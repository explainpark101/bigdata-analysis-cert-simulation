import { assetBasename } from '@/lib/assetPaths';
import type { ExamAsset } from '@/types/exam';

/** Canonical grading-only label file for type-2 (hidden from examinees). */
export const TYPE2_LABEL_BASENAME = 'test_label.csv';

/**
 * True for `test_label.csv` / `test_labels.csv` and hash-suffixed variants
 * (`test_label_ab12cd34.csv`). Not `test.csv` / `customer_test.csv`.
 */
export function isType2LabelCsv(pathOrName: string): boolean {
  const b = assetBasename(pathOrName).toLowerCase();
  return /^test_labels?(?:_|\.csv$)/.test(b);
}

/** Examinee-visible / code-mount data files (excludes grading-only labels). */
export function examineeDataFiles<T extends { path: string; name?: string }>(
  files: T[] | undefined | null,
): T[] {
  return (files ?? []).filter(
    (f) => !isType2LabelCsv(f.path) && !isType2LabelCsv(f.name ?? ''),
  );
}

/** Alias paths so grading scripts can use singular/plural ± data/ prefix. */
export function type2LabelAliasPaths(primaryPath: string): string[] {
  const contentName = assetBasename(primaryPath);
  const aliases = new Set<string>([
    primaryPath.replace(/\\/g, '/'),
    `data/${contentName}`,
    `data/${TYPE2_LABEL_BASENAME}`,
    'data/test_labels.csv',
    TYPE2_LABEL_BASENAME,
    'test_labels.csv',
  ]);
  return [...aliases];
}

/** Pick the grading label asset from quiz files, if any. */
export function findType2LabelAsset(
  files: ExamAsset[] | undefined | null,
): ExamAsset | undefined {
  return (files ?? []).find((f) => isType2LabelCsv(f.path) || isType2LabelCsv(f.name));
}
