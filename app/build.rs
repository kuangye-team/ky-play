fn main() {
    println!("cargo:rerun-if-env-changed=KY_PLAY_EMULATOR_MANIFEST");
    let manifest = match std::env::var("KY_PLAY_EMULATOR_MANIFEST") {
        Ok(path) => {
            println!("cargo:rerun-if-changed={path}");
            std::fs::read_to_string(path).expect("cannot read desktop emulator manifest")
        }
        // Direct Cargo checks and development do not enable app-only updates.
        Err(_) => "null".into(),
    };
    let output = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
    std::fs::write(output.join("emulator-manifest.json"), manifest).unwrap();
    tauri_build::build()
}
