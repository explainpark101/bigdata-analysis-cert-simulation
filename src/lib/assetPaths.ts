import { isImageAsset, type MediaAsset } from '@/lib/assetMedia';
import type { ProjectAsset } from '@/types/project';

/** File basename from a path (`data/a/b.csv` → `b.csv`). */
export function assetBasename(pathOrName: string): string {
  const norm = pathOrName.replace(/\\/g, '/').replace(/^\.\//, '');
  const parts = norm.split('/').filter(Boolean);
  return parts[parts.length - 1] || norm;
}

/**
 * Runtime / exam mount path. Always flat:
 * - data files → `data/<filename>`
 * - images → `images/<filename>`
 */
export function mountPathForAsset(asset: MediaAsset): string {
  const base = assetBasename(asset.name || asset.path);
  return isImageAsset(asset) ? `images/${base}` : `data/${base}`;
}

/** Normalize library tree path; keep folders but force data/ or images/ root. */
export function normalizeLibraryPath(
  raw: string,
  opts: { image: boolean; fileName: string },
): string {
  let path = raw.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  const base = assetBasename(opts.fileName || path);
  const root = opts.image ? 'images' : 'data';

  if (!path || path === base) {
    return `${root}/${base}`;
  }

  if (!path.startsWith(`${root}/`) && path !== root) {
    // Strip wrong root if present, then prefix
    path = path.replace(/^(data|images)\//, '');
    path = `${root}/${path}`;
  }

  // Ensure leaf is the filename
  const parts = path.split('/').filter(Boolean);
  parts[parts.length - 1] = base;
  if (parts[0] !== root) parts.unshift(root);
  return parts.join('/');
}

export type AssetTreeNode =
  | { type: 'dir'; name: string; path: string; children: AssetTreeNode[] }
  | { type: 'file'; name: string; path: string; asset: ProjectAsset };

/** Build a filesystem-style tree from asset.library paths. */
export function buildAssetTree(assets: ProjectAsset[]): AssetTreeNode[] {
  type Dir = {
    type: 'dir';
    name: string;
    path: string;
    dirs: Map<string, Dir>;
    files: AssetTreeNode[];
  };

  const root: Dir = {
    type: 'dir',
    name: '',
    path: '',
    dirs: new Map(),
    files: [],
  };

  for (const asset of assets) {
    const path = asset.path.replace(/\\/g, '/').replace(/^\.\//, '');
    const parts = path.split('/').filter(Boolean);
    if (!parts.length) continue;

    let cur = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const name = parts[i];
      const dirPath = parts.slice(0, i + 1).join('/');
      let next = cur.dirs.get(name);
      if (!next) {
        next = {
          type: 'dir',
          name,
          path: dirPath,
          dirs: new Map(),
          files: [],
        };
        cur.dirs.set(name, next);
      }
      cur = next;
    }

    const fileName = parts[parts.length - 1];
    cur.files.push({
      type: 'file',
      name: fileName,
      path,
      asset,
    });
  }

  const toNodes = (dir: Dir): AssetTreeNode[] => {
    const dirs = [...dir.dirs.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(
        (d): AssetTreeNode => ({
          type: 'dir',
          name: d.name,
          path: d.path,
          children: toNodes(d),
        }),
      );
    const files = [...dir.files].sort((a, b) => a.name.localeCompare(b.name));
    return [...dirs, ...files];
  };

  return toNodes(root);
}

export function filterAssetsByQuery(
  assets: ProjectAsset[],
  query: string,
): ProjectAsset[] {
  const q = query.trim().toLowerCase();
  if (!q) return assets;
  return assets.filter((a) => {
    const mount = mountPathForAsset(a).toLowerCase();
    return (
      a.name.toLowerCase().includes(q) ||
      a.path.toLowerCase().includes(q) ||
      mount.includes(q)
    );
  });
}
