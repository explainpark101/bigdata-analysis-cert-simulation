/**
 * Rust-backed asset/zip bridge for Tauri.
 * Large CSV bodies stay on disk under app_data_dir/assets — never in the WebView heap.
 */
import { invoke } from '@tauri-apps/api/core';
import { bytesToBase64 } from '@/lib/assetMedia';
import type { AuthoringProject, ProjectAsset } from '@/types/project';
import { isTauriRuntime, tauriFilePath } from '@/lib/tauriRuntime';

export { isTauriRuntime };

/** ~192 KiB raw per IPC round-trip while staging an HTML File to disk. */
const STAGE_CHUNK = 192 * 1024;

/**
 * Stream a Blob to a cache temp path via small base64 appends.
 * Never holds the whole zip as one ArrayBuffer / base64 string.
 */
export async function stageBlobToTempPath(
  blob: Blob,
  fileName: string,
): Promise<string> {
  const path = await invoke<string>('create_staging_path', {
    fileName: fileName || 'import.zip',
  });
  try {
    for (let offset = 0; offset < blob.size; offset += STAGE_CHUNK) {
      const slice = blob.slice(offset, offset + STAGE_CHUNK);
      const buf = new Uint8Array(await slice.arrayBuffer());
      await invoke('append_path_base64', {
        path,
        dataBase64: bytesToBase64(buf),
      });
    }
    return path;
  } catch (err) {
    await invoke('remove_path', { path }).catch(() => undefined);
    throw err;
  }
}

export async function removeStagedPath(path: string): Promise<void> {
  await invoke('remove_path', { path }).catch(() => undefined);
}

/**
 * Resolve a real FS path for Rust zip ops. HTML `<input type="file">` usually
 * has no usable `.path` in WebView2 — stage those Blobs to temp first.
 */
export async function resolveRustZipPath(
  source: File | string,
): Promise<{ path: string; staged: boolean }> {
  const direct = tauriFilePath(source);
  if (direct) return { path: direct, staged: false };
  if (!(source instanceof Blob)) {
    throw new Error('ZIP file required');
  }
  const name = source instanceof File ? source.name : 'import.zip';
  const path = await stageBlobToTempPath(source, name);
  return { path, staged: true };
}

/** Run `fn(path)` with a resolved zip path; delete staged temps afterward. */
export async function withRustZipPath<T>(
  source: File | string,
  fn: (path: string) => Promise<T>,
): Promise<T> {
  const { path, staged } = await resolveRustZipPath(source);
  try {
    return await fn(path);
  } finally {
    if (staged) await removeStagedPath(path);
  }
}

/** Lean meta only — never ship asset.content strings through IPC. */
function leanProjectForIpc(project: AuthoringProject): AuthoringProject {
  return {
    ...project,
    assets: project.assets.map((a) => ({
      ...a,
      content: '',
      byteLength:
        typeof a.byteLength === 'number' && a.byteLength >= 0
          ? a.byteLength
          : (a.content?.length ?? 0),
    })),
  };
}

export async function rustImportProjectZip(
  path: Stringish,
): Promise<AuthoringProject> {
  return invoke<AuthoringProject>('import_project_zip', { path: String(path) });
}

export async function rustMergeProjectZip(
  path: Stringish,
  current: AuthoringProject,
  label: string,
): Promise<{
  project: AuthoringProject;
  addedProblems: number;
  addedAssets: number;
  label: string;
}> {
  return invoke('merge_project_zip', {
    path: String(path),
    current: leanProjectForIpc(current),
    label,
  });
}

export async function rustExportProjectZip(
  project: AuthoringProject,
  destPath: Stringish,
): Promise<void> {
  await invoke('export_project_zip', {
    project: leanProjectForIpc(project),
    destPath: String(destPath),
  });
}

/**
 * Native save dialog + export entirely in Rust.
 * Do not use JS `@tauri-apps/plugin-dialog` — it OOMs in WebView2 before paint.
 */
export async function rustExportProjectZipAsk(
  project: AuthoringProject,
  defaultName: string,
): Promise<string | null> {
  return invoke<string | null>('export_project_zip_ask', {
    project: leanProjectForIpc(project),
    defaultName,
  });
}

export async function rustReadAssetText(
  assetId: string,
  maxChars?: number,
): Promise<string> {
  return invoke<string>('read_asset_text', {
    assetId,
    maxChars: maxChars ?? null,
  });
}

export async function rustReadAssetBase64(assetId: string): Promise<string> {
  return invoke<string>('read_asset_base64', { assetId });
}

export async function rustWriteAssetFile(
  assetId: string,
  srcPath: Stringish,
): Promise<number> {
  return invoke<number>('write_asset_file', {
    assetId,
    srcPath: String(srcPath),
  });
}

export async function rustIngestAssetFile(args: {
  srcPath: string;
  assetId: string;
  libraryPath: string;
  name: string;
  encoding: 'utf-8' | 'base64';
  mimeType?: string;
}): Promise<ProjectAsset> {
  return invoke<ProjectAsset>('ingest_asset_file', {
    srcPath: args.srcPath,
    assetId: args.assetId,
    libraryPath: args.libraryPath,
    name: args.name,
    encoding: args.encoding,
    mimeType: args.mimeType ?? null,
  });
}

export async function rustDeleteAsset(assetId: string): Promise<void> {
  await invoke('delete_asset', { assetId });
}

export async function rustClearAssetStore(): Promise<void> {
  await invoke('clear_asset_store');
}

export async function rustAssetExists(assetId: string): Promise<boolean> {
  return invoke<boolean>('asset_exists', { assetId });
}

/** Absolute disk path for convertFileSrc — avoids base64 in the WebView heap. */
export async function rustAssetAbsPath(assetId: string): Promise<string> {
  return invoke<string>('asset_abs_path', { assetId });
}

/** asset: URL for img src without reading file bytes into JS. */
export async function rustAssetSrcUrl(assetId: string): Promise<string> {
  const { convertFileSrc } = await import('@tauri-apps/api/core');
  const abs = await rustAssetAbsPath(assetId);
  return convertFileSrc(abs);
}

export async function rustPeekZipKind(
  path: Stringish,
): Promise<'exam' | 'project' | 'unknown'> {
  const kind = await invoke<string>('peek_zip_kind', { path: String(path) });
  if (kind === 'exam' || kind === 'project') return kind;
  return 'unknown';
}

type Stringish = string;

/**
 * @deprecated Do not call from the WebView — JS plugin-dialog OOMs before paint.
 * Use a hidden `<input type="file">` and {@link tauriFilePath} / Rust import instead.
 */
export async function pickZipPath(_opts?: {
  multiple?: boolean;
  title?: string;
}): Promise<string | string[] | null> {
  throw new Error(
    'pickZipPath is disabled (WebView dialog OOM). Use <input type="file">.',
  );
}

/**
 * @deprecated Prefer {@link rustExportProjectZipAsk} (Rust-side save dialog).
 */
export async function pickSaveZipPath(_defaultName: string): Promise<string | null> {
  throw new Error(
    'pickSaveZipPath is disabled (WebView dialog OOM). Use rustExportProjectZipAsk.',
  );
}
