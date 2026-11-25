import { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  Folder,
  FolderOpen,
  Trash2,
} from 'lucide-react';
import type { ProjectAsset } from '@/types/project';
import {
  assetToDataUrl,
  isImageAsset,
} from '@/lib/assetMedia';
import { assetByteLength } from '@/lib/assetStore';
import {
  buildAssetTree,
  mountPathForAsset,
  normalizeLibraryPath,
  type AssetTreeNode,
} from '@/lib/assetPaths';

interface AssetLibraryTreeProps {
  assets: ProjectAsset[];
  selectedId: string;
  onSelect: (id: string) => void;
  onUpdatePath: (id: string, path: string) => void;
  onRemove: (id: string) => void;
}

function AssetThumb({ asset }: { asset: ProjectAsset }) {
  const [src, setSrc] = useState(() =>
    asset.content ? assetToDataUrl(asset) : '',
  );
  useEffect(() => {
    let cancelled = false;
    if (asset.content) {
      setSrc(assetToDataUrl(asset));
      return;
    }
    void (async () => {
      const { withAssetContent } = await import('@/lib/assetStore');
      const full = await withAssetContent(asset);
      if (!cancelled && full.content) setSrc(assetToDataUrl(full));
    })();
    return () => {
      cancelled = true;
    };
  }, [asset]);
  if (!src) return <FileSpreadsheet size={16} aria-hidden />;
  return <img className="asset-thumb" src={src} alt="" />;
}

function AssetFileRow({
  asset,
  depth,
  selected,
  onSelect,
  onUpdatePath,
  onRemove,
}: {
  asset: ProjectAsset;
  depth: number;
  selected: boolean;
  onSelect: (id: string) => void;
  onUpdatePath: (id: string, path: string) => void;
  onRemove: (id: string) => void;
}) {
  const mount = mountPathForAsset(asset);
  const image = isImageAsset(asset);
  // Draft path locally — committing every keystroke rewrote all assets + IDB.
  const [pathDraft, setPathDraft] = useState(asset.path);
  useEffect(() => {
    setPathDraft(asset.path);
  }, [asset.path]);

  const commitPath = () => {
    const next = normalizeLibraryPath(pathDraft, {
      image,
      fileName: asset.name,
    });
    setPathDraft(next);
    if (next !== asset.path) onUpdatePath(asset.id, next);
  };

  return (
    <div
      className={`fs-tree__file ${selected ? 'active' : ''}`}
      style={{ paddingLeft: 8 + depth * 14 }}
    >
      {image ? (
        <AssetThumb asset={asset} />
      ) : (
        <FileSpreadsheet size={16} aria-hidden />
      )}
      <button
        type="button"
        className="edit-file-name"
        onClick={() => onSelect(asset.id)}
        aria-pressed={selected}
        title="미리보기"
      >
        {asset.name}
      </button>
      <input
        className="edit-file-path"
        value={pathDraft}
        title="라이브러리 트리 경로"
        onChange={(e) => setPathDraft(e.target.value)}
        onBlur={commitPath}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.currentTarget.blur();
          }
        }}
      />
      <span className="badge" title="런타임 로드 경로">
        {mount}
      </span>
      <span className="badge">
        {Math.max(1, Math.round(assetByteLength(asset) / 1024))} KB
      </span>
      <button
        type="button"
        className="danger-btn btn-with-icon"
        onClick={() => onRemove(asset.id)}
      >
        <Trash2 size={14} />
        제거
      </button>
    </div>
  );
}

export function AssetLibraryTree({
  assets,
  selectedId,
  onSelect,
  onUpdatePath,
  onRemove,
}: AssetLibraryTreeProps) {
  const tree = useMemo(() => buildAssetTree(assets), [assets]);
  const [open, setOpen] = useState<Record<string, boolean>>(() => ({
    data: true,
    images: true,
  }));

  if (!assets.length) {
    return (
      <p className="edit-page__sub">
        아직 파일이 없습니다. CSV / 이미지를 추가하세요.
      </p>
    );
  }

  const renderNode = (node: AssetTreeNode, depth: number) => {
    if (node.type === 'dir') {
      const expanded = open[node.path] ?? depth < 2;
      return (
        <div key={`d:${node.path}`} className="fs-tree__dir">
          <button
            type="button"
            className="fs-tree__dir-btn"
            style={{ paddingLeft: 8 + depth * 14 }}
            onClick={() =>
              setOpen((s) => ({ ...s, [node.path]: !expanded }))
            }
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {expanded ? <FolderOpen size={14} /> : <Folder size={14} />}
            <span>{node.name || '/'}</span>
          </button>
          {expanded &&
            node.children.map((child) => renderNode(child, depth + 1))}
        </div>
      );
    }

    return (
      <AssetFileRow
        key={node.asset.id}
        asset={node.asset}
        depth={depth}
        selected={node.asset.id === selectedId}
        onSelect={onSelect}
        onUpdatePath={onUpdatePath}
        onRemove={onRemove}
      />
    );
  };

  return <div className="fs-tree">{tree.map((n) => renderNode(n, 0))}</div>;
}
