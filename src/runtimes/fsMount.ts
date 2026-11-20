import type { ExamAsset } from '@/types/exam';
import { preloadPyodide } from './pyodideRuntime';
import { writeWebRFile } from './webrRuntime';

type FsLike = {
  mkdirTree?: (path: string) => void;
  mkdir: (path: string) => void;
  writeFile: (path: string, data: string | Uint8Array, opts?: { encoding?: string }) => void;
  analyzePath: (path: string) => { exists: boolean };
  unlink: (path: string) => void;
};

function ensureDir(FS: FsLike, dirPath: string): void {
  if (!dirPath || dirPath === '.' || dirPath === '/') return;
  const parts = dirPath.split('/').filter(Boolean);
  let cur = '';
  for (const part of parts) {
    cur = cur ? `${cur}/${part}` : part;
    try {
      if (!FS.analyzePath(cur).exists) {
        FS.mkdir(cur);
      }
    } catch {
      try {
        FS.mkdir(cur);
      } catch {
        // already exists
      }
    }
  }
}

function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i <= 0 ? '' : path.slice(0, i);
}

function decodeAssetBytes(file: ExamAsset): string | Uint8Array {
  if (file.encoding === 'base64') {
    return Uint8Array.from(atob(file.content), (c) => c.charCodeAt(0));
  }
  return file.content;
}

/**
 * Mount quiz-provided assets into Pyodide FS (DataQ style: data/*.csv).
 */
export async function mountAssetsToPyodide(files: ExamAsset[]): Promise<string[]> {
  if (!files.length) return [];
  const pyodide = await preloadPyodide();
  const FS = (pyodide as unknown as { FS: FsLike }).FS;
  const mounted: string[] = [];

  for (const file of files) {
    const path = file.path.replace(/^\.\//, '').replace(/\\/g, '/');
    const dir = dirname(path);
    if (dir) ensureDir(FS, dir);

    const data = decodeAssetBytes(file);
    if (typeof data === 'string') {
      FS.writeFile(path, data, { encoding: 'utf8' });
    } else {
      FS.writeFile(path, data);
    }
    mounted.push(path);
  }

  return mounted;
}

/**
 * Mount quiz-provided assets into webR VFS under /home/web_user
 * so relative paths like data/foo.csv work with read.csv / readr::read_csv.
 */
export async function mountAssetsToWebR(files: ExamAsset[]): Promise<string[]> {
  if (!files.length) return [];
  const mounted: string[] = [];
  for (const file of files) {
    const path = file.path.replace(/^\.\//, '').replace(/\\/g, '/');
    await writeWebRFile(path, decodeAssetBytes(file));
    mounted.push(path);
  }
  return mounted;
}

/** Mount into both runtimes (exam may switch Python ↔ R). */
export async function mountAssetsToRuntimes(
  files: ExamAsset[],
): Promise<{ python: string[]; r: string[] }> {
  const [python, r] = await Promise.all([
    mountAssetsToPyodide(files),
    mountAssetsToWebR(files),
  ]);
  return { python, r };
}

/** List mounted provided-file paths for UI / debugging. */
export function listAssetPaths(files: ExamAsset[]): string[] {
  return (files ?? []).map((f) => f.path);
}
