import { useRef, useState } from 'react';
import type { ExamSet, QuizProblem } from '@/types/exam';
import {
  createEmptyQuiz,
  exportExamSet,
  exportQuiz,
  readJsonFile,
  upsertQuiz,
  validateExam,
} from '@/lib/examIO';

interface ExamManagerProps {
  open: boolean;
  exam: ExamSet;
  activeQuiz: QuizProblem;
  onClose: () => void;
  onExamChange: (exam: ExamSet) => void;
  onSelectQuiz: (id: string) => void;
}

export function ExamManager({
  open,
  exam,
  activeQuiz,
  onClose,
  onExamChange,
  onSelectQuiz,
}: ExamManagerProps) {
  const examFileRef = useRef<HTMLInputElement>(null);
  const quizFileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(activeQuiz.title);
  const [number, setNumber] = useState(activeQuiz.number);
  const [kind, setKind] = useState(activeQuiz.kind);
  const [message, setMessage] = useState('');

  if (!open) return null;

  const syncLocalFromActive = () => {
    setTitle(activeQuiz.title);
    setNumber(activeQuiz.number);
    setKind(activeQuiz.kind);
  };

  const applyMeta = () => {
    const next = upsertQuiz(exam, {
      ...activeQuiz,
      title,
      number,
      kind,
    });
    onExamChange(next);
    setMessage('문제 메타데이터를 저장했습니다.');
  };

  const addQuiz = () => {
    const quiz = createEmptyQuiz({
      title: `새 문제 ${exam.quizzes.length + 1}`,
      number: String(exam.quizzes.filter((q) => q.kind === 'submit').length + 1).padStart(
        2,
        '0',
      ),
      kind: 'submit',
    });
    onExamChange(upsertQuiz(exam, quiz));
    onSelectQuiz(quiz.id);
    setMessage(`추가됨: ${quiz.id}`);
  };

  const removeActive = () => {
    if (exam.quizzes.length <= 1) {
      setMessage('최소 1개 문제가 필요합니다.');
      return;
    }
    const quizzes = exam.quizzes.filter((q) => q.id !== activeQuiz.id);
    onExamChange({ ...exam, quizzes });
    onSelectQuiz(quizzes[0].id);
    setMessage('문제를 삭제했습니다.');
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal__header">
          <strong>시험 / 문제 관리</strong>
          <button type="button" className="ghost-btn" onClick={onClose}>
            닫기
          </button>
        </div>
        <div className="modal__body form-grid">
          <p style={{ margin: 0, color: '#64748b', fontSize: 13 }}>
            시험 세트 JSON import/export, 개별 문제 불러오기/내보내기, 새 문제 생성이
            가능합니다.
          </p>

          <div className="row">
            <button
              type="button"
              className="primary-btn"
              onClick={() => exportExamSet(exam)}
            >
              시험 세트 내보내기
            </button>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => examFileRef.current?.click()}
            >
              시험 세트 불러오기
            </button>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => exportQuiz(activeQuiz)}
            >
              현재 문제 내보내기
            </button>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => quizFileRef.current?.click()}
            >
              문제 불러오기
            </button>
          </div>

          <input
            ref={examFileRef}
            className="hidden-file"
            type="file"
            accept="application/json,.json"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              try {
                const data = validateExam(await readJsonFile(file));
                onExamChange(data);
                onSelectQuiz(data.quizzes[0]?.id ?? '');
                setMessage(`시험 세트 로드: ${data.title}`);
              } catch (err) {
                setMessage(err instanceof Error ? err.message : String(err));
              }
            }}
          />
          <input
            ref={quizFileRef}
            className="hidden-file"
            type="file"
            accept="application/json,.json"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              try {
                const raw = (await readJsonFile(file)) as QuizProblem;
                if (!raw?.id || !raw.markdown) throw new Error('Invalid quiz JSON');
                onExamChange(upsertQuiz(exam, raw));
                onSelectQuiz(raw.id);
                setMessage(`문제 로드: ${raw.title}`);
              } catch (err) {
                setMessage(err instanceof Error ? err.message : String(err));
              }
            }}
          />

          <hr style={{ border: 0, borderTop: '1px solid #e2e8f0', width: '100%' }} />

          <div className="row">
            <button type="button" className="primary-btn" onClick={addQuiz}>
              새 문제 추가
            </button>
            <button type="button" className="danger-btn" onClick={removeActive}>
              현재 문제 삭제
            </button>
            <button type="button" className="ghost-btn" onClick={syncLocalFromActive}>
              폼 새로고침
            </button>
          </div>

          <label>
            제목
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>
            번호 (제출 문항용)
            <input value={number} onChange={(e) => setNumber(e.target.value)} />
          </label>
          <label>
            종류
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as QuizProblem['kind'])}
            >
              <option value="guide">guide</option>
              <option value="practice">practice</option>
              <option value="submit">submit</option>
            </select>
          </label>
          <button type="button" className="primary-btn" onClick={applyMeta}>
            메타데이터 적용
          </button>

          {message && <p style={{ color: '#2563eb', margin: 0 }}>{message}</p>}
        </div>
        <div className="modal__footer">
          <span style={{ fontSize: 12, color: '#64748b' }}>
            schemaVersion: 1 · quizzes: {exam.quizzes.length}
          </span>
          <button type="button" className="ghost-btn" onClick={onClose}>
            완료
          </button>
        </div>
      </div>
    </div>
  );
}
