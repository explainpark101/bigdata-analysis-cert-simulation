/** Session-scoped exam wall clock (start / freeze-on-grade). */

function startKey(examId: string): string {
  return `bks.examTimerStart.${examId}`;
}

function endKey(examId: string): string {
  return `bks.examTimerEnd.${examId}`;
}

export function ensureExamStartMs(examId: string): number {
  try {
    const raw = sessionStorage.getItem(startKey(examId));
    const parsed = raw ? Number(raw) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    const now = Date.now();
    sessionStorage.setItem(startKey(examId), String(now));
    return now;
  } catch {
    return Date.now();
  }
}

/** Freeze the exam clock when grading begins (idempotent). */
export function markExamEndedMs(examId: string): number {
  try {
    const raw = sessionStorage.getItem(endKey(examId));
    const parsed = raw ? Number(raw) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    const now = Date.now();
    sessionStorage.setItem(endKey(examId), String(now));
    return now;
  } catch {
    return Date.now();
  }
}

export function getExamEndedMs(examId: string): number | null {
  try {
    const raw = sessionStorage.getItem(endKey(examId));
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

/** Wall clock used for remaining time / elapsed (frozen after grade starts). */
export function examClockNowMs(examId: string): number {
  return getExamEndedMs(examId) ?? Date.now();
}

export function clearExamTimer(examId: string): void {
  try {
    sessionStorage.removeItem(startKey(examId));
    sessionStorage.removeItem(endKey(examId));
  } catch {
    /* ignore */
  }
}
