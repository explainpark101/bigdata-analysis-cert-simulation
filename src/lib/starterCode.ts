import type { CodeByLanguage } from '@/types/exam';
import type { TaskType } from '@/types/project';
import { assetBasename } from '@/lib/assetPaths';

function isDataPath(path: string): boolean {
  return !/\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(path);
}

/** Prefer main train file (not y_train) among provided paths. */
export function pickTrainPath(paths: string[]): string | undefined {
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

export function pickTestPath(paths: string[]): string | undefined {
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

/**
 * Exam/project starter templates (DataQ-style).
 * - Type 1·3 → `df` + head preview
 * - Type 2 → `train` / `test`
 */
export function buildStarterCode(
  taskType: TaskType,
  filePaths: string[],
): CodeByLanguage {
  const data = filePaths.filter(isDataPath);

  if (taskType === 2) {
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

  const path = data[0] ?? 'data/data.csv';
  return {
    python: `${PY_HEADER}
df = pd.read_csv("${path}")

# 사용자 코딩

# 해당 화면에서는 제출하지 않으며, 문제 풀이 후 답안제출에서 결괏값 제출
print(df.head())
`,
    // DataQ comment uses print(df.head()); R runtime needs print(head(df)).
    r: `${R_HEADER}
df = read.csv("${path}")

# 사용자 코딩

# 해당 화면에서는 제출하지 않으며, 문제 풀이 후 답안제출에서 결괏값 제출
print(head(df))
`,
  };
}
