import JSZip from 'jszip';
import type { AuthoringProject, ProjectAsset } from '@/types/project';
import { validateProject } from './projectIO';
import { downloadBlob } from './download';
import { loadZip } from './zipKind';

const PROJECT_JSON = 'project.json';
const FILES_PREFIX = 'files/';

function metaWithoutBytes(project: AuthoringProject): AuthoringProject {
  return {
    ...project,
    assets: project.assets.map(({ id, path, name, encoding, mimeType }) => ({
      id,
      path,
      name,
      encoding,
      mimeType,
      content: '',
    })),
  };
}

function findAssetEntry(zip: JSZip, assetId: string): JSZip.JSZipObject | null {
  const prefix = `${FILES_PREFIX}${assetId}/`;
  for (const path of Object.keys(zip.files)) {
    const entry = zip.files[path];
    if (!entry || entry.dir) continue;
    if (path.startsWith(prefix)) return entry;
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
  const zip = new JSZip();
  zip.file(PROJECT_JSON, JSON.stringify(metaWithoutBytes(project), null, 2));

  for (const asset of project.assets) {
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
    assets: project.assets.map((a) => ({ ...a, content: '' })),
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
    const entry = findAssetEntry(zip, asset.id);
    if (!entry) {
      assets.push(asset);
      continue;
    }
    assets.push({
      ...asset,
      content: await readAssetContent(entry, asset.encoding),
    });
  }

  return { ...project, assets };
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
  return parseProjectZipFrom(await loadZip(blob));
}

export async function exportProjectZip(project: AuthoringProject): Promise<void> {
  const blob = await buildProjectZip(project);
  downloadBlob(`${project.id || 'project'}.project.zip`, blob);
}
