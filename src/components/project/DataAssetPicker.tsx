import { useId, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  Folder,
  Search,
} from 'lucide-react';
import type { ProjectAsset } from '@/types/project';
import { isImageAsset } from '@/lib/assetMedia';
import {
  buildAssetTree,
  filterAssetsByQuery,
  mountPathForAsset,
  type AssetTreeNode,
} from '@/lib/assetPaths';

interface DataAssetPickerProps {
  assets: ProjectAsset[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

export function DataAssetPicker({
  assets,
  selectedIds,
  onChange,
}: DataAssetPickerProps) {
  const searchId = useId();
  const searchHintId = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({ data: true });

  const dataAssets = useMemo(
    () => assets.filter((a) => !isImageAsset(a)),
    [assets],
  );

  const filtered = useMemo(
    () => filterAssetsByQuery(dataAssets, query),
    [dataAssets, query],
  );

  const tree = useMemo(() => buildAssetTree(filtered), [filtered]);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  const toggle = (id: string) => {
    if (selected.has(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  if (!dataAssets.length) {
    return (
      <p className="edit-page__sub">
        데이터 파일이 없습니다. 라이브러리 탭에서 CSV를 추가하세요.
      </p>
    );
  }

  const renderNode = (node: AssetTreeNode, depth: number) => {
    if (node.type === 'dir') {
      const expanded = open[node.path] ?? true;
      return (
        <div key={`d:${node.path}`}>
          <button
            type="button"
            className="fs-tree__dir-btn"
            style={{ paddingInlineStart: 4 + depth * 12 }}
            onClick={() =>
              setOpen((s) => ({ ...s, [node.path]: !expanded }))
            }
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <Folder size={14} />
            <span>{node.name}</span>
          </button>
          {expanded &&
            node.children.map((child) => renderNode(child, depth + 1))}
        </div>
      );
    }

    const a = node.asset;
    const on = selected.has(a.id);
    const mount = mountPathForAsset(a);
    const switchId = `${searchId}-sw-${a.id}`;

    return (
      <div
        key={a.id}
        className={`data-pick-row ${on ? 'is-on' : ''}`}
        style={{ paddingInlineStart: 4 + depth * 12 }}
      >
        <label className="toggle-switch" htmlFor={switchId} title={on ? '사용 중' : '미사용'}>
          <input
            id={switchId}
            type="checkbox"
            checked={on}
            onChange={() => toggle(a.id)}
            aria-label={`${a.name} 사용`}
            {...({ switch: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
          />
          <span className="toggle-switch__track" aria-hidden />
        </label>
        <FileSpreadsheet size={16} aria-hidden />
        <div className="data-pick-row__meta">
          <span className="data-pick-row__name">{a.name}</span>
          <span className="data-pick-row__path">{a.path}</span>
          <span className="badge">로드: {mount}</span>
        </div>
      </div>
    );
  };

  return (
    <div className="data-asset-picker">
      <search
        className="data-asset-picker__search-block"
        aria-labelledby={`${searchId}-label`}
      >
        <label
          className="data-asset-picker__search-label"
          htmlFor={searchId}
          id={`${searchId}-label`}
        >
          파일 검색
        </label>
        <div className="data-asset-picker__search">
          <Search size={18} aria-hidden className="data-asset-picker__search-icon" />
          <input
            id={searchId}
            type="search"
            name="asset-filter"
            value={query}
            placeholder="예: customer_train · type2 · data/"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="search"
            aria-describedby={searchHintId}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query ? (
            <button
              type="button"
              className="ghost-btn data-asset-picker__clear"
              onClick={() => setQuery('')}
            >
              지우기
            </button>
          ) : null}
        </div>
        <p id={searchHintId} className="data-asset-picker__search-hint">
          파일명 · 트리 경로 · <code>data/파일명.csv</code> 로드 경로로 필터합니다.
        </p>
      </search>

      <p className="edit-page__sub">
        왼쪽 스위치로 이 문제에 마운트할 파일을 고릅니다. 코드에서는 항상{' '}
        <code>data/파일명.csv</code> 로 불러옵니다.
      </p>

      {!filtered.length ? (
        <p className="edit-page__sub" role="status">
          검색 결과가 없습니다.
        </p>
      ) : (
        <div className="data-asset-picker__tree">
          {tree.map((n) => renderNode(n, 0))}
        </div>
      )}
    </div>
  );
}
