import { useEffect, useId, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import {
  getRuntimeLockQueue,
  runtimeKindLabel,
  subscribeRuntimeLockQueue,
  type RuntimeKind,
  type RuntimeLockEntry,
  type RuntimeLockQueueState,
} from '@/lib/runtimeMutex';

interface RuntimeLockQueueModalProps {
  open: boolean;
  onClose: () => void;
}

function LaneSection({
  kind,
  holder,
  waiters,
}: {
  kind: RuntimeKind;
  holder: RuntimeLockEntry | null;
  waiters: RuntimeLockEntry[];
}) {
  const empty = !holder && waiters.length === 0;
  return (
    <section
      className="runtime-lock-queue__lane"
      aria-label={`${runtimeKindLabel(kind)} 큐`}
    >
      <header className="runtime-lock-queue__lane-head">
        <strong>{runtimeKindLabel(kind)}</strong>
        <span
          className={`runtime-lock-queue__pill runtime-lock-queue__pill--${
            holder ? 'busy' : 'idle'
          }`}
        >
          {holder ? (
            <>
              <Loader2 size={12} className="spin" aria-hidden />
              사용 중
            </>
          ) : (
            '대기 없음'
          )}
        </span>
      </header>
      {empty ? (
        <p className="runtime-lock-queue__empty">현재 점유·대기 작업이 없습니다.</p>
      ) : (
        <ul className="runtime-lock-queue__list">
          {holder ? (
            <li className="runtime-lock-queue__item runtime-lock-queue__item--running">
              <div className="runtime-lock-queue__title-row">
                <strong>{holder.session}</strong>
                <span className="runtime-lock-queue__badge">실행 중</span>
              </div>
              <div className="runtime-lock-queue__meta">{holder.label}</div>
            </li>
          ) : null}
          {waiters.map((w, i) => (
            <li key={w.id} className="runtime-lock-queue__item">
              <div className="runtime-lock-queue__title-row">
                <strong>{w.session}</strong>
                <span className="runtime-lock-queue__badge runtime-lock-queue__badge--wait">
                  대기 {i + 1}
                </span>
              </div>
              <div className="runtime-lock-queue__meta">
                {w.label}
                {holder
                  ? ` · ${holder.session} 해제 후 자동 재개`
                  : ' · 곧 시작'}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function RuntimeLockQueueModal({
  open,
  onClose,
}: RuntimeLockQueueModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [queue, setQueue] = useState<RuntimeLockQueueState>(() =>
    getRuntimeLockQueue(),
  );

  useEffect(() => subscribeRuntimeLockQueue(setQueue), []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog runtime-lock-dialog"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClose={() => {
        if (open) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="confirm-dialog__panel runtime-lock-dialog__panel">
        <header className="modal__header">
          <h2 id={titleId}>런타임 큐 · Pyodide / WebR</h2>
          <button
            type="button"
            className="ghost-btn btn-with-icon"
            onClick={onClose}
            aria-label="닫기"
          >
            <X size={16} />
          </button>
        </header>
        <div className="modal__body runtime-lock-dialog__body">
          <p className="edit-page__sub" style={{ marginTop: 0 }}>
            다른 세션이 런타임을 쓰고 있으면 대기열에 남고, 해제되는 즉시 다음
            작업이 이어서 실행됩니다.
          </p>
          <div className="runtime-lock-queue">
            <LaneSection
              kind="python"
              holder={queue.python.holder}
              waiters={queue.python.waiters}
            />
            <LaneSection
              kind="r"
              holder={queue.r.holder}
              waiters={queue.r.waiters}
            />
          </div>
        </div>
      </div>
    </dialog>
  );
}
