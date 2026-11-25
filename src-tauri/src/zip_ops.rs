//! Stream ZIP import/export on disk — never ship multi-MB CSV through the WebView.

use std::fs::File;
use std::io::{Read, Write};
use std::path::Path;

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde_json::{json, Map, Value};
use tauri::AppHandle;
use uuid::Uuid;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::asset_store;

const PROJECT_JSON: &str = "project.json";
const FILES_PREFIX: &str = "files/";

fn open_archive(path: &Path) -> Result<ZipArchive<File>, String> {
    let file = File::open(path).map_err(|e| format!("open zip {}: {e}", path.display()))?;
    ZipArchive::new(file).map_err(|e| format!("zip open: {e}"))
}

fn find_entry_name(archive: &ZipArchive<File>, asset_id: &str) -> Option<String> {
    let prefix = format!("{FILES_PREFIX}{asset_id}/");
    archive.file_names().find_map(|name| {
        if !name.ends_with('/') && name.starts_with(&prefix) {
            Some(name.to_string())
        } else {
            None
        }
    })
}

fn read_project_json(archive: &mut ZipArchive<File>) -> Result<Value, String> {
    let mut file = archive
        .by_name(PROJECT_JSON)
        .map_err(|_| "ZIP must contain project.json".to_string())?;
    let mut buf = String::new();
    file.read_to_string(&mut buf)
        .map_err(|e| format!("read project.json: {e}"))?;
    serde_json::from_str(&buf).map_err(|e| format!("parse project.json: {e}"))
}

fn take_string(obj: &mut Map<String, Value>, key: &str) -> String {
    match obj.remove(key) {
        Some(Value::String(s)) => s,
        Some(other) => {
            obj.insert(key.to_string(), other);
            String::new()
        }
        None => String::new(),
    }
}

fn strip_asset_contents(project: &mut Value) {
    if let Some(assets) = project.get_mut("assets").and_then(|a| a.as_array_mut()) {
        for asset in assets {
            if let Some(obj) = asset.as_object_mut() {
                let content = take_string(obj, "content");
                if !obj.contains_key("byteLength") && !content.is_empty() {
                    obj.insert("byteLength".into(), json!(content.len() as u64));
                }
                obj.insert("content".into(), json!(""));
                drop(content);
            }
        }
    }
}

/// Stream one zip entry to the asset store without buffering the whole file in RAM.
fn extract_entry_to_asset(
    app: &AppHandle,
    archive: &mut ZipArchive<File>,
    entry_name: &str,
    asset_id: &str,
) -> Result<u64, String> {
    let mut entry = archive
        .by_name(entry_name)
        .map_err(|e| format!("entry {entry_name}: {e}"))?;
    asset_store::write_reader(app, asset_id, &mut entry)
}

/// Extract each `files/{id}/...` entry straight to disk; return lean project JSON.
pub fn import_project_zip(app: &AppHandle, zip_path: &str) -> Result<Value, String> {
    let path = Path::new(zip_path);
    let mut archive = open_archive(path)?;
    let mut project = read_project_json(&mut archive)?;
    asset_store::clear_all(app)?;

    let raw_assets = project
        .get_mut("assets")
        .and_then(|a| a.as_array_mut())
        .map(std::mem::take)
        .unwrap_or_default();

    let mut lean_assets = Vec::with_capacity(raw_assets.len());
    for mut asset in raw_assets {
        let Some(obj) = asset.as_object_mut() else {
            continue;
        };
        let id = obj
            .get("id")
            .and_then(|v| v.as_str())
            .ok_or("asset missing id")?
            .to_string();
        let encoding = obj
            .get("encoding")
            .and_then(|v| v.as_str())
            .unwrap_or("utf-8")
            .to_string();
        // Pull content out so we never clone multi-MB strings into lean meta.
        let content = take_string(obj, "content");
        let mut byte_length = obj.get("byteLength").and_then(|v| v.as_u64()).unwrap_or(0);

        if let Some(entry_name) = find_entry_name(&archive, &id) {
            byte_length = extract_entry_to_asset(app, &mut archive, &entry_name, &id)?;
        } else if encoding == "base64" && !content.is_empty() {
            byte_length = asset_store::write_base64(app, &id, &content)?;
        } else if !content.is_empty() {
            byte_length = asset_store::write_bytes(app, &id, content.as_bytes())?;
        }
        drop(content);

        obj.insert("content".into(), json!(""));
        obj.insert("byteLength".into(), json!(byte_length));
        lean_assets.push(asset);
    }

    if let Some(obj) = project.as_object_mut() {
        obj.insert("assets".into(), Value::Array(lean_assets));
    }
    strip_asset_contents(&mut project);
    Ok(project)
}

