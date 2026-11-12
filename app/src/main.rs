#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod assets;
mod storage;
mod window_theme;
use tauri::Manager;
use tauri_plugin_deep_link::DeepLinkExt;

#[tauri::command]
fn open_devtools(window: tauri::WebviewWindow) {
    window.open_devtools();
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn main() {
    let mut context = tauri::generate_context!();
    context.assets = Box::new(assets::DesktopAssets::new(context.assets));
    tauri::Builder::default()
        // Register first so opening a deep link reuses the running app.
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            show_main_window(app)
        }))
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            #[cfg(windows)]
            if let (Some(window), Some(color)) = (
                app.get_webview_window("main"),
                app.config()
                    .app
                    .windows
                    .iter()
                    .find(|config| config.label == "main")
                    .and_then(|config| config.background_color),
            ) {
                // Use the default matcha palette until saved preferences load.
                let text_color = tauri::window::Color(0x34, 0x45, 0x2e, 255);
                if let Err(error) = window_theme::set_title_bar_color(window, color, text_color) {
                    // Older Windows versions keep their system caption colors.
                    eprintln!("{error}");
                }
            }
            #[cfg(all(debug_assertions, windows))]
            app.deep_link().register_all()?;
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                if event
                    .urls()
                    .iter()
                    .any(|url| url.scheme() == "ky-play" && url.host_str() == Some("open"))
                {
                    show_main_window(&handle);
                }
            });
            let storage = storage::Storage::open_configured(app.path().app_data_dir()?)
                .map_err(std::io::Error::other)?;
            app.manage(std::sync::Arc::new(std::sync::Mutex::new(storage)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_devtools,
            window_theme::set_title_bar_color,
            storage::storage_read,
            storage::storage_commit,
            storage::storage_create_file,
            storage::storage_discard_files,
            storage::storage_write_file,
            storage::storage_read_file,
            storage::storage_estimate,
            storage::storage_info,
            storage::storage_move
        ])
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .run(context)
        .expect("failed to run ky-play");
}
