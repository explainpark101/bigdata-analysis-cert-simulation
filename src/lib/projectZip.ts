import JSZip from 'jszip';
import type { AuthoringProject, ProjectAsset } from '@/types/project';
import { validateProject } from './projectIO';
import { downloadBlob } from './download';

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

export async function parseProjectZip(
  blob: Blob | ArrayBuffer,
): Promise<AuthoringProject> {
  const zip = await JSZip.loadAsync(blob);
  const metaFile = zip.file(PROJECT_JSON);
  if (!metaFile) {
    throw new Error('ZIP must contain project.json (authoring project)');
  }
  const project = validateProject(JSON.parse(await metaFile.async('string')));

  const assets: ProjectAsset[] = [];
  for (const asset of project.assets) {
    const prefix = `${FILES_PREFIX}${asset.id}/`;
    const full = Object.keys(zip.files).find(
      (p) => p.startsWith(prefix) && !zip.files[p].dir,
    );
    if (!full) {
      if (asset.content) {
        assets.push(asset);
      }
      continue;
    }
    const entry = zip.file(full);
    if (!entry) continue;
    const content =
      asset.encoding === 'base64'
        ? await entry.async('base64')
        : await entry.async('string');
    assets.push({ ...asset, content });
  }

  return { ...project, assets };
}

export async function exportProjectZip(project: AuthoringProject): Promise<void> {
  const blob = await buildProjectZip(project);
  downloadBlob(`${project.id || 'project'}.project.zip`, blob);
}
