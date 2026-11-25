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

/// Save dialog on the Rust side (avoids JS @tauri-apps/plugin-dialog which OOMs
/// in WebView2 before the picker paints), then stream-export the zip.
#[tauri::command]
fn export_project_zip_ask(
    app: AppHandle,
    project: Value,
    default_name: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let picked = app
        .dialog()
        .file()
        .add_filter("ZIP", &["zip"])
        .set_file_name(&default_name)
        .blocking_save_file();

    let Some(file_path) = picked else {
        return Ok(None);
    };
    let dest = file_path
        .into_path()
        .map_err(|e| format!("save path: {e}"))?;
    let dest_str = dest.to_string_lossy().to_string();
    zip_ops::export_project_zip(&app, &project, &dest_str)?;
    Ok(Some(dest_str))
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

/// Prefer this over write_asset_bytes — avoids JSON number[] IPC blow-ups.
#[tauri::command]
fn write_asset_base64(
    app: AppHandle,
    asset_id: String,
    data_base64: String,
) -> Result<u64, String> {
    asset_store::write_base64(&app, &asset_id, &data_base64)
}

#[tauri::command]
fn begin_write_asset(app: AppHandle, asset_id: String) -> Result<(), String> {
    asset_store::begin_write(&app, &asset_id)
}

#[tauri::command]
fn append_asset_base64(
    app: AppHandle,
    asset_id: String,
    data_base64: String,
) -> Result<u64, String> {
    asset_store::append_base64(&app, &asset_id, &data_base64)
}

#[tauri::command]
fn write_asset_text(app: AppHandle, asset_id: String, text: String) -> Result<u64, String> {
    asset_store::write_bytes(&app, &asset_id, text.as_bytes())
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
fn asset_abs_path(app: AppHandle, asset_id: String) -> Result<String, String> {
    asset_store::asset_path(&app, &asset_id).map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
fn peek_zip_kind(path: String) -> Result<String, String> {
    zip_ops::peek_zip_kind(&path)
}

#[tauri::command]
fn create_staging_path(app: AppHandle, file_name: String) -> Result<String, String> {
    asset_store::create_staging_path(&app, &file_name)
}

#[tauri::command]
fn append_path_base64(path: String, data_base64: String) -> Result<u64, String> {
    asset_store::append_path_base64(&path, &data_base64)
}

#[tauri::command]
fn remove_path(path: String) -> Result<(), String> {
    asset_store::remove_path(&path)
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
            export_project_zip_ask,
            read_asset_text,
            read_asset_base64,
            write_asset_bytes,
            write_asset_base64,
            begin_write_asset,
            append_asset_base64,
            write_asset_text,
            write_asset_file,
            ingest_asset_file,
            delete_asset,
            clear_asset_store,
            asset_exists,
            asset_abs_path,
            peek_zip_kind,
            create_staging_path,
            append_path_base64,
            remove_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
