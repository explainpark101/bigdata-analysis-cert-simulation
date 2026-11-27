import type { ExamSet, QuizProblem } from '@/types/exam';

function draftText(q: QuizProblem): string {
  const drafts = q.answerDrafts;
  const fromLang = [drafts?.python, drafts?.r].filter(Boolean).join('\n');
  return `${q.answerDraft ?? ''}\n${fromLang}`.trim();
}

function shortDraftText(q: QuizProblem): string {
  if (q.shortSlots?.length) {
    return q.shortSlots.map((s) => s.draft?.trim() ?? '').join('').trim();
  }
  return '';
}

export interface ExamSessionProgress {
  quizCount: number;
  submitCount: number;
  submittedCount: number;
  hasDraftWork: boolean;
}

export function getExamSessionProgress(exam: ExamSet): ExamSessionProgress {
  const submitQuizzes = exam.quizzes.filter((q) => q.kind === 'submit');
  const submittedCount = submitQuizzes.filter((q) => q.submitted).length;
  const hasDraftWork =
    exam.quizzes.some(
      (q) => Boolean(draftText(q)) || Boolean(shortDraftText(q)) || Boolean(q.submittedCsv?.trim()),
    ) ||
    Object.values(exam.notepads ?? {}).some((t) => t.trim().length > 0);

  return {
    quizCount: exam.quizzes.length,
    submitCount: submitQuizzes.length,
    submittedCount,
    hasDraftWork,
  };
}
