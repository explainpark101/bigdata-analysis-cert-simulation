import type { ExamSet, QuizProblem } from '@/types/exam';
import { submittedCount } from '@/lib/examIO';

interface QuizSidebarProps {
  exam: ExamSet;
  activeId: string;
  onSelect: (id: string) => void;
}

function statusLabel(quiz: QuizProblem): { text: string; className: string } {
  if (quiz.kind !== 'submit') {
    return { text: '문제 풀이', className: 'badge' };
  }
  if (quiz.submitted) {
    return { text: '제출', className: 'badge ok' };
  }
  return { text: '미제출', className: 'badge warn' };
}

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
          return (
            <button
              key={quiz.id}
              type="button"
              className={`quiz-item ${quiz.id === activeId ? 'active' : ''}`}
              onClick={() => onSelect(quiz.id)}
            >
              <div className="quiz-item__top">
                <span>{quiz.number || '·'}</span>
                <span className={status.className}>{status.text}</span>
              </div>
              <div className="quiz-item__title">{quiz.title}</div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
