import type { ExamSet, QuizProblem } from '@/types/exam';
import { submittedCount } from '@/lib/projectIO';

interface QuizSidebarProps {
  exam: ExamSet;
  activeId: string;
  onSelect: (id: string) => void;
}

function statusLabel(quiz: QuizProblem): { text: string; className: string } {
  if (quiz.kind === 'practice' || quiz.kind === 'guide') {
    return { text: '문제 풀이', className: 'quiz-status quiz-status--info' };
  }
  if (quiz.kind !== 'submit') {
    return { text: '안내', className: 'quiz-status quiz-status--info' };
  }
  if (quiz.submitted) {
    return { text: '제출 완료', className: 'quiz-status quiz-status--ok' };
  }
  return { text: '미제출', className: 'quiz-status quiz-status--warn' };
}

/** DataQ-style left quiz navigator. */
export function QuizSidebar({ exam, activeId, onSelect }: QuizSidebarProps) {
  const { done, total } = submittedCount(exam);

  return (
    <aside className="quiz-sidebar">
      <div className="quiz-sidebar__submit">
        <div className="submit-badge">
          <span>제출</span>
          <strong>
            {String(done).padStart(2, '0')}/{String(total).padStart(2, '0')}
          </strong>
        </div>
      </div>

      <div className="quiz-list">
        {exam.quizzes.map((quiz) => {
          const status = statusLabel(quiz);
          const showNumber = Boolean(quiz.number);
          return (
            <button
              key={quiz.id}
              type="button"
              className={`quiz-item ${quiz.id === activeId ? 'active' : ''}`}
              onClick={() => onSelect(quiz.id)}
            >
              {showNumber ? (
                <span className="quiz-item__num">{quiz.number}</span>
              ) : null}
              <span className="quiz-item__title">{quiz.title}</span>
              <span className={status.className}>{status.text}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
