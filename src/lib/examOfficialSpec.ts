import type { BankProblem, TaskType } from '@/types/project';

/**
 * K-DATA 제13회 빅데이터분석기사 실기 응시 가이드 (2026.11.28) 기준.
 * 문항 수 · 배점 · 시험 시간 · 실행 제한을 앱 전역에서 공유한다.
 */

/** Official bank-item counts per task type (3 + 1 + 2 = 6). */
export const OFFICIAL_COUNTS: Record<TaskType, number> = {
  1: 3,
  2: 1,
  3: 2,
};

/** Points per bank item (type 1/3 may split across 소문항). */
export const OFFICIAL_POINTS_PER_ITEM: Record<TaskType, number> = {
  1: 10,
  2: 40,
  3: 15,
};

export const OFFICIAL_TOTAL_POINTS = 100;
export const OFFICIAL_TOTAL_ITEMS =
  OFFICIAL_COUNTS[1] + OFFICIAL_COUNTS[2] + OFFICIAL_COUNTS[3];

/** Exam wall-clock (10:00–13:00). */
export const OFFICIAL_TIME_LIMIT_MINUTES = 180;

/** Per code-run limit (강제 실행 취소). */
export const OFFICIAL_MAX_RUN_SECONDS = 60;

/**
 * Type-2 format penalties (각 3점, 누적).
 * 지시 파일명 / 칼럼명 / 칼럼 개수 1개 초과.
 */
export const TYPE2_FORMAT_PENALTY = 3;

/**
 * Type-2 metric band step (제13회 가이드 2-2: 평가지표 구간별 5점 단위).
 * Format penalties (−3 each) are applied after banding and are NOT re-rounded.
 */
export const TYPE2_SCORE_BAND = 5;

/** Auto-gen order: three type-1, one type-2, two type-3. */
export const OFFICIAL_AUTOGEN_SEQUENCE: TaskType[] = [1, 1, 1, 2, 3, 3];

export type TypeCounts = Record<TaskType, number>;

export function emptyTypeCounts(): TypeCounts {
  return { 1: 0, 2: 0, 3: 0 };
}

export function countBankByType(
  problems: Array<Pick<BankProblem, 'taskType'>>,
): TypeCounts {
  const counts = emptyTypeCounts();
  for (const p of problems) {
    const t = p.taskType;
    if (t === 1 || t === 2 || t === 3) counts[t] += 1;
  }
  return counts;
}

export function countIdsByType(
  ids: string[],
  bank: Array<Pick<BankProblem, 'id' | 'taskType'>>,
): TypeCounts {
  const byId = new Map(bank.map((b) => [b.id, b.taskType]));
  const counts = emptyTypeCounts();
  for (const id of ids) {
    const t = byId.get(id);
    if (t === 1 || t === 2 || t === 3) counts[t] += 1;
  }
  return counts;
}

export function isOfficialStructure(counts: TypeCounts): boolean {
  return (
    counts[1] === OFFICIAL_COUNTS[1] &&
    counts[2] === OFFICIAL_COUNTS[2] &&
    counts[3] === OFFICIAL_COUNTS[3]
  );
}

export function officialStructureSummary(counts: TypeCounts): string {
  const parts: string[] = [];
  for (const t of [1, 2, 3] as TaskType[]) {
    const got = counts[t];
    const need = OFFICIAL_COUNTS[t];
    const mark = got === need ? '✓' : '·';
    parts.push(`${mark} 제${t}유형 ${got}/${need}`);
  }
  return parts.join('  ');
}

/** Fisher–Yates shuffle (copy). */
export function shuffleCopy<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/**
 * Take all items when they fit in `limit`; otherwise a random sample of `limit`.
 */
export function takeAllOrRandom<T>(items: T[], limit: number): T[] {
  if (limit <= 0) return [];
  if (items.length <= limit) return [...items];
  return shuffleCopy(items).slice(0, limit);
}

/**
 * Pick up to the official count per type for a standard paper (1→2→3).
 * Bank order is append-only (newest last). If a type fits the quota, take all;
 * otherwise sample randomly among the **newest** candidates only (never older
 * bank items ahead of a fresh auto-gen batch).
 */
export function pickOfficialProblemIds(
  bank: Array<Pick<BankProblem, 'id' | 'taskType'>>,
): string[] {
  const byType: Record<TaskType, string[]> = { 1: [], 2: [], 3: [] };
  for (const b of bank) {
    const t = b.taskType;
    if (t !== 1 && t !== 2 && t !== 3) continue;
    byType[t].push(b.id);
  }
  const pickNewest = (ids: string[], need: number): string[] => {
    if (ids.length <= need) return [...ids];
    // Window = newest `need` items only → assembled paper stays on recent gens.
    return takeAllOrRandom(ids.slice(-need), need);
  };
  return [
    ...pickNewest(byType[1], OFFICIAL_COUNTS[1]),
    ...pickNewest(byType[2], OFFICIAL_COUNTS[2]),
    ...pickNewest(byType[3], OFFICIAL_COUNTS[3]),
  ];
}

/** Max points for one type-2 submit quiz. */
export function type2MaxPoints(): number {
  return OFFICIAL_POINTS_PER_ITEM[2];
}

/**
 * Points for one short-answer slot on a type-1/3 submit page.
 * Bank items are worth OFFICIAL_POINTS_PER_ITEM; 소문항 split evenly.
 */
export function shortSlotPoints(
  taskType: TaskType | undefined,
  slotsInBankItem: number,
): number {
  if (taskType !== 1 && taskType !== 3) return 1;
  const itemMax = OFFICIAL_POINTS_PER_ITEM[taskType];
  const n = Math.max(1, slotsInBankItem);
  return itemMax / n;
}

/** Round type-2 earned points to 5-point bands within [0, max]. */
export function roundType2ToBand(
  earned: number,
  max = OFFICIAL_POINTS_PER_ITEM[2],
  band = TYPE2_SCORE_BAND,
): number {
  if (!Number.isFinite(earned) || earned <= 0) return 0;
  const capped = Math.min(max, Math.max(0, earned));
  const rounded = Math.round(capped / band) * band;
  return Math.min(max, Math.max(0, rounded));
}
