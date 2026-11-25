/**
 * Type-2 (ML) scoring: Classification | Regression only.
 *
 * Grading scripts should print (제13회 가이드 / DataQ style):
 *   ML_TYPE=classification|regression
 *   METRIC=rmse|mae|auc|f1|accuracy|...
 *   STUDENT=0.12          # or SCORE= / METRIC_RMSE=
 *   REF=0.10              # answer-model metric (EXPECTED=)
 *   Y_SCALE=42.5          # optional; std/IQR of y_true (regression scale)
 *   SCORE_BANDS=0.85:40,0.80:35,...   # metric→points (5pt steps) — preferred
 *   EARNED_POINTS=35                  # optional if bands applied in-script
 *
 * Points from bands/ratio are 5pt-stepped; CSV format penalties (−3 each)
 * are subtracted afterward without re-rounding (e.g. 40−3=37).
 */
import { roundType2ToBand } from '@/lib/examOfficialSpec';

export type Type2MlKind = 'classification' | 'regression';
export type MetricDirection = 'higher' | 'lower';

/** Relative slack: within this fraction of REF still earns full marks. */
export const TYPE2_FULL_CREDIT_REL = 0.05;

/** Extra absolute slack for bounded [0,1]-ish metrics. */
export const TYPE2_FULL_CREDIT_ABS_BOUNDED = 0.01;

const HIGHER_METRICS = new Set([
  'accuracy',
  'acc',
  'f1',
  'f1_score',
  'f1-score',
  'precision',
  'recall',
  'auc',
  'roc_auc',
  'rocauc',
  'roc-auc',
  'r2',
  'r2_score',
  'r-squared',
  'score', // generic — assume higher-is-better unless ML says regression error
]);

const LOWER_METRICS = new Set([
  'rmse',
  'mse',
  'mae',
  'mape',
  'msle',
  'rmsle',
  'logloss',
  'log_loss',
  'log-loss',
  'brier',
  'brier_score',
]);

export interface Type2MetricParse {
  mlKind: Type2MlKind | 'unknown';
  label: string;
  direction: MetricDirection | 'unknown';
  student: number | null;
  reference: number | null;
  yScale: number | null;
}

export interface Type2EarnedResult {
  earned: number;
  fullCredit: boolean;
  /** Signed performance gap vs REF (positive = worse for the examinee). */
  relativeGap: number | null;
  /** Absolute |student - ref| when both present. */
  gap: number | null;
  gapBasis: 'expected' | 'perfect' | 'none';
  explanation: string;
}

/**
 * Explicit metric→points band (제13회 가이드: 평가지표 구간별 5점 단위).
 * higher-is-better: student >= threshold → points
 * lower-is-better: student <= threshold → points
 */
export interface Type2ScoreBand {
  /** Threshold on the metric. */
  threshold: number;
  /** Points awarded when the band matches (0..40, typically step 5). */
  points: number;
}

export type Type2BandSource = 'earned_points' | 'score_bands' | 'ratio' | 'none';

export interface Type2PointsResult {
  /** Metric band points before format penalties (0..max, 5pt steps when from bands). */
  points: number;
  max: number;
  source: Type2BandSource;
  bands: Type2ScoreBand[];
  fullCredit: boolean;
  earnedRatio: number;
  explanation: string;
}

function normalizeLabel(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/^metric_/, '');
}

export function inferMlKind(
  explicit: string | null | undefined,
  metricLabel: string,
): Type2MlKind | 'unknown' {
  const e = (explicit ?? '').trim().toLowerCase();
  if (e === 'classification' || e === 'clf' || e === 'class') {
    return 'classification';
  }
  if (e === 'regression' || e === 'reg' || e === 'regress') {
    return 'regression';
  }
  const m = normalizeLabel(metricLabel);
  if (
    LOWER_METRICS.has(m) &&
    !['logloss', 'log_loss', 'log-loss', 'brier', 'brier_score'].includes(m)
  ) {
    return 'regression';
  }
  if (
    [
      'accuracy',
      'acc',
      'f1',
      'f1_score',
      'auc',
      'roc_auc',
      'precision',
      'recall',
      'logloss',
      'log_loss',
      'brier',
    ].includes(m)
  ) {
    return 'classification';
  }
  if (m === 'r2' || m === 'r2_score') return 'regression';
  return 'unknown';
}

