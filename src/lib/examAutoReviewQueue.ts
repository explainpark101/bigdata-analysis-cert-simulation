/**
 * Global in-memory queue for exam-paper auto-review jobs.
 * Multiple papers can run concurrently; UI subscribes for progress.
 */

export type ExamAutoReviewProblemPhase =
  | 'queued'
  | 'verifying'
  | 'ok'
  | 'ai_review'
  | 'fixed'
  | 'failed'
  | 'cancelled';

export type ExamAutoReviewJobPhase =
  | 'running'
  | 'done'
  | 'error'
  | 'cancelled';

export interface ExamAutoReviewProblemState {
  problemId: string;
  title: string;
  taskType: number;
  phase: ExamAutoReviewProblemPhase;
  message?: string;
  updatedAt: number;
}

export interface ExamAutoReviewJob {
  examId: string;
  examTitle: string;
  phase: ExamAutoReviewJobPhase;
  problems: ExamAutoReviewProblemState[];
  startedAt: number;
  updatedAt: number;
  message?: string;
}

export interface ExamAutoReviewQueueState {
  jobs: ExamAutoReviewJob[];
  updatedAt: number;
}

type Listener = (state: ExamAutoReviewQueueState) => void;

const listeners = new Set<Listener>();

let state: ExamAutoReviewQueueState = {
  jobs: [],
  updatedAt: Date.now(),
};

/** AbortControllers keyed by examId — not part of serializable state. */
const aborts = new Map<string, AbortController>();

function emit(): void {
  for (const listener of listeners) listener(state);
}

function replaceJob(job: ExamAutoReviewJob): void {
  const others = state.jobs.filter((j) => j.examId !== job.examId);
  state = {
    jobs: [job, ...others].sort((a, b) => b.startedAt - a.startedAt),
    updatedAt: Date.now(),
  };
  emit();
}

export function getExamAutoReviewQueue(): ExamAutoReviewQueueState {
  return state;
}

export function subscribeExamAutoReviewQueue(listener: Listener): () => void {
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
}

export function getExamAutoReviewJob(examId: string): ExamAutoReviewJob | null {
  return state.jobs.find((j) => j.examId === examId) ?? null;
}

export function isExamAutoReviewRunning(examId: string): boolean {
  return getExamAutoReviewJob(examId)?.phase === 'running';
}

export function countRunningExamAutoReviews(): number {
  return state.jobs.filter((j) => j.phase === 'running').length;
}

export function upsertExamAutoReviewJob(job: ExamAutoReviewJob): void {
  replaceJob(job);
}

export function patchExamAutoReviewJob(
  examId: string,
  patch: Partial<Omit<ExamAutoReviewJob, 'examId' | 'problems'>> & {
    problems?: ExamAutoReviewProblemState[];
  },
): ExamAutoReviewJob | null {
  const prev = getExamAutoReviewJob(examId);
  if (!prev) return null;
  const next: ExamAutoReviewJob = {
    ...prev,
    ...patch,
    examId,
    problems: patch.problems ?? prev.problems,
    updatedAt: Date.now(),
  };
  replaceJob(next);
  return next;
}

export function patchExamAutoReviewProblem(
  examId: string,
  problemId: string,
  patch: Partial<ExamAutoReviewProblemState>,
): void {
  const prev = getExamAutoReviewJob(examId);
  if (!prev) return;
  const problems = prev.problems.map((p) =>
    p.problemId === problemId
      ? { ...p, ...patch, updatedAt: Date.now() }
      : p,
  );
  replaceJob({ ...prev, problems, updatedAt: Date.now() });
}

export function registerExamAutoReviewAbort(
  examId: string,
  ctrl: AbortController,
): void {
  aborts.get(examId)?.abort(
    new DOMException('Superseded by new auto-review', 'AbortError'),
  );
  aborts.set(examId, ctrl);
}

export function cancelExamAutoReview(examId: string): void {
  const ctrl = aborts.get(examId);
  if (ctrl && !ctrl.signal.aborted) {
    ctrl.abort(new DOMException('Auto-review cancelled', 'AbortError'));
  }
  patchExamAutoReviewJob(examId, {
    phase: 'cancelled',
    message: 'Cancelled',
  });
  const job = getExamAutoReviewJob(examId);
  if (job) {
    replaceJob({
      ...job,
      phase: 'cancelled',
      problems: job.problems.map((p) =>
        p.phase === 'queued' ||
        p.phase === 'verifying' ||
        p.phase === 'ai_review'
          ? { ...p, phase: 'cancelled', updatedAt: Date.now() }
          : p,
      ),
      updatedAt: Date.now(),
    });
  }
}

export function clearFinishedExamAutoReviews(): void {
  state = {
    jobs: state.jobs.filter((j) => j.phase === 'running'),
    updatedAt: Date.now(),
  };
  emit();
}

export function examAutoReviewProgress(job: ExamAutoReviewJob): {
  done: number;
  total: number;
  ratio: number;
} {
  const total = job.problems.length;
  const done = job.problems.filter((p) =>
    ['ok', 'fixed', 'failed', 'cancelled'].includes(p.phase),
  ).length;
  return {
    done,
    total,
    ratio: total <= 0 ? 1 : Math.min(1, done / total),
  };
}
