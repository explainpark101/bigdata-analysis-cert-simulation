import type { GradeItem, GradeReport } from '@/lib/examGrade';
import type { ExamSet, QuizProblem, ShortAnswerSlot } from '@/types/exam';

function codeWorkspaceQuiz(
  exam: ExamSet,
  graded: QuizProblem,
): QuizProblem {
  const group = graded.notepadGroup;
  const practice = exam.quizzes.find(
    (q) =>
      q.kind === 'practice' &&
      q.taskType === graded.taskType &&
      (!group || q.notepadGroup === group),
  );
  if (practice) return practice;

  const peer = exam.quizzes.find(
    (q) =>
      q.id !== graded.id &&
      q.viewMode !== 'short' &&
      q.taskType === graded.taskType &&
      (!group || q.notepadGroup === group),
  );
  return peer ?? graded;
}

function applyCodesToQuiz(
  quiz: QuizProblem,
  item: GradeItem,
): QuizProblem {
  const python = item.userCodes?.python ?? '';
  const r = item.userCodes?.r ?? '';
  const lang = item.language ?? quiz.language ?? 'python';
  const active =
    (lang === 'r' ? r : python).trim() ||
    (lang === 'r' ? python : r).trim() ||
    item.userCode?.trim() ||
    '';

  if (!python.trim() && !r.trim() && !active) return quiz;

  return {
    ...quiz,
    language: lang,
    answerDraft: active || quiz.answerDraft,
    answerDrafts: {
      ...(quiz.answerDrafts ?? {}),
      ...(python.trim() ? { python } : {}),
      ...(r.trim() ? { r } : {}),
      ...(!python.trim() && !r.trim() && active
        ? { [lang]: active }
        : {}),
    },
  };
}

function applyShortAnswers(
  quiz: QuizProblem,
  item: GradeItem,
): QuizProblem {
  const rows = item.answers ?? [];
  if (!rows.length) return quiz;

  const submitted = item.status !== 'unsubmitted';

  if (quiz.shortSlots?.length) {
    const byLabel = new Map(
      rows.map((row) => [row.label.trim(), row.submitted ?? '']),
    );
    const shortSlots: ShortAnswerSlot[] = quiz.shortSlots.map((slot, i) => {
      const hit =
        byLabel.get(slot.label.trim()) ??
        (rows[i] ? rows[i].submitted ?? '' : undefined);
      if (hit == null) return slot;
      return { ...slot, draft: hit };
    });
    return { ...quiz, shortSlots, submitted: submitted || quiz.submitted };
  }

  const single = rows[0]?.submitted ?? '';
  return {
    ...quiz,
    answerDraft: single || quiz.answerDraft,
    submitted: submitted || quiz.submitted,
  };
}

function applyType2Submit(
  quiz: QuizProblem,
  item: GradeItem,
): QuizProblem {
  const csv =
    item.submittedCsv?.trim() ||
    item.submittedCsvPreview?.trim() ||
    '';
  if (!csv) {
    return {
      ...quiz,
      submitted:
        item.status !== 'unsubmitted' ? true : quiz.submitted,
    };
  }
  return {
    ...quiz,
    submitted: true,
    submittedCsv: csv,
  };
}

/**
 * Re-apply examinee code drafts and submit artifacts from a grade report
 * onto a (possibly fresh) ExamSet so "시험으로" restores prior work.
 */
export function restoreExamFromGradeReport(
  exam: ExamSet,
  report: GradeReport,
): ExamSet {
  const byId = new Map(exam.quizzes.map((q) => [q.id, q]));
  let quizzes = exam.quizzes.map((q) => ({ ...q }));

  const patchById = (id: string, next: QuizProblem) => {
    quizzes = quizzes.map((q) => (q.id === id ? next : q));
    byId.set(id, next);
  };

  for (const item of report.items) {
    if (!item.quizId || item.quizId === 'error') continue;
    const graded = byId.get(item.quizId);
    if (!graded) continue;

    // Codes live on the practice workspace for type 1/3.
    const codeQuiz = codeWorkspaceQuiz({ ...exam, quizzes }, graded);
    const withCode = applyCodesToQuiz(codeQuiz, item);
    if (withCode !== codeQuiz) patchById(codeQuiz.id, withCode);

    if (graded.taskType === 2 || graded.submitFormat === 'csv') {
      const withCsv = applyType2Submit(
        byId.get(graded.id) ?? graded,
        item,
      );
      patchById(graded.id, withCsv);
      // Type-2 also keeps code on the submit quiz itself.
      if (codeQuiz.id === graded.id) {
        patchById(graded.id, applyCodesToQuiz(withCsv, item));
      }
      continue;
    }

    const withShort = applyShortAnswers(
      byId.get(graded.id) ?? graded,
      item,
    );
    patchById(graded.id, withShort);
  }

  return {
    ...exam,
    quizzes,
    updatedAt: new Date().toISOString(),
  };
}
