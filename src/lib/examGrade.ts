import type { ExamSet, QuizProblem, RunResult } from '@/types/exam';
import { preloadPyodide, runPython } from '@/runtimes/pyodideRuntime';
import { preloadWebR, runR } from '@/runtimes/webrRuntime';
import { mountAssetsToPyodide, mountAssetsToWebR } from '@/runtimes/fsMount';
import {
  computeType2Earned,
  parseType2Metrics,
  roundType2Earned,
  type MetricDirection,
  type Type2MlKind,
} from '@/lib/type2Scoring';

export type GradeStatus = 'pass' | 'fail' | 'partial' | 'unsubmitted' | 'ungradable';

export interface GradeAnswerRow {
  label: string;
  expected: string;
  submitted: string;
  ok: boolean;
}

export interface Type2ScoreInfo {
  label: string;
  mlKind: Type2MlKind | 'unknown';
  direction: MetricDirection | 'unknown';
  achieved: number | null;
  expected: number | null;
  yScale: number | null;
  /** Absolute |student - ref| when both known. */
  gap: number | null;
  gapBasis: 'expected' | 'perfect' | 'none';
  /** How much worse than REF (normalized); 0 when full credit. */
  relativeGap: number | null;
  /** Earned ratio in [0, 1] before max points. */
  earnedRatio: number | null;
  fullCredit: boolean;
  rawStdout: string;
}

