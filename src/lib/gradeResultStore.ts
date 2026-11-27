import { ensureIdbReady, idbDelete, idbGet, idbSet } from '@/lib/idb';
import type { GradeReport } from '@/lib/examGrade';
import type {
  ExamActivityEvent,
  ExamActivitySummary,
} from '@/lib/examActivityLog';

const HISTORY_KEY = 'gradeResultHistory' as const;
const MAX_HISTORY = 20;

export interface GradeResultSnapshot {
  /** Stable id for history lookup (`grade-…`). Legacy rows may omit. */
  id?: string;
  examId: string;
  examTitle: string;
  gradedAt: string;
  /** Wall clock from exam start to grade. */
  elapsedMs: number;
  report: GradeReport;
  activity: ExamActivitySummary;
  rawEvents: ExamActivityEvent[];
}

function newGradeResultId(): string {
  return `grade-${crypto.randomUUID().slice(0, 8)}`;
}

function withId(snapshot: GradeResultSnapshot): GradeResultSnapshot {
  if (snapshot.id?.trim()) return snapshot;
  return { ...snapshot, id: newGradeResultId() };
}

async function readHistoryRaw(): Promise<GradeResultSnapshot[]> {
  const data = await idbGet<GradeResultSnapshot[]>(HISTORY_KEY);
  return Array.isArray(data) ? data : [];
}

/** Ensure legacy single `gradeResult` appears in history once; backfill ids. */
async function migrateLegacyIntoHistory(): Promise<GradeResultSnapshot[]> {
  let history = await readHistoryRaw();
  let dirty = false;

  const latest = await idbGet<GradeResultSnapshot>('gradeResult');
  if (latest) {
    const normalized = withId(latest);
    const already =
      (normalized.id && history.some((h) => h.id === normalized.id)) ||
      history.some(
        (h) =>
          h.examId === normalized.examId &&
          h.gradedAt === normalized.gradedAt,
      );

    if (!already) {
      history = [normalized, ...history];
      dirty = true;
    }

    if (!latest.id && normalized.id) {
      await idbSet('gradeResult', normalized);
    }
  }

  const withIds = history.map((row) => {
    if (row.id?.trim()) return row;
    dirty = true;
    return withId(row);
  });

  const trimmed = withIds.slice(0, MAX_HISTORY);
  if (dirty || trimmed.length !== history.length) {
    await idbSet(HISTORY_KEY, trimmed);
  }

  return trimmed;
}

export async function saveGradeResult(
  snapshot: GradeResultSnapshot,
): Promise<GradeResultSnapshot> {
  await ensureIdbReady();
  const next = withId(snapshot);
  await idbSet('gradeResult', next);

  const history = await readHistoryRaw();
  const withoutDup = history.filter((h) => h.id !== next.id);
  const updated = [next, ...withoutDup].slice(0, MAX_HISTORY);
  await idbSet(HISTORY_KEY, updated);
  return next;
}

export async function loadGradeResult(): Promise<GradeResultSnapshot | null> {
  await ensureIdbReady();
  const data = await idbGet<GradeResultSnapshot>('gradeResult');
  return data ?? null;
}

export async function loadGradeResultHistory(): Promise<GradeResultSnapshot[]> {
  await ensureIdbReady();
  return migrateLegacyIntoHistory();
}

export async function loadGradeResultById(
  id: string,
): Promise<GradeResultSnapshot | null> {
  if (!id.trim()) return null;
  await ensureIdbReady();
  const history = await migrateLegacyIntoHistory();
  const found = history.find((h) => h.id === id);
  if (found) return found;
  const latest = await loadGradeResult();
  return latest?.id === id ? latest : null;
}

export async function clearGradeResult(): Promise<void> {
  await ensureIdbReady();
  await idbDelete('gradeResult');
}

export async function removeGradeResultFromHistory(id: string): Promise<void> {
  if (!id.trim()) return;
  await ensureIdbReady();
  const history = await readHistoryRaw();
  const next = history.filter((h) => h.id !== id);
  await idbSet(HISTORY_KEY, next);

  const latest = await idbGet<GradeResultSnapshot>('gradeResult');
  if (latest?.id === id) {
    await idbDelete('gradeResult');
  }
}

export async function clearGradeResultHistory(): Promise<void> {
  await ensureIdbReady();
  await idbDelete(HISTORY_KEY);
  await idbDelete('gradeResult');
}
