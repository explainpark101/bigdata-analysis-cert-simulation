/**
 * Shared helpers for private project builders (gichul / goldenrabbit).
 * Keep aligned with src/lib/starterCode.ts + AnswerAuthorPanel short-answer sync.
 * (Self-contained — Bun scripts cannot resolve the app `@/` path alias.)
 */
import path from 'node:path';

export type TaskType = 1 | 2 | 3;

export interface CodeByLanguage {
  python: string;
  r: string;
}

export function emptyCode(): CodeByLanguage {
  return { python: '', r: '' };
}

function assetBasename(p: string): string {
  const norm = p.replace(/\\/g, '/');
  const i = norm.lastIndexOf('/');
  return i >= 0 ? norm.slice(i + 1) : norm;
}

function isDataPath(p: string): boolean {
  return !/\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(p);
}

function csvBasename(path: string): string | null {
  const b = assetBasename(path).toLowerCase();
  return b.endsWith('.csv') ? b : null;
}

/** Keep in sync with src/lib/starterCode.ts pickTrainPath. */
function pickTrainPath(paths: string[]): string | undefined {
  const data = paths.filter(isDataPath);
  const scored = data
    .map((p) => {
      const b = csvBasename(p);
      if (!b) return null;
      if (b.startsWith('test') || /_test\.csv$/.test(b)) return null;

      let score = 0;
      if (b.startsWith('train')) score = 100;
      else if (/_train\.csv$/.test(b)) score = 50;
      else return null;

      if (b === 'train.csv') score = 110;

      if (/^y[_-]?train\.csv$/.test(b)) score = 10;
      else if (/^x[_-]?train\.csv$/.test(b)) score = 40;

      return { p, score };
    })
    .filter((x): x is { p: string; score: number } => x != null)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.p;
}

function isType2LabelCsv(pathOrName: string): boolean {
  const b = assetBasename(pathOrName).toLowerCase();
  return /^test_labels?(?:_|\.csv$)/.test(b);
}

/** Keep in sync with src/lib/starterCode.ts pickTestPath. */
function pickTestPath(paths: string[]): string | undefined {
  const data = paths.filter(isDataPath);
  const scored = data
    .map((p) => {
      const b = csvBasename(p);
      if (!b) return null;
      if (isType2LabelCsv(b)) return null;
      if (b.startsWith('train') || /_train\.csv$/.test(b)) return null;

      let score = 0;
      if (b.startsWith('test')) score = 100;
      else if (/_test\.csv$/.test(b)) score = 50;
      else return null;

      if (b === 'test.csv') score = 110;
      if (/^x[_-]?test\.csv$/.test(b)) score = 40;

      return { p, score };
    })
    .filter((x): x is { p: string; score: number } => x != null)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.p;
}

const PY_HEADER = `# 출력을 원할 경우 print() 함수 활용
# 예시) print(df.head())

# getcwd(), chdir() 등 작업 폴더 설정 불필요
# 파일 경로 상 내부 드라이브 경로(C: 등) 접근 불가

import pandas as pd
`;

const R_HEADER = `# 출력을 원할 경우 print() 함수 활용
# 예시) print(df.head())

# setwd(), getwd() 등 작업 폴더 설정 불필요
# 파일 경로 상 내부 드라이브 경로(C: 등) 접근 불가
`;

