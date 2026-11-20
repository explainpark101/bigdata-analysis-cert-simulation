/**
 * Type-2 (ML) scoring: Classification | Regression only.
 *
 * Grading scripts should print (OpenAI / DataQ style keys also accepted):
 *   ML_TYPE=classification|regression
 *   METRIC=rmse|mae|auc|f1|accuracy|...
 *   STUDENT=0.12          # or SCORE= / METRIC_RMSE=
 *   REF=0.10              # answer-model metric (EXPECTED=)
 *   Y_SCALE=42.5          # optional; std/IQR of y_true (regression scale)
 *
 * Full marks when the submitted model is better, equal, or only slightly
 * worse than the answer model; otherwise a scale-aware partial score.
 */

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
