import JSZip from 'jszip';

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

/** Peek zip kind. Prefer {@link loadZip} + {@link zipKindFrom} when parsing follows. */
export async function detectZipKind(
  blob: Blob | ArrayBuffer,
): Promise<ZipKind> {
  return zipKindFrom(await loadZip(blob));
}
