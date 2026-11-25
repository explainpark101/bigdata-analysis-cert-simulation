/**
 * Rust-backed asset/zip bridge for Tauri.
 * Large CSV bodies stay on disk under app_data_dir/assets — never in the WebView heap.
 */
import { invoke } from '@tauri-apps/api/core';
import type { AuthoringProject, ProjectAsset } from '@/types/project';
import { isTauriRuntime } from '@/lib/tauriRuntime';

export { isTauriRuntime };

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

/** Native open dialog → filesystem path (Tauri only). */
export async function pickZipPath(opts?: {
  multiple?: boolean;
  title?: string;
}): Promise<string | string[] | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({
    multiple: Boolean(opts?.multiple),
    title: opts?.title ?? 'ZIP 선택',
    filters: [{ name: 'ZIP', extensions: ['zip'] }],
  });
  if (selected == null) return null;
  return selected as string | string[];
}

export async function pickSaveZipPath(defaultName: string): Promise<string | null> {
  const { save } = await import('@tauri-apps/plugin-dialog');
  const selected = await save({
    title: '프로젝트 ZIP 저장',
    defaultPath: defaultName,
    filters: [{ name: 'ZIP', extensions: ['zip'] }],
  });
  return selected;
}

export async function pickDataFiles(): Promise<string[] | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({
    multiple: true,
    title: 'CSV / 이미지 선택',
    filters: [
      {
        name: 'Data',
        extensions: [
          'csv',
          'tsv',
          'txt',
          'png',
          'jpg',
          'jpeg',
          'gif',
          'webp',
          'svg',
        ],
      },
    ],
  });
  if (selected == null) return null;
  return Array.isArray(selected) ? selected : [selected];
}
