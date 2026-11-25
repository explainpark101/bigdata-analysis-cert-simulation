/**
 * Asset body store facade.
 * - Tauri: Rust disk under app_data_dir/assets (OOM-safe)
 * - Browser: IndexedDB Blob fallback
 */
import { assetToDataUrl } from '@/lib/assetMedia';
import {
  ensureIdbReady,
  idbClearAssetBodies,
  idbDeleteAssetBodies,
  idbDeleteAssetBody,
  idbGetAssetBody,
  idbPutAssetBody,
  type AssetBodyRecord,
} from '@/lib/idb';
import type { AuthoringProject, ProjectAsset } from '@/types/project';
import { isTauriRuntime } from '@/lib/tauriRuntime';
import {
  rustAssetSrcUrl,
  rustClearAssetStore,
  rustDeleteAsset,
  rustReadAssetBase64,
  rustReadAssetText,
} from '@/lib/tauriAssets';

let cachedId: string | null = null;
let cachedContent: string | null = null;

function setCache(id: string, content: string): void {
  cachedId = id;
  cachedContent = content;
}

export function clearAssetContentCache(): void {
  cachedId = null;
  cachedContent = null;
}

/**
 * Keep bodies out of React/IDB project JSON — disk (Tauri) or assetBodies (web).
 * Images used to stay inline; hydrating every thumb then OOMd WebView2.
 */
export function usesExternalBody(_asset: {
  encoding: ProjectAsset['encoding'];
  name: string;
  path: string;
  mimeType?: string;
  content?: string;
}): boolean {
  return true;
}

export function assetByteLength(asset: ProjectAsset): number {
  if (typeof asset.byteLength === 'number' && asset.byteLength >= 0) {
    return asset.byteLength;
  }
  return asset.content?.length ?? 0;
}

export function stripExternalContents(project: AuthoringProject): AuthoringProject {
  return {
    ...project,
    assets: project.assets.map((a) => {
      if (!usesExternalBody(a)) {
        return {
          ...a,
          byteLength: a.byteLength ?? a.content.length,
        };
      }
      return {
        ...a,
        content: '',
        byteLength: assetByteLength(a),
      };
    }),
  };
}

function mimeForAsset(
  encoding: ProjectAsset['encoding'],
  mimeType?: string,
): string {
  if (mimeType) return mimeType;
  return encoding === 'base64' ? 'application/octet-stream' : 'text/csv';
}

/**
 * Store raw bytes.
 * Tauri: append base64 chunks (never one multi-MB IPC payload / number[]).
 */
export async function putAssetBodyBytes(
  id: string,
  encoding: ProjectAsset['encoding'],
  bytes: Uint8Array,
  mimeType?: string,
): Promise<void> {
  if (isTauriRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const { bytesToBase64 } = await import('@/lib/assetMedia');
    // 240 KiB raw → ~320 KiB base64 per round-trip; keeps WebView IPC stable.
    const chunkSize = 240 * 1024;
    if (bytes.byteLength <= chunkSize) {
      await invoke('write_asset_base64', {
        assetId: id,
        dataBase64: bytesToBase64(bytes),
      });
    } else {
      await invoke('begin_write_asset', { assetId: id });
      for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
        const slice = bytes.subarray(offset, offset + chunkSize);
        await invoke('append_asset_base64', {
          assetId: id,
          dataBase64: bytesToBase64(slice),
        });
      }
    }
    if (cachedId === id) clearAssetContentCache();
    return;
  }
  await ensureIdbReady();
  const copy = bytes.slice();
  const blob = new Blob([copy], {
    type: mimeForAsset(encoding, mimeType),
  });
  await idbPutAssetBody(id, { encoding, blob });
  if (cachedId === id) clearAssetContentCache();
}

export async function putAssetBody(
  id: string,
  encoding: ProjectAsset['encoding'],
  content: string,
  mimeType?: string,
): Promise<void> {
  if (isTauriRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core');
    // Small payloads: one IPC. Large: chunk via putAssetBodyBytes.
    const small = content.length <= 240 * 1024;
    if (encoding === 'base64' && small) {
      await invoke('write_asset_base64', {
        assetId: id,
        dataBase64: content,
      });
    } else if (encoding !== 'base64' && small) {
      await invoke('write_asset_text', { assetId: id, text: content });
    } else if (encoding === 'base64') {
      const bin = atob(content);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      await putAssetBodyBytes(id, encoding, bytes, mimeType);
      return;
    } else {
      await putAssetBodyBytes(
        id,
        encoding,
        new TextEncoder().encode(content),
        mimeType,
      );
      return;
    }
    if (cachedId === id) clearAssetContentCache();
    return;
  }
  if (encoding === 'base64') {
    const bin = atob(content);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    await putAssetBodyBytes(id, encoding, bytes, mimeType);
    return;
  }
  await ensureIdbReady();
  const blob = new Blob([content], {
    type: mimeForAsset(encoding, mimeType),
  });
  await idbPutAssetBody(id, { encoding, blob });
  if (cachedId === id) clearAssetContentCache();
}

export async function deleteAssetBody(id: string): Promise<void> {
  if (cachedId === id) clearAssetContentCache();
  if (isTauriRuntime()) {
    await rustDeleteAsset(id);
    return;
  }
  await ensureIdbReady();
  await idbDeleteAssetBody(id);
}

