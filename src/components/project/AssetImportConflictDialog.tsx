import { useMemo, useState } from 'react';
import {
  suggestRename,
  type AssetNameConflict,
  type ConflictResolution,
} from '@/lib/assetImport';
import { mountPathForAsset } from '@/lib/assetPaths';

interface AssetImportConflictDialogProps {
  conflicts: AssetNameConflict[];
  takenNames: Set<string>;
  onResolveAll: (resolutions: ConflictResolution[]) => void;
  onCancel: () => void;
}

export function AssetImportConflictDialog({
  conflicts,
  takenNames,
  onResolveAll,
  onCancel,
}: AssetImportConflictDialogProps) {
  const [index, setIndex] = useState(0);
  const [resolutions, setResolutions] = useState<ConflictResolution[]>([]);
  const [renameValue, setRenameValue] = useState('');

  const current = conflicts[index];
  const remaining = conflicts.length - index;

  const suggestion = useMemo(() => {
    if (!current) return '';
    const taken = new Set(takenNames);
    for (const r of resolutions) {
      if (r.action === 'rename') taken.add(r.newName.toLowerCase());
    }
    return suggestRename(current.pending.fileName, taken);
  }, [current, takenNames, resolutions]);

  if (!current) return null;

  const existingMount = mountPathForAsset(current.existing);
  const displayRename = renameValue || suggestion;

  const commit = (resolution: ConflictResolution) => {
    const next = [...resolutions, resolution];
    if (index + 1 >= conflicts.length) {
      onResolveAll(next);
      return;
    }
    setResolutions(next);
    setIndex(index + 1);
    setRenameValue('');
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="modal asset-conflict-modal"
        role="dialog"
        aria-labelledby="asset-conflict-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <h2 id="asset-conflict-title">파일명 충돌 ({index + 1}/{conflicts.length})</h2>
          <button type="button" className="ghost-btn" onClick={onCancel}>
            취소
          </button>
        </div>
        <div className="modal__body">
          <p>
            같은 파일명 <strong>{current.pending.fileName}</strong> 이(가) 이미
            있고, <strong>내용이 다릅니다</strong>.
          </p>
          <ul className="asset-conflict-meta">
            <li>
              <span>기존</span>
              <code>{current.existing.path}</code>
              <span className="badge">로드 {existingMount}</span>
            </li>
            <li>
              <span>가져올 파일</span>
              <code>{current.pending.sourcePath}</code>
              <span className="badge">{current.pending.libraryPath}</span>
            </li>
          </ul>
          <p className="edit-page__sub">
            남은 충돌 {remaining}건 · 내용이 같으면 자동으로 건너뜁니다.
          </p>
          <label className="form-grid" style={{ display: 'grid', gap: 6 }}>
            새 파일명으로 추가
            <input
              value={displayRename}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder={suggestion}
            />
          </label>
        </div>
        <div className="modal__footer">
          <button
            type="button"
            className="ghost-btn"
            onClick={() => {
              const rest = conflicts.slice(index).map(() => ({
                action: 'skip' as const,
              }));
              onResolveAll([...resolutions, ...rest]);
            }}
          >
            나머지 모두 건너뛰기
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => commit({ action: 'skip' })}
          >
            건너뛰기
          </button>
          <button
            type="button"
            className="primary-btn"
            onClick={() => {
              const name = displayRename.trim();
              if (!name) return;
              commit({ action: 'rename', newName: name });
            }}
          >
            이름 바꿔 추가
          </button>
        </div>
      </div>
    </div>
  );
}
