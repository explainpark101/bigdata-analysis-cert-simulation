mod asset_store;
mod zip_ops;

use serde_json::Value;
use tauri::AppHandle;

#[tauri::command]
fn import_project_zip(app: AppHandle, path: String) -> Result<Value, String> {
    zip_ops::import_project_zip(&app, &path)
}

#[tauri::command]
fn merge_project_zip(
    app: AppHandle,
    path: String,
    current: Value,
    label: String,
) -> Result<Value, String> {
    zip_ops::merge_project_zip(&app, &path, current, &label)
}

#[tauri::command]
fn export_project_zip(app: AppHandle, project: Value, dest_path: String) -> Result<(), String> {
    zip_ops::export_project_zip(&app, &project, &dest_path)
}

#[tauri::command]
fn read_asset_text(
    app: AppHandle,
    asset_id: String,
    max_chars: Option<usize>,
) -> Result<String, String> {
    asset_store::read_text(&app, &asset_id, max_chars)
}

#[tauri::command]
fn read_asset_base64(app: AppHandle, asset_id: String) -> Result<String, String> {
    asset_store::read_base64(&app, &asset_id)
}

#[tauri::command]
fn write_asset_bytes(app: AppHandle, asset_id: String, bytes: Vec<u8>) -> Result<u64, String> {
    asset_store::write_bytes(&app, &asset_id, &bytes)
}

#[tauri::command]
fn write_asset_file(app: AppHandle, asset_id: String, src_path: String) -> Result<u64, String> {
    asset_store::write_file(&app, &asset_id, std::path::Path::new(&src_path))
}

#[tauri::command]
fn ingest_asset_file(
    app: AppHandle,
    src_path: String,
    asset_id: String,
    library_path: String,
    name: String,
    encoding: String,
    mime_type: Option<String>,
) -> Result<Value, String> {
    zip_ops::ingest_file(
        &app,
        &src_path,
        &asset_id,
        &library_path,
        &name,
        &encoding,
        mime_type.as_deref(),
    )
}

#[tauri::command]
fn delete_asset(app: AppHandle, asset_id: String) -> Result<(), String> {
    asset_store::delete_asset(&app, &asset_id)
}

#[tauri::command]
fn clear_asset_store(app: AppHandle) -> Result<(), String> {
    asset_store::clear_all(&app)
}

#[tauri::command]
fn asset_exists(app: AppHandle, asset_id: String) -> Result<bool, String> {
    asset_store::exists(&app, &asset_id)
}

#[tauri::command]
fn peek_zip_kind(path: String) -> Result<String, String> {
    zip_ops::peek_zip_kind(&path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            import_project_zip,
            merge_project_zip,
            export_project_zip,
            read_asset_text,
            read_asset_base64,
            write_asset_bytes,
            write_asset_file,
            ingest_asset_file,
            delete_asset,
            clear_asset_store,
            asset_exists,
            peek_zip_kind,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