/** DataQ-style starter (same rules as src/lib/starterCode.ts). */
export function starterFor(
  taskType: TaskType,
  mountFiles: string[],
): CodeByLanguage {
  const data = [...new Set(mountFiles)].filter(isDataPath);

  if (taskType === 2) {
    const byBase = (re: RegExp) =>
      data.find((p) => re.test(assetBasename(p).toLowerCase()));
    const xTrain = byBase(/^x[_-]?train\.csv$/);
    const yTrain = byBase(/^y[_-]?train\.csv$/);
    const xTest = byBase(/^x[_-]?test\.csv$/);
    if (xTrain && xTest) {
      const yLinePy = yTrain
        ? `y_train = pd.read_csv("${yTrain}")\n`
        : '';
      const yLineR = yTrain ? `y_train = read.csv("${yTrain}")\n` : '';
      return {
        python: `${PY_HEADER}
X_train = pd.read_csv("${xTrain}")
X_test = pd.read_csv("${xTest}")
${yLinePy}
# 사용자 코딩

# 예측 결과는 result.csv 로 저장한 뒤 제출 버튼을 사용하세요
print(X_train.head())
`,
        r: `${R_HEADER}
X_train = read.csv("${xTrain}")
X_test = read.csv("${xTest}")
${yLineR}
# 사용자 코딩

# 예측 결과는 result.csv 로 저장한 뒤 제출 버튼을 사용하세요
print(head(X_train))
`,
      };
    }
    const train =
      pickTrainPath(data) ??
      data.find((p) => !/test/i.test(assetBasename(p))) ??
      data[0] ??
      'data/train.csv';
    const test =
      pickTestPath(data) ??
      data.find((p) => p !== train) ??
      'data/test.csv';
    return {
      python: `${PY_HEADER}
train = pd.read_csv("${train}")
test = pd.read_csv("${test}")

# 사용자 코딩

# 예측 결과는 result.csv 로 저장한 뒤 제출 버튼을 사용하세요
print(train.head())
`,
      r: `${R_HEADER}
train = read.csv("${train}")
test = read.csv("${test}")

# 사용자 코딩
# 예: write.csv(data.frame(pred = pred), "result.csv", row.names = FALSE)

# 예측 결과는 result.csv 로 저장한 뒤 제출 버튼을 사용하세요
print(head(train))
`,
    };
  }

  const paths = data.length ? data : ['data/data.csv'];
  const multi = paths.length > 1;
  const pyLoads = paths
    .map((p, i) => {
      const name = multi ? `df${i + 1}` : 'df';
      return `${name} = pd.read_csv("${p}")`;
    })
    .join('\n');
  const rLoads = paths
    .map((p, i) => {
      const name = multi ? `df${i + 1}` : 'df';
      return `${name} = read.csv("${p}")`;
    })
    .join('\n');
  const pyPreview = multi
    ? paths.map((_, i) => `print(df${i + 1}.head())`).join('\n')
    : 'print(df.head())';
  const rPreview = multi
    ? paths.map((_, i) => `print(head(df${i + 1}))`).join('\n')
    : 'print(head(df))';

  return {
    python: `${PY_HEADER}
${pyLoads}

# 사용자 코딩

# 해당 화면에서는 제출하지 않으며, 문제 풀이 후 답안제출에서 결괏값 제출
${pyPreview}
`,
    r: `${R_HEADER}
${rLoads}

# 사용자 코딩

# 해당 화면에서는 제출하지 않으며, 문제 풀이 후 답안제출에서 결괏값 제출
${rPreview}
`,
  };
}

/**
 * Extract short-answer keys from author solution comments / print literals.
 * Used for type 1·3 only.
 */
