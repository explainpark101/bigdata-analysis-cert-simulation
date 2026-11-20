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

function pickTrainPath(paths: string[]): string | undefined {
  const data = paths.filter(isDataPath);
  const scored = data
    .map((p) => {
      const b = assetBasename(p).toLowerCase();
      if (!b.includes('train') || b.includes('test')) return null;
      let score = 10;
      if (/^y[_-]?train\.csv$/.test(b)) score = 1;
      else if (/^x[_-]?train\.csv$/.test(b)) score = 8;
      else if (/_train\.csv$/.test(b)) score = 9;
      return { p, score };
    })
    .filter((x): x is { p: string; score: number } => x != null)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.p;
}

function pickTestPath(paths: string[]): string | undefined {
  const data = paths.filter(isDataPath);
  const scored = data
    .map((p) => {
      const b = assetBasename(p).toLowerCase();
      if (!b.includes('test') || b.includes('train')) return null;
      let score = 10;
      if (/^x[_-]?test\.csv$/.test(b)) score = 9;
      else if (/_test\.csv$/.test(b)) score = 8;
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
    const hashNum = line.match(/#\s*([0-9]+(?:\.[0-9]+)?)\s*$/);
    if (hashNum) {
      push(hashNum[1]);
      continue;
    }
    const hashToken = line.match(
      /#\s*(정답\s*[:：]?\s*)?([0-9]+(?:\.[0-9]+)?|[A-Za-z])\s*$/,
    );
    if (hashToken) {
      push(hashToken[2]);
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
    return { shortAnswer: '', shortAnswers: [''] };
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

# Type-2 scaffold — replace with real metric(y_true, pred) vs answer model
# print("ML_TYPE=classification")  # or regression
# print("METRIC=auc")              # auc|f1|accuracy|rmse|mae|...
# print("STUDENT=0.85")
# print("REF=0.90")
# print("Y_SCALE=1.0")             # regression: std/IQR of target
pred = pd.read_csv("result.csv")
assert len(pred) > 0, "empty result.csv"
print("rows", len(pred))
print("cols", list(pred.columns))
print(pred.head())
`,
    r: `# print("ML_TYPE=regression"); print("METRIC=rmse")
# print("STUDENT=0.12"); print("REF=0.10"); print("Y_SCALE=5")
pred <- read.csv("result.csv")
stopifnot(nrow(pred) > 0)
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
