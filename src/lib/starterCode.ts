import type { CodeByLanguage } from '@/types/exam';
import type { TaskType } from '@/types/project';
import { assetBasename } from '@/lib/assetPaths';
import { isType2LabelCsv } from '@/lib/type2Assets';

function isDataPath(path: string): boolean {
  return !/\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(path);
}

function csvBasename(path: string): string | null {
  const b = assetBasename(path).toLowerCase();
  return b.endsWith('.csv') ? b : null;
}

/**
 * Prefer main train file among provided paths.
 * Priority: basename starts with `train` → `*_train.csv` → contains "train"
 * (excludes obvious test files; demotes x_train / y_train).
 */
export function pickTrainPath(paths: string[]): string | undefined {
  const data = paths.filter(isDataPath);
  const scored = data
    .map((p) => {
      const b = csvBasename(p);
      if (!b) return null;
      // Pure test files (start with test / *_test) are never train.
      if (b.startsWith('test') || /_test\.csv$/.test(b)) return null;

      let score = 0;
      if (b.startsWith('train')) score = 100;
      else if (/_train\.csv$/.test(b)) score = 50;
      else return null;

      if (b === 'train.csv') score = 110;

      // Feature/label split helpers — not the main train table.
      if (/^y[_-]?train\.csv$/.test(b)) score = 10;
      else if (/^x[_-]?train\.csv$/.test(b)) score = 40;

      return { p, score };
    })
    .filter((x): x is { p: string; score: number } => x != null)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.p;
}

/**
 * Prefer main test file among provided paths.
 * Priority: basename starts with `test` → `*_test.csv`
 * (excludes train files; avoids false positives like welch_ttest.csv).
 */
export function pickTestPath(paths: string[]): string | undefined {
  const data = paths.filter(isDataPath);
  const scored = data
    .map((p) => {
      const b = csvBasename(p);
      if (!b) return null;
      // Grading-only labels must never be treated as the examinee test CSV.
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

/**
 * Exam/project starter templates (DataQ-style).
 * - Type 1·3 → `df` + head preview
 * - Type 2 → `train` / `test` (basename starts with train/test, or *_train/*_test)
 */
export function buildStarterCode(
  taskType: TaskType,
  filePaths: string[],
): CodeByLanguage {
  const data = filePaths.filter(isDataPath);

  if (taskType === 2) {
    const byBase = (re: RegExp) =>
      data.find((p) => {
        const b = csvBasename(p);
        return b != null && re.test(b);
      });
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
# 예: write.csv(data.frame(pred = pred), "result.csv", row.names = FALSE)

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
    // DataQ comment uses print(df.head()); R runtime needs print(head(df)).
    r: `${R_HEADER}
${rLoads}

# 사용자 코딩

# 해당 화면에서는 제출하지 않으며, 문제 풀이 후 답안제출에서 결괏값 제출
${rPreview}
`,
  };
}
