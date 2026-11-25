/**
 * Shared authoring guidance: exam runtime package assumptions + difficulty.
 * Keep in sync with src/data/packages.ts (Pyodide load + webR suggested).
 */

/** Packages authors may assume when writing Python answer / dataset / transform code. */
export const AUTHOR_PYTHON_PACKAGES = [
  'pandas',
  'numpy',
  'scipy.stats',
  'statsmodels',
  'sklearn (scikit-learn)',
  'xgboost',
  'lightgbm',
] as const;

/** Packages authors may assume when writing R answer / transform code. */
export const AUTHOR_R_PACKAGES = [
  'tidyverse',
  'broom',
  'lubridate',
] as const;

/** English block for agent system prompts. */
export function authorRuntimeEnvPromptEn(): string {
  return [
    '## Runtime environment (write code for this stack only)',
    `Python (Pyodide): ${AUTHOR_PYTHON_PACKAGES.join(', ')}.`,
    '  - Prefer `import pandas as pd`, `import numpy as np`, `from scipy import stats`, `import statsmodels.api as sm` / `statsmodels.formula.api`, `sklearn.*`, `xgboost`, `lightgbm`.',
    '  - Do not require packages outside this list (no selenium, no local filesystem paths beyond mounted data/).',
    `R (webR): ${AUTHOR_R_PACKAGES.join(', ')} (tidyverse includes dplyr/tidyr/readr/ggplot2/stringr/purrr/tibble/forcats).`,
    '  - Prefer `library(tidyverse)`, `library(broom)`, `library(lubridate)` at the top of R answer/transform code.',
    '  - Do not require packages outside this list unless the user explicitly asks.',
    'Answer code and transform code MUST run in this environment — verify with run_answer_code / run_transform_code / run_dataset_code.',
  ].join('\n');
}

/**
 * Hard custom metrics that are NOT a single call in pandas/numpy/scipy/sklearn/statsmodels.
 * Rotate — never default every hard item to pooled variance.
 */
export const HARD_CUSTOM_METRIC_IDEAS = [
  'population attributable fraction (PAF) with given risk formula',
  'Herfindahl–Hirschman index (HHI) / concentration index from shares',
  'Gini coefficient (discrete) from value shares',
  'Theil index or entropy-based inequality measure',
  'winsorized mean or trimmed mean with explicit cut rules',
  'coefficient of quartile variation or robust CV using MAD',
  'Brier score or log-loss computed by hand from probability columns',
  'Matthews correlation components assembled from a confusion table by formula',
  'Cohen\'s kappa from agreement counts (explicit formula)',
  'odds ratio / risk ratio then a specified transform (e.g. log-OR)',
  'Spearman rank correlation computed via rank averages without scipy.stats shortcut when asked to show steps',
  'weighted RMSE / MAPE with problem-defined weights',
  'stratified rate standardization (direct standardization) with given weights',
  'Lorenz-curve gap or area-style summary from ordered shares',
  'geometric mean of positive ratios with explicit product formula',
] as const;

/** Research statistical knowledge via web tools before inventing formulas. */
export function authorStatsResearchPromptEn(): string {
  return [
    '## Research stats knowledge (web / APIs — use freely)',
    '- Tools: `lookup_statistic` (preferred for metrics), `web_search`, then `fetch_url` on the best page.',
    '- Sources to prefer: Wikipedia (ko/en), textbooks/docs, CrossValidated, package docs. Verify the formula before putting it in the problem.',
    '- When designing a hard custom metric: look it up first — do not invent LaTeX or definitions from memory alone.',
    '- After fetch, rewrite the formula in KaTeX (`$...$` / `$$...$$`) in Korean exam tone; cite the idea in `note` briefly (no need for a bibliography).',
    '- Still reject package one-liners (mean/std/ttest/AUC/F1…): those need no pasted formula.',
  ].join('\n');
}

export function authorStatsResearchPromptKo(): string {
  return [
    '## 통계 지식 조사 (웹검색·API · 적극 사용)',
    '- 도구: `lookup_statistic`(지표 조회 우선) → `web_search` → 필요 시 `fetch_url`로 본문 확인.',
    '- 위키백과(한/영), 교재·공식 문서, CrossValidated 등에서 수식·정의를 확인한 뒤 출제하세요. 기억만으로 수식을 만들지 마세요.',
    '- 조사한 지표를 KaTeX(`$...$` / `$$...$$`)로 본문에 넣고, `note`에 어떤 지표를 참고했는지 한 줄로 남겨도 됩니다.',
    '- 패키지 한 줄로 되는 값(평균·표준편차·t검정·AUC 등)은 조사해도 본문에 수식을 넣지 마세요.',
  ].join('\n');
}

