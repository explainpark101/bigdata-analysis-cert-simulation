import type { ExamSet } from '@/types/exam';

export const SAMPLE_EXAM: ExamSet = {
  schemaVersion: 1,
  id: 'bigdata-knight-practice-v2',
  title: '빅데이터분석기사 실기 체험',
  description:
    '제1유형 단답 3문항 · 제2유형 ML(result.csv) · 제3유형 단답 2문항',
  timeLimitMinutes: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  quizzes: [
    {
      id: 't1-q1',
      number: '01',
      title: '제1유형 · 단답형 (1)',
      kind: 'submit',
      submitFormat: 'short',
      language: 'python',
      markdown: `## 제1유형 (1/3) — 단답형

주어진 시리즈에서 **중앙값(median)** 을 구하여 소수 첫째 자리까지 반올림해 출력하시오.

\`\`\`python
import pandas as pd
s = pd.Series([12, 7, 9, 15, 11, 8])
\`\`\`

제출 형식: 숫자 한 줄`,
      starterCode: {
        python: `import pandas as pd

s = pd.Series([12, 7, 9, 15, 11, 8])
# TODO: 중앙값 (소수 첫째 자리)
print(round(float(s.median()), 1))
`,
        r: `s <- c(12, 7, 9, 15, 11, 8)
print(round(median(s), 1))
`,
      },
      testCases: [{ id: 't1', name: 'median', expectIncludes: ['10'] }],
    },
    {
      id: 't1-q2',
      number: '02',
      title: '제1유형 · 단답형 (2)',
      kind: 'submit',
      submitFormat: 'short',
      language: 'python',
      markdown: `## 제1유형 (2/3) — 단답형

데이터프레임에서 **결측치가 하나라도 있는 행의 개수**를 정수로 출력하시오.

\`\`\`python
import pandas as pd
df = pd.DataFrame({
    "a": [1, None, 3, 4],
    "b": [5, 6, None, 8],
    "c": [9, 10, 11, 12],
})
\`\`\`

제출 형식: 정수 한 줄`,
      starterCode: {
        python: `import pandas as pd

df = pd.DataFrame({
    "a": [1, None, 3, 4],
    "b": [5, 6, None, 8],
    "c": [9, 10, 11, 12],
})
# TODO
print(int(df.isna().any(axis=1).sum()))
`,
        r: `df <- data.frame(
  a = c(1, NA, 3, 4),
  b = c(5, 6, NA, 8),
  c = c(9, 10, 11, 12)
)
print(sum(rowSums(is.na(df)) > 0))
`,
      },
      testCases: [{ id: 't1', name: 'na rows', expectIncludes: ['2'] }],
    },
    {
      id: 't1-q3',
      number: '03',
      title: '제1유형 · 단답형 (3)',
      kind: 'submit',
      submitFormat: 'short',
      language: 'python',
      markdown: `## 제1유형 (3/3) — 단답형

그룹 \`g\` 별 \`v\` 의 평균을 구한 뒤, **평균이 가장 큰 그룹 이름**을 출력하시오.

\`\`\`python
import pandas as pd
df = pd.DataFrame({
    "g": ["A", "A", "B", "B", "C", "C"],
    "v": [10, 14, 9, 11, 20, 18],
})
\`\`\`

제출 형식: 그룹명 한 줄 (예: \`C\`)`,
      starterCode: {
        python: `import pandas as pd

df = pd.DataFrame({
    "g": ["A", "A", "B", "B", "C", "C"],
    "v": [10, 14, 9, 11, 20, 18],
})
# TODO
print(df.groupby("g")["v"].mean().idxmax())
`,
        r: `df <- data.frame(
  g = c("A", "A", "B", "B", "C", "C"),
  v = c(10, 14, 9, 11, 20, 18)
)
means <- tapply(df$v, df$g, mean)
print(names(means)[which.max(means)])
`,
      },
      testCases: [{ id: 't1', name: 'group', expectIncludes: ['C'] }],
    },
    {
      id: 't2-ml',
      number: '04',
      title: '제2유형 · ML (result.csv)',
      kind: 'submit',
      submitFormat: 'csv',
      submitFile: 'result.csv',
      language: 'python',
      markdown: `## 제2유형 — 머신러닝 학습 후 제출

\`sklearn.ensemble\` (예: \`RandomForestClassifier\`) 등으로 학습한 뒤,
테스트 세트에 대한 예측 결과를 **\`result.csv\`** 로 저장하시오.

### 요구사항
1. 아래 생성 데이터를 사용 (또는 동일 시드로 재현)
2. \`train_test_split(..., test_size=0.3, random_state=42)\`
3. 예측 컬럼명: \`pred\`
4. 파일을 작업 디렉터리에 \`result.csv\` 로 저장 (\`index=False\`)
5. **제출** 시 \`result.csv\` 가 다운로드됩니다.

\`\`\`python
from sklearn.datasets import make_classification
X, y = make_classification(
    n_samples=300, n_features=10, n_informative=6, random_state=42
)
\`\`\`
`,
      starterCode: {
        python: `import pandas as pd
from sklearn.datasets import make_classification
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier

X, y = make_classification(
    n_samples=300, n_features=10, n_informative=6, random_state=42
)
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.3, random_state=42
)

model = RandomForestClassifier(n_estimators=100, random_state=42)
model.fit(X_train, y_train)
pred = model.predict(X_test)

result = pd.DataFrame({"pred": pred})
result.to_csv("result.csv", index=False)
print("saved result.csv", len(result))
print(result.head())
`,
        r: `# Type 2 sample is Python-oriented (result.csv + sklearn.ensemble)
print("Use Python3 for this item")
`,
      },
      testCases: [
        {
          id: 't1',
          name: 'saved csv',
          expectIncludes: ['result.csv'],
        },
      ],
    },
    {
      id: 't3-q1',
      number: '05',
      title: '제3유형 · 단답형 (1)',
      kind: 'submit',
      submitFormat: 'short',
      language: 'python',
      markdown: `## 제3유형 (1/2) — 단답형

정규분포 N(0,1) 에서 크기 200 표본을 뽑고 (\`numpy\` \`default_rng(0)\`),
**표본 표준편차**를 소수 넷째 자리까지 반올림해 출력하시오.

제출 형식: 숫자 한 줄`,
      starterCode: {
        python: `import numpy as np

rng = np.random.default_rng(0)
sample = rng.normal(loc=0, scale=1, size=200)
# TODO: 표본 표준편차 (ddof=1)
print(round(float(sample.std(ddof=1)), 4))
`,
        r: `set.seed(0)
sample <- rnorm(200, mean = 0, sd = 1)
print(round(sd(sample), 4))
`,
      },
    },
    {
      id: 't3-q2',
      number: '06',
      title: '제3유형 · 단답형 (2)',
      kind: 'submit',
      submitFormat: 'short',
      language: 'python',
      markdown: `## 제3유형 (2/2) — 단답형

두 독립표본에 대해 Welch t-검정(\`scipy.stats.ttest_ind\`, \`equal_var=False\`)을 수행하고
**p-value** 를 소수 넷째 자리까지 출력하시오.

\`\`\`python
a = [1.1, 1.3, 1.2, 1.4, 1.5]
b = [1.8, 1.9, 2.0, 1.7, 2.2]
\`\`\`

제출 형식: 숫자 한 줄`,
      starterCode: {
        python: `from scipy import stats
import numpy as np

a = np.array([1.1, 1.3, 1.2, 1.4, 1.5])
b = np.array([1.8, 1.9, 2.0, 1.7, 2.2])
_, p = stats.ttest_ind(a, b, equal_var=False)
print(round(float(p), 4))
`,
        r: `a <- c(1.1, 1.3, 1.2, 1.4, 1.5)
b <- c(1.8, 1.9, 2.0, 1.7, 2.2)
print(round(t.test(a, b)$p.value, 4))
`,
      },
    },
  ],
};
