import type { ExamAsset } from '@/types/exam';
import type { ProjectAsset } from '@/types/project';

export type MediaAsset = Pick<
  ExamAsset | ProjectAsset,
  'path' | 'name' | 'encoding' | 'content' | 'mimeType'
>;

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i;

export function isImageAsset(asset: MediaAsset): boolean {
  if (asset.mimeType?.startsWith('image/')) return true;
  return IMAGE_EXT.test(asset.name) || IMAGE_EXT.test(asset.path);
}

export function isImageFileName(name: string, mimeType?: string): boolean {
  if (mimeType?.startsWith('image/')) return true;
  return IMAGE_EXT.test(name);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    // Avoid spread (...chunk) — large images blow the call stack / OOM in WebView.
    const slice = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode.apply(
      null,
      slice as unknown as number[],
    );
  }
  return btoa(binary);
}

export function assetToDataUrl(asset: MediaAsset): string {
  const mime =
    asset.mimeType ||
    (asset.path.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream');
  if (asset.encoding === 'base64') {
    return `data:${mime};base64,${asset.content}`;
  }
  // utf-8 text (e.g. svg) — never call this for multi-MB CSVs
  return `data:${mime};charset=utf-8,${encodeURIComponent(asset.content)}`;
}

/**
 * Map mount/library paths → data URLs for markdown/img preview.
 * Images only: encoding every CSV with encodeURIComponent OOM'd Tauri WebView
 * (gichul ~9MB raw → ~15MB+ URI strings on top of React state).
 */
export function buildAssetUrlMap(assets: MediaAsset[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const asset of assets) {
    if (!isImageAsset(asset)) continue;
    const url = assetToDataUrl(asset);
    const path = asset.path.replace(/^\.\//, '');
    map.set(path, url);
    map.set(`./${path}`, url);
    map.set(asset.name, url);
    const base = asset.name || path.split('/').pop() || path;
    const mount = `images/${base}`;
    map.set(mount, url);
    map.set(`./${mount}`, url);
  }
  return map;
}

/** Paths from markdown image syntax ![alt](path) */
export function extractMarkdownImagePaths(markdown: string): string[] {
  const paths: string[] = [];
  const re = /!\[[^\]]*]\(\s*<?([^)\s>]+)>?\s*(?:["'][^"']*["'])?\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown ?? ''))) {
    const raw = m[1]?.trim();
    if (!raw || raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('data:')) {
      continue;
    }
    paths.push(raw.replace(/^\.\//, ''));
  }
  return [...new Set(paths)];
}

export function markdownImageSnippet(asset: MediaAsset, alt?: string): string {
  const label = alt ?? asset.name.replace(/\.[^.]+$/, '');
  const base = asset.name || asset.path.split('/').pop() || asset.path;
  const mount = isImageAsset(asset) ? `images/${base}` : asset.path;
  return `![${label}](${mount})`;
}
