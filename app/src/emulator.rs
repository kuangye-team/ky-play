use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{self, Read},
    path::{Path, PathBuf},
    sync::Mutex,
};

// Outside the application bundle: both NSIS and the macOS updater can replace
// the installation without removing resources needed by an app-only update.
static CACHE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Deserialize, Serialize)]
pub struct EmulatorManifest {
    schema: u32,
    pub hash: String,
    files: Vec<EmulatorFile>,
}

#[derive(Deserialize, Serialize)]
struct EmulatorFile {
    path: String,
    size: u64,
    sha256: String,
}

pub fn bundled_manifest() -> Option<EmulatorManifest> {
    serde_json::from_str(include_str!(concat!(
        env!("OUT_DIR"),
        "/emulator-manifest.json"
    )))
    .ok()
}

fn failure(message: &str) -> io::Error {
    io::Error::other(message)
}

fn safe_relative(path: &str) -> bool {
    !path
        .split('/')
        .any(|part| part.is_empty() || part == "." || part == ".." || part.contains(['\\', ':']))
}

impl EmulatorManifest {
    fn valid(&self) -> bool {
        self.schema == 1
            && !self.files.is_empty()
            && self.files.iter().all(|file| safe_relative(&file.path))
            && self
                .files
                .windows(2)
                .all(|pair| pair[0].path < pair[1].path)
            && serde_json::to_vec(&self.files)
                .map(|bytes| format!("{:x}", Sha256::digest(bytes)) == self.hash)
                .unwrap_or(false)
    }

    pub fn cache_root(&self, data: &Path) -> Option<PathBuf> {
        self.valid()
            .then(|| data.join("emulators").join(&self.hash))
    }

    pub fn verify(&self, root: &Path) -> io::Result<()> {
        if !self.valid() || count_files(root)? != self.files.len() {
            return Err(failure("Emulator inventory does not match"));
        }
        let mut buffer = [0u8; 64 * 1024];
        for expected in &self.files {
            let mut file = fs::File::open(root.join(&expected.path))?;
            if file.metadata()?.len() != expected.size {
                return Err(failure("Emulator file size does not match"));
            }
            let mut hash = Sha256::new();
            loop {
                let length = file.read(&mut buffer)?;
                if length == 0 {
                    break;
                }
                hash.update(&buffer[..length]);
            }
            if format!("{:x}", hash.finalize()) != expected.sha256 {
                return Err(failure("Emulator file checksum does not match"));
            }
        }
        Ok(())
    }

    pub fn preserve(&self, bundled: &Path, data: &Path) -> io::Result<PathBuf> {
        let _lock = CACHE_LOCK
            .lock()
            .map_err(|_| failure("Emulator cache is busy"))?;
        let destination = self
            .cache_root(data)
            .ok_or_else(|| failure("Invalid emulator manifest"))?;
        if self.verify(&destination).is_ok() {
            return Ok(destination);
        }
        self.verify(bundled)?;
        let parent = destination.parent().unwrap();
        fs::create_dir_all(parent)?;
        let staging = parent.join(format!(".staging-{}", uuid::Uuid::new_v4()));
        let result = (|| {
            fs::create_dir(&staging)?;
            for file in &self.files {
                let target = staging.join(&file.path);
                fs::create_dir_all(target.parent().unwrap())?;
                fs::copy(bundled.join(&file.path), target)?;
            }
            self.verify(&staging)?;
            if destination.exists() {
                fs::remove_dir_all(&destination)?;
            }
            fs::rename(&staging, &destination)?;
            Ok(destination)
        })();
        let _ = fs::remove_dir_all(staging);
        result
    }
}

fn count_files(root: &Path) -> io::Result<usize> {
    if !fs::symlink_metadata(root)?.is_dir() {
        return Err(failure("Emulator directory is not a regular directory"));
    }
    let mut count = 0;
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        if kind.is_dir() {
            count += count_files(&entry.path())?;
        } else if kind.is_file() {
            count += 1;
        } else {
            return Err(failure("Unsupported emulator entry"));
        }
    }
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../temp/artifacts")
                .join(format!("emulator-test-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(root.join("bundled/data/cores")).unwrap();
            fs::write(root.join("bundled/data/loader.js"), b"loader").unwrap();
            fs::write(root.join("bundled/data/cores/nes.data"), [0, 255, 1, 128]).unwrap();
            Self(root)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn manifest() -> EmulatorManifest {
        serde_json::from_str(include_str!(
            "../../scripts/fixtures/emulator-manifest.json"
        ))
        .unwrap()
    }

    #[test]
    fn preserved_resources_survive_replacing_the_full_install_and_repeated_app_updates() {
        let fixture = Fixture::new();
        let bundled = fixture.0.join("bundled");
        let data = fixture.0.join("app-data");
        let manifest = manifest();
        assert!(
            manifest.valid(),
            "Node and Rust must agree on the inventory hash"
        );
        let cache = manifest.preserve(&bundled, &data).unwrap();
        fs::remove_dir_all(&bundled).unwrap();
        assert!(manifest.verify(&cache).is_ok());
        assert_eq!(manifest.preserve(&bundled, &data).unwrap(), cache);
        fs::write(cache.join("data/loader.js"), b"broken").unwrap();
        assert!(
            manifest.verify(&cache).is_err(),
            "same-size corruption must be detected"
        );
        assert!(
            manifest.preserve(&bundled, &data).is_err(),
            "missing bundle must force a full update"
        );
    }

    #[test]
    fn repairs_invalid_cache_from_verified_bundle_and_rejects_incomplete_sources() {
        let fixture = Fixture::new();
        let bundled = fixture.0.join("bundled");
        let data = fixture.0.join("app-data");
        let manifest = manifest();
        let cache = manifest.preserve(&bundled, &data).unwrap();
        fs::remove_file(cache.join("data/cores/nes.data")).unwrap();
        assert!(manifest.verify(&cache).is_err());
        assert_eq!(manifest.preserve(&bundled, &data).unwrap(), cache);
        fs::write(cache.join("extra.js"), b"extra").unwrap();
        assert!(manifest.verify(&cache).is_err());
        manifest.preserve(&bundled, &data).unwrap();
        assert!(!cache.join("extra.js").exists());
        fs::remove_dir_all(&cache).unwrap();
        fs::remove_file(bundled.join("data/loader.js")).unwrap();
        assert!(manifest.preserve(&bundled, &data).is_err());
        assert!(!cache.exists());
    }

    #[test]
    fn refuses_invalid_inventory_and_symlinked_files() {
        let fixture = Fixture::new();
        let mut manifest = manifest();
        manifest.hash = "../escape".into();
        assert!(manifest.cache_root(&fixture.0).is_none());
        for path in [
            "../file",
            "/absolute",
            "data/./file",
            "C:/file",
            "data\\file",
            "data/file:stream",
        ] {
            assert!(!safe_relative(path));
        }
        #[cfg(unix)]
        {
            let bundled = fixture.0.join("bundled");
            fs::rename(bundled.join("data/loader.js"), fixture.0.join("outside.js")).unwrap();
            std::os::unix::fs::symlink(
                fixture.0.join("outside.js"),
                bundled.join("data/loader.js"),
            )
            .unwrap();
            assert!(super::tests::manifest().verify(&bundled).is_err());
        }
    }
}
