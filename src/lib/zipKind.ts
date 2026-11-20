import JSZip from 'jszip';

export type ZipKind = 'exam' | 'project' | 'unknown';

/** Peek zip entries without fully parsing project/exam payloads. */
export async function detectZipKind(
  blob: Blob | ArrayBuffer,
): Promise<ZipKind> {
  const zip = await JSZip.loadAsync(blob);
  if (zip.file('project.json')) return 'project';
  if (zip.file('exam.json')) return 'exam';
  return 'unknown';
}
