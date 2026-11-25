import JSZip from 'jszip';
import type { AuthoringProject, ProjectAsset } from '@/types/project';
import { validateProject } from './projectIO';
import { downloadBlob } from './download';
import { loadZip } from './zipKind';
import {
  putAssetBody,
  replaceAllAssetBodies,
  stripExternalContents,
  usesExternalBody,
  withAssetContent,
  withProjectAssetContents,
} from './assetStore';

const PROJECT_JSON = 'project.json';
const FILES_PREFIX = 'files/';

function metaWithoutBytes(project: AuthoringProject): AuthoringProject {
  return {
    ...project,
    assets: project.assets.map(
      ({ id, path, name, encoding, mimeType, byteLength }) => ({
        id,
        path,
        name,
        encoding,
        mimeType,
        byteLength,
        content: '',
      }),
    ),
  };
}

function findAssetEntry(
  zip: JSZip,
  assetId: string,
): { path: string; entry: JSZip.JSZipObject } | null {
  const prefix = `${FILES_PREFIX}${assetId}/`;
  for (const path of Object.keys(zip.files)) {
    const entry = zip.files[path];
    if (!entry || entry.dir) continue;
    if (path.startsWith(prefix)) return { path, entry };
  }
  return null;
}

async function readAssetContent(
  entry: JSZip.JSZipObject,
  encoding: ProjectAsset['encoding'],
): Promise<string> {
  return encoding === 'base64'
    ? entry.async('base64')
    : entry.async('string');
}

export async function buildProjectZip(project: AuthoringProject): Promise<Blob> {
  const hydrated = await withProjectAssetContents(project);
  const zip = new JSZip();
  zip.file(PROJECT_JSON, JSON.stringify(metaWithoutBytes(hydrated), null, 2));

  for (const asset of hydrated.assets) {
    const entry = `${FILES_PREFIX}${asset.id}/${asset.path}`;
    if (asset.encoding === 'base64') {
      zip.file(entry, asset.content, { base64: true });
    } else {
      zip.file(entry, asset.content);
    }
  }

  return zip.generateAsync({ type: 'blob' });
}

/** Read project.json only — asset bytes stay unloaded until hydrate. */
export async function parseProjectZipMeta(
  zip: JSZip,
): Promise<AuthoringProject> {
  const metaFile = zip.file(PROJECT_JSON);
  if (!metaFile) {
    throw new Error('ZIP must contain project.json (authoring project)');
  }
  const project = validateProject(JSON.parse(await metaFile.async('string')));
  return {
    ...project,
    assets: project.assets.map((a) => ({
      ...a,
      content: '',
      byteLength: a.byteLength ?? a.content?.length ?? 0,
    })),
  };
}

/**
 * Fill asset.content from zip entries.
 * When `assetIds` is set, only those ids are inflated (others stay empty).
 */
export async function hydrateProjectAssets(
  zip: JSZip,
  project: AuthoringProject,
  assetIds?: Iterable<string>,
): Promise<AuthoringProject> {
  const want = assetIds ? new Set(assetIds) : null;
  const assets: ProjectAsset[] = [];

  for (const asset of project.assets) {
    if (want && !want.has(asset.id)) {
      assets.push(asset.content ? { ...asset, content: '' } : asset);
      continue;
    }
    if (asset.content) {
      assets.push(asset);
      continue;
    }
    const found = findAssetEntry(zip, asset.id);
    if (!found) {
      assets.push(asset);
      continue;
    }
    const content = await readAssetContent(found.entry, asset.encoding);
    assets.push({
      ...asset,
      content,
      byteLength: content.length,
    });
  }

  return { ...project, assets };
}

/**
 * Inflate zip assets one-by-one into IDB (external) or inline (images).
 * Does not clear existing IDB bodies — caller decides (full import vs merge).
 */
export async function ingestProjectZipAssets(
  zip: JSZip,
  meta: AuthoringProject,
): Promise<ProjectAsset[]> {
  const assets: ProjectAsset[] = [];
  for (const asset of meta.assets) {
    const found = findAssetEntry(zip, asset.id);
    if (!found) {
      assets.push({ ...asset, content: '', byteLength: asset.byteLength ?? 0 });
      continue;
    }

    const content = await readAssetContent(found.entry, asset.encoding);
    // Free compressed copy as soon as we have the string.
    zip.remove(found.path);

    if (usesExternalBody(asset)) {
      await putAssetBody(asset.id, asset.encoding, content);
      assets.push({
        ...asset,
        content: '',
        byteLength: content.length,
      });
    } else {
      assets.push({
        ...asset,
        content,
        byteLength: content.length,
      });
    }
  }
  return assets;
}

/**
 * Import a .project.zip without holding every CSV string in RAM at once.
 * Each entry: inflate → IndexedDB → drop zip entry → clear local string.
 * Returns a project safe for React state (external bodies stripped).
 */
export async function importProjectZip(file: File): Promise<AuthoringProject> {
  const zip = await loadZip(file);
  const meta = await parseProjectZipMeta(zip);
  await replaceAllAssetBodies();
  const assets = await ingestProjectZipAssets(zip, meta);
  return stripExternalContents({ ...meta, assets });
}

export async function parseProjectZipFrom(
  zip: JSZip,
): Promise<AuthoringProject> {
  const meta = await parseProjectZipMeta(zip);
  return hydrateProjectAssets(zip, meta);
}

export async function parseProjectZip(
  blob: Blob | ArrayBuffer,
): Promise<AuthoringProject> {
  // Prefer streaming import for File (project tab / home).
  if (typeof File !== 'undefined' && blob instanceof File) {
    return importProjectZip(blob);
  }
  return parseProjectZipFrom(await loadZip(blob));
}

export async function exportProjectZip(project: AuthoringProject): Promise<void> {
  const blob = await buildProjectZip(project);
  downloadBlob(`${project.id || 'project'}.project.zip`, blob);
}

/** Hydrate one asset for UI that still expects inline content. */
export async function loadAssetForPreview(
  asset: ProjectAsset,
): Promise<ProjectAsset> {
  return withAssetContent(asset);
}
