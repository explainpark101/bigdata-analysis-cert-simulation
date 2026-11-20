import { useEffect } from 'react';
import type { GradeReport, GradeStatus } from '@/lib/examGrade';

interface GradeResultModalProps {
  open: boolean;
  report: GradeReport | null;
  onClose: () => void;
}

function statusLabel(s: GradeStatus): string {
  switch (s) {
    case 'pass':
      return '정답';
    case 'fail':
      return '오답';
    case 'partial':
      return '부분';
    case 'unsubmitted':
      return '미제출';
    case 'ungradable':
      return '채점불가';
    default:
      return s;
  }
}

export function GradeResultModal({
  open,
  report,
  onClose,
}: GradeResultModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !report) return null;

  const pct =
    report.max > 0 ? Math.round((report.earned / report.max) * 1000) / 10 : 0;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal grade-result-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="grade-result-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal__header">
          <h2 id="grade-result-title">채점 결과</h2>
          <button type="button" className="ghost-btn" onClick={onClose}>
            닫기
          </button>
        </header>
        <div className="modal__body">
          <div className="grade-result-summary">
            <strong>
              {report.earned}/{report.max}점 ({pct}%)
            </strong>
            {report.unsubmittedCount > 0 ? (
              <span className="edit-page__sub">
                미제출 {report.unsubmittedCount}건 포함
              </span>
            ) : null}
          </div>
          <ul className="grade-result-list">
            {report.items.map((item) => (
              <li
                key={item.quizId}
                className={`grade-result-item grade-result-item--${item.status}`}
              >
                <div className="grade-result-item__head">
                  <span className="grade-result-item__badge">
                    {statusLabel(item.status)}
                  </span>
                  <strong>
                    {item.taskType ? `제${item.taskType}유형 · ` : ''}
                    {item.title}
                  </strong>
                  <span className="grade-result-item__score">
                    {item.earned}/{item.max}
                  </span>
                </div>
                <pre className="grade-result-item__detail">{item.detail}</pre>
              </li>
            ))}
          </ul>
        </div>
        <footer className="modal__footer">
          <button type="button" className="primary-btn" onClick={onClose}>
            확인
          </button>
        </footer>
      </div>
    </div>
  );
}
