/** Hide Home "이어풀기" after grade without wiping the exam session. */

const KEY = 'bks.examResumeExcludeId';

export function excludeExamFromResume(examId: string): void {
  if (!examId.trim()) return;
  try {
    localStorage.setItem(KEY, examId);
  } catch {
    /* private mode */
  }
}

export function clearExamResumeExclude(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function isExamExcludedFromResume(examId: string): boolean {
  if (!examId.trim()) return false;
  try {
    return localStorage.getItem(KEY) === examId;
  } catch {
    return false;
  }
}
