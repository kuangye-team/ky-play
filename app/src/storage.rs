use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::{
    ipc::{InvokeBody, Request, Response},
    State,
};

const CHUNK_SIZE: usize = 4 * 1024 * 1024;
type Result<T> = std::result::Result<T, String>;
fn error(e: impl std::fmt::Display) -> String {
    e.to_string()
}

pub struct Storage {
    connection: Connection,
    root: PathBuf,
    locator: Option<PathBuf>,
    _lock: File,
}
pub type StorageState = Arc<Mutex<Storage>>;

#[derive(Deserialize)]
pub struct Change {
    kind: String,
    store: String,
    key: Option<String>,
    value: Option<Value>,
    #[serde(default)]
    files: Vec<String>,
}
#[derive(Serialize)]
pub struct Row {
    key: String,
    value: Value,
}

fn check_store(store: &str) -> Result<()> {
    if ["games", "roms", "tags", "saves", "settings", "nativeSaves"].contains(&store) {
        Ok(())
    } else {
        Err("Unknown storage collection".into())
    }
}
impl Storage {
    pub fn open_configured(default: PathBuf) -> Result<Self> {
        fs::create_dir_all(&default).map_err(error)?;
        let default = default.canonicalize().map_err(error)?;
        let locator = default.join("storage-location.sqlite3");
        let config = Self::location_database(&locator)?;
        let configured: Option<String> = config
            .query_row("SELECT directory FROM location WHERE id = 1", [], |row| {
                row.get(0)
            })
            .optional()
            .map_err(error)?;
        let has_configured = configured.is_some();
        let root = configured.map(PathBuf::from).unwrap_or(default);
        // A disconnected drive must never silently become a new, empty library.
        if has_configured && !root.join("library.sqlite3").is_file() {
            return Err("数据存储目录无法访问，请连接存储设备后重试。".into());
        }
        let mut storage = Self::open(root)?;
        storage.locator = Some(locator);
        Ok(storage)
    }
    fn location_database(path: &Path) -> Result<Connection> {
        let config = Connection::open(path).map_err(error)?;
        config.execute_batch("PRAGMA synchronous = FULL;
            CREATE TABLE IF NOT EXISTS location (id INTEGER PRIMARY KEY CHECK(id = 1), directory TEXT NOT NULL);")
            .map_err(error)?;
        Ok(config)
    }
    pub fn open(root: PathBuf) -> Result<Self> {
        fs::create_dir_all(&root).map_err(error)?;
        let root = root.canonicalize().map_err(error)?;
        let lock = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(root.join("storage.lock"))
            .map_err(error)?;
        fs2::FileExt::try_lock_exclusive(&lock).map_err(error)?;
        Self::open_locked(root, lock)
    }
    fn open_locked(root: PathBuf, lock: File) -> Result<Self> {
        fs::create_dir_all(root.join("files")).map_err(error)?;
        let connection = Connection::open(root.join("library.sqlite3")).map_err(error)?;
        connection
            .execute_batch(
                "PRAGMA foreign_keys = ON;
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = FULL;
            CREATE TABLE IF NOT EXISTS records (
                store TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
                PRIMARY KEY (store, key));
            CREATE TABLE IF NOT EXISTS files (
                id TEXT PRIMARY KEY, store TEXT NOT NULL, key TEXT NOT NULL,
                FOREIGN KEY (store, key) REFERENCES records(store, key) ON DELETE CASCADE);",
            )
            .map_err(error)?;
        let storage = Self {
            connection,
            root,
            locator: None,
            _lock: lock,
        };
        // Recover staged files left by a crash and retry prior interrupted cleanup.
        for entry in fs::read_dir(storage.root.join("files")).map_err(error)? {
            let entry = entry.map_err(error)?;
            let id = entry.file_name().to_string_lossy().into_owned();
            if uuid::Uuid::parse_str(&id).is_ok() && entry.file_type().map_err(error)?.is_file() {
                if let Err(e) = storage.discard(&id) {
                    eprintln!("Storage cleanup: {e}");
                }
            }
        }
        Ok(storage)
    }
    fn info(&self) -> Value {
        serde_json::json!({ "directory": self.root })
    }
    fn move_to(&mut self, target: &Path) -> Result<Value> {
        let target = target.canonicalize().map_err(error)?;
        if target == self.root {
            return Ok(self.info());
        }
        let locator = self
            .locator
            .clone()
            .ok_or("Missing storage configuration")?;
        if target.starts_with(&self.root)
            || self.root.starts_with(&target)
            || locator.starts_with(&target)
        {
            return Err("storage_directory_overlap".into());
        }
        if fs::read_dir(&target).map_err(error)?.next().is_some() {
            return Err("storage_directory_not_empty".into());
        }
        let mut files = Vec::new();
        for entry in fs::read_dir(self.root.join("files")).map_err(error)? {
            let entry = entry.map_err(error)?;
            let id = entry.file_name().to_string_lossy().into_owned();
            if uuid::Uuid::parse_str(&id).is_err() {
                continue;
            }
            if !entry.file_type().map_err(error)?.is_file() {
                return Err("Invalid stored file".into());
            }
            if !self.referenced(&id)? {
                return Err("storage_directory_busy".into());
            }
            files.push(entry.path());
        }
        let expected: usize = self
            .connection
            .query_row("SELECT COUNT(*) FROM files", [], |row| row.get(0))
            .map_err(error)?;
        if files.len() != expected {
            return Err("Missing stored file".into());
        }
        // Reserve only our own paths; never clean up a directory owned by another instance.
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .open(target.join("storage.lock"))
            .map_err(error)?;
        fs2::FileExt::try_lock_exclusive(&lock).map_err(error)?;
        if let Err(cause) = fs::create_dir(target.join("files")) {
            drop(lock);
            let _ = fs::remove_file(target.join("storage.lock"));
            return Err(error(cause));
        }
        // Keep the original library live until the copy and its location commit succeed.
        let prepare = (|| -> Result<Self> {
            let mut next = Self::open_locked(target.clone(), lock)?;
            for source in files {
                let mut input = File::open(&source).map_err(error)?;
                let mut output = OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(target.join("files").join(source.file_name().unwrap()))
                    .map_err(error)?;
                let size = std::io::copy(&mut input, &mut output).map_err(error)?;
                if size != input.metadata().map_err(error)?.len() {
                    return Err("Incomplete storage copy".into());
                }
                output.sync_all().map_err(error)?;
            }
            rusqlite::backup::Backup::new(&self.connection, &mut next.connection)
                .map_err(error)?
                .run_to_completion(256, std::time::Duration::from_millis(10), None)
                .map_err(error)?;
            let check: String = next
                .connection
                .query_row("PRAGMA quick_check", [], |row| row.get(0))
                .map_err(error)?;
            if check != "ok" {
                return Err("Storage copy verification failed".into());
            }
            #[cfg(unix)]
            for path in [&target, &target.join("files")] {
                File::open(path)
                    .and_then(|dir| dir.sync_all())
                    .map_err(error)?;
            }
            Self::location_database(&locator)?
                .execute(
                    "INSERT OR REPLACE INTO location (id, directory) VALUES (1, ?1)",
                    [target.to_str().ok_or("Invalid storage directory")?],
                )
                .map_err(error)?;
            next.locator = Some(locator);
            Ok(next)
        })();
        let next = match prepare {
            Ok(next) => next,
            Err(cause) => {
                cleanup_library(&target);
                return Err(cause);
            }
        };
        let old_root = self.root.clone();
        drop(std::mem::replace(self, next));
        // The default directory also holds WebView data and the locator: leave those intact.
        let cleanup_warning = !cleanup_library(&old_root);
        let mut info = self.info();
        info["cleanupWarning"] = Value::Bool(cleanup_warning);
        Ok(info)
    }
    fn path(&self, id: &str) -> Result<PathBuf> {
        if uuid::Uuid::parse_str(id).map_err(error)?.to_string() != id {
            return Err("Invalid file ID".into());
        }
        Ok(self.root.join("files").join(id))
    }
    fn referenced(&self, id: &str) -> Result<bool> {
        self.connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM files WHERE id = ?1)",
                [id],
                |row| row.get(0),
            )
            .map_err(error)
    }
    fn discard(&self, id: &str) -> Result<()> {
        let path = self.path(id)?;
        if !self.referenced(id)? {
            match fs::remove_file(path) {
                Ok(()) => (),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
                Err(e) => return Err(error(e)),
            }
        }
        Ok(())
    }
    fn create_file(&self) -> Result<String> {
        let id = uuid::Uuid::new_v4().to_string();
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(self.path(&id)?)
            .map_err(error)?;
        Ok(id)
    }
    fn write_file(&self, id: &str, offset: u64, bytes: &[u8]) -> Result<()> {
        if bytes.len() > CHUNK_SIZE || self.referenced(id)? {
            return Err("Invalid file write".into());
        }
        let mut file = OpenOptions::new()
            .append(true)
            .open(self.path(id)?)
            .map_err(error)?;
        if file.metadata().map_err(error)?.len() != offset {
            return Err("Unexpected file offset".into());
        }
        file.write_all(bytes).map_err(error)
    }
    fn read(&self, store: &str, key: Option<&str>) -> Result<Vec<Row>> {
        check_store(store)?;
        let mut statement = self.connection.prepare("SELECT key, value FROM records WHERE store = ?1 AND (?2 IS NULL OR key = ?2) ORDER BY key").map_err(error)?;
        let rows = statement
            .query_map(params![store, key], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(error)?;
        rows.map(|row| {
            let (key, value) = row.map_err(error)?;
            Ok(Row {
                key,
                value: serde_json::from_str(&value).map_err(error)?,
            })
        })
        .collect()
    }
    fn commit(&mut self, changes: Vec<Change>) -> Result<()> {
        let mut referenced = HashSet::new();
        for change in &changes {
            check_store(&change.store)?;
            if change.kind != "clear" && change.key.as_ref().is_none_or(|key| key.is_empty()) {
                return Err("Missing record key".into());
            }
            if change.kind == "put" {
                let value = change.value.as_ref().ok_or("Missing record value")?;
                let mut descriptors = Vec::new();
                collect_files(value, &mut descriptors)?;
                let actual: HashSet<_> = descriptors.iter().map(|(id, _)| id.clone()).collect();
                if actual != change.files.iter().cloned().collect() {
                    return Err("File references do not match".into());
                }
                for (id, size) in descriptors {
                    if !referenced.insert(id.clone()) || self.referenced(&id)? {
                        return Err("File already committed".into());
                    }
                    // Windows FlushFileBuffers requires a handle with write access.
                    let file = OpenOptions::new()
                        .write(true)
                        .open(self.path(&id)?)
                        .map_err(error)?;
                    if file.metadata().map_err(error)?.len() != size {
                        return Err("Incomplete file".into());
                    }
                    file.sync_all().map_err(error)?;
                }
            }
        }
        #[cfg(unix)]
        File::open(self.root.join("files"))
            .and_then(|dir| dir.sync_all())
            .map_err(error)?;
        // Only collect old references, never unrelated uploads from other requests.
        let mut obsolete = Vec::new();
        let tx = self.connection.transaction().map_err(error)?;
        for change in changes {
            let key = change.key.as_deref();
            let mut statement = tx
                .prepare("SELECT id FROM files WHERE store = ?1 AND (?2 IS NULL OR key = ?2)")
                .map_err(error)?;
            obsolete.extend(
                statement
                    .query_map(
                        params![
                            change.store,
                            if change.kind == "clear" { None } else { key }
                        ],
                        |row| row.get::<_, String>(0),
                    )
                    .map_err(error)?
                    .collect::<std::result::Result<Vec<_>, _>>()
                    .map_err(error)?,
            );
            drop(statement);
            match change.kind.as_str() {
                "clear" => {
                    tx.execute("DELETE FROM records WHERE store = ?1", [&change.store])
                        .map_err(error)?;
                }
                "delete" => {
                    tx.execute(
                        "DELETE FROM records WHERE store = ?1 AND key = ?2",
                        params![change.store, key],
                    )
                    .map_err(error)?;
                }
                "put" => {
                    tx.execute(
                        "DELETE FROM records WHERE store = ?1 AND key = ?2",
                        params![change.store, key],
                    )
                    .map_err(error)?;
                    tx.execute(
                        "INSERT INTO records (store, key, value) VALUES (?1, ?2, ?3)",
                        params![
                            change.store,
                            key,
                            serde_json::to_string(&change.value).map_err(error)?
                        ],
                    )
                    .map_err(error)?;
                    for id in change.files {
                        tx.execute(
                            "INSERT INTO files (id, store, key) VALUES (?1, ?2, ?3)",
                            params![id, change.store, key],
                        )
                        .map_err(error)?;
                    }
                }
                _ => return Err("Unknown storage operation".into()),
            }
        }
        tx.commit().map_err(error)?;
        for id in obsolete {
            if let Err(e) = self.discard(&id) {
                eprintln!("Storage cleanup: {e}");
            }
        }
        Ok(())
    }
}
fn cleanup_library(root: &Path) -> bool {
    let mut complete = true;
    for name in [
        "files",
        "library.sqlite3",
        "library.sqlite3-wal",
        "library.sqlite3-shm",
        "storage.lock",
    ] {
        let path = root.join(name);
        let result = if name == "files" {
            fs::remove_dir_all(path)
        } else {
            fs::remove_file(path)
        };
        if let Err(e) = result {
            if e.kind() != std::io::ErrorKind::NotFound {
                complete = false;
            }
        }
    }
    complete
}
fn collect_files(value: &Value, files: &mut Vec<(String, u64)>) -> Result<()> {
    match value {
        Value::Object(object) => {
            if let Some(id) = object.get("$file") {
                files.push((
                    id.as_str().ok_or("Invalid file reference")?.into(),
                    object
                        .get("size")
                        .and_then(Value::as_u64)
                        .ok_or("Invalid file size")?,
                ));
            } else {
                for child in object.values() {
                    collect_files(child, files)?;
                }
            }
        }
        Value::Array(items) => {
            for child in items {
                collect_files(child, files)?;
            }
        }
        _ => (),
    }
    Ok(())
}

