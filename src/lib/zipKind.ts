import JSZip from 'jszip';
import { listZipEntries, zipKindFromEntries } from '@/lib/zipStream';

export type ZipKind = 'exam' | 'project' | 'unknown';

/** Load a zip once. Prefer Blob/File over ArrayBuffer to avoid an extra copy. */
export async function loadZip(data: Blob | ArrayBuffer | Uint8Array): Promise<JSZip> {
  return JSZip.loadAsync(data);
}

export function zipKindFrom(zip: JSZip): ZipKind {
  if (zip.file('project.json')) return 'project';
  if (zip.file('exam.json')) return 'exam';
  return 'unknown';
}

/**
 * Detect zip kind by scanning the central directory only (Blob.slice).
 * Does NOT inflate the archive — safe before a streaming import.
 */
export async function peekZipKind(blob: Blob): Promise<ZipKind> {
  try {
    return zipKindFromEntries(await listZipEntries(blob));
  } catch {
    return 'unknown';
  }
}

/** Peek zip kind. Prefer {@link loadZip} + {@link zipKindFrom} when parsing follows. */
export async function detectZipKind(
  blob: Blob | ArrayBuffer,
): Promise<ZipKind> {
  if (typeof Blob !== 'undefined' && blob instanceof Blob) {
    return peekZipKind(blob);
  }
  return zipKindFrom(await loadZip(blob));
}
