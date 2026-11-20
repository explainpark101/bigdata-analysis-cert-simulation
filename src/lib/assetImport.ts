import { bytesToBase64, isImageFileName } from '@/lib/assetMedia';
import {
  assetBasename,
  mountPathForAsset,
  normalizeLibraryPath,
} from '@/lib/assetPaths';
import { createProjectAsset } from '@/lib/projectIO';
import type { ProjectAsset } from '@/types/project';

export interface PendingAssetImport {
  /** Original file basename */
  fileName: string;
  /** Proposed library tree path */
  libraryPath: string;
  content: string;
  encoding: 'utf-8' | 'base64';
  mimeType: string;
  /** webkitRelativePath or name */
  sourcePath: string;
}

export interface AssetNameConflict {
  pending: PendingAssetImport;
  existing: ProjectAsset;
}

export type ConflictResolution =
  | { action: 'skip' }
  | { action: 'rename'; newName: string };

const DATA_EXT = /\.(csv|tsv|txt|json)$/i;

function isImportableFile(file: File): boolean {
  if (isImageFileName(file.name, file.type)) return true;
  if (DATA_EXT.test(file.name)) return true;
  if (file.type.startsWith('text/')) return true;
  // Folder picks often have empty type for csv
  if (!file.type && /\.\w+$/.test(file.name)) return true;
  return false;
}

function libraryPathFromFile(file: File): { path: string; image: boolean } {
  const image = isImageFileName(file.name, file.type);
  const rel =
    (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
    file.name;
  const cleaned = rel.replace(/\\/g, '/').replace(/^\/+/, '');
  const withRoot = image ? `images/${cleaned}` : `data/${cleaned}`;
  return {
    path: normalizeLibraryPath(withRoot, {
      image,
      fileName: file.name,
    }),
    image,
  };
}

/** Read FileList / File[] into pending imports (skips non-data/image). */
export async function readPendingImports(
  files: FileList | File[],
): Promise<PendingAssetImport[]> {
  const list = Array.from(files).filter(isImportableFile);
  const out: PendingAssetImport[] = [];

  for (const file of list) {
    const { path, image } = libraryPathFromFile(file);
    const sourcePath =
      (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
      file.name;

    if (image) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      out.push({
        fileName: file.name,
        libraryPath: path,
        content: bytesToBase64(bytes),
        encoding: 'base64',
        mimeType: file.type || 'image/png',
        sourcePath,
      });
    } else {
      out.push({
        fileName: file.name,
        libraryPath: path,
        content: await file.text(),
        encoding: 'utf-8',
        mimeType: file.type || 'text/csv',
        sourcePath,
      });
    }
  }

  return out;
}

function contentEqual(a: ProjectAsset, b: PendingAssetImport): boolean {
  return a.encoding === b.encoding && a.content === b.content;
}

function mountKey(fileName: string, image: boolean): string {
  const base = assetBasename(fileName);
  return image ? `images/${base}` : `data/${base}`;
}

function pendingIsImage(p: PendingAssetImport): boolean {
  return p.encoding === 'base64' || isImageFileName(p.fileName, p.mimeType);
}

/**
 * Split pending imports into:
 * - ready: no basename conflict (or identical content → skip later)
 * - conflicts: same mount basename, different content
 * - identical: same basename + same content (skip)
 */
export function classifyAssetImports(
  pending: PendingAssetImport[],
  existing: ProjectAsset[],
): {
  ready: PendingAssetImport[];
  conflicts: AssetNameConflict[];
  identicalCount: number;
} {
  const byMount = new Map<string, ProjectAsset>();
  for (const a of existing) {
    byMount.set(mountPathForAsset(a), a);
  }

  const ready: PendingAssetImport[] = [];
  const conflicts: AssetNameConflict[] = [];
  let identicalCount = 0;

  // Also detect duplicates within the batch
  const batchSeen = new Map<string, PendingAssetImport>();

  for (const p of pending) {
    const key = mountKey(p.fileName, pendingIsImage(p));
    const prevBatch = batchSeen.get(key);
    if (prevBatch) {
      if (
        prevBatch.content === p.content &&
        prevBatch.encoding === p.encoding
      ) {
        identicalCount += 1;
        continue;
      }
      // Treat later file as conflicting with a synthetic "existing" from first
      conflicts.push({
        pending: p,
        existing: createProjectAsset(
          {
            name: prevBatch.fileName,
            content: prevBatch.content,
            mimeType: prevBatch.mimeType,
            encoding: prevBatch.encoding,
          },
          prevBatch.libraryPath,
        ),
      });
      continue;
    }

    const existingAsset = byMount.get(key);
    if (!existingAsset) {
      batchSeen.set(key, p);
      ready.push(p);
      continue;
    }

    if (contentEqual(existingAsset, p)) {
      identicalCount += 1;
      continue;
    }

    conflicts.push({ pending: p, existing: existingAsset });
  }

  return { ready, conflicts, identicalCount };
}

/** Suggest a free filename: name.csv → name_1.csv */
export function suggestRename(
  fileName: string,
  taken: Set<string>,
): string {
  const m = fileName.match(/^(.*?)(\.[^.]+)?$/);
  const stem = m?.[1] || fileName;
  const ext = m?.[2] || '';
  let i = 1;
  let next = `${stem}_${i}${ext}`;
  while (taken.has(next.toLowerCase())) {
    i += 1;
    next = `${stem}_${i}${ext}`;
  }
  return next;
}

export function pendingToAsset(
  p: PendingAssetImport,
  nameOverride?: string,
): ProjectAsset {
  const name = nameOverride || p.fileName;
  const image = pendingIsImage(p);
  const dir = p.libraryPath.includes('/')
    ? p.libraryPath.slice(0, p.libraryPath.lastIndexOf('/'))
    : image
      ? 'images'
      : 'data';
  const libraryPath = normalizeLibraryPath(`${dir}/${name}`, {
    image,
    fileName: name,
  });
  return createProjectAsset(
    {
      name,
      content: p.content,
      mimeType: p.mimeType,
      encoding: p.encoding,
    },
    libraryPath,
  );
}

/** Collect basenames already used for mount uniqueness. */
export function takenBasenames(assets: ProjectAsset[]): Set<string> {
  return new Set(assets.map((a) => assetBasename(a.name).toLowerCase()));
}