#[tauri::command]
pub fn storage_info(state: State<StorageState>) -> Result<Value> {
    Ok(state.lock().map_err(error)?.info())
}
#[tauri::command]
pub async fn storage_move(state: State<'_, StorageState>, directory: String) -> Result<Value> {
    let storage = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || {
        storage
            .lock()
            .map_err(error)?
            .move_to(Path::new(&directory))
    })
    .await
    .map_err(error)?
}
#[tauri::command]
pub fn storage_read(
    state: State<StorageState>,
    store: String,
    key: Option<String>,
) -> Result<Vec<Row>> {
    state.lock().map_err(error)?.read(&store, key.as_deref())
}
#[tauri::command]
pub fn storage_commit(state: State<StorageState>, changes: Vec<Change>) -> Result<()> {
    state.lock().map_err(error)?.commit(changes)
}
#[tauri::command]
pub fn storage_create_file(state: State<StorageState>) -> Result<String> {
    state.lock().map_err(error)?.create_file()
}
#[tauri::command]
pub fn storage_discard_files(state: State<StorageState>, ids: Vec<String>) -> Result<()> {
    let storage = state.lock().map_err(error)?;
    for id in ids {
        storage.discard(&id)?;
    }
    Ok(())
}
#[tauri::command]
pub fn storage_write_file(state: State<StorageState>, request: Request<'_>) -> Result<()> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected binary data".into());
    };
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .ok_or_else(|| "Missing file header".to_string())
    };
    state.lock().map_err(error)?.write_file(
        header("x-file-id")?,
        header("x-file-offset")?.parse().map_err(error)?,
        bytes,
    )
}
#[tauri::command]
pub fn storage_read_file(
    state: State<StorageState>,
    id: String,
    offset: u64,
    length: usize,
) -> Result<Response> {
    if length > CHUNK_SIZE {
        return Err("File chunk too large".into());
    }
    let storage = state.lock().map_err(error)?;
    let mut file = File::open(storage.path(&id)?).map_err(error)?;
    file.seek(SeekFrom::Start(offset)).map_err(error)?;
    let mut bytes = vec![0; length];
    file.read_exact(&mut bytes).map_err(error)?;
    Ok(Response::new(bytes))
}
#[tauri::command]
pub fn storage_estimate(state: State<StorageState>) -> Result<Value> {
    let storage = state.lock().map_err(error)?;
    let quota = fs2::total_space(&storage.root).map_err(error)?;
    let available = fs2::available_space(&storage.root).map_err(error)?;
    Ok(serde_json::json!({ "quota": quota, "usage": quota.saturating_sub(available) }))
}

