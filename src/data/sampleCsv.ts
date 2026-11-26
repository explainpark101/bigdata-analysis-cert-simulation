/** Small synthetic CSVs for sample bank problems (all questions load from data/*.csv). */

function rowsToCsv(header: string[], rows: Array<Array<string | number>>): string {
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(row.map((c) => String(c)).join(','));
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Type1 shared CSV — three short-answer questions on one file.
 * Q1 median(value) → 11.0
 * Q2 rows with any NA → 2
 * Q3 max group mean(value) → 13.0
 */
export const SAMPLE_TYPE1_CSV = rowsToCsv(
  ['group', 'value', 'score'],
  [
    ['A', 12, 1],
    ['A', 7, ''],
    ['B', 9, 2],
    ['B', 15, 3],
    ['C', 11, ''],
    ['C', 8, 4],
    ['C', 20, 5],
  ],
);

/** @deprecated Prefer SAMPLE_TYPE1_CSV */
export const SAMPLE_MEDIAN_CSV = SAMPLE_TYPE1_CSV;
/** @deprecated Prefer SAMPLE_TYPE1_CSV */
export const SAMPLE_MISSING_CSV = SAMPLE_TYPE1_CSV;
/** @deprecated Prefer SAMPLE_TYPE1_CSV */
export const SAMPLE_GROUP_CSV = SAMPLE_TYPE1_CSV;

/** Type2 train: 40 rows with target total_purchase */
export const SAMPLE_CUSTOMER_TRAIN_CSV = rowsToCsv(
  [
    'id',
    'gender',
    'age_group',
    'visit_count',
    'avg_purchase',
    'total_purchase',
  ],
  Array.from({ length: 40 }, (_, i) => {
    const visit = 2 + (i % 12);
    const avg = 20 + (i % 15) * 3;
    const total = visit * avg + (i % 7);
    return [
      i + 1,
      i % 2 === 0 ? 'M' : 'F',
      20 + (i % 5) * 10,
      visit,
      avg,
      total,
    ];
  }),
);

/** Type2 test: 12 rows without target (predict → result.csv) */
export const SAMPLE_CUSTOMER_TEST_CSV = rowsToCsv(
  ['id', 'gender', 'age_group', 'visit_count', 'avg_purchase'],
  Array.from({ length: 12 }, (_, i) => {
    const visit = 3 + (i % 8);
    const avg = 25 + (i % 10) * 2;
    return [1001 + i, i % 2 === 0 ? 'F' : 'M', 30 + (i % 4) * 10, visit, avg];
  }),
);

/** Type2 hidden labels for test rows (grading only; not shown to examinees). */
export const SAMPLE_CUSTOMER_TEST_LABEL_CSV = rowsToCsv(
  ['id', 'total_purchase'],
  Array.from({ length: 12 }, (_, i) => {
    const visit = 3 + (i % 8);
    const avg = 25 + (i % 10) * 2;
    const total = visit * avg + (i % 7);
    return [1001 + i, total];
  }),
);

/** Type3-1: sample std (ddof=1), rounded 4 decimals → 1.5811 */
export const SAMPLE_STD_CSV = rowsToCsv(
  ['x'],
  [[1], [2], [3], [4], [5]],
);

/** Type3-2: Welch t-test two groups */
export const SAMPLE_TTEST_CSV = rowsToCsv(
  ['group', 'value'],
  [
    ['A', 1.1],
    ['A', 1.3],
    ['A', 1.2],
    ['A', 1.4],
    ['A', 1.5],
    ['B', 1.8],
    ['B', 1.9],
    ['B', 2.0],
    ['B', 1.7],
    ['B', 2.2],
  ],
);