export async function deleteAssetBodies(ids: string[]): Promise<void> {
  if (cachedId && ids.includes(cachedId)) clearAssetContentCache();
  if (isTauriRuntime()) {
    for (const id of ids) await rustDeleteAsset(id);
    return;
  }
  await ensureIdbReady();
  await idbDeleteAssetBodies(ids);
}

export async function replaceAllAssetBodies(): Promise<void> {
  clearAssetContentCache();
  if (isTauriRuntime()) {
    await rustClearAssetStore();
    return;
  }
  await ensureIdbReady();
  await idbClearAssetBodies();
}

export async function persistExternalAssets(
  project: AuthoringProject,
): Promise<AuthoringProject> {
  for (const asset of project.assets) {
    if (!usesExternalBody(asset)) continue;
    if (!asset.content) continue;
    await putAssetBody(
      asset.id,
      asset.encoding,
      asset.content,
      asset.mimeType,
    );
  }
  return stripExternalContents(project);
}

async function recordToString(body: AssetBodyRecord): Promise<string> {
  if (body.blob) {
    if (body.encoding === 'base64') {
      const buf = await body.blob.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        const slice = bytes.subarray(i, i + chunk);
        binary += String.fromCharCode.apply(
          null,
          slice as unknown as number[],
        );
      }
      return btoa(binary);
    }
    return body.blob.text();
  }
  return body.content ?? '';
}

export async function getAssetContent(asset: ProjectAsset): Promise<string> {
  if (asset.content) return asset.content;
  if (cachedId === asset.id && cachedContent != null) return cachedContent;
  if (isTauriRuntime()) {
    const content =
      asset.encoding === 'base64'
        ? await rustReadAssetBase64(asset.id)
        : await rustReadAssetText(asset.id);
    setCache(asset.id, content);
    return content;
  }
  await ensureIdbReady();
  const body = await idbGetAssetBody(asset.id);
  if (!body) return '';
  const content = await recordToString(body);
  setCache(asset.id, content);
  return content;
}

export async function getAssetContentPreview(
  asset: ProjectAsset,
  maxChars = 2_000_000,
): Promise<string> {
  if (asset.content) {
    return asset.content.length > maxChars
      ? asset.content.slice(0, maxChars)
      : asset.content;
  }
  if (isTauriRuntime()) {
    if (asset.encoding === 'base64') {
      return rustReadAssetBase64(asset.id);
    }
    return rustReadAssetText(asset.id, maxChars);
  }
  if (!usesExternalBody(asset)) return '';
  await ensureIdbReady();
  const body = await idbGetAssetBody(asset.id);
  if (!body) return '';
  if (body.blob && body.encoding === 'utf-8') {
    const sliced = body.blob.slice(0, maxChars);
    return sliced.text();
  }
  const full = await recordToString(body);
  return full.length > maxChars ? full.slice(0, maxChars) : full;
}

export async function withAssetContent(
  asset: ProjectAsset,
): Promise<ProjectAsset> {
  if (asset.content) return asset;
  const content = await getAssetContent(asset);
  return {
    ...asset,
    content,
    byteLength: asset.byteLength ?? content.length,
  };
}

export async function withAssetContents(
  assets: ProjectAsset[],
  ids?: Iterable<string>,
): Promise<ProjectAsset[]> {
  const want = ids ? new Set(ids) : null;
  const out: ProjectAsset[] = [];
  for (const asset of assets) {
    if (want && !want.has(asset.id)) {
      out.push(asset);
      continue;
    }
    out.push(await withAssetContent(asset));
  }
  return out;
}

export async function withProjectAssetContents(
  project: AuthoringProject,
  ids?: Iterable<string>,
): Promise<AuthoringProject> {
  return {
    ...project,
    assets: await withAssetContents(project.assets, ids),
  };
}

export type AssetDisplayUrl = {
  url: string;
  /** Revoke blob: URLs when the consumer unmounts. */
  revoke: () => void;
};

/**
 * Display URL for a single image without stuffing every asset into React state.
 * Tauri: asset protocol (disk). Browser: data URL or one-shot blob URL.
 */
export async function getAssetDisplayUrl(
  asset: ProjectAsset,
): Promise<AssetDisplayUrl> {
  if (isTauriRuntime()) {
    try {
      const url = await rustAssetSrcUrl(asset.id);
      return { url, revoke: () => undefined };
    } catch {
      /* fall through */
    }
  }
  if (asset.content) {
    return { url: assetToDataUrl(asset), revoke: () => undefined };
  }
  if (isTauriRuntime()) {
    const content = await getAssetContent(asset);
    if (!content) return { url: '', revoke: () => undefined };
    return {
      url: assetToDataUrl({ ...asset, content }),
      revoke: () => undefined,
    };
  }
  await ensureIdbReady();
  const body = await idbGetAssetBody(asset.id);
  if (body?.blob) {
    const url = URL.createObjectURL(body.blob);
    return { url, revoke: () => URL.revokeObjectURL(url) };
  }
  if (body?.content) {
    return {
      url: assetToDataUrl({ ...asset, content: body.content }),
      revoke: () => undefined,
    };
  }
  return { url: '', revoke: () => undefined };
}