/** English difficulty + formula-implementation guidance. */
export function authorDifficultyPromptEn(opts?: {
  preferHard?: boolean;
  metricHint?: string;
}): string {
  const hint =
    opts?.metricHint?.trim() ||
    HARD_CUSTOM_METRIC_IDEAS[
      Math.floor(Math.random() * HARD_CUSTOM_METRIC_IDEAS.length)
    ];
  return [
    '## Difficulty (medium baseline; hard allowed)',
    '- Baseline: multi-step cleaning → transform/feature → aggregate or model/test → formatted answer.',
    '- Hard items (when used) must match 빅데이터분석기사 실기 style:',
    '  * Put an explicit formula in markdown with KaTeX delimiters: inline `$...$` or block `$$...$$`.',
    '  * Formula ONLY for quantities that are NOT a one-liner in the allowed stack',
    '    (do NOT paste formulas for mean/median/std/var/corr/ttest/chi2/AUC/F1 that pandas/numpy/scipy/sklearn/statsmodels already compute — just name the function/metric).',
    '  * Diversify custom metrics. Do NOT reuse 합동분산/pooled variance as the default hard item.',
    `  * Seed idea for this turn (optional — you may replace after lookup_statistic / web_search): ${hint}.`,
    '  * Prefer looking up a different real-world metric via tools rather than repeating the seed.',
    '  * Examinees implement that formula in code; answer_code must implement the SAME formula.',
    '  * Never invent the final number — compute via tools after implementing the formula.',
    opts?.preferHard
      ? '- This turn: prefer a hard custom-metric item (research + KaTeX formula), not a toy aggregate.'
      : '- Hard formula items are optional; when used, research a fresh metric (not pooled variance again).',
    '- Avoid unfair obscurity: state units, filters, ddof/rounding, and which groups enter the formula.',
  ].join('\n');
}

/** Korean block for auto-generate user prompts. */
export function authorRuntimeEnvPromptKo(): string {
  return [
    '## 실행 환경 (이 스택 기준으로 코드·정답 작성)',
    `- Python(Pyodide): ${AUTHOR_PYTHON_PACKAGES.join(', ')}`,
    '  - 예: pandas/numpy, `scipy.stats`, statsmodels, sklearn, xgboost, lightgbm',
    `- R(webR): ${AUTHOR_R_PACKAGES.join(', ')} (tidyverse = dplyr·tidyr·readr·ggplot2 등)`,
    '  - 답안/변형 코드 상단에 library(tidyverse), library(broom), library(lubridate) 사용 가능',
    '- 위 목록 밖 패키지에 의존하지 마세요. set_answer_code / transform / dataset 코드는 이 환경에서 실행·검증하세요.',
  ].join('\n');
}

export function authorDifficultyPromptKo(opts?: {
  preferHard?: boolean;
  metricHint?: string;
}): string {
  const hint =
    opts?.metricHint?.trim() ||
    HARD_CUSTOM_METRIC_IDEAS[
      Math.floor(Math.random() * HARD_CUSTOM_METRIC_IDEAS.length)
    ];
  const prefer = opts?.preferHard
    ? '- 이번 문항은 고난도(커스텀 지표·수식 직접 구현)를 우선하세요.'
    : '- 기본은 실전형 중난도 다단계 파이프라인이며, 고난도 문항도 허용합니다.';
  return [
    '## 난이도 · 수식',
    prefer,
    '- 기초 패키지(pandas/numpy/scipy.stats/sklearn/statsmodels 등)로 한 줄 계산되는 값(평균·중앙값·표준편차·상관계수·t검정 p값·AUC·F1 등)은 본문에 수식을 넣지 마세요. 이름만 지시하세요.',
    '- 고난도는 패키지 원라이너가 아닌 통계적으로 의미 있는 지표만 본문에 KaTeX 수식(`$...$` / `$$...$$`)으로 제시하고, 응시자·정답 코드가 동일 수식을 구현하세요.',
    '- 합동분산(pooled variance)을 기본/반복 출제하지 마세요. `lookup_statistic` / `web_search`로 다른 실존 지표를 찾아 쓰세요.',
    `- 시드 아이디어(선택 · 조사 후 바꿔도 됨): ${hint}`,
    '- 필터·ddof·반올림·대상 집단을 본문에 명시하고, 숫자는 run_answer_code 결과로만 set_short_answers 하세요.',
  ].join('\n');
}

/** Stable-ish pick for auto-gen so papers do not all collapse to pooled variance. */
export function pickHardMetricHint(
  taskType: 1 | 2 | 3,
  ordinalInType: number,
): string {
  const idx =
    (taskType * 17 + ordinalInType * 31) % HARD_CUSTOM_METRIC_IDEAS.length;
  return HARD_CUSTOM_METRIC_IDEAS[idx];
}

/**
 * 제13회 응시 가이드 2-2 제2유형: 평가지표 구간별 5점 단위 + 형식 감점.
 */
