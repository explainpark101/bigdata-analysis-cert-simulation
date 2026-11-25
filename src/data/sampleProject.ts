import type { AuthoringProject } from '@/types/project';
import {
  SAMPLE_CUSTOMER_TEST_CSV,
  SAMPLE_CUSTOMER_TRAIN_CSV,
  SAMPLE_STD_CSV,
  SAMPLE_TTEST_CSV,
  SAMPLE_TYPE1_CSV,
} from './sampleCsv';

const TYPE1_ID = 'asset-type1';
const TRAIN_ID = 'asset-train';
const TEST_ID = 'asset-test';
const STD_ID = 'asset-std';
const TTEST_ID = 'asset-ttest';

const TYPE1_STARTER = {
  python: `# 출력을 원할 경우 print() 함수 활용
# 예시) print(df.head())

# getcwd(), chdir() 등 작업 폴더 설정 불필요
# 파일 경로 상 내부 드라이브 경로(C: 등) 접근 불가

import pandas as pd

df = pd.read_csv("data/type1_exam.csv")

# 사용자 코딩

# 해당 화면에서는 제출하지 않으며, 문제 풀이 후 답안제출에서 결괏값 제출
print(df.head())
`,
  r: `# 출력을 원할 경우 print() 함수 활용
# 예시) print(head(df))

# setwd(), getwd() 등 작업 폴더 설정 불필요
# 파일 경로 상 내부 드라이브 경로(C: 등) 접근 불가

df = read.csv("data/type1_exam.csv")

# 사용자 코딩

# 해당 화면에서는 제출하지 않으며, 문제 풀이 후 답안제출에서 결괏값 제출
print(head(df))
`,
};

