/**
 * External storage for large (non-image) project asset bodies.
 * Keeps CSV/text out of React state so Tauri WebView does not OOM on import.
 */
import { isImageAsset } from '@/lib/assetMedia';
import {
  ensureIdbReady,
  idbClearAssetBodies,
  idbDeleteAssetBodies,
  idbDeleteAssetBody,
  idbGetAssetBody,
  idbPutAssetBody,
} from '@/lib/idb';
import type { AuthoringProject, ProjectAsset } from '@/types/project';

const contentCache = new Map<string, string>();
const CACHE_MAX = 4;

function touchCache(id: string, content: string): void {
  contentCache.delete(id);
  contentCache.set(id, content);
  while (contentCache.size > CACHE_MAX) {
    const oldest = contentCache.keys().next().value;
    if (oldest == null) break;
    contentCache.delete(oldest);
  }
}

export function clearAssetContentCache(): void {
  contentCache.clear();
}

/** Large text/CSV assets are stored in IDB; images stay inline (small). */
export function usesExternalBody(asset: {
  encoding: ProjectAsset['encoding'];
  name: string;
  path: string;
  mimeType?: string;
  content?: string;
}): boolean {
  return !isImageAsset({
    encoding: asset.encoding,
    name: asset.name,
    path: asset.path,
    mimeType: asset.mimeType,
    content: asset.content ?? '',
  });
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

export async function putAssetBody(
  id: string,
  encoding: ProjectAsset['encoding'],
  content: string,
): Promise<void> {
  await ensureIdbReady();
  await idbPutAssetBody(id, { encoding, content });
  touchCache(id, content);
}

export async function deleteAssetBody(id: string): Promise<void> {
  await ensureIdbReady();
  contentCache.delete(id);
  await idbDeleteAssetBody(id);
}

export async function deleteAssetBodies(ids: string[]): Promise<void> {
  await ensureIdbReady();
  for (const id of ids) contentCache.delete(id);
  await idbDeleteAssetBodies(ids);
}

export async function replaceAllAssetBodies(): Promise<void> {
  await ensureIdbReady();
  clearAssetContentCache();
  await idbClearAssetBodies();
}

/** Persist inline bodies that belong in IDB; return project safe for React state. */
export async function persistExternalAssets(
  project: AuthoringProject,
): Promise<AuthoringProject> {
  await ensureIdbReady();
  for (const asset of project.assets) {
    if (!usesExternalBody(asset)) continue;
    if (!asset.content) continue;
    await putAssetBody(asset.id, asset.encoding, asset.content);
  }
  return stripExternalContents(project);
}

export async function getAssetContent(asset: ProjectAsset): Promise<string> {
  if (asset.content) return asset.content;
  const cached = contentCache.get(asset.id);
  if (cached != null) return cached;
  if (!usesExternalBody(asset)) return '';
  await ensureIdbReady();
  const body = await idbGetAssetBody(asset.id);
  const content = body?.content ?? '';
  if (content) touchCache(asset.id, content);
  return content;
}

export async function withAssetContent(
  asset: ProjectAsset,
): Promise<ProjectAsset> {
  if (asset.content || !usesExternalBody(asset)) return asset;
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