export function authorType2BandPromptEn(): string {
  return [
    '## Type 2 scoring bands (제13회 가이드 2-2 — mandatory)',
    '- Max 40 points. Award points by evaluation-metric **bands in 5-point steps** (40·35·30·…·0).',
    '- Problem markdown MUST include: metric name/direction, submit file/column rules, and a **채점 구간표** table.',
    '- Calibrate bands from the answer/reference model metric (REF): top band = full credit near REF; below lowest band → 0 points.',
    '- gradingCode MUST print:',
    '  ML_TYPE=…  METRIC=…  STUDENT=…  REF=…',
    '  SCORE_BANDS=<thr>:<pts>,…   (same table as markdown; higher: student≥thr, lower: student≤thr)',
    '  optionally EARNED_POINTS=<0..40 step 5> after applying bands in-script.',
    '- CSV format penalties (−3 each, cumulative: wrong filename / wrong column / >1 column) are applied by the app AFTER band points (e.g. 40−3=37; do not re-round).',
    '- 0 points also when pred count ≠ test rows (평가지표 산출 불가).',
  ].join('\n');
}

export function authorType2BandPromptKo(): string {
  return [
    '## 제2유형 구간별 채점 (제13회 가이드 2-2 · 필수)',
    '- 만점 40점. 평가지표에 따라 **구간별 점수(5점 단위: 40·35·…·0)** 를 부여하세요.',
    '- 문제 본문에 반드시 포함: 평가지표·방향, 제출 파일명/칼럼명, **채점 구간표**.',
    '- 정답(기준) 모델 지표(REF)로 만점 구간을 잡고, 아래로 5점 단위 구간을 설계하세요. 최저 구간 미만은 0점.',
    '- grading 코드 stdout 예:',
    '  ML_TYPE=regression  METRIC=rmse  STUDENT=…  REF=…',
    '  SCORE_BANDS=12:40,15:35,18:30,22:25,28:20,35:15,45:10,60:5',
    '  (또는 구간 적용 후 EARNED_POINTS=35)',
    '- 형식 감점(파일명/칼럼명/칼럼 수, 각 3점 누적)은 앱이 구간 점수에서 차감합니다(40−3=37, 재반올림 없음).',
    '- 평가 행 수 ≠ 예측 행 수이면 0점 처리되도록 채점 코드에서 검사를 두세요.',
  ].join('\n');
}

/**
 * 제1·3유형: 답은 숫자만. 반올림 또는 절사로 자리수를 맞춘 뒤 제출 (제13회 가이드 형식 예시).
 */
export function authorType13AnswerFormatPromptEn(): string {
  return [
    '## Type 1 / 3 answer format (mandatory)',
    '- Every short answer MUST be a **number only** (optional leading minus, optional decimal point). No letters, labels, units, commas, or multiple values.',
    '- Problem markdown MUST require **rounding (반올림)** or **truncation (절사)** to a stated number of decimal places (or integer). Example: "반올림하여 소수점 둘째 자리까지".',
    '- answer_code must apply that same round/trunc before printing; set_short_answers from that printed numeric string only (e.g. "0.12", "11", "-3.5").',
    '- Do not author items whose key is a category/string (e.g. "C", "Yes", column name). Redesign so the reported value is numeric after round/trunc.',
  ].join('\n');
}

export function authorType13AnswerFormatPromptKo(): string {
  return [
    '## 제1·3유형 답안 형식 (필수)',
    '- 모든 단답 정답은 **숫자만** 가능합니다 (부호·소수점만 허용). 문자·라벨·단위·쉼표·복수 값 금지.',
    '- 문제 본문에 **반올림** 또는 **절사**와 자리수(또는 정수)를 반드시 명시하세요. 예: "반올림하여 소수점 둘째 자리까지 구하시오".',
    '- 정답 코드도 동일 규칙으로 round/절사 후 출력하고, 그 숫자 문자열만 set_short_answers 하세요 (예: "0.12", "11").',
    '- 카테고리/문자열 정답 문항은 만들지 마세요. 반드시 수치를 round·절사해 답하게 설계하세요.',
  ].join('\n');
}

/** True if the string is a single numeric short-answer token. */
export function isNumericShortAnswer(raw: string): boolean {
  const s = String(raw ?? '').trim();
  if (!s) return false;
  // Reject comma-separated multi-answers and non-numeric tokens.
  if (/[,\s]/.test(s)) return false;
  return /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(s);
}

export function validateNumericShortAnswers(answers: string[]): {
  ok: boolean;
  answers: string[];
  rejected: string[];
} {
  const trimmed = answers.map((a) => String(a ?? '').trim());
  const rejected = trimmed.filter((a) => a && !isNumericShortAnswer(a));
  const empty = trimmed.every((a) => !a);
  return {
    ok: !empty && rejected.length === 0 && trimmed.some((a) => a.length > 0),
    answers: trimmed,
    rejected,
  };
}
