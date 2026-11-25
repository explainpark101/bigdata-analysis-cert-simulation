/**
 * Detect / normalize 소문항 (sub-questions) for type-1/3 bank items.
 * Exam assemble builds one short-answer input per entry returned here.
 */

import type { TaskType } from '@/types/project';
import { clampSubQuestionCount } from '@/lib/examOfficialSpec';

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩';
const CIRCLED_TO_N: Record<string, number> = {
  '①': 1,
  '②': 2,
  '③': 3,
  '④': 4,
  '⑤': 5,
  '⑥': 6,
  '⑦': 7,
  '⑧': 8,
  '⑨': 9,
  '⑩': 10,
};

function looksNumericToken(raw: string): boolean {
  const s = String(raw ?? '').trim();
  if (!s || /[,\s]/.test(s)) return false;
  return /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(s);
}

/**
 * Expand packed short-answer values.
 * Models sometimes pass ["1.0\\n2.0\\n3.0"] or "1.0, 2.0, 3.0" as one entry —
 * those must become three slots on the exam submit page.
 */
export function expandPackedShortAnswers(answers: string[]): string[] {
  const out: string[] = [];
  for (const raw of answers) {
    const s = String(raw ?? '').trim();
    if (!s) {
      out.push('');
      continue;
    }
    if (!/[\n\r,]/.test(s)) {
      out.push(s);
      continue;
    }
    const parts = s
      .split(/[\n\r,]+/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length > 1 && parts.every((p) => looksNumericToken(p))) {
      out.push(...parts);
    } else {
      out.push(s);
    }
  }
  return out.length ? out : [''];
}

/**
 * Count sub-question markers in problem markdown (uncapped).
 * Line-oriented markers with optional list / emphasis prefixes.
 */
export function countSubQuestionsInMarkdown(markdown: string): number {
  const text = String(markdown ?? '').replace(/\r\n/g, '\n');
  if (!text.trim()) return 1;

  const circled = new Set<number>();
  // e.g. "① …", "- ① …", "**①** …", "1) ① …"
  for (const m of text.matchAll(
    new RegExp(
      `(?:^|\\n)\\s*(?:[-*•]|\\d+[.)])?\\s*(?:\\*{1,2}|_{1,2})?\\s*([${CIRCLED}])`,
      'g',
    ),
  )) {
    const n = CIRCLED_TO_N[m[1]];
    if (n) circled.add(n);
  }

  const numbered = new Set<number>();
  // e.g. "(1) …", "- (2) …", "**(3)** …"
  for (const m of text.matchAll(
    /(?:^|\n)\s*(?:[-*•])?\s*(?:\*{1,2}|_{1,2})?\s*[\(（]\s*([1-9])\s*[\)）]/g,
  )) {
    numbered.add(Number(m[1]));
  }
  // Same-line runs: "… (1) 평균 (2) 분산 (3) 표준편차"
  for (const m of text.matchAll(/[\(（]\s*([1-9])\s*[\)）]/g)) {
    const n = Number(m[1]);
    // Ignore likely score tags like "(10점)" — already excluded by [1-9] alone.
    numbered.add(n);
  }

  const hangul = new Set<string>();
  for (const m of text.matchAll(
    /(?:^|\n)\s*(?:[-*•])?\s*([가나다라마바사])\s*[\.．\)]\s+\S/g,
  )) {
    hangul.add(m[1]);
  }

  // "소문항 1" / "소문항①" / "문항 (2)"
  const labeled = new Set<number>();
  for (const m of text.matchAll(
    /(?:소)?문항\s*[#(（]?\s*([1-9]|[①②③④⑤⑥⑦⑧⑨⑩])/gi,
  )) {
    const raw = m[1];
    const n = CIRCLED_TO_N[raw] ?? Number(raw);
    if (n >= 1 && n <= 10) labeled.add(n);
  }

  const n = Math.max(
    circled.size,
    numbered.size,
    hangul.size,
    labeled.size,
    0,
  );
  // Require ≥2 distinct markers before treating as multi-소문항.
  // If markers are ①③ (size 2) but max index is 3, prefer max index when contiguous enough.
  const maxIdx = Math.max(
    circled.size ? Math.max(...circled) : 0,
    numbered.size ? Math.max(...numbered) : 0,
    labeled.size ? Math.max(...labeled) : 0,
    0,
  );
  if (n >= 2) {
    // Contiguous ①②③ → 3; sparse ①④ → use set size (safer than inventing ②③).
    if (maxIdx >= 2 && maxIdx <= 10 && maxIdx - n <= 1) return maxIdx;
    return n;
  }
  return 1;
}

/** Count 소문항 in markdown, clamped to the official max for the task type. */
export function countSubQuestionsForType(
  markdown: string,
  taskType: TaskType | undefined,
): number {
  return clampSubQuestionCount(taskType, countSubQuestionsInMarkdown(markdown));
}

/**
 * Expected short-answer keys for one bank item (= one input field each on 문제 풀이).
 *
 * Slot count = max(
 *   expanded authored shortAnswers / shortAnswer,
 *   markdown 소문항 markers
 * ) clamped to type caps (type1≤5, type3≤3).
 */
export function ensureShortAnswersForSubQuestions(
  markdown: string,
  shortAnswers: string[] | undefined,
  shortAnswer?: string,
  taskType?: TaskType,
): string[] {
  let base: string[];
  if (Array.isArray(shortAnswers) && shortAnswers.length > 0) {
    base = expandPackedShortAnswers(shortAnswers.map((s) => String(s ?? '')));
  } else if (shortAnswer != null && String(shortAnswer).length > 0) {
    base = expandPackedShortAnswers([String(shortAnswer)]);
  } else {
    base = [''];
  }

  const need = countSubQuestionsForType(markdown, taskType);
  const target = clampSubQuestionCount(
    taskType,
    Math.max(base.length, need),
  );
  if (base.length > target) return base.slice(0, target);
  if (base.length >= target) return base;
  return [...base, ...Array.from({ length: target - base.length }, () => '')];
}
