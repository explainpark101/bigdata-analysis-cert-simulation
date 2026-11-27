import type { ExamAsset, ExamSet, QuizProblem, RunResult } from '@/types/exam';
import { preloadPyodide, runPython } from '@/runtimes/pyodideRuntime';
import { runR, writeWebRFile } from '@/runtimes/webrRuntime';
import { mountAssetsToPyodide, mountAssetsToWebR } from '@/runtimes/fsMount';
import {
  resolveType2Points,
  type MetricDirection,
  type Type2BandSource,
  type Type2MlKind,
  type Type2ScoreBand,
} from '@/lib/type2Scoring';
import {
  OFFICIAL_MAX_RUN_SECONDS,
  OFFICIAL_POINTS_PER_ITEM,
  TYPE2_FORMAT_PENALTY,
  type2MaxPoints,
} from '@/lib/examOfficialSpec';
import { shortAnswersEqual } from '@/lib/shortAnswerMatch';
import {
  findType2LabelAsset,
  type2LabelAliasPaths,
} from '@/lib/type2Assets';
import { loadType2ExamSubmissions } from '@/lib/type2ResultStore';
import {
  loadType2Label,
  saveType2Label,
  type2LabelRecordToAsset,
} from '@/lib/type2LabelStore';
import {
  ensureType2LabelsForGrading,
  isMissingType2LabelError,
  mountSynthesizedType2Labels,
} from '@/lib/ensureType2Labels';

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
  /** How metric points were resolved (제13회 구간별 채점). */
  bandSource?: Type2BandSource;
  /** Parsed SCORE_BANDS (if any). */
  bands?: Type2ScoreBand[];
  /** Metric band points before format penalties. */
  pointsBeforePenalty?: number;
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
  /** Full type-2 submit CSV (for restoring the exam session from a report). */
  submittedCsv?: string;
  /** Examinee code draft (for AI coaching on the report page). */
  userCode?: string;
  language?: 'python' | 'r';
  /** Both language buffers — always populated for the report UI. */
  userCodes?: { python: string; r: string };
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
  opts?: {
    readCsv?: (
      path: string,
      language: 'python' | 'r',
    ) => Promise<string | null>;
  },
): Promise<ExamSet> {
  const quizzes: QuizProblem[] = [];
  for (const q of exam.quizzes) {
    if (q.kind !== 'submit' || q.submitted) {
      quizzes.push(q);
      continue;
    }
    if (q.taskType === 2 || q.submitFormat === 'csv') {
      const path = q.submitFile || 'result.csv';
      const language = q.language ?? 'python';
      let csv: string | null = null;
      if (opts?.readCsv) {
        try {
          csv = await opts.readCsv(path, language);
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

function draftForLang(
  quiz: QuizProblem,
  lang: 'python' | 'r',
): string {
  const fromDrafts = quiz.answerDrafts?.[lang]?.trim() ?? '';
  if (fromDrafts) return fromDrafts;
  // Active single-buffer mirrors answerDrafts[language] when present.
  if ((quiz.language ?? 'python') === lang) {
    const active = quiz.answerDraft?.trim() ?? '';
    if (active) return active;
  }
  return '';
}

/**
 * Type 1/3: examinees write & run code on the `practice` quiz; short answers
 * live on a separate `submit` quiz. Prefer the runnable workspace for report
 * code. Type 2 keeps code on the submit quiz itself.
 */
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

  // Fallback: any non-short code workspace sharing the notepad group / type.
  const peer = exam.quizzes.find(
    (q) =>
      q.id !== graded.id &&
      q.viewMode !== 'short' &&
      q.taskType === graded.taskType &&
      (!group || q.notepadGroup === group),
  );
  return peer ?? graded;
}

function mergeDraftForLang(
  primary: QuizProblem,
  secondary: QuizProblem | null,
  lang: 'python' | 'r',
): string {
  return draftForLang(primary, lang) || (secondary ? draftForLang(secondary, lang) : '');
}

function baseFields(quiz: QuizProblem, codeQuiz: QuizProblem = quiz) {
  // Prefer workspace (practice) drafts; fall back to graded quiz buffers
  // (type-2 submit, or legacy single-quiz exams).
  const secondary = codeQuiz.id === quiz.id ? null : quiz;
  const userCodes = {
    python: mergeDraftForLang(codeQuiz, secondary, 'python'),
    r: mergeDraftForLang(codeQuiz, secondary, 'r'),
  };
  const lang = codeQuiz.language ?? quiz.language ?? 'python';
  // Prefer the active language buffer; if empty, fall back to the other
  // language so legacy single-buffer sessions still surface written code.
  const userCode =
    userCodes[lang] ||
    userCodes[lang === 'python' ? 'r' : 'python'] ||
    codeQuiz.starterCode?.[lang]?.trim() ||
    codeQuiz.starterCode?.[lang === 'python' ? 'r' : 'python']?.trim() ||
    quiz.starterCode?.[lang]?.trim() ||
    quiz.starterCode?.[lang === 'python' ? 'r' : 'python']?.trim() ||
    '';
  const language: 'python' | 'r' =
    userCodes[lang] || !userCodes[lang === 'python' ? 'r' : 'python']
      ? lang
      : lang === 'python'
        ? 'r'
        : 'python';
  return {
    quizId: quiz.id,
    title: quiz.title,
    taskType: quiz.taskType,
    markdown: quiz.markdown ?? '',
    userCode,
    language,
    userCodes,
  };
}

function slotMaxPoints(
  quiz: QuizProblem,
  slot: { points?: number },
  slotCount: number,
): number {
  if (typeof slot.points === 'number' && Number.isFinite(slot.points)) {
    return slot.points;
  }
  if (quiz.taskType === 1 || quiz.taskType === 3) {
    return OFFICIAL_POINTS_PER_ITEM[quiz.taskType] / Math.max(1, slotCount);
  }
  return 1;
}

function gradeShortQuiz(quiz: QuizProblem, exam: ExamSet): GradeItem {
  const slots = quiz.shortSlots ?? [];
  const base = baseFields(quiz, codeWorkspaceQuiz(exam, quiz));
  const legacyItemMax =
    quiz.taskType === 1 || quiz.taskType === 3
      ? OFFICIAL_POINTS_PER_ITEM[quiz.taskType]
      : 1;

  if (!slots.length) {
    const draft = (quiz.answerDraft ?? '').trim();
    const expected = (quiz.shortAnswer ?? '').trim();
    const max = legacyItemMax;
    const answers: GradeAnswerRow[] = [
      {
        label: '단답',
        expected,
        submitted: draft,
        ok: Boolean(expected) ? shortAnswersEqual(draft, expected) : Boolean(draft),
      },
    ];
    if (!quiz.submitted) {
      return {
        ...base,
        status: 'unsubmitted',
        detail: '미제출',
        earned: 0,
        max,
        answers,
      };
    }
    if (!expected) {
      return {
        ...base,
        status: draft ? 'pass' : 'fail',
        detail: draft ? `제출됨: ${draft}` : '답안 없음',
        earned: draft ? max : 0,
        max,
        answers,
      };
    }
    const ok = shortAnswersEqual(draft, expected);
    return {
      ...base,
      status: ok ? 'pass' : 'fail',
      detail: ok
        ? `정답 · ${draft}`
        : `오답 · 제출 ${draft || '(미입력)'} / 정답 ${expected}`,
      earned: ok ? max : 0,
      max,
      answers,
    };
  }

  const answers: GradeAnswerRow[] = slots.map((s) => {
    const draft = (s.draft ?? '').trim();
    const expected = (s.expected ?? '').trim();
    // Empty expected key: never auto-pass (avoids free points from padded 소문항 slots).
    const ok = Boolean(expected) && shortAnswersEqual(draft, expected);
    return {
      label: s.label,
      expected,
      submitted: draft,
      ok,
    };
  });

  const max = slots.reduce(
    (sum, s) => sum + slotMaxPoints(quiz, s, slots.length),
    0,
  );

  if (!quiz.submitted) {
    return {
      ...base,
      status: 'unsubmitted',
      detail: `미제출 (단답 ${slots.length}칸 · 만점 ${max}점)`,
      earned: 0,
      max,
      answers,
    };
  }

  const lines: string[] = [];
  let earned = 0;
  for (let i = 0; i < answers.length; i++) {
    const row = answers[i];
    const pts = slotMaxPoints(quiz, slots[i], slots.length);
    if (!row.expected) {
      if (row.submitted) {
        earned += pts;
        lines.push(`${row.label}: 제출 (${row.submitted}) · ${pts}점`);
      } else {
        lines.push(`${row.label}: 미입력 · 0/${pts}`);
      }
      continue;
    }
    if (row.ok) {
      earned += pts;
      lines.push(`${row.label}: 정답 · ${pts}점`);
    } else {
      lines.push(
        `${row.label}: 오답 (제출 ${row.submitted || '(미입력)'} / 정답 ${row.expected}) · 0/${pts}`,
      );
    }
  }

  const status: GradeStatus =
    earned >= max - 1e-9 ? 'pass' : earned <= 0 ? 'fail' : 'partial';

  return {
    ...base,
    status,
    detail: lines.join('\n'),
    earned,
    max,
    answers,
  };
}

/** Header cells of a type-2 submit CSV (result.csv). */
export function type2CsvHeaderColumns(csv: string): string[] {
  const lines = csv.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim());
  if (!lines.length) return [];
  return lines[0]
    .split(',')
    .map((c) => c.trim().replace(/^"|"$/g, ''));
}

/** True when the first header cell looks like a pandas/R index column. */
export function type2CsvHasIndexHeader(csv: string): boolean {
  const cols = type2CsvHeaderColumns(csv);
  if (!cols.length) return false;
  return (
    cols[0] === '' ||
    /^unnamed/i.test(cols[0]) ||
    /^index$/i.test(cols[0])
  );
}

/**
 * Prediction / submit columns only (index/Unnamed stripped).
 * Official type-2 submit format requires exactly one data column.
 */
export function type2CsvDataColumns(csv: string): string[] {
  const cols = type2CsvHeaderColumns(csv);
  if (!cols.length) return [];
  return type2CsvHasIndexHeader(csv) ? cols.slice(1) : cols;
}

/** Inspect submitted CSV for 제13회 type-2 format penalties. */
export function type2FormatPenalties(csv: string): {
  penalty: number;
  reasons: string[];
} {
  const reasons: string[] = [];
  const dataCols = type2CsvDataColumns(csv);
  if (!type2CsvHeaderColumns(csv).length) {
    return { penalty: 0, reasons };
  }
  if (dataCols.length > 1) {
    reasons.push(
      `제출 칼럼 1개 초과 (${dataCols.length}개) −${TYPE2_FORMAT_PENALTY}`,
    );
  }
  if (type2CsvHasIndexHeader(csv)) {
    reasons.push(`index/Unnamed 칼럼 포함 −${TYPE2_FORMAT_PENALTY}`);
  }
  const penalty = reasons.length * TYPE2_FORMAT_PENALTY;
  return { penalty, reasons };
}

async function writeRuntimeFile(
  language: 'python' | 'r',
  path: string,
  content: string,
): Promise<void> {
  if (language === 'python') {
    const py = await preloadPyodide();
    const FS = (
      py as unknown as {
        FS: {
          writeFile: (p: string, d: string, opts?: { encoding?: string }) => void;
          analyzePath: (p: string) => { exists: boolean };
          mkdir: (p: string) => void;
        };
      }
    ).FS;
    const slash = path.lastIndexOf('/');
    if (slash > 0) {
      const dir = path.slice(0, slash);
      const parts = dir.split('/').filter(Boolean);
      let cur = '';
      for (const part of parts) {
        cur = cur ? `${cur}/${part}` : part;
        try {
          if (!FS.analyzePath(cur).exists) FS.mkdir(cur);
        } catch {
          try {
            FS.mkdir(cur);
          } catch {
            /* exists */
          }
        }
      }
    }
    FS.writeFile(path, content, { encoding: 'utf8' });
    return;
  }
  await writeWebRFile(path, content);
}

function decodeExamAssetText(file: ExamAsset): string {
  if (file.encoding === 'base64') {
    try {
      return atob(file.content);
    } catch {
      return file.content;
    }
  }
  return file.content;
}

/** Ensure test_label / test_labels (± data/) all resolve during grading. */
async function mountType2LabelAliases(
  language: 'python' | 'r',
  files: ExamAsset[] | undefined,
): Promise<void> {
  const label = findType2LabelAsset(files);
  if (!label) return;
  const body = decodeExamAssetText(label);
  if (!body.trim()) return;
  for (const alias of type2LabelAliasPaths(label.path)) {
    try {
      await writeRuntimeFile(language, alias, body);
    } catch {
      /* best-effort aliases */
    }
  }
}

/** Parse SCORE / EXPECTED / SCORE_BANDS and resolve type-2 metric points. */
export function parseType2Score(
  stdout: string,
  gradingSource = '',
  max = type2MaxPoints(),
): Type2ScoreInfo {
  const resolved = resolveType2Points(stdout, gradingSource, max);
  const { parsed, ratioResult } = resolved;
  return {
    label: parsed.label,
    mlKind: parsed.mlKind,
    direction: parsed.direction,
    achieved: parsed.student,
    expected: parsed.reference,
    yScale: parsed.yScale,
    gap: ratioResult.gap,
    gapBasis: ratioResult.gapBasis,
    relativeGap: ratioResult.relativeGap,
    earnedRatio: resolved.earnedRatio,
    fullCredit: resolved.fullCredit,
    bandSource: resolved.source,
    bands: resolved.bands,
    pointsBeforePenalty: resolved.points,
    rawStdout: stdout.trim(),
  };
}

function csvPreview(csv: string, maxLines = 8): string {
  const lines = csv.replace(/\r\n/g, '\n').split('\n').filter(Boolean);
  if (lines.length <= maxLines) return lines.join('\n');
  return `${lines.slice(0, maxLines).join('\n')}\n… (${lines.length} lines)`;
}

type GradeQuizUpdate = (
  quizId: string,
  patch: Partial<QuizProblem>,
) => void;

async function persistType2LabelOntoQuiz(opts: {
  quiz: QuizProblem;
  files: ExamAsset[];
  csv: string;
  source: string;
  assetName?: string;
  onQuizUpdate?: GradeQuizUpdate;
}): Promise<void> {
  const { quiz, files, csv, source, assetName, onQuizUpdate } = opts;
  if (!csv.trim()) return;
  const hadOnQuiz = Boolean(findType2LabelAsset(quiz.files));
  if (source !== 'existing') {
    try {
      await saveType2Label({
        problemId: quiz.id,
        csv,
        source,
        name: assetName,
      });
    } catch {
      /* ignore store errors */
    }
  }
  // Put label onto the problem itself so re-grade / export reuse it.
  if (!hadOnQuiz || source !== 'existing') {
    onQuizUpdate?.(quiz.id, { files });
  }
}

async function gradeType2Quiz(
  quiz: QuizProblem,
  exam: ExamSet,
  timeoutMs: number,
  onQuizUpdate?: GradeQuizUpdate,
): Promise<GradeItem> {
  const max = type2MaxPoints();
  const base = {
    ...baseFields(quiz, codeWorkspaceQuiz(exam, quiz)),
    max,
  };

  const submittedCsv = quiz.submittedCsv?.trim() ?? '';
  if (!quiz.submitted || !submittedCsv) {
    return {
      ...base,
      status: 'unsubmitted',
      detail: '미제출 (result.csv 없음)',
      earned: 0,
    };
  }

  const preview = csvPreview(submittedCsv);
  const format = type2FormatPenalties(submittedCsv);
  const lang = quiz.language;
  const path = quiz.submitFile || 'result.csv';
  const grading = quiz.gradingCode?.[lang]?.trim();

  /**
   * 제13회 가이드: 평가지표 구간 점수(5점 단위)를 먼저 부여한 뒤,
   * 형식 감점(각 3점, 누적)을 빼며 재반올림하지 않음 (예: 40−3=37).
   */
  const applyFormatPenalty = (bandPoints: number): number =>
    Math.max(0, bandPoints - format.penalty);

  if (!grading) {
    const earned = applyFormatPenalty(max);
    return {
      ...base,
      status: earned >= max - 1e-9 ? 'pass' : earned <= 0 ? 'fail' : 'partial',
      detail: [
        `제출 CSV 확인 (${submittedCsv.split(/\r?\n/).length} lines) · 채점 코드 없음`,
        format.reasons.length
          ? `형식 감점: ${format.reasons.join(' · ')}`
          : '형식 감점 없음',
        `earned=${earned}/${max} (구간 ${max} − 형식감점)`,
      ].join('\n'),
      earned,
      submittedCsvPreview: preview,
      submittedCsv,
    };
  }

  try {
    let files = quiz.files ?? [];
    let labelNote = '';

    const ensureAndMountLabels = async (force: boolean) => {
      const ensured = await ensureType2LabelsForGrading(quiz, {
        timeoutMs,
        force,
      });
      if (ensured.asset && ensured.csv.trim()) {
        const withoutOld = files.filter(
          (f) =>
            !findType2LabelAsset([f]) &&
            f.path !== ensured.asset!.path,
        );
        files = [...withoutOld, ensured.asset];
        labelNote = ensured.note;
        await persistType2LabelOntoQuiz({
          quiz,
          files,
          csv: ensured.csv,
          source: ensured.source,
          assetName: ensured.asset.name,
          onQuizUpdate,
        });
      } else if (ensured.note) {
        labelNote = ensured.note;
      }
      if (files.length) {
        if (lang === 'python') await mountAssetsToPyodide(files);
        else await mountAssetsToWebR(files);
      }
      await mountType2LabelAliases(lang, files);
      if (ensured.csv.trim()) {
        await mountSynthesizedType2Labels(lang, ensured.csv);
      }
      // Answer-code runs overwrite result.csv — restore the examinee submit.
      await writeRuntimeFile(lang, path, submittedCsv);
      return ensured;
    };

    let ensured = await ensureAndMountLabels(false);

    const runGradingOnce = async (): Promise<RunResult> =>
      lang === 'python'
        ? await runPython(grading, { timeoutMs })
        : await runR(grading, { timeoutMs });

    let out = await runGradingOnce();
    const errBlob = `${out.stdout}\n${out.stderr}`;
    if (
      !out.ok &&
      isMissingType2LabelError(errBlob) &&
      ensured.source !== 'ai_generate'
    ) {
      ensured = await ensureAndMountLabels(true);
      out = await runGradingOnce();
      if (ensured.note) labelNote = ensured.note;
    }

    const type2Score = parseType2Score(out.stdout, grading, max);
    const hasMetric =
      type2Score.achieved != null ||
      type2Score.bandSource === 'earned_points';
    let earned = 0;
    let status: GradeStatus = 'fail';
    if (!out.ok && !hasMetric) {
      earned = 0;
      status = 'fail';
    } else if (!hasMetric) {
      earned = 0;
      status = 'ungradable';
    } else {
      const bandPts = type2Score.pointsBeforePenalty ?? 0;
      earned = applyFormatPenalty(bandPts);
      if (earned >= max - 1e-9) {
        status = 'pass';
        earned = max;
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
        : '점수 파싱 없음 (STUDENT=/REF= 또는 SCORE_BANDS / EARNED_POINTS 권장)';
    return {
      ...base,
      status,
      detail: [
        out.ok ? '채점 코드 실행 성공' : '채점 코드 실행 실패',
        labelNote ? `라벨: ${labelNote}` : '',
        `ML=${type2Score.mlKind} · metric=${type2Score.label} (${type2Score.direction})`,
        `구간채점=${type2Score.bandSource ?? 'none'} · 구간점수=${type2Score.pointsBeforePenalty ?? 0}/${max}`,
        gapLine,
        type2Score.achieved != null
          ? `STUDENT=${type2Score.achieved}`
          : '',
        type2Score.expected != null ? `REF=${type2Score.expected}` : '',
        type2Score.yScale != null ? `Y_SCALE=${type2Score.yScale}` : '',
        format.reasons.length
          ? `형식 감점: ${format.reasons.join(' · ')} (구간점수 후 차감, 재반올림 없음)`
          : '형식 감점 없음',
        `earned=${earned}/${max}${type2Score.fullCredit ? ' (만점 구간)' : ''}`,
        out.stdout.trim(),
        out.stderr.trim() ? `[stderr]\n${out.stderr.trim()}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      earned,
      type2Score,
      submittedCsvPreview: preview,
      submittedCsv,
    };
  } catch (err) {
    return {
      ...base,
      status: 'fail',
      detail: err instanceof Error ? err.message : String(err),
      earned: 0,
      submittedCsvPreview: preview,
      submittedCsv,
    };
  }
}

/**
 * Merge IndexedDB type-2 result snapshots onto quiz.submittedCsv so end-of-exam
 * grading works even if session state drifted.
 */
export async function hydrateType2SubmissionsFromIdb(
  exam: ExamSet,
): Promise<ExamSet> {
  const stored = await loadType2ExamSubmissions(exam.id);
  if (!Object.keys(stored).length) return exam;
  let changed = false;
  const quizzes = exam.quizzes.map((q) => {
    const hit = stored[q.id];
    if (!hit?.csv?.trim()) return q;
    if (q.submitted && q.submittedCsv?.trim()) return q;
    changed = true;
    return {
      ...q,
      submitted: true,
      submittedCsv: hit.csv,
      submitFile: q.submitFile || hit.submitFile || 'result.csv',
    };
  });
  return changed ? { ...exam, quizzes } : exam;
}

/**
 * Merge persisted (AI / synthesized) test_label CSVs onto quiz.files so
 * re-grading reuses the same labels without regenerating.
 */
export async function hydrateType2LabelsFromIdb(
  exam: ExamSet,
  onQuizUpdate?: GradeQuizUpdate,
): Promise<ExamSet> {
  let changed = false;
  const quizzes: QuizProblem[] = [];
  for (const q of exam.quizzes) {
    const isType2 = q.taskType === 2 || q.submitFormat === 'csv';
    if (!isType2 || findType2LabelAsset(q.files)) {
      quizzes.push(q);
      continue;
    }
    let stored;
    try {
      stored = await loadType2Label(q.id);
    } catch {
      stored = undefined;
    }
    if (!stored?.csv?.trim()) {
      quizzes.push(q);
      continue;
    }
    changed = true;
    const next: QuizProblem = {
      ...q,
      files: [...(q.files ?? []), type2LabelRecordToAsset(stored)],
    };
    onQuizUpdate?.(q.id, { files: next.files });
    quizzes.push(next);
  }
  return changed ? { ...exam, quizzes } : exam;
}

export type GradeExamProgress = {
  /** 0-based index of the quiz about to be / being graded. */
  current: number;
  total: number;
  quizId: string;
  title: string;
};

/** Grade all submit-kind quizzes against answer keys / grading scripts. */
export async function gradeExam(
  exam: ExamSet,
  opts?: {
    timeoutMs?: number;
    onProgress?: (p: GradeExamProgress) => void;
    /** Persist synthesized labels (and other patches) onto the live exam. */
    onQuizUpdate?: GradeQuizUpdate;
  },
): Promise<GradeReport> {
  const timeoutMs = opts?.timeoutMs ?? OFFICIAL_MAX_RUN_SECONDS * 1000;
  let hydrated = await hydrateType2SubmissionsFromIdb(exam);
  hydrated = await hydrateType2LabelsFromIdb(hydrated, opts?.onQuizUpdate);
  const submit = listSubmitQuizzes(hydrated);
  const unsubmittedCount = submit.filter((q) => !q.submitted).length;
  const items: GradeItem[] = [];
  const total = submit.length;

  for (let i = 0; i < submit.length; i += 1) {
    const quiz = submit[i];
    opts?.onProgress?.({
      current: i,
      total,
      quizId: quiz.id,
      title: quiz.title,
    });
    if (quiz.taskType === 2 || quiz.submitFormat === 'csv') {
      items.push(
        await gradeType2Quiz(
          quiz,
          hydrated,
          timeoutMs,
          opts?.onQuizUpdate,
        ),
      );
    } else {
      items.push(gradeShortQuiz(quiz, hydrated));
    }
  }

  if (total > 0) {
    opts?.onProgress?.({
      current: total,
      total,
      quizId: submit[total - 1]?.id ?? '',
      title: '채점 완료',
    });
  }

  const earned = items.reduce((s, i) => s + i.earned, 0);
  const max = items.reduce((s, i) => s + i.max, 0);
  return { items, earned, max, unsubmittedCount };
}