export function directionForMetric(
  metricLabel: string,
  mlKind: Type2MlKind | 'unknown',
): MetricDirection | 'unknown' {
  const m = normalizeLabel(metricLabel);
  if (LOWER_METRICS.has(m)) return 'lower';
  if (HIGHER_METRICS.has(m)) {
    // bare "score" under regression often means error → lower better only if
    // paired with explicit lower metrics; keep higher for generic score.
    if (m === 'score' && mlKind === 'regression') return 'lower';
    return 'higher';
  }
  if (mlKind === 'regression') return 'lower';
  if (mlKind === 'classification') return 'higher';
  return 'unknown';
}

function parseNumber(raw: string | undefined): number | null {
  if (raw == null) return null;
  const v = Number(String(raw).trim());
  return Number.isFinite(v) ? v : null;
}

function firstMatch(
  blob: string,
  patterns: RegExp[],
): RegExpExecArray | null {
  for (const re of patterns) {
    const m = re.exec(blob);
    if (m) return m;
  }
  return null;
}

/** Parse grading stdout (+ optional source) for type-2 metrics. */
export function parseType2Metrics(
  stdout: string,
  gradingSource = '',
): Type2MetricParse {
  const blob = `${gradingSource}\n${stdout}`;

  const mlHit = firstMatch(blob, [
    /\bML_TYPE\s*[:=]\s*([A-Za-z_]+)/i,
    /\bTASK\s*[:=]\s*(classification|regression|clf|reg)\b/i,
  ]);
  const mlRaw = mlHit?.[1] ?? null;

  // METRIC=rmse → name; METRIC=0.12 → numeric student (handled below)
  const metricNameHit = firstMatch(blob, [
    /\bMETRIC_NAME\s*[:=]\s*([A-Za-z][A-Za-z0-9_\-]*)/i,
    /\bMETRIC\s*[:=]\s*([A-Za-z][A-Za-z0-9_\-]*)/i,
  ]);

  // Prefer STUDENT= / SCORE=; also METRIC_RMSE=0.12 style
  const studentHit = firstMatch(blob, [
    /\bSTUDENT(?:_SCORE|_METRIC)?\s*[:=]\s*([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)/i,
    /\bSCORE\s*[:=]\s*([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)/i,
    /\bMETRIC_(RMSE|MAE|MSE|AUC|F1|ACCURACY|R2|LOGLOSS|MAPE)\s*[:=]\s*([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)/i,
    /\bMETRIC\s*[:=]\s*([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)/i,
    /\b(auc|f1|accuracy|rmse|mae|mse|r2|logloss)\s*[:=]\s*([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)/i,
  ]);

  const refHit = firstMatch(blob, [
    /\bREF(?:_SCORE|_METRIC|_MODEL_SCORE)?\s*[:=]\s*([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)/i,
    /\bEXPECTED\s*[:=]\s*([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)/i,
    /\bBASELINE\s*[:=]\s*([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)/i,
    /\b정답\s*[:=]\s*([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)/i,
  ]);

  const scaleHit = firstMatch(blob, [
    /\bY_SCALE\s*[:=]\s*([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)/i,
    /\bY_STD\s*[:=]\s*([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)/i,
    /\bY_IQR\s*[:=]\s*([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)/i,
    /\bTARGET_SCALE\s*[:=]\s*([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)/i,
  ]);

  let label = 'score';
  let student: number | null = null;
  if (studentHit) {
    if (studentHit[2] != null && /METRIC_/i.test(studentHit[0])) {
      label = normalizeLabel(studentHit[1]);
      student = parseNumber(studentHit[2]);
    } else if (studentHit[2] != null) {
      label = normalizeLabel(studentHit[1]);
      student = parseNumber(studentHit[2]);
    } else {
      student = parseNumber(studentHit[1]);
    }
  }
  if (metricNameHit?.[1]) {
    label = normalizeLabel(metricNameHit[1]);
  }

  const reference = refHit
    ? parseNumber(refHit[1] ?? refHit[2])
    : null;
  const yScale = scaleHit ? parseNumber(scaleHit[1]) : null;
  const mlKind = inferMlKind(mlRaw, label);
  const direction = directionForMetric(label, mlKind);

  return { mlKind, label, direction, student, reference, yScale };
}

function isBoundedMetric(label: string): boolean {
  const m = normalizeLabel(label);
  return [
    'accuracy',
    'acc',
    'f1',
    'f1_score',
    'precision',
    'recall',
    'auc',
    'roc_auc',
    'r2',
    'r2_score',
  ].includes(m);
}

/**
 * Chance / floor level for higher-is-better partial scoring.
 * Below this → ~0 points.
 */
function higherFloor(
  label: string,
  mlKind: Type2MlKind | 'unknown',
  reference: number,
): number {
  const m = normalizeLabel(label);
  if (m === 'auc' || m === 'roc_auc') return 0.5;
  if (mlKind === 'classification') return 0;
  if (m === 'r2' || m === 'r2_score') return Math.min(0, reference);
  return 0;
}

/**
 * Map student vs answer-model metric → earned ratio in [0, 1].
 */
export function computeType2Earned(
  parsed: Type2MetricParse,
): Type2EarnedResult {
  const { student, reference, label, direction, mlKind, yScale } = parsed;

  if (student == null) {
    return {
      earned: 0,
      fullCredit: false,
      relativeGap: null,
      gap: null,
      gapBasis: 'none',
      explanation: '지표 파싱 실패 (STUDENT=/SCORE= 필요)',
    };
  }

  // No reference: heuristic vs perfect (1.0) for higher, or vs 0 for lower.
  if (reference == null) {
    if (direction === 'lower' || (direction === 'unknown' && mlKind === 'regression')) {
      const scale = Math.max(Math.abs(yScale ?? 0), 1e-9);
      const earned = clamp01(1 - Math.abs(student) / scale);
      return {
        earned,
        fullCredit: earned >= 1 - 1e-9,
        relativeGap: Math.abs(student) / scale,
        gap: Math.abs(student),
        gapBasis: 'perfect',
        explanation: `REF 없음 · lower metric vs Y_SCALE(${scale})`,
      };
    }
    const earned = clamp01(student);
    return {
      earned,
      fullCredit: earned >= 1 - 1e-9,
      relativeGap: Math.max(0, 1 - student),
      gap: Math.max(0, 1 - student),
      gapBasis: 'perfect',
      explanation: 'REF 없음 · higher metric vs 1.0',
    };
  }

  const dir: MetricDirection =
    direction === 'unknown'
      ? mlKind === 'regression'
        ? 'lower'
        : 'higher'
      : direction;

  const gap = Math.abs(student - reference);
  const absSlack = isBoundedMetric(label)
    ? TYPE2_FULL_CREDIT_ABS_BOUNDED
    : TYPE2_FULL_CREDIT_REL *
      Math.max(Math.abs(reference), Math.abs(yScale ?? 0), 1e-9);

  if (dir === 'higher') {
    const threshold = Math.min(
      reference * (1 - TYPE2_FULL_CREDIT_REL),
      reference - absSlack,
    );
    // Better / equal / slightly worse → full
    if (student + 1e-12 >= threshold) {
      return {
        earned: 1,
        fullCredit: true,
        relativeGap: Math.max(0, (reference - student) / Math.max(Math.abs(reference), 1e-9)),
        gap,
        gapBasis: 'expected',
        explanation: `만점 (student=${student} ≥ 허용하한 ${threshold.toFixed(6)}, REF=${reference})`,
      };
    }
    const floor = higherFloor(label, mlKind, reference);
    const denom = Math.max(threshold - floor, 1e-9);
    const earned = clamp01((student - floor) / denom);
    return {
      earned,
      fullCredit: false,
      relativeGap: (reference - student) / Math.max(Math.abs(reference), 1e-9),
      gap,
      gapBasis: 'expected',
      explanation: `부분점수 higher-is-better · floor=${floor} · denom=${denom}`,
    };
  }

  // lower-is-better (errors)
  const threshold = Math.max(
    reference * (1 + TYPE2_FULL_CREDIT_REL),
    reference + absSlack,
  );
  if (student - 1e-12 <= threshold) {
    return {
      earned: 1,
      fullCredit: true,
      relativeGap: Math.max(0, (student - reference) / Math.max(Math.abs(reference), 1e-9)),
      gap,
      gapBasis: 'expected',
      explanation: `만점 (student=${student} ≤ 허용상한 ${threshold.toFixed(6)}, REF=${reference})`,
    };
  }

  const scale = Math.max(
    Math.abs(yScale ?? 0),
    Math.abs(reference) * 2,
    Math.abs(threshold) * 0.5,
    1e-9,
  );
  const excess = student - threshold;
  const earned = clamp01(1 - excess / scale);
  return {
    earned,
    fullCredit: false,
    relativeGap: excess / scale,
    gap,
    gapBasis: 'expected',
    explanation: `부분점수 lower-is-better · excess=${excess} · scale=${scale}`,
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** Round earned points for display / report totals (keep precision). */
export function roundType2Earned(earned: number, max = 1): number {
  const v = clamp01(earned) * max;
  return Math.round(v * 1e6) / 1e6;
}

const NUM = '[-+]?[0-9]*\\.?[0-9]+(?:[eE][-+]?[0-9]+)?';

/**
 * Parse SCORE_BANDS=thr:pts,... or lines `BAND thr pts`.
 * Points should be 5-step (0..40) per 제13회 가이드.
 */
export function parseType2ScoreBands(blob: string): Type2ScoreBand[] {
  const bands: Type2ScoreBand[] = [];
  const seen = new Set<string>();

  const push = (threshold: number, points: number) => {
    if (!Number.isFinite(threshold) || !Number.isFinite(points)) return;
    const key = `${threshold}:${points}`;
    if (seen.has(key)) return;
    seen.add(key);
    bands.push({ threshold, points: Math.max(0, points) });
  };

  const inline = firstMatch(blob, [
    /\bSCORE_BANDS\s*[:=]\s*([^\n\r]+)/i,
    /\bBANDS\s*[:=]\s*([^\n\r]+)/i,
  ]);
  if (inline?.[1]) {
    const parts = inline[1].split(/[,;|]+/);
    for (const part of parts) {
      const m = part
        .trim()
        .match(new RegExp(`^(${NUM})\\s*[:=→>~-]\\s*(${NUM})$`));
      if (!m) continue;
      push(Number(m[1]), Number(m[2]));
    }
  }

  const lineRe = new RegExp(
    `^\\s*BAND\\s+(${NUM})\\s+(${NUM})\\s*$`,
    'gim',
  );
  let lm: RegExpExecArray | null;
  while ((lm = lineRe.exec(blob)) != null) {
    push(Number(lm[1]), Number(lm[2]));
  }

  return bands;
}

/** Prefer EARNED_POINTS= / BAND_POINTS= when grading already applied 구간표. */
export function parseType2EarnedPoints(blob: string): number | null {
  const hit = firstMatch(blob, [
    /\bEARNED_POINTS\s*[:=]\s*([-+]?[0-9]*\.?[0-9]+)/i,
    /\bBAND_POINTS\s*[:=]\s*([-+]?[0-9]*\.?[0-9]+)/i,
    /\bPOINTS\s*[:=]\s*([-+]?[0-9]*\.?[0-9]+)/i,
  ]);
  return hit ? parseNumber(hit[1]) : null;
}

/**
 * Apply official-style metric bands.
 * Returns 0 when student is outside every band (최저 구간 미만 → 0점).
 */
export function applyType2ScoreBands(
  student: number,
  bands: Type2ScoreBand[],
  direction: MetricDirection | 'unknown',
  max = 40,
): number {
  if (!bands.length || !Number.isFinite(student)) return 0;
  const dir: MetricDirection =
    direction === 'lower' || direction === 'higher' ? direction : 'higher';
  const ordered = [...bands].sort((a, b) => b.points - a.points);
  for (const b of ordered) {
    const ok =
      dir === 'higher'
        ? student + 1e-12 >= b.threshold
        : student - 1e-12 <= b.threshold;
    if (ok) return Math.min(max, Math.max(0, b.points));
  }
  return 0;
}

/**
 * Suggest 5-point bands from a reference metric (authoring aid).
 * higher: REF → 40, then step down; lower: REF → 40, then step up.
 */
export function suggestType2BandsFromRef(
  reference: number,
  direction: MetricDirection,
  max = 40,
  band = 5,
): Type2ScoreBand[] {
  const steps = Math.floor(max / band);
  const bands: Type2ScoreBand[] = [];
  if (!Number.isFinite(reference)) return bands;
  for (let i = 0; i <= steps; i++) {
    const points = max - i * band;
    if (points < 0) break;
    const t =
      direction === 'higher'
        ? reference * (1 - 0.04 * i)
        : reference * (1 + 0.06 * i);
    bands.push({
      threshold: Number(t.toPrecision(6)),
      points,
    });
  }
  return bands;
}

/**
 * Resolve type-2 metric points before CSV format penalties.
 * Priority (제13회): EARNED_POINTS → SCORE_BANDS → continuous ratio→5pt band.
 */
export function resolveType2Points(
  stdout: string,
  gradingSource = '',
  max = 40,
): Type2PointsResult & {
  parsed: Type2MetricParse;
  ratioResult: Type2EarnedResult;
} {
  const blob = `${gradingSource}\n${stdout}`;
  const parsed = parseType2Metrics(stdout, gradingSource);
  const ratioResult = computeType2Earned(parsed);
  const bands = parseType2ScoreBands(blob);
  const earnedDirect = parseType2EarnedPoints(blob);

  if (earnedDirect != null) {
    const points = Math.min(max, Math.max(0, earnedDirect));
    return {
      points,
      max,
      source: 'earned_points',
      bands,
      fullCredit: points >= max - 1e-9,
      earnedRatio: max > 0 ? points / max : 0,
      explanation: `EARNED_POINTS=${points}`,
      parsed,
      ratioResult,
    };
  }

  if (bands.length && parsed.student != null) {
    const dir =
      parsed.direction === 'unknown'
        ? parsed.mlKind === 'regression'
          ? 'lower'
          : 'higher'
        : parsed.direction;
    const points = applyType2ScoreBands(parsed.student, bands, dir, max);
    return {
      points,
      max,
      source: 'score_bands',
      bands,
      fullCredit: points >= max - 1e-9,
      earnedRatio: max > 0 ? points / max : 0,
      explanation:
        points > 0
          ? `SCORE_BANDS 적용 · student=${parsed.student} → ${points}점`
          : `SCORE_BANDS · 최저 구간 미만 → 0점 (student=${parsed.student})`,
      parsed,
      ratioResult,
    };
  }

  const ratioPts = roundType2Earned(ratioResult.earned, max);
  // Snap continuous score to 5pt bands (가이드: 구간별 5점 단위).
  const points = roundType2ToBand(ratioPts, max);
  return {
    points,
    max,
    source: ratioResult.earned > 0 || parsed.student != null ? 'ratio' : 'none',
    bands,
    fullCredit: ratioResult.fullCredit,
    earnedRatio: ratioResult.earned,
    explanation: ratioResult.explanation,
    parsed,
    ratioResult,
  };
}
