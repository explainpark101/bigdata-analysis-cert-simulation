import { useEffect, useId, useRef, useState } from 'react';
import { Loader2, Square, Trash2, X } from 'lucide-react';
import {
  cancelExamAutoReview,
  clearFinishedExamAutoReviews,
  examAutoReviewProgress,
  subscribeExamAutoReviewQueue,
  type ExamAutoReviewJob,
  type ExamAutoReviewQueueState,
} from '@/lib/examAutoReviewQueue';

interface ExamAutoReviewQueueModalProps {
  open: boolean;
  onClose: () => void;
  /** Jump to exam assemble tab for this paper. */
  onSelectExam: (examId: string) => void;
  /** Jump to bank modify dock for a problem under auto-review. */
  onSelectProblem?: (problemId: string, examId: string) => void;
}

function phaseLabel(phase: ExamAutoReviewJob['phase']): string {
  switch (phase) {
    case 'running':
      return '검수 중';
    case 'done':
      return '완료';
    case 'error':
      return '오류';
    case 'cancelled':
      return '취소됨';
    default:
      return phase;
  }
}

function problemPhaseLabel(phase: string): string {
  switch (phase) {
    case 'queued':
      return '대기';
    case 'verifying':
      return '검증';
    case 'ok':
      return '통과';
    case 'ai_review':
      return 'AI 검수';
    case 'fixed':
      return '수정됨';
    case 'failed':
      return '실패';
    case 'cancelled':
      return '취소';
    default:
      return phase;
  }
}

export function ExamAutoReviewQueueModal({
  open,
  onClose,
  onSelectExam,
  onSelectProblem,
}: ExamAutoReviewQueueModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [queue, setQueue] = useState<ExamAutoReviewQueueState>(() => ({
    jobs: [],
    updatedAt: Date.now(),
  }));

  useEffect(() => subscribeExamAutoReviewQueue(setQueue), []);

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
      className="confirm-dialog exam-auto-review-dialog"
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
      <div className="confirm-dialog__panel exam-auto-review-dialog__panel">
        <header className="modal__header">
          <h2 id={titleId}>자동 검수 큐</h2>
          <button
            type="button"
            className="ghost-btn btn-with-icon"
            onClick={onClose}
            aria-label="닫기"
          >
            <X size={16} />
          </button>
        </header>
        <div className="modal__body exam-auto-review-dialog__body">
          {!queue.jobs.length ? (
            <p className="edit-page__sub" style={{ margin: 0 }}>
              진행 중이거나 최근 완료된 시험지 검수가 없습니다.
            </p>
          ) : (
            <ul className="exam-auto-review-queue">
              {queue.jobs.map((job) => {
                const prog = examAutoReviewProgress(job);
                const running = job.phase === 'running';
                return (
                  <li key={job.examId} className="exam-auto-review-queue__item">
                    <button
                      type="button"
                      className="exam-auto-review-queue__select"
                      onClick={() => {
                        onSelectExam(job.examId);
                        onClose();
                      }}
                    >
                      <div className="exam-auto-review-queue__title-row">
                        <strong>{job.examTitle}</strong>
                        <span
                          className={`exam-auto-review-queue__badge exam-auto-review-queue__badge--${job.phase}`}
                        >
                          {running ? (
                            <Loader2 size={12} className="spin" aria-hidden />
                          ) : null}
                          {phaseLabel(job.phase)}
                        </span>
                      </div>
                      <div className="exam-auto-review-queue__meta">
                        {prog.done}/{prog.total} 문제
                        {job.message ? ` · ${job.message}` : ''}
                      </div>
                      <div
                        className="exam-auto-review-queue__bar"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(prog.ratio * 100)}
                      >
                        <span style={{ width: `${prog.ratio * 100}%` }} />
                      </div>
                    </button>
                    <ul className="exam-auto-review-queue__problems">
                      {job.problems.map((p) => (
                        <li key={p.problemId}>
                          {onSelectProblem ? (
                            <button
                              type="button"
                              className="exam-auto-review-queue__problem-btn"
                              onClick={() => {
                                onSelectProblem(p.problemId, job.examId);
                                onClose();
                              }}
                              title="문제 수정 탭에서 검수 채팅 보기"
                            >
                              <span className="badge">제{p.taskType}유형</span>
                              <span className="exam-auto-review-queue__pname">
                                {p.title}
                              </span>
                              <span
                                className={`exam-auto-review-queue__pphase exam-auto-review-queue__pphase--${p.phase}`}
                              >
                                {problemPhaseLabel(p.phase)}
                              </span>
                              {p.message ? (
                                <span className="exam-auto-review-queue__pmsg">
                                  {p.message}
                                </span>
                              ) : null}
                            </button>
                          ) : (
                            <>
                              <span className="badge">제{p.taskType}유형</span>
                              <span className="exam-auto-review-queue__pname">
                                {p.title}
                              </span>
                              <span
                                className={`exam-auto-review-queue__pphase exam-auto-review-queue__pphase--${p.phase}`}
                              >
                                {problemPhaseLabel(p.phase)}
                              </span>
                              {p.message ? (
                                <span className="exam-auto-review-queue__pmsg">
                                  {p.message}
                                </span>
                              ) : null}
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                    {running ? (
                      <button
                        type="button"
                        className="ghost-btn btn-with-icon exam-auto-review-queue__cancel"
                        onClick={() => cancelExamAutoReview(job.examId)}
                        title="이 시험지 검수 취소"
                      >
                        <Square size={14} fill="currentColor" />
                        취소
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <footer className="modal__footer">
          <button
            type="button"
            className="ghost-btn btn-with-icon"
            onClick={() => clearFinishedExamAutoReviews()}
            disabled={!queue.jobs.some((j) => j.phase !== 'running')}
          >
            <Trash2 size={14} />
            완료 항목 지우기
          </button>
          <button type="button" className="primary-btn" onClick={onClose}>
            닫기
          </button>
        </footer>
      </div>
    </dialog>
  );
}
