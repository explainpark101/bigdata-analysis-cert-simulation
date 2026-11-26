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

    const out = await withRuntimeLock(async () => {
      if (lang === 'python') {
        await preloadPyodide();
        await mountAssetsToPyodide(files);
        return runPython(answerCode);
      }
      await preloadWebR();
      const { mountAssetsToWebR } = await import('@/runtimes/fsMount');
      await mountAssetsToWebR(files);
      return runR(answerCode);
    });

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

    if (!type2 && match === false) {
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

    if (!type2 && expected.length === 0) {
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
      match: type2 ? null : true,
      needsAiReview: false,
      reason: type2 ? 'type2_ok' : 'match',
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
