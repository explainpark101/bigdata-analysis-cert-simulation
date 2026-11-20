import { ensureIdbReady, idbDelete, idbGet, idbSet } from '@/lib/idb';
import type { GradeReport } from '@/lib/examGrade';
import type {
  ExamActivityEvent,
  ExamActivitySummary,
} from '@/lib/examActivityLog';

export interface GradeResultSnapshot {
  examId: string;
  examTitle: string;
  gradedAt: string;
  /** Wall clock from exam start to grade. */
  elapsedMs: number;
  report: GradeReport;
  activity: ExamActivitySummary;
  rawEvents: ExamActivityEvent[];
}

export async function saveGradeResult(
  snapshot: GradeResultSnapshot,
): Promise<void> {
  await ensureIdbReady();
  await idbSet('gradeResult', snapshot);
}

export async function loadGradeResult(): Promise<GradeResultSnapshot | null> {
  await ensureIdbReady();
  const data = await idbGet<GradeResultSnapshot>('gradeResult');
  return data ?? null;
}

export async function clearGradeResult(): Promise<void> {
  await ensureIdbReady();
  await idbDelete('gradeResult');
}