fn remap_id(
    old: &str,
    map: &mut std::collections::HashMap<String, String>,
    prefix: &str,
) -> String {
    if let Some(existing) = map.get(old) {
        return existing.clone();
    }
    let next = format!("{prefix}-{}", &Uuid::new_v4().to_string()[..8]);
    map.insert(old.to_string(), next.clone());
    next
}

/// Merge a project zip into `current` without loading CSV strings into the WebView.
pub fn merge_project_zip(
    app: &AppHandle,
    zip_path: &str,
    current: Value,
    label: &str,
) -> Result<Value, String> {
    let path = Path::new(zip_path);
    let mut archive = open_archive(path)?;
    let incoming = read_project_json(&mut archive)?;

    let mut asset_map = std::collections::HashMap::new();
    let mut problem_map = std::collections::HashMap::new();

    let mut assets = current
        .get("assets")
        .and_then(|a| a.as_array())
        .cloned()
        .unwrap_or_default();
    let mut bank = current
        .get("bank")
        .and_then(|a| a.as_array())
        .cloned()
        .unwrap_or_default();

    let mut added_assets = 0u64;
    let mut added_problems = 0u64;

    let incoming_assets = incoming
        .get("assets")
        .and_then(|a| a.as_array())
        .cloned()
        .unwrap_or_default();

    for mut asset in incoming_assets {
        let Some(obj) = asset.as_object_mut() else {
            continue;
        };
        let old_id = obj
            .get("id")
            .and_then(|v| v.as_str())
            .ok_or("asset missing id")?
            .to_string();
        let new_id = remap_id(&old_id, &mut asset_map, "asset");
        let name = obj
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("file")
            .to_string();
        let raw_path = obj
            .get("path")
            .and_then(|v| v.as_str())
            .unwrap_or(name.as_str())
            .to_string();
        let base = Path::new(&raw_path)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or(&name)
            .to_string();
        let library_path = format!("imports/{label}/{base}");
        let encoding = obj
            .get("encoding")
            .and_then(|v| v.as_str())
            .unwrap_or("utf-8")
            .to_string();
        let content = take_string(obj, "content");

        let mut byte_length = 0u64;
        if let Some(entry_name) = find_entry_name(&archive, &old_id) {
            byte_length = extract_entry_to_asset(app, &mut archive, &entry_name, &new_id)?;
        } else if encoding == "base64" && !content.is_empty() {
            byte_length = asset_store::write_base64(app, &new_id, &content)?;
        } else if !content.is_empty() {
            byte_length = asset_store::write_bytes(app, &new_id, content.as_bytes())?;
        }
        drop(content);

        let display_name = if name.is_empty() { base } else { name };
        obj.insert("id".into(), json!(new_id));
        obj.insert("path".into(), json!(library_path));
        obj.insert("name".into(), json!(display_name));
        obj.insert("content".into(), json!(""));
        obj.insert("byteLength".into(), json!(byte_length));
        obj.insert("encoding".into(), json!(encoding));
        assets.push(asset);
        added_assets += 1;
    }

    if let Some(incoming_bank) = incoming.get("bank").and_then(|a| a.as_array()) {
        for problem in incoming_bank {
            let old_id = problem
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("bank");
            let new_id = remap_id(old_id, &mut problem_map, "bank");
            let mut next = problem.clone();
            if let Some(obj) = next.as_object_mut() {
                obj.insert("id".into(), json!(new_id));
                if let Some(ids) = obj.get("assetIds").and_then(|v| v.as_array()) {
                    let mapped: Vec<Value> = ids
                        .iter()
                        .filter_map(|v| v.as_str())
                        .filter_map(|id| asset_map.get(id).cloned())
                        .map(Value::String)
                        .collect();
                    obj.insert("assetIds".into(), Value::Array(mapped));
                }
                let note = obj
                    .get("note")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let note = if note.is_empty() {
                    format!("imported: {label}")
                } else {
                    format!("{note}\n(imported: {label})")
                };
                obj.insert("note".into(), json!(note));
            }
            bank.push(next);
            added_problems += 1;
        }
    }

    let mut out = current;
    if let Some(obj) = out.as_object_mut() {
        obj.insert("assets".into(), Value::Array(assets));
        obj.insert("bank".into(), Value::Array(bank));
        obj.insert("updatedAt".into(), json!(now_iso()));
    }

    Ok(json!({
        "project": out,
        "addedProblems": added_problems,
        "addedAssets": added_assets,
        "label": label,
    }))
}

