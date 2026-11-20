import type { ExamSet, QuizProblem, RunResult } from '@/types/exam';
import { preloadPyodide, runPython } from '@/runtimes/pyodideRuntime';
import { preloadWebR, runR } from '@/runtimes/webrRuntime';
import { mountAssetsToPyodide, mountAssetsToWebR } from '@/runtimes/fsMount';

export type GradeStatus = 'pass' | 'fail' | 'partial' | 'unsubmitted' | 'ungradable';

export interface GradeItem {
  quizId: string;
  title: string;
  taskType?: 1 | 2 | 3;
  status: GradeStatus;
  detail: string;
  earned: number;
  max: number;
}

export interface GradeReport {
  items: GradeItem[];
  earned: number;
  max: number;
  unsubmittedCount: number;
}

export function listSubmitQuizzes(exam: ExamSet): QuizProblem[] {
  return exam.quizzes.filter((q) => q.kind === 'submit');
}

export function listUnsubmitted(exam: ExamSet): QuizProblem[] {
  return listSubmitQuizzes(exam).filter((q) => !q.submitted);
}

/**
 * Mark unsubmitted short-answer quizzes as submitted (keep drafts).
 * For type-2, optionally capture CSV via `readCsv` when present.
 */
export async function forceSubmitPending(
  exam: ExamSet,
  opts?: { readCsv?: (path: string) => Promise<string | null> },
): Promise<ExamSet> {
  const quizzes: QuizProblem[] = [];
  for (const q of exam.quizzes) {
    if (q.kind !== 'submit' || q.submitted) {
      quizzes.push(q);
      continue;
    }
    if (q.taskType === 2 || q.submitFormat === 'csv') {
      const path = q.submitFile || 'result.csv';
      let csv: string | null = null;
      if (opts?.readCsv) {
        try {
          csv = await opts.readCsv(path);
        } catch {
          csv = null;
        }
      }
      if (csv?.trim()) {
        quizzes.push({ ...q, submitted: true, submittedCsv: csv });
      } else {
        quizzes.push(q);
      }
      continue;
    }
    quizzes.push({ ...q, submitted: true });
  }
  return { ...exam, quizzes };
}

function gradeShortQuiz(quiz: QuizProblem): GradeItem {
  const slots = quiz.shortSlots ?? [];
  if (!slots.length) {
    const draft = (quiz.answerDraft ?? '').trim();
    const expected = (quiz.shortAnswer ?? '').trim();
    if (!quiz.submitted) {
      return {
        quizId: quiz.id,
        title: quiz.title,
        taskType: quiz.taskType,
        status: 'unsubmitted',
        detail: '미제출',
        earned: 0,
        max: 1,
      };
    }
    if (!expected) {
      return {
        quizId: quiz.id,
        title: quiz.title,
        taskType: quiz.taskType,
        status: draft ? 'pass' : 'fail',
        detail: draft ? `제출됨: ${draft}` : '답안 없음',
        earned: draft ? 1 : 0,
        max: 1,
      };
    }
    const ok = draft === expected;
    return {
      quizId: quiz.id,
      title: quiz.title,
      taskType: quiz.taskType,
      status: ok ? 'pass' : 'fail',
      detail: ok
        ? `정답 · ${draft}`
        : `오답 · 제출 ${draft || '(미입력)'} / 정답 ${expected}`,
      earned: ok ? 1 : 0,
      max: 1,
    };
  }

  const max = slots.length;
  if (!quiz.submitted) {
    return {
      quizId: quiz.id,
      title: quiz.title,
      taskType: quiz.taskType,
      status: 'unsubmitted',
      detail: `미제출 (단답 ${max}칸)`,
      earned: 0,
      max,
    };
  }

  const lines: string[] = [];
  let earned = 0;
  for (const s of slots) {
    const draft = (s.draft ?? '').trim();
    const expected = (s.expected ?? '').trim();
    if (!expected) {
      if (draft) {
        earned += 1;
        lines.push(`${s.label}: 제출 (${draft})`);
      } else {
        lines.push(`${s.label}: 미입력`);
      }
      continue;
    }
    if (draft === expected) {
      earned += 1;
      lines.push(`${s.label}: 정답`);
    } else {
      lines.push(
        `${s.label}: 오답 (제출 ${draft || '(미입력)'} / 정답 ${expected})`,
      );
    }
  }

  const status: GradeStatus =
    earned === max ? 'pass' : earned === 0 ? 'fail' : 'partial';

  return {
    quizId: quiz.id,
    title: quiz.title,
    taskType: quiz.taskType,
    status,
    detail: lines.join('\n'),
    earned,
    max,
  };
}

