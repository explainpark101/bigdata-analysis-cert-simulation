/**
 * Low-memory ZIP reader: scans the central directory via Blob.slice and
 * inflates one entry at a time. Avoids JSZip.loadAsync buffering the whole file.
 */

export interface ZipCdEntry {
  name: string;
  compression: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

const textDecoder = new TextDecoder('utf-8');

function u16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function u32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('DecompressionStream is not available in this WebView');
  }
  // Copy so the stream does not retain the zip slice's backing store longer than needed.
  const copy = data.slice();
  const stream = new Blob([copy])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Parse central directory entry names/offsets from a seekable Blob. */
export async function listZipEntries(blob: Blob): Promise<ZipCdEntry[]> {
  if (blob.size < 22) return [];

  const tailLen = Math.min(blob.size, 65536 + 256);
  const tailBuf = await blob.slice(blob.size - tailLen).arrayBuffer();
  const tail = new Uint8Array(tailBuf);
  const tailView = new DataView(tailBuf);

  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i -= 1) {
    if (
      tail[i] === 0x50 &&
      tail[i + 1] === 0x4b &&
      tail[i + 2] === 0x05 &&
      tail[i + 3] === 0x06
    ) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Invalid ZIP: end of central directory not found');

  const cdSize = u32(tailView, eocd + 12);
  const cdOffset = u32(tailView, eocd + 16);
  if (cdOffset + cdSize > blob.size) {
    throw new Error('Invalid ZIP: central directory out of range');
  }

  const cdBuf = await blob.slice(cdOffset, cdOffset + cdSize).arrayBuffer();
  const cd = new Uint8Array(cdBuf);
  const cdView = new DataView(cdBuf);
  const entries: ZipCdEntry[] = [];
  let offset = 0;

  while (offset + 46 <= cd.length) {
    if (u32(cdView, offset) !== 0x02014b50) break;
    const compression = u16(cdView, offset + 10);
    const compressedSize = u32(cdView, offset + 20);
    const uncompressedSize = u32(cdView, offset + 24);
    const nameLen = u16(cdView, offset + 28);
    const extraLen = u16(cdView, offset + 30);
    const commentLen = u16(cdView, offset + 32);
    const localHeaderOffset = u32(cdView, offset + 42);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLen;
    if (nameEnd > cd.length) break;
    const name = textDecoder.decode(cd.subarray(nameStart, nameEnd));
    entries.push({
      name,
      compression,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    offset = nameEnd + extraLen + commentLen;
  }

  return entries;
}

export async function readZipEntryBytes(
  blob: Blob,
  entry: ZipCdEntry,
): Promise<Uint8Array> {
  // Local file header is at least 30 bytes; name/extra lengths follow.
  const headerBuf = await blob
    .slice(entry.localHeaderOffset, entry.localHeaderOffset + 30)
    .arrayBuffer();
  const headerView = new DataView(headerBuf);
  if (u32(headerView, 0) !== 0x04034b50) {
    throw new Error(`Invalid ZIP local header: ${entry.name}`);
  }
  const nameLen = u16(headerView, 26);
  const extraLen = u16(headerView, 28);
  const dataStart = entry.localHeaderOffset + 30 + nameLen + extraLen;
  const dataEnd = dataStart + entry.compressedSize;
  const compressed = new Uint8Array(
    await blob.slice(dataStart, dataEnd).arrayBuffer(),
  );

  if (entry.compression === 0) {
    return compressed.slice();
  }
  if (entry.compression === 8) {
    return inflateRaw(compressed);
  }
  throw new Error(
    `Unsupported ZIP compression method ${entry.compression} for ${entry.name}`,
  );
}

export async function readZipEntryText(
  blob: Blob,
  entry: ZipCdEntry,
): Promise<string> {
  const bytes = await readZipEntryBytes(blob, entry);
  return textDecoder.decode(bytes);
}

export function zipKindFromEntries(entries: ZipCdEntry[]): 'exam' | 'project' | 'unknown' {
  const names = new Set(entries.map((e) => e.name.replace(/^\/+/, '')));
  if (names.has('project.json')) return 'project';
  if (names.has('exam.json')) return 'exam';
  return 'unknown';
}
