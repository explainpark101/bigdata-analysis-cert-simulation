//! Disk-backed asset bodies under app_data_dir/assets/{id}.bin
//! Keeps multi-MB CSV out of the WebView heap.

use std::fs;
use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use tauri::{AppHandle, Manager};

pub fn assets_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?
        .join("assets");
    fs::create_dir_all(&dir).map_err(|e| format!("create assets dir: {e}"))?;
    Ok(dir)
}

pub fn asset_path(app: &AppHandle, asset_id: &str) -> Result<PathBuf, String> {
    let safe = asset_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect::<String>();
    if safe.is_empty() {
        return Err("empty asset id".into());
    }
    Ok(assets_dir(app)?.join(format!("{safe}.bin")))
}

pub fn write_bytes(app: &AppHandle, asset_id: &str, bytes: &[u8]) -> Result<u64, String> {
    let path = asset_path(app, asset_id)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, bytes).map_err(|e| format!("write {}: {e}", path.display()))?;
    Ok(bytes.len() as u64)
}

/// Stream any reader straight to the asset file (zip entry → disk).
pub fn write_reader<R: std::io::Read>(
    app: &AppHandle,
    asset_id: &str,
    reader: &mut R,
) -> Result<u64, String> {
    let path = asset_path(app, asset_id)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut out = fs::File::create(&path).map_err(|e| format!("create {}: {e}", path.display()))?;
    let written = std::io::copy(reader, &mut out).map_err(|e| format!("copy {}: {e}", path.display()))?;
    Ok(written)
}

pub fn write_file(app: &AppHandle, asset_id: &str, src: &Path) -> Result<u64, String> {
    let mut file =
        fs::File::open(src).map_err(|e| format!("read {}: {e}", src.display()))?;
    write_reader(app, asset_id, &mut file)
}

pub fn write_base64(app: &AppHandle, asset_id: &str, data_base64: &str) -> Result<u64, String> {
    let bytes = B64
        .decode(data_base64)
        .map_err(|e| format!("base64 decode: {e}"))?;
    write_bytes(app, asset_id, &bytes)
}

/// Truncate/create the asset file for chunked appends from the WebView.
pub fn begin_write(app: &AppHandle, asset_id: &str) -> Result<(), String> {
    let path = asset_path(app, asset_id)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::File::create(&path).map_err(|e| format!("create {}: {e}", path.display()))?;
    Ok(())
}

/// Append one base64 chunk (keeps each IPC payload small).
pub fn append_base64(app: &AppHandle, asset_id: &str, data_base64: &str) -> Result<u64, String> {
    let bytes = B64
        .decode(data_base64)
        .map_err(|e| format!("base64 decode: {e}"))?;
    let path = asset_path(app, asset_id)?;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("append {}: {e}", path.display()))?;
    use std::io::Write;
    file.write_all(&bytes)
        .map_err(|e| format!("append write {}: {e}", path.display()))?;
    Ok(bytes.len() as u64)
}

pub fn read_bytes(app: &AppHandle, asset_id: &str) -> Result<Vec<u8>, String> {
    let path = asset_path(app, asset_id)?;
    fs::read(&path).map_err(|e| format!("read {}: {e}", path.display()))
}

pub fn read_text(app: &AppHandle, asset_id: &str, max_chars: Option<usize>) -> Result<String, String> {
    let path = asset_path(app, asset_id)?;
    let bytes = fs::read(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
    match max_chars {
        // Cap by bytes first so huge CSVs are not fully scanned just for a preview.
        Some(n) => {
            let take = std::cmp::min(bytes.len(), n.saturating_mul(4));
            let text = String::from_utf8_lossy(&bytes[..take]);
            if text.chars().count() > n {
                Ok(text.chars().take(n).collect())
            } else {
                Ok(text.into_owned())
            }
        }
        None => Ok(String::from_utf8_lossy(&bytes).into_owned()),
    }
}

pub fn read_base64(app: &AppHandle, asset_id: &str) -> Result<String, String> {
    let bytes = read_bytes(app, asset_id)?;
    Ok(B64.encode(bytes))
}

pub fn delete_asset(app: &AppHandle, asset_id: &str) -> Result<(), String> {
    let path = asset_path(app, asset_id)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn clear_all(app: &AppHandle) -> Result<(), String> {
    let dir = assets_dir(app)?;
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn exists(app: &AppHandle, asset_id: &str) -> Result<bool, String> {
    Ok(asset_path(app, asset_id)?.exists())
}

fn import_staging_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("app_cache_dir: {e}"))?
        .join("import-staging");
    fs::create_dir_all(&dir).map_err(|e| format!("create staging dir: {e}"))?;
    Ok(dir)
}

fn sanitize_file_name(name: &str) -> String {
    let base = Path::new(name)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("import.zip");
    let safe: String = base
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if safe.is_empty() {
        "import.zip".into()
    } else {
        safe
    }
}

/// Create an empty temp path under app cache for staging an HTML File into Rust.
pub fn create_staging_path(app: &AppHandle, file_name: &str) -> Result<String, String> {
    use std::time::{SystemTime, UNIX_EPOCH};
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let path = import_staging_dir(app)?.join(format!(
        "{}-{}",
        stamp,
        sanitize_file_name(file_name)
    ));
    fs::File::create(&path).map_err(|e| format!("create staging file: {e}"))?;
    Ok(path.to_string_lossy().into_owned())
}

pub fn append_path_base64(path: &str, data_base64: &str) -> Result<u64, String> {
    let bytes = B64
        .decode(data_base64)
        .map_err(|e| format!("base64 decode: {e}"))?;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| format!("append {path}: {e}"))?;
    use std::io::Write;
    file.write_all(&bytes)
        .map_err(|e| format!("append write {path}: {e}"))?;
    Ok(bytes.len() as u64)
}

pub fn remove_path(path: &str) -> Result<(), String> {
    let p = Path::new(path);
    if p.exists() {
        fs::remove_file(p).map_err(|e| format!("remove {path}: {e}"))?;
    }
    Ok(())
}