async function writeRuntimeFile(
  language: 'python' | 'r',
  path: string,
  content: string,
): Promise<void> {
  if (language === 'python') {
    const py = await preloadPyodide();
    py.FS.writeFile(path, content);
    return;
  }
  await preloadWebR();
  // webR: write via R code
  const escaped = content
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '');
  await runR(
    `writeLines(strsplit("${escaped}", "\\n", fixed=TRUE)[[1]], "${path}")`,
  );
}

async function gradeType2Quiz(
  quiz: QuizProblem,
  timeoutMs: number,
): Promise<GradeItem> {
  const base = {
    quizId: quiz.id,
    title: quiz.title,
    taskType: quiz.taskType as 1 | 2 | 3 | undefined,
    max: 1,
  };

  if (!quiz.submitted || !quiz.submittedCsv?.trim()) {
    return {
      ...base,
      status: 'unsubmitted',
      detail: '미제출 (result.csv 없음)',
      earned: 0,
    };
  }

  const lang = quiz.language;
  const path = quiz.submitFile || 'result.csv';
  const grading = quiz.gradingCode?.[lang]?.trim();

  if (!grading) {
    return {
      ...base,
      status: 'pass',
      detail: `제출 CSV 확인 (${quiz.submittedCsv.split(/\r?\n/).length} lines) · 채점 코드 없음`,
      earned: 1,
    };
  }

  try {
    if (quiz.files?.length) {
      if (lang === 'python') await mountAssetsToPyodide(quiz.files);
      else await mountAssetsToWebR(quiz.files);
    }
    await writeRuntimeFile(lang, path, quiz.submittedCsv);
    const out: RunResult =
      lang === 'python'
        ? await runPython(grading, { timeoutMs })
        : await runR(grading, { timeoutMs });
    return {
      ...base,
      status: out.ok ? 'pass' : 'fail',
      detail: [
        out.ok ? '채점 코드 실행 성공' : '채점 코드 실행 실패',
        out.stdout.trim(),
        out.stderr.trim() ? `[stderr]\n${out.stderr.trim()}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      earned: out.ok ? 1 : 0,
    };
  } catch (err) {
    return {
      ...base,
      status: 'fail',
      detail: err instanceof Error ? err.message : String(err),
      earned: 0,
    };
  }
}

/** Grade all submit-kind quizzes against answer keys / grading scripts. */
export async function gradeExam(
  exam: ExamSet,
  opts?: { timeoutMs?: number },
): Promise<GradeReport> {
  const timeoutMs = opts?.timeoutMs ?? 60_000;
  const submit = listSubmitQuizzes(exam);
  const unsubmittedCount = submit.filter((q) => !q.submitted).length;
  const items: GradeItem[] = [];

  for (const quiz of submit) {
    if (quiz.taskType === 2 || quiz.submitFormat === 'csv') {
      items.push(await gradeType2Quiz(quiz, timeoutMs));
    } else {
      items.push(gradeShortQuiz(quiz));
    }
  }

  const earned = items.reduce((s, i) => s + i.earned, 0);
  const max = items.reduce((s, i) => s + i.max, 0);
  return { items, earned, max, unsubmittedCount };
}
