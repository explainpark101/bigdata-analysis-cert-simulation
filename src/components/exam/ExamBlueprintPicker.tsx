import { useId } from 'react';
import { Play } from 'lucide-react';
import type { ExamBlueprint } from '@/types/project';

interface ExamBlueprintPickerProps {
  exams: ExamBlueprint[];
  selectedId: string;
  onSelect: (id: string) => void;
  onSubmit: () => void;
  busy?: boolean;
  submitLabel?: string;
  busyLabel?: string;
  emptyMessage?: string;
  /** Accessible name for the form (heading id or text). */
  labelledBy?: string;
}

export function ExamBlueprintPicker({
  exams,
  selectedId,
  onSelect,
  onSubmit,
  busy = false,
  submitLabel = '선택한 시험 보기',
  busyLabel = '여는 중…',
  emptyMessage = '등록된 시험지가 없습니다.',
  labelledBy,
}: ExamBlueprintPickerProps) {
  const fallbackTitleId = useId();
  const formLabelId = labelledBy ?? fallbackTitleId;

  if (!exams.length) {
    return <p className="edit-page__sub">{emptyMessage}</p>;
  }

  return (
    <form
      className="exam-pick-form"
      aria-labelledby={formLabelId}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {!labelledBy ? (
        <h2 id={fallbackTitleId} className="visually-hidden">
          시험지 선택
        </h2>
      ) : null}
      <fieldset className="exam-pick-fieldset">
        <legend>시험지</legend>
        <ul className="home-exam-list">
          {exams.map((ex) => {
            const inputId = `exam-blueprint-${ex.id}`;
            const checked = selectedId === ex.id;
            return (
              <li key={ex.id}>
                <label
                  htmlFor={inputId}
                  className={`home-exam-item exam-pick-option${
                    checked ? ' exam-pick-option--active' : ''
                  }`}
                >
                  <input
                    id={inputId}
                    type="radio"
                    name="examId"
                    value={ex.id}
                    checked={checked}
                    required
                    disabled={busy}
                    onChange={() => onSelect(ex.id)}
                  />
                  <span className="home-exam-item__meta">
                    <strong>{ex.title}</strong>
                    <span>
                      문제 {ex.problemIds.length}개
                      {ex.timeLimitMinutes == null
                        ? ' · 시간 제한 없음'
                        : ` · ${ex.timeLimitMinutes}분`}
                      {ex.description?.trim()
                        ? ` · ${ex.description.trim()}`
                        : ''}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>

      <div className="exam-pick-form__actions">
        <button
          type="submit"
          className="primary-btn btn-with-icon"
          disabled={busy || !selectedId}
        >
          <Play size={16} />
          {busy ? busyLabel : submitLabel}
        </button>
      </div>
    </form>
  );
}