export function extractShortAnswers(code: string): string[] {
  const lines = code.split(/\r?\n/);
  const found: string[] = [];
  const push = (v: string) => {
    const t = v.trim();
    if (!t) return;
    if (/TODO|print|round|filter|head|shape/i.test(t) && !/^[0-9]/.test(t)) {
      return;
    }
    if (!found.includes(t)) found.push(t);
  };

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    // Skip section headers like `#1`, `#2-1` (not answer keys).
    if (/^\s*#\s*\d+([-.]\d+)?\s*$/.test(line)) continue;
    const hashAnswer = line.match(
      /#\s*정답\s*[:：]?\s*([0-9]+(?:\.[0-9]+)?|[A-Za-z][A-Za-z0-9._-]*)\s*$/,
    );
    if (hashAnswer) {
      push(hashAnswer[1]);
      continue;
    }
    const hashNum = line.match(/#\s*([0-9]+(?:\.[0-9]+)?)\s*$/);
    if (hashNum) {
      push(hashNum[1]);
      continue;
    }
    const printLit = line.match(
      /print\(\s*['"]([^'"]+)['"]\s*\)\s*(?:#.*)?$/,
    );
    if (printLit) {
      push(printLit[1]);
      continue;
    }
    const printNum = line.match(/print\(\s*([0-9]+(?:\.[0-9]+)?)\s*\)\s*$/);
    if (printNum) {
      push(printNum[1]);
      continue;
    }
  }

  found.reverse();
  return found;
}

/**
 * When literal keys are missing, infer how many short-answer slots a solution
 * expects (e.g. `#1-1` / `print("2-1 답:"` style sub-questions).
 */
export function inferShortSlotCount(code: string): number {
  const markers = new Set<string>();
  for (const m of code.matchAll(/#\s*(\d+[-.]\d+)/g)) {
    markers.add(m[1].replace('.', '-'));
  }
  for (const m of code.matchAll(/["'`](\d+-\d+)\s*[:：]/g)) {
    markers.add(m[1]);
  }
  for (const m of code.matchAll(/\b(\d+-\d+)\s*답/g)) {
    markers.add(m[1]);
  }
  if (markers.size > 0) return markers.size;

  const prints = code.match(/^\s*print\s*\(/gm);
  if (prints && prints.length >= 1 && prints.length <= 8) {
    return prints.length;
  }
  return 1;
}

export function shortFieldsFor(
  taskType: TaskType,
  answerCode: CodeByLanguage,
  language: 'python' | 'r',
): { shortAnswer: string; shortAnswers?: string[] } {
  if (taskType === 2) {
    return { shortAnswer: '', shortAnswers: undefined };
  }
  const code = language === 'python' ? answerCode.python : answerCode.r;
  const answers = extractShortAnswers(code);
  if (!answers.length) {
    const n = Math.max(1, inferShortSlotCount(code));
    const blanks = Array.from({ length: n }, () => '');
    return { shortAnswer: '', shortAnswers: blanks };
  }
  return {
    shortAnswer: answers[0] ?? '',
    shortAnswers: answers,
  };
}

/**
 * Minimal type-2 grading scaffold (author can refine).
 * App scorer reads:
 *   ML_TYPE=classification|regression
 *   METRIC=auc|f1|accuracy|rmse|mae|...
 *   STUDENT=<examinee metric vs y_true>
 *   REF=<answer-model metric vs y_true>
 *   Y_SCALE=<optional std/IQR of y_true for regression>
 * Legacy aliases: SCORE=/EXPECTED= still work.
 */
export function defaultGradingCode(): CodeByLanguage {
  return {
    python: `import pandas as pd

# Type-2 scaffold — metric(y_true from data/test_label.csv, student pred)
# print("ML_TYPE=classification")  # or regression
# print("METRIC=auc")              # auc|f1|accuracy|rmse|mae|...
# print("STUDENT=0.85")
# print("REF=0.90")
# print("Y_SCALE=1.0")             # regression: std/IQR of target
try:
    y_true = pd.read_csv("data/test_label.csv")
except Exception:
    y_true = pd.read_csv("data/test_labels.csv")
pred = pd.read_csv("result.csv")
assert len(pred) > 0, "empty result.csv"
assert len(pred) == len(y_true), "pred rows != test_label rows"
print("rows", len(pred))
print("cols", list(pred.columns))
print(pred.head())
`,
    r: `# print("ML_TYPE=regression"); print("METRIC=rmse")
# print("STUDENT=0.12"); print("REF=0.10"); print("Y_SCALE=5")
y_true <- tryCatch(
  read.csv("data/test_label.csv"),
  error = function(e) read.csv("data/test_labels.csv")
)
pred <- read.csv("result.csv")
stopifnot(nrow(pred) > 0, nrow(pred) == nrow(y_true))
print(nrow(pred))
print(colnames(pred))
print(head(pred))
`,
  };
}

export function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function basenameLower(p: string): string {
  return path.basename(p).toLowerCase();
}
