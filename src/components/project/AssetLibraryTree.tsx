import { useMemo, useState } from 'react';
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

    const a = node.asset;
    const mount = mountPathForAsset(a);
    const active = a.id === selectedId;

    return (
      <div
        key={a.id}
        className={`fs-tree__file ${active ? 'active' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        {isImageAsset(a) ? (
          <img className="asset-thumb" src={assetToDataUrl(a)} alt="" />
        ) : (
          <FileSpreadsheet size={16} aria-hidden />
        )}
        <button
          type="button"
          className="edit-file-name"
          onClick={() => onSelect(a.id)}
          aria-pressed={active}
          title="미리보기"
        >
          {a.name}
        </button>
        <input
          className="edit-file-path"
          value={a.path}
          title="라이브러리 트리 경로"
          onChange={(e) =>
            onUpdatePath(
              a.id,
              normalizeLibraryPath(e.target.value, {
                image: isImageAsset(a),
                fileName: a.name,
              }),
            )
          }
        />
        <span className="badge" title="런타임 로드 경로">
          {mount}
        </span>
        <span className="badge">
          {Math.max(1, Math.round(a.content.length / 1024))} KB
        </span>
        <button
          type="button"
          className="danger-btn btn-with-icon"
          onClick={() => onRemove(a.id)}
        >
          <Trash2 size={14} />
          제거
        </button>
      </div>
    );
  };

  return <div className="fs-tree">{tree.map((n) => renderNode(n, 0))}</div>;
}
