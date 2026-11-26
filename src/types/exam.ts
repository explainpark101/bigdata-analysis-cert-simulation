export type ExamLanguage = 'python' | 'r';

export type QuizKind = 'guide' | 'practice' | 'submit';

export type SubmitFormat = 'short' | 'csv';

/** code = editor workspace; short = DataQ-style short-answer form */
export type QuizViewMode = 'code' | 'short';

/** Python / R code pair used for starter, answer, or grading scripts. */
export interface CodeByLanguage {
  python: string;
  r: string;
}

/** Resolved file embedded in a take-home exam (bytes included). */
export interface ExamAsset {
  path: string;
  name: string;
  encoding: 'utf-8' | 'base64';
  content: string;
  mimeType?: string;
}

/** One short-answer field on a type-1 / type-3 submit page (답안 ①…). */
export interface ShortAnswerSlot {
  id: string;
  /** UI label, e.g. 답안 ① */
  label: string;
  /** Author expected value (grading key) */
  expected?: string;
  /** Examinee draft */
  draft?: string;
  /**
   * Max points for this slot (제13회: type1 item 10 / type3 item 15,
   * split evenly across 소문항). Defaults to 1 when missing (legacy exams).
   */
  points?: number;
}

/** Self-contained quiz for the exam runner (*.exam.zip). */
export interface QuizProblem {
  id: string;
  number: string;
  /** Display title in exam UI, e.g. `제1유형 1번` / `문제 풀이` */
  title: string;
  /** 작업형 1 / 2 / 3 (for display / grouping) */
  taskType?: 1 | 2 | 3;
  /** Author note; shown only when showNoteOnExam is true */
  note?: string;
  showNoteOnExam?: boolean;
  kind: QuizKind;
  /** Default `code`. Short-answer submit pages use `short`. */
  viewMode?: QuizViewMode;
  markdown: string;
  language: ExamLanguage;
  starterCode: CodeByLanguage;
  /** Reference solution code (not shown in problem panel) */
  answerCode?: CodeByLanguage;
  /** Expected short-answer text (legacy single; prefer shortSlots) */
  shortAnswer?: string;
  /** Multi short-answer fields (유형 1·3 답안제출) */
  shortSlots?: ShortAnswerSlot[];
  /**
   * Type-2 grading script: reference model / training / metric vs result.csv.
   * Not shown in the problem panel.
   */
  gradingCode?: CodeByLanguage;
  /** Files resolved from the project library at export time */
  files?: ExamAsset[];
  submitFormat?: SubmitFormat;
  submitFile?: string;
  testCases?: Array<{
    id: string;
    name: string;
    expectIncludes?: string[];
  }>;
  submitted?: boolean;
  /** Active editor buffer (mirrors answerDrafts[language]). */
  answerDraft?: string;
  /**
   * Per-language editor drafts so switching Python ↔ R keeps both buffers.
   * Grade reports read `answerDrafts[language] ?? answerDraft`.
   */
  answerDrafts?: Partial<CodeByLanguage>;
  /**
   * Snapshot of result.csv (or submitFile) captured on type-2 submit.
   * Used as the grading artifact.
   */
  submittedCsv?: string;
  /**
   * Share notepad across practice + short-submit of the same type
   * (e.g. `t1`, `t2`, `t3`). Text lives on ExamSet.notepads.
   */
  notepadGroup?: string;
  /** @deprecated Prefer ExamSet.notepads[notepadGroup] */
  notepad?: string;
}

/** Take-home exam package — separate from AuthoringProject. */
export interface ExamSet {
  schemaVersion: 1;
  kind?: 'exam';
  id: string;
  title: string;
  description?: string;
  /** Exam duration in minutes. Default 180 (3h). `null` = no limit. */
  timeLimitMinutes: number | null;
  /** Max code run time per execution (seconds). Default 60. */
  maxRunSeconds: number;
  quizzes: QuizProblem[];
  /**
   * Shared notepads keyed by notepadGroup (`t1` / `t2` / `t3`).
   * Practice and short-submit pages of the same type share one notepad.
   */
  notepads?: Record<string, string>;
  createdAt?: string;
  updatedAt?: string;
}

export interface RuntimeStatus {
  python: 'idle' | 'loading' | 'ready' | 'error';
  r: 'idle' | 'loading' | 'ready' | 'error';
  message?: string;
}

export interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
}