fn now_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Compact UTC stamp; frontend also sets updatedAt on save.
    format!("{secs}")
}

/// Write a project zip to `dest_path` using on-disk asset bodies.
/// Streams each asset file into the archive — never buffers all CSVs in RAM.
pub fn export_project_zip(app: &AppHandle, project: &Value, dest_path: &str) -> Result<(), String> {
    let dest = Path::new(dest_path);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let file = File::create(dest).map_err(|e| format!("create zip: {e}"))?;
    let mut zip = ZipWriter::new(file);
    let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    let mut meta = project.clone();
    strip_asset_contents(&mut meta);
    let meta_str =
        serde_json::to_string_pretty(&meta).map_err(|e| format!("serialize project: {e}"))?;
    // Drop the cloned meta tree before streaming large asset files.
    drop(meta);
    zip.start_file(PROJECT_JSON, opts)
        .map_err(|e| e.to_string())?;
    zip.write_all(meta_str.as_bytes())
        .map_err(|e| e.to_string())?;
    drop(meta_str);

    if let Some(assets) = project.get("assets").and_then(|a| a.as_array()) {
        for asset in assets {
            let id = asset.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let path = asset.get("path").and_then(|v| v.as_str()).unwrap_or("file");
            let encoding = asset
                .get("encoding")
                .and_then(|v| v.as_str())
                .unwrap_or("utf-8");
            if id.is_empty() {
                continue;
            }
            let entry_name = format!("{FILES_PREFIX}{id}/{path}");
            if asset_store::exists(app, id)? {
                let disk_path = asset_store::asset_path(app, id)?;
                let mut src = File::open(&disk_path)
                    .map_err(|e| format!("open {}: {e}", disk_path.display()))?;
                zip.start_file(&entry_name, opts).map_err(|e| e.to_string())?;
                std::io::copy(&mut src, &mut zip).map_err(|e| format!("zip copy {id}: {e}"))?;
            } else if let Some(content) = asset.get("content").and_then(|c| c.as_str()) {
                if content.is_empty() {
                    continue;
                }
                zip.start_file(&entry_name, opts).map_err(|e| e.to_string())?;
                if encoding == "base64" {
                    let bytes = B64.decode(content).map_err(|e| e.to_string())?;
                    zip.write_all(&bytes).map_err(|e| e.to_string())?;
                } else {
                    zip.write_all(content.as_bytes())
                        .map_err(|e| e.to_string())?;
                }
            }
        }
    }

    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

/// Return "project" | "exam" | "unknown" without extracting asset bodies.
pub fn peek_zip_kind(zip_path: &str) -> Result<String, String> {
    let archive = open_archive(Path::new(zip_path))?;
    let names: Vec<String> = archive.file_names().map(|s| s.to_string()).collect();
    if names
        .iter()
        .any(|n| n == PROJECT_JSON || n.ends_with("/project.json"))
    {
        return Ok("project".into());
    }
    if names
        .iter()
        .any(|n| n == "exam.json" || n.ends_with("/exam.json"))
    {
        return Ok("exam".into());
    }
    Ok("unknown".into())
}

/// Copy an external file into the asset store; return lean asset meta JSON.
pub fn ingest_file(
    app: &AppHandle,
    src: &str,
    asset_id: &str,
    library_path: &str,
    name: &str,
    encoding: &str,
    mime_type: Option<&str>,
) -> Result<Value, String> {
    let byte_length = asset_store::write_file(app, asset_id, Path::new(src))?;
    Ok(json!({
        "id": asset_id,
        "path": library_path,
        "name": name,
        "encoding": encoding,
        "content": "",
        "byteLength": byte_length,
        "mimeType": mime_type,
    }))
}