#[cfg(test)]
mod tests {
    use super::*;
    struct TestRoot(PathBuf);
    impl TestRoot {
        fn new() -> Self {
            Self(std::env::temp_dir().join(format!("ky-play-storage-{}", uuid::Uuid::new_v4())))
        }
        fn open(&self) -> Storage {
            Storage::open(self.0.clone()).unwrap()
        }
    }
    impl Drop for TestRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn put(store: &str, key: &str, value: Value, files: Vec<String>) -> Change {
        Change {
            kind: "put".into(),
            store: store.into(),
            key: Some(key.into()),
            value: Some(value),
            files,
        }
    }
    fn file_record(storage: &Storage, bytes: &[u8]) -> (String, Value) {
        let id = storage.create_file().unwrap();
        storage.write_file(&id, 0, bytes).unwrap();
        let value = serde_json::json!({ "$file": id, "size": bytes.len(), "type": "" });
        (id, value)
    }
    #[test]
    fn files_and_sqlite_survive_reopen_and_orphans_are_recovered() {
        let root = TestRoot::new();
        let mut storage = root.open();
        let (id, value) = file_record(&storage, b"ROM");
        storage
            .commit(vec![
                put("roms", "game", value.clone(), vec![id.clone()]),
                put("games", "game", serde_json::json!({"id":"game"}), vec![]),
            ])
            .unwrap();
        let orphan = storage.create_file().unwrap();
        fs::write(root.0.join("files/.DS_Store"), b"Finder metadata").unwrap();
        storage.discard(&id).unwrap(); // lost commit reply must not delete committed content
        drop(storage);
        let storage = root.open();
        assert_eq!(storage.read("roms", Some("game")).unwrap()[0].value, value);
        assert_eq!(fs::read(storage.path(&id).unwrap()).unwrap(), b"ROM");
        assert!(!storage.path(&orphan).unwrap().exists());
        assert!(Storage::open(root.0.clone()).is_err());
    }
    #[test]
    fn failed_batch_rolls_back_metadata_and_keeps_original_file() {
        let root = TestRoot::new();
        let mut storage = root.open();
        let (original, value) = file_record(&storage, b"old");
        storage
            .commit(vec![put(
                "roms",
                "game",
                value.clone(),
                vec![original.clone()],
            )])
            .unwrap();
        let (replacement, next) = file_record(&storage, b"new");
        assert!(storage
            .commit(vec![
                put("roms", "game", next, vec![replacement.clone()]),
                Change {
                    kind: "invalid".into(),
                    store: "games".into(),
                    key: Some("game".into()),
                    value: None,
                    files: vec![]
                }
            ])
            .is_err());
        storage.discard(&replacement).unwrap();
        assert_eq!(storage.read("roms", Some("game")).unwrap()[0].value, value);
        assert!(storage.path(&original).unwrap().exists());
        assert!(!storage.path(&replacement).unwrap().exists());
    }
    #[test]
    fn replacing_and_removing_records_reclaims_only_their_files() {
        let root = TestRoot::new();
        let mut storage = root.open();
        let (old, value) = file_record(&storage, b"old save");
        let (other, other_value) = file_record(&storage, b"another game");
        storage
            .commit(vec![
                put("saves", "save", value, vec![old.clone()]),
                put("roms", "other", other_value, vec![other.clone()]),
            ])
            .unwrap();
        let (new, value) = file_record(&storage, b"new save");
        storage
            .commit(vec![put("saves", "save", value, vec![new.clone()])])
            .unwrap();
        assert!(!storage.path(&old).unwrap().exists());
        assert!(storage.path(&new).unwrap().exists());
        storage
            .commit(vec![Change {
                kind: "clear".into(),
                store: "saves".into(),
                key: None,
                value: None,
                files: vec![],
            }])
            .unwrap();
        assert!(!storage.path(&new).unwrap().exists());
        assert!(storage.path(&other).unwrap().exists());
    }
    #[test]
    fn incomplete_uploads_and_path_escape_are_rejected() {
        let root = TestRoot::new();
        let mut storage = root.open();
        let (id, _) = file_record(&storage, b"abc");
        assert!(storage.write_file(&id, 0, b"overwrite").is_err());
        assert!(storage.path("../library.sqlite3").is_err());
        assert!(storage.read("arbitrary", None).is_err());
        assert!(storage
            .commit(vec![put(
                "roms",
                "game",
                serde_json::json!({"$file": id, "size":4}),
                vec![id.clone()]
            )])
            .is_err());
        assert!(storage.read("roms", None).unwrap().is_empty());
        storage
            .commit(vec![put(
                "roms",
                "game",
                serde_json::json!({"$file": id, "size":3}),
                vec![id.clone()],
            )])
            .unwrap();
        assert!(storage.write_file(&id, 3, b"edit committed file").is_err());
    }
    #[test]
    fn native_files_have_no_browser_one_gib_limit() {
        let root = TestRoot::new();
        let mut storage = root.open();
        let id = storage.create_file().unwrap();
        let size: u64 = 1024 * 1024 * 1024 + 1;
        OpenOptions::new()
            .write(true)
            .open(storage.path(&id).unwrap())
            .unwrap()
            .set_len(size)
            .unwrap();
        storage
            .commit(vec![put(
                "roms",
                "large",
                serde_json::json!({"$file": id, "size":size}),
                vec![id],
            )])
            .unwrap();
        assert_eq!(
            storage.read("roms", Some("large")).unwrap()[0].value["size"],
            size
        );
    }
    #[test]
    fn migration_preserves_all_collections_and_reopens_at_the_selected_directory() {
        let default = TestRoot::new();
        let target = TestRoot::new();
        fs::create_dir_all(&target.0).unwrap();
        let mut storage = Storage::open_configured(default.0.clone()).unwrap();
        let mut ids = Vec::new();
        for store in ["games", "roms", "tags", "saves", "settings", "nativeSaves"] {
            let (id, value) = file_record(&storage, store.as_bytes());
            storage
                .commit(vec![put(store, "record", value, vec![id.clone()])])
                .unwrap();
            ids.push((store, id));
        }
        fs::write(default.0.join("webview-data"), b"leave in place").unwrap();
        let info = storage.move_to(&target.0).unwrap();
        assert_eq!(
            info["directory"],
            target.0.canonicalize().unwrap().to_str().unwrap()
        );
        assert_eq!(info["cleanupWarning"], false);
        assert!(!default.0.join("library.sqlite3").exists());
        assert!(!default.0.join("files").exists());
        assert!(default.0.join("webview-data").exists());
        assert!(default.0.join("storage-location.sqlite3").exists());
        assert!(Storage::open(target.0.clone()).is_err());
        storage
            .commit(vec![put(
                "settings",
                "after-move",
                Value::Bool(true),
                vec![],
            )])
            .unwrap();
        drop(storage);
        let storage = Storage::open_configured(default.0.clone()).unwrap();
        for (store, id) in ids {
            assert_eq!(
                storage.read(store, Some("record")).unwrap()[0].value["$file"],
                id
            );
            assert_eq!(
                fs::read(storage.path(&id).unwrap()).unwrap(),
                store.as_bytes()
            );
        }
        assert_eq!(
            storage.read("settings", Some("after-move")).unwrap()[0].value,
            true
        );
    }
    #[test]
    fn migration_rejects_nonempty_nested_and_busy_destinations_without_data_loss() {
        let default = TestRoot::new();
        let target = TestRoot::new();
        fs::create_dir_all(&target.0).unwrap();
        let mut storage = Storage::open_configured(default.0.clone()).unwrap();
        storage
            .commit(vec![put("settings", "keep", Value::Bool(true), vec![])])
            .unwrap();
        fs::write(target.0.join("keep.txt"), b"unrelated").unwrap();
        assert_eq!(
            storage.move_to(&target.0).unwrap_err(),
            "storage_directory_not_empty"
        );
        assert_eq!(fs::read(target.0.join("keep.txt")).unwrap(), b"unrelated");
        let nested = default.0.join("nested");
        fs::create_dir(&nested).unwrap();
        assert_eq!(
            storage.move_to(&nested).unwrap_err(),
            "storage_directory_overlap"
        );
        assert!(storage.move_to(&default.0).is_ok());
        fs::remove_file(target.0.join("keep.txt")).unwrap();
        let pending = storage.create_file().unwrap();
        assert_eq!(
            storage.move_to(&target.0).unwrap_err(),
            "storage_directory_busy"
        );
        assert!(fs::read_dir(&target.0).unwrap().next().is_none());
        storage.discard(&pending).unwrap();
        assert_eq!(
            storage.read("settings", Some("keep")).unwrap()[0].value,
            true
        );
        assert!(storage.move_to(&target.0).is_ok());
    }
    #[test]
    fn failed_location_commit_rolls_back_and_can_retry() {
        let default = TestRoot::new();
        let target = TestRoot::new();
        fs::create_dir_all(&target.0).unwrap();
        let mut storage = Storage::open_configured(default.0.clone()).unwrap();
        let (id, value) = file_record(&storage, b"save data");
        storage
            .commit(vec![put("saves", "save", value, vec![id.clone()])])
            .unwrap();
        let locator = storage.locator.clone().unwrap();
        // Fail after copying, without relying on platform-dependent permissions.
        storage.locator = Some(default.0.join("missing/config.sqlite3"));
        assert!(storage.move_to(&target.0).is_err());
        assert!(fs::read_dir(&target.0).unwrap().next().is_none());
        assert_eq!(fs::read(storage.path(&id).unwrap()).unwrap(), b"save data");
        storage.locator = Some(locator);
        drop(storage);
        let mut storage = Storage::open_configured(default.0.clone()).unwrap();
        assert_eq!(storage.root, default.0.canonicalize().unwrap());
        storage.move_to(&target.0).unwrap();
        drop(storage);
        // An unavailable configured drive must fail instead of creating an empty library.
        fs::remove_dir_all(&target.0).unwrap();
        assert!(Storage::open_configured(default.0.clone()).is_err());
        assert!(!target.0.exists());
    }
    #[test]
    fn migration_rejects_missing_committed_files() {
        let default = TestRoot::new();
        let target = TestRoot::new();
        fs::create_dir_all(&target.0).unwrap();
        let mut storage = Storage::open_configured(default.0.clone()).unwrap();
        let (id, value) = file_record(&storage, b"game");
        storage
            .commit(vec![put("roms", "game", value, vec![id.clone()])])
            .unwrap();
        fs::remove_file(storage.path(&id).unwrap()).unwrap();
        assert!(storage.move_to(&target.0).is_err());
        assert!(default.0.join("library.sqlite3").exists());
        assert!(fs::read_dir(&target.0).unwrap().next().is_none());
    }
}
