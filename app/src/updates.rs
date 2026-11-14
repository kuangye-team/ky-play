use serde::{Deserialize, Serialize};
use std::{
    future::Future,
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::{ipc::Channel, Manager, Resource, ResourceId, Runtime, Webview};
use tauri_plugin_updater::Update;
use tokio_util::sync::CancellationToken;

// Closing this webview-owned resource also stops an in-flight HTTP download.
struct UpdateDownload {
    update: Arc<Update>,
    cancel: CancellationToken,
    package: Mutex<Option<DownloadedPackage>>,
}

struct DownloadedPackage {
    update: Update,
    emulator_cache: Option<PathBuf>,
    bytes: Vec<u8>,
}

#[derive(Deserialize)]
struct AppUpdate {
    emulator_hash: String,
    url: tauri::Url,
    signature: String,
}

fn platform_key() -> String {
    let os = if cfg!(target_os = "macos") {
        "darwin"
    } else {
        "windows"
    };
    format!("{os}-{}", std::env::consts::ARCH)
}

fn app_update(raw: &serde_json::Value, hash: &str, platform: &str) -> Option<AppUpdate> {
    let updates = raw.get("app_updates")?;
    if updates.get("schema")?.as_u64()? != 1 {
        return None;
    }
    let entry: AppUpdate =
        serde_json::from_value(updates.get("platforms")?.get(platform)?.clone()).ok()?;
    (entry.emulator_hash == hash
        && !entry.signature.is_empty()
        && matches!(entry.url.scheme(), "http" | "https")
        && entry.url.username().is_empty()
        && entry.url.password().is_none()
        && entry.url.fragment().is_none())
    .then_some(entry)
}

fn select_package(update: &Update, bundled: PathBuf, data: PathBuf) -> (Update, Option<PathBuf>) {
    let select = || {
        let manifest = crate::emulator::bundled_manifest()?;
        let entry = app_update(&update.raw_json, &manifest.hash, &platform_key())?;
        let mut selected = update.clone();
        selected.download_url = entry.url;
        // Only choose the small package once a complete verified copy exists
        // outside the installation. Disk/copy/checksum failures use the full one.
        let cache = manifest.preserve(&bundled, &data).ok()?;
        selected.signature = entry.signature;
        Some((selected, Some(cache)))
    };
    select().unwrap_or_else(|| (update.clone(), None))
}

fn small_update_paths(
    bundled: Result<PathBuf, tauri::Error>,
    data: Result<PathBuf, tauri::Error>,
) -> Option<(PathBuf, PathBuf)> {
    Some((bundled.ok()?.join("emulatorjs"), data.ok()?))
}

impl Resource for UpdateDownload {
    fn close(self: Arc<Self>) {
        self.cancel.cancel();
    }
}

#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data")]
pub enum DownloadEvent {
    #[serde(rename_all = "camelCase")]
    Started {
        content_length: Option<u64>,
    },
    #[serde(rename_all = "camelCase")]
    Progress {
        chunk_length: usize,
    },
    Finished,
}

async fn cancellable<T>(
    cancel: &CancellationToken,
    work: impl Future<Output = Result<T, String>>,
) -> Result<T, String> {
    tokio::select! {
        biased;
        _ = cancel.cancelled() => Err("Update cancelled".into()),
        result = work => result,
    }
}

#[tauri::command]
pub fn prepare_update_download<R: Runtime>(
    webview: Webview<R>,
    update_rid: ResourceId,
) -> Result<ResourceId, String> {
    let mut resources = webview.resources_table();
    let update = resources
        .get::<Update>(update_rid)
        .map_err(|e| e.to_string())?;
    Ok(resources.add(UpdateDownload {
        update,
        cancel: CancellationToken::new(),
        package: Mutex::new(None),
    }))
}

#[tauri::command]
pub async fn download_update<R: Runtime>(
    webview: Webview<R>,
    download_rid: ResourceId,
    on_event: Channel<DownloadEvent>,
) -> Result<(), String> {
    let download = webview
        .resources_table()
        .get::<UpdateDownload>(download_rid)
        .map_err(|e| e.to_string())?;
    let original = download.update.clone();
    let paths = small_update_paths(
        webview.path().resource_dir(),
        webview.path().app_local_data_dir(),
    );
    let (update, emulator_cache) = if let Some((bundled, data)) = paths {
        cancellable(&download.cancel, async {
            tauri::async_runtime::spawn_blocking(move || select_package(&original, bundled, data))
                .await
                .map_err(|e| e.to_string())
        })
        .await?
    } else {
        ((*original).clone(), None)
    };
    let mut started = false;
    let bytes = cancellable(&download.cancel, async {
        // Keep the plugin's signature verification and platform handling.
        update
            .download(
                |chunk_length, content_length| {
                    if !started {
                        started = true;
                        let _ = on_event.send(DownloadEvent::Started { content_length });
                    }
                    let _ = on_event.send(DownloadEvent::Progress { chunk_length });
                },
                || {},
            )
            .await
            .map_err(|e| e.to_string())
    })
    .await?;
    // Finished means the package has also passed signature verification.
    *download.package.lock().map_err(|e| e.to_string())? = Some(DownloadedPackage {
        update,
        emulator_cache,
        bytes,
    });
    let _ = on_event.send(DownloadEvent::Finished);
    Ok(())
}

#[tauri::command]
pub async fn install_update<R: Runtime>(
    webview: Webview<R>,
    download_rid: ResourceId,
) -> Result<(), String> {
    let download = webview
        .resources_table()
        .get::<UpdateDownload>(download_rid)
        .map_err(|e| e.to_string())?;
    // Installation can block; keep it off the async runtime and UI thread.
    tauri::async_runtime::spawn_blocking(move || {
        if download.cancel.is_cancelled() {
            return Err("Update cancelled".into());
        }
        let package = download.package.lock().map_err(|e| e.to_string())?;
        let package = package.as_ref().ok_or("Update has not been downloaded")?;
        // A download can wait while a game is running. Recheck resources before
        // replacing the application, in case they were deleted in the meantime.
        if let Some(root) = &package.emulator_cache {
            crate::emulator::bundled_manifest()
                .ok_or("Missing emulator manifest")?
                .verify(root)
                .map_err(|e| e.to_string())?;
        }
        package
            .update
            .install(&package.bytes)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selects_only_matching_resources_for_the_current_platform() {
        let hash = "a".repeat(64);
        for platform in ["windows-x86_64", "darwin-aarch64", "darwin-x86_64"] {
            let raw = serde_json::json!({ "app_updates": { "schema": 1, "platforms": {
                platform: { "emulator_hash": hash, "url": "https://example.com/app-update", "signature": "signed" }
            }}});
            assert!(app_update(&raw, &hash, platform).is_some());
            assert!(app_update(&raw, &"b".repeat(64), platform).is_none());
            assert!(app_update(&raw, &hash, "unsupported").is_none());
            for url in [
                "http://host.docker.internal:10888/play/app-update",
                "http://localhost:10888/play/app-update",
            ] {
                let mut local = raw.clone();
                local["app_updates"]["platforms"][platform]["url"] = url.into();
                assert_eq!(
                    app_update(&local, &hash, platform).unwrap().url.as_str(),
                    url
                );
            }
            for url in [
                "file:///update",
                "ftp://example.com/update",
                "http://user:pass@example.com/update",
                "http://example.com/update#part",
                "https://user:pass@example.com/update",
                "not a URL",
                "https://example.com/update#part",
            ] {
                let mut invalid = raw.clone();
                invalid["app_updates"]["platforms"][platform]["url"] = url.into();
                assert!(app_update(&invalid, &hash, platform).is_none());
            }
            let mut invalid = raw.clone();
            invalid["app_updates"]["schema"] = 2.into();
            assert!(app_update(&invalid, &hash, platform).is_none());
            invalid = raw.clone();
            invalid["app_updates"]["platforms"][platform]["signature"] = "".into();
            assert!(app_update(&invalid, &hash, platform).is_none());
        }
        assert!(app_update(
            &serde_json::json!({ "platforms": {} }),
            &hash,
            "windows-x86_64"
        )
        .is_none());
    }

    #[test]
    fn missing_small_update_paths_fall_back_to_the_full_package() {
        let bundled = PathBuf::from("/tmp/ky-play/resources");
        let data = PathBuf::from("/tmp/ky-play/data");
        assert_eq!(
            small_update_paths(Ok(bundled.clone()), Ok(data.clone())),
            Some((bundled.join("emulatorjs"), data))
        );
        assert_eq!(
            small_update_paths(
                Err(tauri::Error::UnknownPath),
                Ok(PathBuf::from("/tmp/data"))
            ),
            None
        );
        assert_eq!(
            small_update_paths(
                Ok(PathBuf::from("/tmp/resources")),
                Err(tauri::Error::UnknownPath)
            ),
            None
        );
    }

    #[tokio::test]
    async fn cancellation_drops_in_flight_work() {
        let cancel = CancellationToken::new();
        let (started, ready) = tokio::sync::oneshot::channel();
        let (held, dropped) = tokio::sync::oneshot::channel::<()>();
        let token = cancel.clone();
        let task = tokio::spawn(async move {
            cancellable(&token, async move {
                let _held = held;
                started.send(()).unwrap();
                std::future::pending::<Result<(), String>>().await
            })
            .await
        });
        ready.await.unwrap();
        cancel.cancel();
        assert_eq!(task.await.unwrap().unwrap_err(), "Update cancelled");
        assert!(dropped.await.is_err());
    }

    #[tokio::test]
    async fn cancellation_wins_even_when_work_is_ready() {
        let cancel = CancellationToken::new();
        cancel.cancel();
        assert!(cancellable(&cancel, async {
            panic!("must not start");
            #[allow(unreachable_code)]
            Ok(())
        })
        .await
        .is_err());
        assert_eq!(
            cancellable(&CancellationToken::new(), async { Ok(vec![1, 2]) })
                .await
                .unwrap(),
            vec![1, 2]
        );
    }
}
