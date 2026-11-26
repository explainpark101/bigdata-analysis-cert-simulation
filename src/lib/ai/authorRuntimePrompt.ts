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
    '  - CSV load paths MUST be `data/<file>.csv` only (e.g. `pd.read_csv("data/train.csv")`). No absolute paths, no nested dirs in code.',
    `R (webR): ${AUTHOR_R_PACKAGES.join(', ')} (tidyverse includes dplyr/tidyr/readr/ggplot2/stringr/purrr/tibble/forcats).`,
    '  - Prefer `library(tidyverse)`, `library(broom)`, `library(lubridate)` at the top of R answer/transform code.',
    '  - CSV paths MUST be `data/<file>.csv` (e.g. `read.csv("data/train.csv")`).',
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
    '## Research stats knowledge (web / APIs — optional)',
    '- Tools: `lookup_statistic` (preferred), `web_search`, then `fetch_url` on the best page.',
    '- If search/fetch fails or returns empty: **skip research** and continue using your trained statistical knowledge. Do not stall the turn.',
    '- Sources when available: Wikipedia (ko/en), textbooks/docs, CrossValidated. Prefer verified formulas when the web works.',
    '- After a successful fetch, rewrite in KaTeX (`$...$` / `$$...$$`); optionally note the metric in `note`.',
    '- Still reject package one-liners (mean/std/ttest/AUC/F1…): those need no pasted formula.',
  ].join('\n');
}

