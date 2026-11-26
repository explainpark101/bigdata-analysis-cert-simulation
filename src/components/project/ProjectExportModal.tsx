import { useEffect, useId, useRef, useState } from 'react';
import type { AuthoringProject } from '@/types/project';
import {
  previewProjectExport,
  type ProjectExportOptions,
} from '@/lib/projectIO';

interface ProjectExportModalProps {
  open: boolean;
  project: AuthoringProject;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (options: ProjectExportOptions) => void;
}

export function ProjectExportModal({
  open,
  project,
  busy = false,
  onCancel,
  onConfirm,
}: ProjectExportModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [omitUnassignedProblems, setOmitUnassignedProblems] = useState(true);
  const [omitUnassignedCsvs, setOmitUnassignedCsvs] = useState(true);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setOmitUnassignedProblems(true);
    setOmitUnassignedCsvs(true);
  }, [open]);

  const options: ProjectExportOptions = {
    omitUnassignedProblems,
    omitUnassignedCsvs,
  };
  const preview = previewProjectExport(project, options);

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog project-export-dialog"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
      onClose={() => {
        if (open && !busy) onCancel();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <form
        className="confirm-dialog__panel project-export-dialog__panel"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) onConfirm(options);
        }}
      >
        <header className="modal__header">
          <h2 id={titleId}>프로젝트 ZIP 내보내기</h2>
        </header>
        <div className="modal__body project-export-dialog__body">
          <p className="edit-page__sub" style={{ marginTop: 0 }}>
            시험에 쓰이지 않는 항목을 빼고 내보낼 수 있습니다. 작업 중인
            프로젝트는 그대로 두고, ZIP에만 적용됩니다.
          </p>

          <fieldset className="project-export-dialog__options" disabled={busy}>
            <legend className="visually-hidden">내보내기 옵션</legend>
            <label className="switch project-export-dialog__option">
              <input
                type="checkbox"
                checked={omitUnassignedProblems}
                onChange={(e) => setOmitUnassignedProblems(e.target.checked)}
              />
              <span>
                시험에 포함되지 않은 문제 제외
                <span className="project-export-dialog__hint">
                  {omitUnassignedProblems
                    ? `문제 ${preview.problemKept}/${preview.problemTotal}` +
                      (preview.problemOmitted
                        ? ` · ${preview.problemOmitted}개 제외`
                        : '')
                    : `문제 ${preview.problemTotal}개 전부`}
                </span>
              </span>
            </label>
            <label className="switch project-export-dialog__option">
              <input
                type="checkbox"
                checked={omitUnassignedCsvs}
                onChange={(e) => setOmitUnassignedCsvs(e.target.checked)}
              />
              <span>
                문제에 배정되지 않은 CSV 제외
                <span className="project-export-dialog__hint">
                  {omitUnassignedCsvs
                    ? `CSV ${preview.csvKept}/${preview.csvTotal}` +
                      (preview.csvOmitted
                        ? ` · ${preview.csvOmitted}개 제외`
                        : '')
                    : `CSV ${preview.csvTotal}개 전부`}
                  {omitUnassignedProblems && omitUnassignedCsvs
                    ? ' (남은 문제 기준)'
                    : ''}
                </span>
              </span>
            </label>
          </fieldset>
        </div>
        <footer className="modal__footer">
          <button
            type="button"
            className="ghost-btn"
            disabled={busy}
            onClick={onCancel}
          >
            취소
          </button>
          <button type="submit" className="primary-btn" disabled={busy}>
            {busy ? '저장 중…' : 'ZIP 저장'}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
