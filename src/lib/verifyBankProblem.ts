import {
  type2CsvDataColumns,
  type2CsvHasIndexHeader,
} from '@/lib/examGrade';
import { readExamResultCsv } from '@/lib/examResultFile';
import { resolveAssets } from '@/lib/projectIO';
import { withRuntimeLock } from '@/lib/runtimeMutex';
import { shortAnswersEqual } from '@/lib/shortAnswerMatch';
import { ensureShortAnswersForSubQuestions } from '@/lib/subQuestions';
import { mountAssetsToPyodide } from '@/runtimes/fsMount';
import { preloadPyodide, runPython } from '@/runtimes/pyodideRuntime';
import { preloadWebR, runR } from '@/runtimes/webrRuntime';
import type { AuthoringProject, BankProblem } from '@/types/project';

export type BankProblemVerifyResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  expected: string[];
  got: string[];
  /** null when type-2 / CSV submit (no short-answer compare). */
  match: boolean | null;
  needsAiReview: boolean;
  reason: string;
};

function expectedShorts(problem: BankProblem): string[] {
  if (problem.taskType === 2 || problem.submitFormat === 'csv') return [];
  return ensureShortAnswersForSubQuestions(
    problem.markdown,
    problem.shortAnswers,
    problem.shortAnswer,
    problem.taskType,
  ).map((s) => s.trim());
}

function normalizeLine(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

export function linesFromStdout(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map(normalizeLine)
    .filter(Boolean);
}

export function compareAnswerLines(
  expected: string[],
  got: string[],
): boolean {
  if (!expected.length) return got.length === 0;
  if (got.length < expected.length) return false;
  const slice = got.slice(-expected.length);
  return expected.every((e, i) => {
    const a = normalizeLine(e);
    const b = normalizeLine(slice[i] ?? '');
    return shortAnswersEqual(a, b) || a === b;
  });
}

/**
 * Run answer code against linked assets and compare short answers (type 1/3).
 * Mount + execute are atomic under the runtime lock.
 */
export async function verifyBankProblemAnswer(
  project: AuthoringProject,
  problem: BankProblem,
): Promise<BankProblemVerifyResult> {
  const expected = expectedShorts(problem);
  const type2 = problem.taskType === 2 || problem.submitFormat === 'csv';
  const lang = problem.language === 'r' ? 'r' : 'python';
  const answerCode =
    lang === 'python'
      ? problem.answerCode?.python ?? ''
      : problem.answerCode?.r ?? '';

  if (!answerCode.trim()) {
    return {
      ok: false,
      stdout: '',
      stderr: 'Answer code is empty.',
      expected,
      got: [],
      match: type2 ? null : false,
      needsAiReview: true,
      reason: 'empty_answer_code',
    };
  }

  try {
    const { withProjectAssetContents } = await import('@/lib/assetStore');
    const hydrated = await withProjectAssetContents(
      project,
      problem.assetIds,
    );
    const files = resolveAssets(hydrated, problem.assetIds);

    const submitPath = problem.submitFile?.trim() || 'result.csv';
    const { runtimeSessionLabel } = await import('@/lib/runtimeLockWait');
    const out = await withRuntimeLock(
      async () => {
        let run;
        if (lang === 'python') {
          await preloadPyodide();
          await mountAssetsToPyodide(files);
          run = await runPython(answerCode);
        } else {
          await preloadWebR();
          const { mountAssetsToWebR } = await import('@/runtimes/fsMount');
          await mountAssetsToWebR(files);
          run = await runR(answerCode);
        }
        let resultCsv: string | null = null;
        if (type2 && run.ok) {
          try {
            resultCsv = await readExamResultCsv(lang, submitPath);
          } catch {
            resultCsv = null;
          }
        }
        return { ...run, resultCsv };
      },
      {
        runtime: lang,
        label: 'verify_bank_problem',
        session: runtimeSessionLabel({
          mode: 'verify',
          title: problem.title,
          taskType: problem.taskType,
        }),
      },
    );

    const got = linesFromStdout(out.stdout);
    const match = type2 ? null : compareAnswerLines(expected, got);

    if (!out.ok) {
      return {
        ok: false,
        stdout: out.stdout,
        stderr: out.stderr,
        expected,
        got,
        match,
        needsAiReview: true,
        reason: 'runtime_error',
      };
    }

    if (type2) {
      if (!out.resultCsv?.trim()) {
        return {
          ok: false,
          stdout: out.stdout,
          stderr: out.stderr || `Missing ${submitPath} after answer code run.`,
          expected,
          got,
          match: null,
          needsAiReview: true,
          reason: 'type2_missing_result_csv',
        };
      }
      const dataCols = type2CsvDataColumns(out.resultCsv);
      const hasIndex = type2CsvHasIndexHeader(out.resultCsv);
      if (dataCols.length !== 1 || hasIndex) {
        return {
          ok: false,
          stdout: out.stdout,
          stderr:
            out.stderr ||
            (hasIndex
              ? `${submitPath} must not include an index/Unnamed column — write a single prediction column (index=False / row.names=FALSE).`
              : `${submitPath} must have exactly 1 data column for grading (found ${dataCols.length}: ${dataCols.join(', ') || '(none)'}). Write a single prediction column.`),
          expected,
          got,
          match: null,
          needsAiReview: true,
          reason: hasIndex
            ? 'type2_index_column_csv'
            : 'type2_multi_column_csv',
        };
      }
      return {
        ok: true,
        stdout: out.stdout,
        stderr: out.stderr,
        expected,
        got,
        match: null,
        needsAiReview: false,
        reason: 'type2_ok',
      };
    }

    if (match === false) {
      return {
        ok: true,
        stdout: out.stdout,
        stderr: out.stderr,
        expected,
        got,
        match: false,
        needsAiReview: true,
        reason: 'answer_mismatch',
      };
    }

    if (expected.length === 0) {
      return {
        ok: true,
        stdout: out.stdout,
        stderr: out.stderr,
        expected,
        got,
        match: false,
        needsAiReview: true,
        reason: 'missing_short_answers',
      };
    }

    return {
      ok: true,
      stdout: out.stdout,
      stderr: out.stderr,
      expected,
      got,
      match: true,
      needsAiReview: false,
      reason: 'match',
    };
  } catch (err) {
    return {
      ok: false,
      stdout: '',
      stderr: err instanceof Error ? err.message : String(err),
      expected,
      got: [],
      match: type2 ? null : null,
      needsAiReview: true,
      reason: 'verify_exception',
    };
  }
}