export function authorStatsResearchPromptKo(): string {
  return [
    '## 통계 지식 조사 (웹검색·API · 선택)',
    '- 도구: `lookup_statistic` → `web_search` → 필요 시 `fetch_url`.',
    '- 검색/조회가 실패하거나 비면 **스킵**하고, 모델이 알고 있는 통계 지식으로 바로 출제하세요. 조사 때문에 작업을 멈추지 마세요.',
    '- 조사가 성공하면 KaTeX(`$...$` / `$$...$$`)로 본문에 넣고, `note`에 지표명을 한 줄 남겨도 됩니다.',
    '- 패키지 한 줄로 되는 값(평균·표준편차·t검정·AUC 등)은 본문에 수식을 넣지 마세요.',
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
    '- CSV 경로는 반드시 `data/파일명.csv` 형태 (예: `pd.read_csv("data/train.csv")`, `read.csv("data/train.csv")`). 절대경로·다른 폴더 금지.',
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
export function authorType13AnswerFormatPromptEn(opts?: {
  taskType?: 1 | 3;
}): string {
  const maxSub = opts?.taskType === 3 ? 3 : 5;
  const typeLabel = opts?.taskType === 3 ? 'Type 3' : 'Type 1';
  return [
    '## Type 1 / 3 answer format (mandatory)',
    '- Every short answer MUST be a **number only** (optional leading minus, optional decimal point). No letters, labels, units, commas, or multiple values in one slot.',
    '- Problem markdown MUST require **rounding (반올림)** or **truncation (절사)** to a stated number of decimal places (or integer). Example: "반올림하여 소수점 둘째 자리까지".',
    `- One bank item may include multiple 소문항. ${typeLabel} max **${maxSub}** sub-questions (item points split evenly). Prefer 2+ when it fits the skill; single-answer items are still OK.`,
    '- Mark 소문항 clearly in markdown with line-leading ①②… or (1)(2)… Each 소문항 MUST have its **own** short-answer slot. `set_short_answers` length = 소문항 count (one number per entry). Never pack several answers into one string.',
    '- answer_code must print one numeric line per 소문항 (same order); then set_short_answers from those lines (e.g. ["0.12", "11"]).',
    '- If run_answer_code prints NaN / Inf / -Inf: do NOT save. Change the dataset, filters, or metric and regenerate until every answer is a finite number.',
    '- Do not author items whose key is a category/string (e.g. "C", "Yes", column name). Redesign so the reported value is numeric after round/trunc.',
  ].join('\n');
}

export function authorType13AnswerFormatPromptKo(opts?: {
  taskType?: 1 | 3;
}): string {
  const maxSub = opts?.taskType === 3 ? 3 : 5;
  const typeLabel = opts?.taskType === 3 ? '제3유형' : '제1유형';
  return [
    '## 제1·3유형 답안 형식 (필수)',
    '- 모든 단답 정답은 **숫자만** 가능합니다 (부호·소수점만 허용). 한 칸에 문자·라벨·단위·쉼표·여러 값 금지.',
    '- 문제 본문에 **반올림** 또는 **절사**와 자리수(또는 정수)를 반드시 명시하세요. 예: "반올림하여 소수점 둘째 자리까지 구하시오".',
    `- 한 문항 안에 소문항을 둘 수 있습니다. ${typeLabel} 소문항 **최대 ${maxSub}개** (문항 배점은 소문항으로 균등 분할). 스킬에 맞으면 2개 이상을 권장하고, 단일도 가능합니다.`,
    '- 본문에 줄 앞 ①②… 또는 (1)(2)… 로 소문항을 표시하세요. **소문항마다 별도 정답란**. `set_short_answers` 길이 = 소문항 수. 한 문자열에 여러 답 금지.',
    '- 정답 코드는 소문항 순서대로 한 줄에 숫자 하나씩 출력한 뒤 set_short_answers 하세요 (예: ["0.12", "11"]).',
    '- run_answer_code 결과가 NaN / Inf / -Inf 이면 저장하지 마세요. 데이터·필터·지표를 바꿔 유한 숫자가 나올 때까지 문항을 다시 만드세요.',
    '- 카테고리/문자열 정답 문항은 만들지 마세요. 반드시 수치를 round·절사해 답하게 설계하세요.',
  ].join('\n');
}

/** NaN / Inf tokens that must never become exam keys. */
export function isNonFiniteAnswerToken(raw: string): boolean {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return false;
  return (
    s === 'nan' ||
    s === 'inf' ||
    s === '+inf' ||
    s === '-inf' ||
    s === 'infinity' ||
    s === '+infinity' ||
    s === '-infinity'
  );
}

/** True if stdout from answer_code contains a non-finite answer line. */
export function stdoutHasNonFiniteAnswer(stdout: string): boolean {
  const lines = String(stdout ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return false;
  // Prefer last lines (final prints); also flag any bare nan/inf line.
  const check = (line: string) => {
    if (isNonFiniteAnswerToken(line)) return true;
    // e.g. "nan", "NaN", "float('nan')" leftovers as sole token
    if (/^[\[\(\s]*nan[\]\)\s]*$/i.test(line)) return true;
    if (/^[\[\(\s]*[+-]?inf(?:inity)?[\]\)\s]*$/i.test(line)) return true;
    return false;
  };
  if (lines.some(check)) return true;
  // Also scan trailing tokens on the last few lines
  for (const line of lines.slice(-5)) {
    const toks = line.split(/[\s,;]+/).filter(Boolean);
    if (toks.some((t) => isNonFiniteAnswerToken(t))) return true;
  }
  return false;
}

/** True if the string is a single finite numeric short-answer token. */
export function isNumericShortAnswer(raw: string): boolean {
  const s = String(raw ?? '').trim();
  if (!s) return false;
  if (isNonFiniteAnswerToken(s)) return false;
  // Reject comma-separated multi-answers and non-numeric tokens.
  if (/[,\s]/.test(s)) return false;
  if (!/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(s)) return false;
  const n = Number(s);
  return Number.isFinite(n);
}

/** Type 1/3 draft answers ready to save (finite numbers only). */
export function shortAnswersAreFinite(
  answers: string[] | undefined,
  opts?: { taskType?: 1 | 2 | 3 },
): boolean {
  if (opts?.taskType === 2) return true;
  const check = validateNumericShortAnswers(answers ?? [''], opts);
  return (
    check.ok &&
    check.answers.every((a) => a.trim() && isNumericShortAnswer(a))
  );
}

export function validateNumericShortAnswers(
  answers: string[],
  opts?: { taskType?: 1 | 2 | 3 },
): {
  ok: boolean;
  answers: string[];
  rejected: string[];
  error?: string;
} {
  // Split packed "1\n2\n3" / "1,2,3" into separate 소문항 slots first.
  const expanded: string[] = [];
  for (const raw of answers) {
    const s = String(raw ?? '').trim();
    if (!s) {
      expanded.push('');
      continue;
    }
    if (/[\n\r,]/.test(s)) {
      const parts = s
        .split(/[\n\r,]+/)
        .map((p) => p.trim())
        .filter(Boolean);
      if (parts.length > 1 && parts.every((p) => isNumericShortAnswer(p))) {
        expanded.push(...parts);
        continue;
      }
    }
    expanded.push(s);
  }
  const trimmed = expanded.length ? expanded : [''];
  const rejected = trimmed.filter((a) => a && !isNumericShortAnswer(a));
  const nonFinite = trimmed.filter((a) => a && isNonFiniteAnswerToken(a));
  const empty = trimmed.every((a) => !a);
  const max =
    opts?.taskType === 1 ? 5 : opts?.taskType === 3 ? 3 : undefined;
  if (nonFinite.length) {
    return {
      ok: false,
      answers: trimmed,
      rejected: [...new Set([...rejected, ...nonFinite])],
      error:
        'Answer is NaN/Inf — redesign the item (dataset/filters/metric) and regenerate until answers are finite numbers.',
    };
  }
  if (max != null && trimmed.length > max) {
    return {
      ok: false,
      answers: trimmed.slice(0, max),
      rejected,
      error: `Too many 소문항 (max ${max} for type ${opts?.taskType}).`,
    };
  }
  if (trimmed.length < 1) {
    return { ok: false, answers: [''], rejected, error: 'Need at least one answer.' };
  }
  return {
    ok: !empty && rejected.length === 0 && trimmed.some((a) => a.length > 0),
    answers: trimmed,
    rejected,
  };
}

/** Hard contract: tools are attached on every authoring/modify turn. */
export function authorToolContractPromptEn(toolNames: string[]): string {
  const listed =
    toolNames.length > 0
      ? toolNames.join(', ')
      : 'list_project_csvs, set_dataset_code, run_dataset_code, set_transform_code, run_transform_code, save_generated_assets, set_answer_code, run_answer_code, set_short_answers, update_draft, apply_changes / save_problem / save_variant';
  return [
    '## Tools are LIVE (mandatory — never deny this)',
    'This request already includes OpenAI-compatible function tools. Tool calling IS connected in THIS turn.',
    `Available tools: ${listed}.`,
    'NEVER claim that tools, file access, shell, set_dataset_code, run_answer_code, or similar are disconnected, missing, unavailable, or only work in another session.',
    'NEVER ask the user to "retry in a session with tools" or end with only a planned SYNTHESIZE/MUTATE write-up.',
    'NEVER paste tool calls as markdown/JSON in the assistant text (e.g. ```json {"tool_calls":[...]} ```). That does NOT run. Use the API native function/tool_calls channel only.',
    'If CSV and answers disagree: call tools NOW — e.g. list_project_csvs / set_dataset_code or set_transform_code → run_* → save_generated_assets → set_answer_code → run_answer_code → set_short_answers → apply_changes/save_*.',
    'A text-only reply that postpones work is a failure. Emit native tool_calls; brief Korean narration is fine alongside tools.',
  ].join('\n');
}

/** Korean block for auto-generate / dock user prompts. */
export function authorToolContractPromptKo(): string {
  return [
    '## 도구는 이미 연결됨 (필수)',
    '이 요청에는 출제 도구(function calling)가 이미 포함되어 있습니다. 지금 턴에서 바로 호출하세요.',
    '도구/파일/셸/`set_dataset_code`/`run_answer_code` 등이 연결되지 않았다고 말하지 마세요. 다른 세션에서 다시 보내 달라고 하지 마세요.',
    '계획만 적고 끝내지 마세요. MUTATE/SYNTHESIZE·정답 재계산·저장은 전부 도구 호출로 실행하세요.',
    '본문에 ```json {"tool_calls":[...]} ``` 형태로 도구를 적지 마세요. 그건 실행되지 않습니다. API 네이티브 function/tool_calls만 사용하세요.',
    'CSV와 정답이 어긋나면 즉시 도구로 CSV를 재생성·검증·set_short_answers·save/apply 하세요.',
  ].join('\n');
}

/**
 * Detect assistant text that wrongly claims tools are missing or only plans work.
 */
export function assistantSkippedRequiredTools(text: string): boolean {
  const raw = String(text ?? '');
  if (!raw.trim()) return false;
  const patterns = [
    /도구가?\s*(아직\s*)?(붙|연결|제공|포함)?\s*(어?\s*있)?\s*(지\s*않|안\s*되|없)/i,
    /출제용\s*도구.{0,40}(없|안|불가|연결)/i,
    /파일\s*\/?\s*셸\s*접근/i,
    /이\s*턴에서.{0,60}(할\s*수\s*없|불가)/i,
    /다시\s*보내\s*주/i,
    /도구가\s*붙은\s*세션/i,
    /세션에서\s*같은\s*요청/i,
    /tools?\s*(are\s*|is\s*)?(not\s+)?(available|connected|attached|enabled|present|missing)/i,
    /tool[- ]?calling\s+(is\s+)?(not|unavailable|disabled)/i,
    /cannot\s+(actually\s+)?(regenerate|run|save|execute|call)/i,
    /without\s+(access\s+to\s+)?tools?/i,
    /no\s+(access\s+to\s+)?tools?\b/i,
    /retry\s+.{0,40}(with\s+)?tools?/i,
    /의도한\s*수정.{0,80}예정/i,
    /바로\s*실행하겠/i,
    /```(?:json)?\s*\{\s*"tool_calls"/i,
    /\{\s*"tool_calls"\s*:\s*\[/i,
  ];
  return patterns.some((re) => re.test(raw));
}

/** User nudge when the model returned zero tool_calls. */
export function toolCallNudgeMessage(
  toolNames: string[],
  opts?: { saveTool?: string },
): string {
  const names =
    toolNames.length > 0
      ? toolNames.join(', ')
      : 'list_project_csvs, set_dataset_code, run_answer_code, save_generated_assets, apply_changes';
  return [
    'TOOLS_ARE_CONNECTED=true. Your previous message used zero tool_calls.',
    'Do NOT say tools are missing or ask the user to retry elsewhere.',
    `Call tools now. Available: ${names}.`,
    'Typical fix path when CSV≠answers: set_dataset_code or set_transform_code → run_* → save_generated_assets → set_answer_code → run_answer_code → set_short_answers → then save/apply.',
    opts?.saveTool
      ? `When ready, call ${opts.saveTool}(confirm=true).`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}
