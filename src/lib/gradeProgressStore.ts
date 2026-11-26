/** In-memory grading progress so /exam/result can show a loading screen. */

export type GradeProgressPhase = 'idle' | 'running' | 'done' | 'error';

export interface GradeProgressState {
  phase: GradeProgressPhase;
  examId: string;
  examTitle: string;
  /** 0-based index of the quiz currently being graded. */
  current: number;
  total: number;
  /** Human-readable step label (quiz title / 준비 중). */
  label: string;
  message?: string;
  updatedAt: number;
}

type Listener = (state: GradeProgressState) => void;

const listeners = new Set<Listener>();

let state: GradeProgressState = {
  phase: 'idle',
  examId: '',
  examTitle: '',
  current: 0,
  total: 0,
  label: '',
  updatedAt: Date.now(),
};

function emit(): void {
  for (const listener of listeners) listener(state);
}

export function getGradeProgress(): GradeProgressState {
  return state;
}

export function subscribeGradeProgress(listener: Listener): () => void {
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
}

export function startGradeProgress(opts: {
  examId: string;
  examTitle: string;
  total: number;
}): void {
  state = {
    phase: 'running',
    examId: opts.examId,
    examTitle: opts.examTitle,
    current: 0,
    total: Math.max(0, opts.total),
    label: '채점 준비 중…',
    updatedAt: Date.now(),
  };
  emit();
}

export function updateGradeProgress(opts: {
  current: number;
  total?: number;
  label: string;
}): void {
  if (state.phase !== 'running') return;
  state = {
    ...state,
    current: opts.current,
    total: opts.total ?? state.total,
    label: opts.label,
    updatedAt: Date.now(),
  };
  emit();
}

export function finishGradeProgress(): void {
  state = {
    ...state,
    phase: 'done',
    current: state.total,
    label: '채점 완료',
    updatedAt: Date.now(),
  };
  emit();
}

export function failGradeProgress(message: string): void {
  state = {
    ...state,
    phase: 'error',
    message,
    label: '채점 오류',
    updatedAt: Date.now(),
  };
  emit();
}

export function resetGradeProgress(): void {
  state = {
    phase: 'idle',
    examId: '',
    examTitle: '',
    current: 0,
    total: 0,
    label: '',
    updatedAt: Date.now(),
  };
  emit();
}

/** Determinate ratio in [0, 1]. */
export function gradeProgressRatio(s: GradeProgressState): number {
  if (s.total <= 0) return s.phase === 'done' ? 1 : 0;
  if (s.phase === 'done') return 1;
  return Math.min(1, Math.max(0, s.current / s.total));
}
