use std::{
    borrow::Cow,
    fs,
    path::{Path, PathBuf},
    sync::OnceLock,
};
use tauri::{
    utils::assets::{AssetKey, AssetsIter, CspHash},
    App, Assets, Manager, Runtime,
};

/// Keep the existing same-origin URLs, headers and MIME handling while reading
/// the emulator from the shared resource directory instead of the executable.
pub struct DesktopAssets<R: Runtime> {
    embedded: Box<dyn Assets<R>>,
    emulator_root: OnceLock<PathBuf>,
}

impl<R: Runtime> DesktopAssets<R> {
    pub fn new(embedded: Box<dyn Assets<R>>) -> Self {
        Self {
            embedded,
            emulator_root: OnceLock::new(),
        }
    }
}

fn read_resource(root: &Path, relative: &str) -> Option<Vec<u8>> {
    // Tauri has already URL-decoded the asset key. Reject traversal and Windows
    // drive/stream syntax, and keep symlinks inside the emulator resource tree.
    if relative
        .split('/')
        .any(|part| part.is_empty() || part == "." || part == ".." || part.contains(['\\', ':']))
    {
        return None;
    }
    let path = root.join(relative).canonicalize().ok()?;
    if !path.starts_with(root) || !path.is_file() {
        return None;
    }
    fs::read(path).ok()
}

impl<R: Runtime> Assets<R> for DesktopAssets<R> {
    fn setup(&self, app: &App<R>) {
        self.embedded.setup(app);
        if let Ok(root) = app
            .path()
            .resource_dir()
            .and_then(|dir| dir.join("emulatorjs").canonicalize().map_err(Into::into))
        {
            let _ = self.emulator_root.set(root);
        }
    }

    fn get(&self, key: &AssetKey) -> Option<Cow<'_, [u8]>> {
        if let Some(relative) = key.as_ref().strip_prefix("/emulatorjs/") {
            return read_resource(self.emulator_root.get()?, relative).map(Cow::Owned);
        }
        self.embedded.get(key)
    }

    fn iter(&self) -> Box<AssetsIter<'_>> {
        self.embedded.iter()
    }

    fn csp_hashes(&self, html_path: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        self.embedded.csp_hashes(html_path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../temp/artifacts")
                .join(format!("desktop-assets-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(root.join("emulatorjs/data/cores")).unwrap();
            Self(root.canonicalize().unwrap())
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    struct Frontend;
    impl Assets<tauri::Wry> for Frontend {
        fn get(&self, key: &AssetKey) -> Option<Cow<'_, [u8]>> {
            (key.as_ref() == "/player.html").then_some(Cow::Borrowed(b"player"))
        }
        fn iter(&self) -> Box<AssetsIter<'_>> {
            Box::new(std::iter::empty())
        }
        fn csp_hashes(&self, _: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
            Box::new(std::iter::empty())
        }
    }

    #[test]
    fn serves_resource_bytes_and_keeps_the_embedded_frontend() {
        let fixture = Fixture::new();
        let root = fixture.0.join("emulatorjs");
        let assets = DesktopAssets::new(Box::new(Frontend));
        assets.emulator_root.set(root.clone()).unwrap();
        fs::write(root.join("data/cores/nes.data"), [0, 255, 1, 128]).unwrap();
        assert_eq!(
            assets
                .get(&"/emulatorjs/data/cores/nes.data".into())
                .unwrap()
                .as_ref(),
            &[0, 255, 1, 128]
        );
        assert_eq!(
            assets.get(&"/player.html".into()).unwrap().as_ref(),
            b"player"
        );
        assert!(assets.get(&"/emulatorjs/data/missing.js".into()).is_none());
        assert!(DesktopAssets::new(Box::new(Frontend))
            .get(&"/emulatorjs/data/loader.js".into())
            .is_none());
    }

    #[test]
    fn rejects_paths_outside_the_emulator_directory() {
        let fixture = Fixture::new();
        fs::write(fixture.0.join("private.txt"), b"private").unwrap();
        let root = fixture.0.join("emulatorjs");
        for path in [
            "../private.txt",
            "data/../../private.txt",
            "/private.txt",
            "data\\..\\..\\private.txt",
            "C:/private.txt",
            "data/file:stream",
            "data/cores",
            "",
        ] {
            assert!(read_resource(&root, path).is_none(), "{path}");
        }
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(fixture.0.join("private.txt"), root.join("link.txt"))
                .unwrap();
            assert!(read_resource(&root, "link.txt").is_none());
        }
    }
}
