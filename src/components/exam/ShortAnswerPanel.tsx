import { useMemo } from 'react';
import type { QuizProblem, ShortAnswerSlot } from '@/types/exam';
import { renderMarkdown } from '@/lib/markdown';

interface ShortAnswerPanelProps {
  quiz: QuizProblem;
  onSlotsChange: (slots: ShortAnswerSlot[]) => void;
  onSubmit: () => void;
}

/** DataQ-style short-answer submit page (유형 1·3 답안제출). Always light content. */
export function ShortAnswerPanel({
  quiz,
  onSlotsChange,
  onSubmit,
}: ShortAnswerPanelProps) {
  const slots = quiz.shortSlots ?? [];
  const html = useMemo(() => renderMarkdown(quiz.markdown), [quiz.markdown]);

  const updateDraft = (slotId: string, draft: string) => {
    onSlotsChange(
      slots.map((s) => (s.id === slotId ? { ...s, draft } : s)),
    );
  };

  return (
    <section className="short-answer-panel" data-force-light="">
      <div className="short-answer-panel__container">
        <div className="short-answer-panel__head">
          <div>
            <div className="short-answer-panel__eyebrow">문제</div>
            <div className="short-answer-panel__meta">
              <span>유형</span>
              <strong>주관식</strong>
              {quiz.taskType ? (
                <em className="short-answer-panel__type">제{quiz.taskType}유형</em>
              ) : null}
            </div>
          </div>
        </div>

        <div className="short-answer-panel__body">
          <h2 className="short-answer-panel__title">
            {quiz.taskType
              ? `제${quiz.taskType}유형 (답안제출)`
              : quiz.title}
          </h2>

          <div
            className="short-answer-panel__md md-content"
            dangerouslySetInnerHTML={{ __html: html }}
          />

          <p className="short-answer-panel__hint">
            ※ 제출 형식에 맞지 않는 경우 입력 형식 오류 메세지가 표시됩니다.
            일부 답안만 입력해도 제출할 수 있습니다.
          </p>

          <div className="short-answer-fields">
            {slots.map((slot) => (
              <label key={slot.id} className="short-answer-field">
                <span>{slot.label}</span>
                <input
                  type="text"
                  placeholder="내용을 입력해주세요."
                  value={slot.draft ?? ''}
                  onChange={(e) => updateDraft(slot.id, e.target.value)}
                />
              </label>
            ))}
          </div>

          <div className="short-answer-panel__actions">
            {quiz.submitted ? (
              <span className="short-answer-panel__status">제출 완료</span>
            ) : (
              <span className="short-answer-panel__status-spacer" />
            )}
            <button type="button" className="primary-btn" onClick={onSubmit}>
              제출
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