export const SAMPLE_PROJECT: AuthoringProject = {
  schemaVersion: 1,
  kind: 'project',
  id: 'bigdata-knight-project-v1',
  title: '빅데이터분석기사 실기 프로젝트',
  description: 'CSV 라이브러리 + 문제은행 → 시험 세트로보내기',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  assets: [
    {
      id: TYPE1_ID,
      path: 'data/type1/type1_exam.csv',
      name: 'type1_exam.csv',
      encoding: 'utf-8',
      content: SAMPLE_TYPE1_CSV,
      mimeType: 'text/csv',
    },
    {
      id: TRAIN_ID,
      path: 'data/type2/customer_train.csv',
      name: 'customer_train.csv',
      encoding: 'utf-8',
      content: SAMPLE_CUSTOMER_TRAIN_CSV,
      mimeType: 'text/csv',
    },
    {
      id: TEST_ID,
      path: 'data/type2/customer_test.csv',
      name: 'customer_test.csv',
      encoding: 'utf-8',
      content: SAMPLE_CUSTOMER_TEST_CSV,
      mimeType: 'text/csv',
    },
    {
      id: STD_ID,
      path: 'data/type3/sample_std.csv',
      name: 'sample_std.csv',
      encoding: 'utf-8',
      content: SAMPLE_STD_CSV,
      mimeType: 'text/csv',
    },
    {
      id: TTEST_ID,
      path: 'data/type3/welch_ttest.csv',
      name: 'welch_ttest.csv',
      encoding: 'utf-8',
      content: SAMPLE_TTEST_CSV,
      mimeType: 'text/csv',
    },
  ],
  bank: [
    {
      id: 't1-q1',
      number: '01',
      taskType: 1,
      title: '중앙값 단답',
      note: '샘플 · type1_exam.csv (1/3)',
      showNoteOnExam: false,
      kind: 'submit',
      submitFormat: 'short',
      language: 'python',
      assetIds: [TYPE1_ID],
      markdown: `## 문제 1. (10점)

제공된 \`data/type1_exam.csv\` 의 \`value\` 컬럼 **중앙값(median)** 을
소수 첫째 자리까지 반올림해 구하시오.

**[제출 형식]** 반올림하여 소수점 첫째 자리까지 작성`,
      starterCode: TYPE1_STARTER,
      answerCode: {
        python: `import pandas as pd
df = pd.read_csv("data/type1_exam.csv")
print(round(float(df["value"].median()), 1))
`,
        r: `df <- read.csv("data/type1_exam.csv")
print(round(median(df$value), 1))
`,
      },
      shortAnswer: '11.0',
      testCases: [{ id: 't1', name: 'median', expectIncludes: ['11'] }],
    },
    {
      id: 't1-q2',
      number: '02',
      taskType: 1,
      title: '결측 행 개수',
      note: '샘플 · type1_exam.csv (2/3)',
      showNoteOnExam: false,
      kind: 'submit',
      submitFormat: 'short',
      language: 'python',
      assetIds: [TYPE1_ID],
      markdown: `## 문제 2. (10점)

제공된 \`data/type1_exam.csv\` 에서 **하나라도 결측이 있는 행**의 개수를 구하시오.

**[제출 형식]** 정수로 작성 (소수점 이하는 절사)`,
      starterCode: TYPE1_STARTER,
      answerCode: {
        python: `import pandas as pd
df = pd.read_csv("data/type1_exam.csv")
print(int(df.isna().any(axis=1).sum()))
`,
        r: `df <- read.csv("data/type1_exam.csv", na.strings = c("", "NA"))
print(sum(!complete.cases(df)))
`,
      },
      shortAnswer: '2',
      testCases: [{ id: 't1', name: 'na', expectIncludes: ['2'] }],
    },
    {
      id: 't1-q3',
      number: '03',
      taskType: 1,
      title: '그룹 평균 최댓값',
      note: '샘플 · type1_exam.csv (3/3)',
      showNoteOnExam: false,
      kind: 'submit',
      submitFormat: 'short',
      language: 'python',
      assetIds: [TYPE1_ID],
      markdown: `## 문제 3. (10점)

제공된 \`data/type1_exam.csv\` 에서 그룹(\`group\`)별 \`value\` 평균 중
**가장 큰 평균값**을 구하시오.

**[제출 형식]** 반올림하여 소수점 첫째 자리까지 작성`,
      starterCode: TYPE1_STARTER,
      answerCode: {
        python: `import pandas as pd
df = pd.read_csv("data/type1_exam.csv")
print(round(float(df.groupby("group")["value"].mean().max()), 1))
`,
        r: `df <- read.csv("data/type1_exam.csv")
m <- aggregate(value ~ group, data = df, FUN = mean)
print(round(max(m$value), 1))
`,
      },
      shortAnswer: '13.0',
      testCases: [{ id: 't1', name: 'gmax', expectIncludes: ['13'] }],
    },
    {
      id: 't2-ml',
      number: '04',
      taskType: 2,
      title: '고객 총구매액 예측',
      note: '샘플 · customer_train/test → result.csv',
      showNoteOnExam: true,
      kind: 'submit',
      submitFormat: 'csv',
      submitFile: 'result.csv',
      language: 'python',
      assetIds: [TRAIN_ID, TEST_ID],
      markdown: `## 제2유형

제공된 \`data/customer_train.csv\` / \`data/customer_test.csv\` 로 총구매액(\`total_purchase\`)을 예측하고
\`result.csv\` (\`pred\` 컬럼 1개, index 제거) 을 제출하시오.

파일 경로 상 내부 드라이브(C: 등) 접근 불가.

### 채점 (제13회 가이드 · 구간별 5점 단위)
- 평가지표: 기준 모델 예측 대비 **RMSE** (낮을수록 우수), 만점 40점
- 제출 형식 위반 시 구간 점수에서 각 3점 감점(누적)

| RMSE 구간 | 점수 |
|-----------|------|
| ≤ 8 | 40 |
| ≤ 12 | 35 |
| ≤ 16 | 30 |
| ≤ 22 | 25 |
| ≤ 30 | 20 |
| ≤ 40 | 15 |
| ≤ 55 | 10 |
| ≤ 75 | 5 |
| > 75 | 0 |
`,
      starterCode: {
        python: `# 출력을 원할 경우 print() 함수 활용
# 예시) print(df.head())

# getcwd(), chdir() 등 작업 폴더 설정 불필요
# 파일 경로 상 내부 드라이브 경로(C: 등) 접근 불가

import pandas as pd

train = pd.read_csv("data/customer_train.csv")
test = pd.read_csv("data/customer_test.csv")

# 사용자 코딩

# 예측 결과는 result.csv 로 저장한 뒤 제출 버튼을 사용하세요
print(train.head())
`,
        r: `# 출력을 원할 경우 print() 함수 활용
# 예시) print(head(df))

# setwd(), getwd() 등 작업 폴더 설정 불필요
# 파일 경로 상 내부 드라이브 경로(C: 등) 접근 불가

train = read.csv("data/customer_train.csv")
test = read.csv("data/customer_test.csv")

# 사용자 코딩

# 예측 결과는 result.csv 로 저장한 뒤 제출 버튼을 사용하세요
print(head(train))
`,
      },
      answerCode: {
        python: `import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.preprocessing import LabelEncoder

train = pd.read_csv("data/customer_train.csv")
test = pd.read_csv("data/customer_test.csv")
y = train["total_purchase"]
X = train.drop(columns=["total_purchase", "id"])
X_test = test.drop(columns=["id"])
for col in ["gender"]:
    le = LabelEncoder()
    X[col] = le.fit_transform(X[col].astype(str))
    X_test[col] = le.transform(X_test[col].astype(str))
model = RandomForestRegressor(n_estimators=80, random_state=42)
model.fit(X, y)
pd.DataFrame({"pred": model.predict(X_test)}).to_csv("result.csv", index=False)
print("saved result.csv")
`,
        r: `train <- read.csv("data/customer_train.csv")
print(nrow(train))
`,
      },
      gradingCode: {
        python: `"""
Type-2 grading reference (regression / RMSE)
- Answer model: RandomForestRegressor(n_estimators=80, random_state=42)
- Test has no labels → compare student pred to answer-model pred
- Print ML_TYPE / METRIC / STUDENT / REF / Y_SCALE for the app scorer
"""
import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.preprocessing import LabelEncoder
from sklearn.metrics import mean_absolute_error, mean_squared_error

train = pd.read_csv("data/customer_train.csv")
test = pd.read_csv("data/customer_test.csv")
y = train["total_purchase"]
X = train.drop(columns=["total_purchase", "id"])
X_test = test.drop(columns=["id"])
for col in ["gender"]:
    le = LabelEncoder()
    X[col] = le.fit_transform(X[col].astype(str))
    X_test[col] = le.transform(X_test[col].astype(str))

ref = RandomForestRegressor(n_estimators=80, random_state=42)
ref.fit(X, y)
ref_pred = ref.predict(X_test)

sub = pd.read_csv("result.csv")
if "pred" not in sub.columns:
    raise SystemExit("FAIL: result.csv must contain column 'pred'")
pred = sub["pred"].to_numpy(dtype=float)
if len(pred) != len(ref_pred):
    raise SystemExit(f"FAIL: pred length {len(pred)} != {len(ref_pred)}")

# Error vs answer-model predictions (REF=0 means identical to answer)
student_rmse = float(np.sqrt(mean_squared_error(ref_pred, pred)))
student_mae = float(mean_absolute_error(ref_pred, pred))
y_scale = float(np.std(y, ddof=1)) if len(y) > 1 else float(np.std(ref_pred))

print("ML_TYPE=regression")
print("METRIC=rmse")
print(f"STUDENT={student_rmse:.6f}")
print("REF=0")
print(f"Y_SCALE={y_scale:.6f}")
# 제13회: 평가지표 구간별 5점 단위 (markdown 구간표와 동일)
print("SCORE_BANDS=8:40,12:35,16:30,22:25,30:20,40:15,55:10,75:5")
print(f"METRIC_MAE={student_mae:.6f}")
print(f"REF_MODEL=RandomForestRegressor(n_estimators=80, random_state=42)")
`,
        r: `# Type-2 grading (R sketch): compare result.csv pred length to test rows
train <- read.csv("data/customer_train.csv")
test <- read.csv("data/customer_test.csv")
sub <- read.csv("result.csv")
stopifnot("pred" %in% names(sub))
print("ML_TYPE=regression")
print("METRIC=rmse")
print(paste("n_test", nrow(test), "n_pred", length(sub$pred)))
`,
      },
    },
    {
      id: 't3-q1',
      number: '05',
      taskType: 3,
      title: '표본 표준편차',
      note: '샘플 · sample_std.csv',
      showNoteOnExam: false,
      kind: 'submit',
      submitFormat: 'short',
      language: 'python',
      assetIds: [STD_ID],
      markdown: `## 문제 1. (10점)

제공된 \`data/sample_std.csv\` 의 \`x\` 컬럼 **표본 표준편차**(ddof=1)를
소수 넷째 자리까지 반올림해 구하시오.

**[제출 형식]** 반올림하여 소수점 넷째 자리까지 작성`,
      starterCode: {
        python: `# 출력을 원할 경우 print() 함수 활용
# 예시) print(df.head())

# getcwd(), chdir() 등 작업 폴더 설정 불필요
# 파일 경로 상 내부 드라이브 경로(C: 등) 접근 불가

import pandas as pd

df = pd.read_csv("data/sample_std.csv")

# 사용자 코딩

# 해당 화면에서는 제출하지 않으며, 문제 풀이 후 답안제출에서 결괏값 제출
print(df.head())
`,
        r: `# 출력을 원할 경우 print() 함수 활용
# 예시) print(head(df))

# setwd(), getwd() 등 작업 폴더 설정 불필요
# 파일 경로 상 내부 드라이브 경로(C: 등) 접근 불가

df = read.csv("data/sample_std.csv")

# 사용자 코딩

# 해당 화면에서는 제출하지 않으며, 문제 풀이 후 답안제출에서 결괏값 제출
print(head(df))
`,
      },
      answerCode: {
        python: `import pandas as pd
df = pd.read_csv("data/sample_std.csv")
print(round(float(df["x"].std(ddof=1)), 4))
`,
        r: `df <- read.csv("data/sample_std.csv")
print(round(sd(df$x), 4))
`,
      },
      shortAnswer: '1.5811',
      testCases: [{ id: 't1', name: 'std', expectIncludes: ['1.5811'] }],
    },
    {
      id: 't3-q2',
      number: '06',
      taskType: 3,
      title: 'Welch t-test p-value',
      note: '샘플 · welch_ttest.csv',
      showNoteOnExam: false,
      kind: 'submit',
      submitFormat: 'short',
      language: 'python',
      assetIds: [TTEST_ID],
      markdown: `## 문제 2. (10점)

제공된 \`data/welch_ttest.csv\` 에서 그룹 A와 B의 \`value\`에 대해
Welch t-test (\`equal_var=False\`) **p-value**를 소수 넷째 자리까지 반올림해 구하시오.

**[제출 형식]** 반올림하여 소수점 넷째 자리까지 작성`,
      starterCode: {
        python: `# 출력을 원할 경우 print() 함수 활용
# 예시) print(df.head())

# getcwd(), chdir() 등 작업 폴더 설정 불필요
# 파일 경로 상 내부 드라이브 경로(C: 등) 접근 불가

import pandas as pd

df = pd.read_csv("data/welch_ttest.csv")

# 사용자 코딩

# 해당 화면에서는 제출하지 않으며, 문제 풀이 후 답안제출에서 결괏값 제출
print(df.head())
`,
        r: `# 출력을 원할 경우 print() 함수 활용
# 예시) print(head(df))

# setwd(), getwd() 등 작업 폴더 설정 불필요
# 파일 경로 상 내부 드라이브 경로(C: 등) 접근 불가

df = read.csv("data/welch_ttest.csv")

# 사용자 코딩

# 해당 화면에서는 제출하지 않으며, 문제 풀이 후 답안제출에서 결괏값 제출
print(head(df))
`,
      },
      answerCode: {
        python: `import pandas as pd
from scipy import stats

df = pd.read_csv("data/welch_ttest.csv")
a = df.loc[df["group"] == "A", "value"]
b = df.loc[df["group"] == "B", "value"]
print(round(float(stats.ttest_ind(a, b, equal_var=False).pvalue), 4))
`,
        r: `df <- read.csv("data/welch_ttest.csv")
a <- df$value[df$group == "A"]
b <- df$value[df$group == "B"]
print(round(t.test(a, b)$p.value, 4))
`,
      },
      shortAnswer: '',
      testCases: [{ id: 't1', name: 'pval', expectIncludes: ['0.'] }],
    },
  ],
  exams: [
    {
      id: 'bigdata-knight-exam-v1',
      title: '빅데이터분석기사 실기 체험',
      description:
        '제13회 가이드 공식 구성(1유형 3·2유형 1·3유형 2 = 6문항 / 100점)',
      timeLimitMinutes: 180,
      maxRunSeconds: 60,
      problemIds: ['t1-q1', 't1-q2', 't1-q3', 't2-ml', 't3-q1', 't3-q2'],
    },
    {
      id: 'bigdata-knight-exam-type1',
      title: '제1유형만 연습',
      description: '작업형 1유형 단답 연습 (비공식·연습용)',
      timeLimitMinutes: 180,
      maxRunSeconds: 60,
      problemIds: ['t1-q1', 't1-q2', 't1-q3'],
    },
  ],
  activeExamId: 'bigdata-knight-exam-v1',
};
