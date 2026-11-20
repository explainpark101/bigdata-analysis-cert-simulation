export type ExamLanguage = 'python' | 'r';

export type QuizKind = 'guide' | 'practice' | 'submit';

/** How the answer is collected on submit */
export type SubmitFormat = 'short' | 'csv';

export interface QuizProblem {
  id: string;
  /** Display number like "01" or empty for guide/practice */
  number: string;
  title: string;
  kind: QuizKind;
  /** Problem body in markdown (rendered with markdown-it + betterMd plugin) */
  markdown: string;
  language: ExamLanguage;
  starterCode: {
    python: string;
    r: string;
  };
  /** short = stdout answer; csv = write result.csv then download on submit */
  submitFormat?: SubmitFormat;
  /** Path inside Pyodide FS for csv submit (default result.csv) */
  submitFile?: string;
  /** Optional expected stdout substring checks for local "테스트" */
  testCases?: Array<{
    id: string;
    name: string;
    expectIncludes?: string[];
  }>;
  submitted?: boolean;
  answerDraft?: string;
  notepad?: string;
}

export interface ExamSet {
  schemaVersion: 1;
  id: string;
  title: string;
  description?: string;
  timeLimitMinutes: number | null;
  quizzes: QuizProblem[];
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
