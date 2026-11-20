import { useEffect } from 'react';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Optional middle / alternate action (e.g. go home). */
  secondaryLabel?: string;
  busy?: boolean;
  /** Style the primary confirm as a destructive action. */
  confirmDanger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onSecondary?: () => void;
}

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = '확인',
  cancelLabel = '취소',
  secondaryLabel,
  busy = false,
  confirmDanger = false,
  onConfirm,
  onCancel,
  onSecondary,
}: ConfirmModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        className="modal asset-conflict-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal__header">
          <h2 id="confirm-modal-title">{title}</h2>
        </header>
        <div className="modal__body">
          <p style={{ margin: 0, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
            {message}
          </p>
        </div>
        <footer className="modal__footer">
          <button
            type="button"
            className="ghost-btn"
            disabled={busy}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          {secondaryLabel && onSecondary ? (
            <button
              type="button"
              className="ghost-btn"
              disabled={busy}
              onClick={onSecondary}
            >
              {secondaryLabel}
            </button>
          ) : null}
          <button
            type="button"
            className={confirmDanger ? 'danger-btn' : 'primary-btn'}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? '처리 중…' : confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}
