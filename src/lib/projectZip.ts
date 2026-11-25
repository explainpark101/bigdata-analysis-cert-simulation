import JSZip from 'jszip';
import type { AuthoringProject, ProjectAsset } from '@/types/project';
import { validateProject } from './projectIO';
import { downloadBlob } from './download';
import { loadZip } from './zipKind';
import {
  getAssetContent,
  putAssetBodyBytes,
  replaceAllAssetBodies,
  stripExternalContents,
  usesExternalBody,
  withAssetContent,
} from './assetStore';
import { bytesToBase64 } from './assetMedia';
import {
  listZipEntries,
  readZipEntryBytes,
  readZipEntryText,
  type ZipCdEntry,
  zipKindFromEntries,
} from './zipStream';

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

function findStreamAssetEntry(
  entries: ZipCdEntry[],
  assetId: string,
): ZipCdEntry | null {
  const prefix = `${FILES_PREFIX}${assetId}/`;
  for (const entry of entries) {
    if (entry.name.endsWith('/')) continue;
    if (entry.name.startsWith(prefix)) return entry;
  }
  return null;
}

function yieldToUi(): Promise<void> {
  return new Promise((r) => {
    window.setTimeout(r, 0);
  });
}

/** Build zip one asset at a time — never hydrate all CSV strings together. */
export async function buildProjectZip(project: AuthoringProject): Promise<Blob> {
  const zip = new JSZip();
  zip.file(PROJECT_JSON, JSON.stringify(metaWithoutBytes(project), null, 2));

  for (const asset of project.assets) {
    const content = await getAssetContent(asset);
    const entry = `${FILES_PREFIX}${asset.id}/${asset.path}`;
    if (asset.encoding === 'base64') {
      zip.file(entry, content, { base64: true });
    } else {
      zip.file(entry, content);
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
 * Fill asset.content from zip entries (in-memory; exam pending flow).
 * When `assetIds` is set, only those ids are inflated.
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
    if (asset.encoding === 'base64') {
      const bytes = await found.entry.async('uint8array');
      const content = bytesToBase64(bytes);
      assets.push({ ...asset, content, byteLength: content.length });
    } else {
      const content = await found.entry.async('string');
      assets.push({ ...asset, content, byteLength: content.length });
    }
  }

  return { ...project, assets };
}

/**
 * Import a .project.zip without JSZip.loadAsync (no full-buffer inflate).
 * Each entry: Blob.slice → inflate → IDB Blob → drop bytes.
 */
export async function importProjectZip(file: File): Promise<AuthoringProject> {
  const entries = await listZipEntries(file);
  if (zipKindFromEntries(entries) !== 'project') {
    throw new Error('ZIP must contain project.json (authoring project)');
  }

  const metaEntry = entries.find(
    (e) => e.name === PROJECT_JSON || e.name.endsWith(`/${PROJECT_JSON}`),
  );
  if (!metaEntry) {
    throw new Error('ZIP must contain project.json (authoring project)');
  }

  const metaJson = await readZipEntryText(file, metaEntry);
  const meta = validateProject(JSON.parse(metaJson));
  const leanMeta: AuthoringProject = {
    ...meta,
    assets: meta.assets.map((a) => ({
      ...a,
      content: '',
      byteLength: a.byteLength ?? a.content?.length ?? 0,
    })),
  };

  await replaceAllAssetBodies();

  const assets: ProjectAsset[] = [];
  for (const asset of leanMeta.assets) {
    const found = findStreamAssetEntry(entries, asset.id);
    if (!found) {
      assets.push({ ...asset, content: '', byteLength: asset.byteLength ?? 0 });
      continue;
    }

    const bytes = await readZipEntryBytes(file, found);

    if (usesExternalBody(asset)) {
      await putAssetBodyBytes(asset.id, asset.encoding, bytes, asset.mimeType);
      assets.push({
        ...asset,
        content: '',
        byteLength: bytes.byteLength,
      });
    } else if (asset.encoding === 'base64') {
      const content = bytesToBase64(bytes);
      assets.push({ ...asset, content, byteLength: content.length });
    } else {
      const content = new TextDecoder('utf-8').decode(bytes);
      assets.push({ ...asset, content, byteLength: content.length });
    }

    await yieldToUi();
  }

  return stripExternalContents({ ...leanMeta, assets });
}

/** @deprecated Prefer {@link importProjectZip} for File inputs. */
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
    const bytes = await found.entry.async('uint8array');
    zip.remove(found.path);
    if (usesExternalBody(asset)) {
      await putAssetBodyBytes(asset.id, asset.encoding, bytes, asset.mimeType);
      assets.push({ ...asset, content: '', byteLength: bytes.byteLength });
    } else if (asset.encoding === 'base64') {
      const content = bytesToBase64(bytes);
      assets.push({ ...asset, content, byteLength: content.length });
    } else {
      const content = new TextDecoder('utf-8').decode(bytes);
      assets.push({ ...asset, content, byteLength: content.length });
    }
    await yieldToUi();
  }
  return assets;
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
  if (typeof File !== 'undefined' && blob instanceof File) {
    return importProjectZip(blob);
  }
  if (typeof Blob !== 'undefined' && blob instanceof Blob) {
    // Treat generic Blob like File for streaming import.
    return importProjectZip(new File([blob], 'project.zip'));
  }
  return parseProjectZipFrom(await loadZip(blob));
}

export async function exportProjectZip(project: AuthoringProject): Promise<void> {
  const blob = await buildProjectZip(project);
  downloadBlob(`${project.id || 'project'}.project.zip`, blob);
}

export async function loadAssetForPreview(
  asset: ProjectAsset,
): Promise<ProjectAsset> {
  return withAssetContent(asset);
}
