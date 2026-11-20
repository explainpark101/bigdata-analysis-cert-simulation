/** Session-scoped exam activity log (tabs, runs, focus) for grade reports. */

export type ExamActivityEventType =
  | 'session_start'
  | 'quiz_focus'
  | 'tab_focus'
  | 'run_start'
  | 'run_end'
  | 'submit'
  | 'grade';

export interface ExamActivityEvent {
  type: ExamActivityEventType;
  at: number;
  quizId?: string;
  title?: string;
  /** Workspace tab id: `code` | `short` | csv path */
  tab?: string;
  durationMs?: number;
  ok?: boolean;
}

export interface QuizActivitySummary {
  quizId: string;
  title: string;
  focusMs: number;
  tabMs: Record<string, number>;
  runCount: number;
  runMs: number;
  submitCount: number;
}

export interface ExamActivitySummary {
  totalFocusMs: number;
  byQuiz: QuizActivitySummary[];
  events: ExamActivityEvent[];
}

function storageKey(examId: string): string {
  return `bks.examActivity.${examId}`;
}

export function loadActivityEvents(examId: string): ExamActivityEvent[] {
  try {
    const raw = sessionStorage.getItem(storageKey(examId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ExamActivityEvent[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveActivityEvents(
  examId: string,
  events: ExamActivityEvent[],
): void {
  try {
    sessionStorage.setItem(storageKey(examId), JSON.stringify(events));
  } catch {
    /* quota / private mode */
  }
}

export function clearActivityEvents(examId: string): void {
  try {
    sessionStorage.removeItem(storageKey(examId));
  } catch {
    /* ignore */
  }
}

export function appendActivityEvent(
  examId: string,
  event: ExamActivityEvent,
): ExamActivityEvent[] {
  const next = [...loadActivityEvents(examId), event];
  saveActivityEvents(examId, next);
  return next;
}

export function ensureSessionStart(
  examId: string,
  title?: string,
): ExamActivityEvent[] {
  const events = loadActivityEvents(examId);
  if (events.some((e) => e.type === 'session_start')) return events;
  return appendActivityEvent(examId, {
    type: 'session_start',
    at: Date.now(),
    title,
  });
}

/** Close open focus intervals and aggregate dwell / run stats. */
export function summarizeActivity(
  events: ExamActivityEvent[],
  endAt = Date.now(),
): ExamActivitySummary {
  const sorted = [...events].sort((a, b) => a.at - b.at);
  const quizMeta = new Map<string, string>();
  const focusMs = new Map<string, number>();
  const tabMs = new Map<string, Record<string, number>>();
  const runCount = new Map<string, number>();
  const runMs = new Map<string, number>();
  const submitCount = new Map<string, number>();

  let curQuiz: string | null = null;
  let curQuizSince = 0;
  let curTab: string | null = null;
  let curTabSince = 0;

  const addFocus = (quizId: string, ms: number) => {
    if (ms <= 0) return;
    focusMs.set(quizId, (focusMs.get(quizId) ?? 0) + ms);
  };
  const addTab = (quizId: string, tab: string, ms: number) => {
    if (ms <= 0) return;
    const bag = tabMs.get(quizId) ?? {};
    bag[tab] = (bag[tab] ?? 0) + ms;
    tabMs.set(quizId, bag);
  };

  const closeTab = (until: number) => {
    if (curQuiz && curTab && curTabSince > 0) {
      addTab(curQuiz, curTab, until - curTabSince);
    }
    curTab = null;
    curTabSince = 0;
  };
  const closeQuiz = (until: number) => {
    closeTab(until);
    if (curQuiz && curQuizSince > 0) {
      addFocus(curQuiz, until - curQuizSince);
    }
    curQuiz = null;
    curQuizSince = 0;
  };

  for (const e of sorted) {
    if (e.quizId && e.title) quizMeta.set(e.quizId, e.title);

    if (e.type === 'quiz_focus' && e.quizId) {
      closeQuiz(e.at);
      curQuiz = e.quizId;
      curQuizSince = e.at;
      continue;
    }
    if (e.type === 'tab_focus' && e.quizId && e.tab) {
      if (curQuiz !== e.quizId) {
        closeQuiz(e.at);
        curQuiz = e.quizId;
        curQuizSince = e.at;
      } else {
        closeTab(e.at);
      }
      curTab = e.tab;
      curTabSince = e.at;
      continue;
    }
    if (e.type === 'run_end' && e.quizId) {
      runCount.set(e.quizId, (runCount.get(e.quizId) ?? 0) + 1);
      runMs.set(
        e.quizId,
        (runMs.get(e.quizId) ?? 0) + Math.max(0, e.durationMs ?? 0),
      );
      continue;
    }
    if (e.type === 'submit' && e.quizId) {
      submitCount.set(e.quizId, (submitCount.get(e.quizId) ?? 0) + 1);
    }
  }
  closeQuiz(endAt);

  const ids = new Set<string>([
    ...focusMs.keys(),
    ...tabMs.keys(),
    ...runCount.keys(),
    ...submitCount.keys(),
    ...quizMeta.keys(),
  ]);

  const byQuiz: QuizActivitySummary[] = [...ids].map((quizId) => ({
    quizId,
    title: quizMeta.get(quizId) ?? quizId,
    focusMs: focusMs.get(quizId) ?? 0,
    tabMs: tabMs.get(quizId) ?? {},
    runCount: runCount.get(quizId) ?? 0,
    runMs: runMs.get(quizId) ?? 0,
    submitCount: submitCount.get(quizId) ?? 0,
  }));
  byQuiz.sort((a, b) => b.focusMs - a.focusMs);

  return {
    totalFocusMs: byQuiz.reduce((s, q) => s + q.focusMs, 0),
    byQuiz,
    events: sorted,
  };
}

export function formatDurationMs(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  return `${m}:${String(sec).padStart(2, '0')}`;
}
