import type { ExamSet, QuizProblem } from '@/types/exam';

/** Bumped when default sample exam structure changes. */
const STORAGE_KEY = 'bks.exam.v2';

export function cloneExam(exam: ExamSet): ExamSet {
  return structuredClone(exam);
}

export function loadExamFromStorage(): ExamSet | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return validateExam(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveExamToStorage(exam: ExamSet): void {
  const next = {
    ...exam,
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function validateExam(data: unknown): ExamSet {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid exam JSON');
  }
  const exam = data as ExamSet;
  if (exam.schemaVersion !== 1 || !Array.isArray(exam.quizzes)) {
    throw new Error('Unsupported or invalid exam schema');
  }
  return exam;
}

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportExamSet(exam: ExamSet): void {
  downloadJson(`${exam.id || 'exam'}.exam.json`, exam);
}

export function exportQuiz(quiz: QuizProblem): void {
  downloadJson(`${quiz.id || 'quiz'}.quiz.json`, quiz);
}

export async function readJsonFile(file: File): Promise<unknown> {
  const text = await file.text();
  return JSON.parse(text);
}

export function upsertQuiz(exam: ExamSet, quiz: QuizProblem): ExamSet {
  const idx = exam.quizzes.findIndex((q) => q.id === quiz.id);
  const quizzes = [...exam.quizzes];
  if (idx >= 0) quizzes[idx] = quiz;
  else quizzes.push(quiz);
  return { ...exam, quizzes, updatedAt: new Date().toISOString() };
}

export function createEmptyQuiz(partial?: Partial<QuizProblem>): QuizProblem {
  const id = partial?.id ?? `quiz-${crypto.randomUUID().slice(0, 8)}`;
  return {
    id,
    number: partial?.number ?? '',
    title: partial?.title ?? '새 문제',
    kind: partial?.kind ?? 'practice',
    language: partial?.language ?? 'python',
    markdown: partial?.markdown ?? '## 새 문제\n\n문제 내용을 작성하세요.\n',
    starterCode: partial?.starterCode ?? {
      python: '# write python code\nprint("hello")\n',
      r: '# write R code\nprint("hello")\n',
    },
    submitted: false,
    answerDraft: '',
    notepad: '',
  };
}

export function submittedCount(exam: ExamSet): { done: number; total: number } {
  const submitQuizzes = exam.quizzes.filter((q) => q.kind === 'submit');
  const done = submitQuizzes.filter((q) => q.submitted).length;
  return { done, total: submitQuizzes.length };
}