export interface GradeItem {
  quizId: string;
  title: string;
  taskType?: 1 | 2 | 3;
  status: GradeStatus;
  detail: string;
  earned: number;
  max: number;
  /** Problem statement snapshot for the report page. */
  markdown?: string;
  answers?: GradeAnswerRow[];
  type2Score?: Type2ScoreInfo;
  submittedCsvPreview?: string;
  /** Examinee code draft (for AI coaching on the report page). */
  userCode?: string;
  language?: 'python' | 'r';
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

function baseFields(quiz: QuizProblem) {
  const lang = quiz.language ?? 'python';
  const draft = quiz.answerDraft?.trim();
  const starter = quiz.starterCode?.[lang]?.trim();
  return {
    quizId: quiz.id,
    title: quiz.title,
    taskType: quiz.taskType,
    markdown: quiz.markdown ?? '',
    userCode: draft || starter || '',
    language: lang as 'python' | 'r',
  };
}

function gradeShortQuiz(quiz: QuizProblem): GradeItem {
  const slots = quiz.shortSlots ?? [];
  const base = baseFields(quiz);

  if (!slots.length) {
    const draft = (quiz.answerDraft ?? '').trim();
    const expected = (quiz.shortAnswer ?? '').trim();
    const answers: GradeAnswerRow[] = [
      {
        label: '단답',
        expected,
        submitted: draft,
        ok: Boolean(expected) ? draft === expected : Boolean(draft),
      },
    ];
    if (!quiz.submitted) {
      return {
        ...base,
        status: 'unsubmitted',
        detail: '미제출',
        earned: 0,
        max: 1,
        answers,
      };
    }
    if (!expected) {
      return {
        ...base,
        status: draft ? 'pass' : 'fail',
        detail: draft ? `제출됨: ${draft}` : '답안 없음',
        earned: draft ? 1 : 0,
        max: 1,
        answers,
      };
    }
    const ok = draft === expected;
    return {
      ...base,
      status: ok ? 'pass' : 'fail',
      detail: ok
        ? `정답 · ${draft}`
        : `오답 · 제출 ${draft || '(미입력)'} / 정답 ${expected}`,
      earned: ok ? 1 : 0,
      max: 1,
      answers,
    };
  }

  const max = slots.length;
  const answers: GradeAnswerRow[] = slots.map((s) => {
    const draft = (s.draft ?? '').trim();
    const expected = (s.expected ?? '').trim();
    const ok = expected ? draft === expected : Boolean(draft);
    return {
      label: s.label,
      expected,
      submitted: draft,
      ok,
    };
  });

  if (!quiz.submitted) {
    return {
      ...base,
      status: 'unsubmitted',
      detail: `미제출 (단답 ${max}칸)`,
      earned: 0,
      max,
      answers,
    };
  }

  const lines: string[] = [];
  let earned = 0;
  for (const row of answers) {
    if (!row.expected) {
      if (row.submitted) {
        earned += 1;
        lines.push(`${row.label}: 제출 (${row.submitted})`);
      } else {
        lines.push(`${row.label}: 미입력`);
      }
      continue;
    }
    if (row.ok) {
      earned += 1;
      lines.push(`${row.label}: 정답`);
    } else {
      lines.push(
        `${row.label}: 오답 (제출 ${row.submitted || '(미입력)'} / 정답 ${row.expected})`,
      );
    }
  }

  const status: GradeStatus =
    earned === max ? 'pass' : earned === 0 ? 'fail' : 'partial';

  return {
    ...base,
    status,
    detail: lines.join('\n'),
    earned,
    max,
    answers,
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
  const escaped = content
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '');
  await runR(
    `writeLines(strsplit("${escaped}", "\\n", fixed=TRUE)[[1]], "${path}")`,
  );
}

/** Parse SCORE / EXPECTED style metrics and compute type-2 earned ratio. */
export function parseType2Score(
  stdout: string,
  gradingSource = '',
): Type2ScoreInfo {
  const parsed = parseType2Metrics(stdout, gradingSource);
  const scored = computeType2Earned(parsed);
  return {
    label: parsed.label,
    mlKind: parsed.mlKind,
    direction: parsed.direction,
    achieved: parsed.student,
    expected: parsed.reference,
    yScale: parsed.yScale,
    gap: scored.gap,
    gapBasis: scored.gapBasis,
    relativeGap: scored.relativeGap,
    earnedRatio: scored.earned,
    fullCredit: scored.fullCredit,
    rawStdout: stdout.trim(),
  };
}

function csvPreview(csv: string, maxLines = 8): string {
  const lines = csv.replace(/\r\n/g, '\n').split('\n').filter(Boolean);
  if (lines.length <= maxLines) return lines.join('\n');
  return `${lines.slice(0, maxLines).join('\n')}\n… (${lines.length} lines)`;
}

async function gradeType2Quiz(
  quiz: QuizProblem,
  timeoutMs: number,
): Promise<GradeItem> {
  const base = {
    ...baseFields(quiz),
    max: 1 as const,
  };

  if (!quiz.submitted || !quiz.submittedCsv?.trim()) {
    return {
      ...base,
      status: 'unsubmitted',
      detail: '미제출 (result.csv 없음)',
      earned: 0,
    };
  }

  const preview = csvPreview(quiz.submittedCsv);
  const lang = quiz.language;
  const path = quiz.submitFile || 'result.csv';
  const grading = quiz.gradingCode?.[lang]?.trim();

  if (!grading) {
    return {
      ...base,
      status: 'pass',
      detail: `제출 CSV 확인 (${quiz.submittedCsv.split(/\r?\n/).length} lines) · 채점 코드 없음`,
      earned: 1,
      submittedCsvPreview: preview,
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
    const type2Score = parseType2Score(out.stdout, grading);
    const hasMetric = type2Score.achieved != null;
    // Structural / runtime failure without a metric → 0.
    // If metrics printed, score by REF comparison even when script exited non-ok
    // only when stdout still parsed (e.g. SCORE then SystemExit).
    let earned = 0;
    let status: GradeStatus = 'fail';
    if (!out.ok && !hasMetric) {
      earned = 0;
      status = 'fail';
    } else if (!hasMetric) {
      // Script ran but did not emit STUDENT/SCORE — cannot auto-score.
      earned = 0;
      status = 'ungradable';
    } else {
      earned = roundType2Earned(type2Score.earnedRatio ?? 0, base.max);
      if (type2Score.fullCredit || earned >= base.max - 1e-9) {
        status = 'pass';
        earned = base.max;
      } else if (earned <= 0) {
        status = 'fail';
      } else {
        status = 'partial';
      }
    }
    const gapLine =
      type2Score.gap != null
        ? type2Score.gapBasis === 'expected'
          ? `|REF-STUDENT|=${type2Score.gap}`
          : `만점 기준 대비 오차=${type2Score.gap}`
        : '점수 파싱 없음 (STUDENT=/REF= 또는 SCORE=/EXPECTED= 권장)';
    return {
      ...base,
      status,
      detail: [
        out.ok ? '채점 코드 실행 성공' : '채점 코드 실행 실패',
        `ML=${type2Score.mlKind} · metric=${type2Score.label} (${type2Score.direction})`,
        gapLine,
        type2Score.achieved != null
          ? `STUDENT=${type2Score.achieved}`
          : '',
        type2Score.expected != null ? `REF=${type2Score.expected}` : '',
        type2Score.yScale != null ? `Y_SCALE=${type2Score.yScale}` : '',
        `earned=${earned}/${base.max}${type2Score.fullCredit ? ' (만점 허용범위)' : ''}`,
        out.stdout.trim(),
        out.stderr.trim() ? `[stderr]\n${out.stderr.trim()}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      earned,
      type2Score,
      submittedCsvPreview: preview,
    };
  } catch (err) {
    return {
      ...base,
      status: 'fail',
      detail: err instanceof Error ? err.message : String(err),
      earned: 0,
      submittedCsvPreview: preview,
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
