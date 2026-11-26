import {
  isNumericShortAnswer,
  shortAnswersAreFinite,
  stdoutHasNonFiniteAnswer,
} from '@/lib/ai/authorRuntimePrompt';
import { linkedCsvAssetIds } from '@/lib/ai/ensureProblemCsv';
import { resolveAssets } from '@/lib/projectIO';
import { mountAssetsToPyodide } from '@/runtimes/fsMount';
import { preloadPyodide, runPython } from '@/runtimes/pyodideRuntime';
import { preloadWebR, runR } from '@/runtimes/webrRuntime';
import type { CodeByLanguage } from '@/types/exam';
import type { AuthoringProject, TaskType } from '@/types/project';

export type VerifySolveInput = {
  project: AuthoringProject;
  assetIds: string[];
  taskType: TaskType;
  language: 'python' | 'r';
  answerCode: CodeByLanguage;
  shortAnswers?: string[];
};

export type VerifySolveResult =
  | {
      ok: true;
      language: 'python' | 'r';
      stdout: string;
      stderr: string;
    }
  | {
      ok: false;
      error: string;
      regenerate?: boolean;
      language?: 'python' | 'r';
      stdout?: string;
      stderr?: string;
    };

function numbersClose(a: string, b: string): boolean {
  const na = Number(String(a).trim());
  const nb = Number(String(b).trim());
  if (!Number.isFinite(na) || !Number.isFinite(nb)) {
    return String(a).trim() === String(b).trim();
  }
  const scale = Math.max(1, Math.abs(na), Math.abs(nb));
  return Math.abs(na - nb) <= 1e-9 * scale;
}

/** Numeric stdout lines (trimmed), in order. */
export function extractNumericStdoutLines(stdout: string): string[] {
  return String(stdout ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => isNumericShortAnswer(l));
}

/**
 * Confirm short answers were produced by the answer code run against the CSV.
 * Prefer trailing numeric lines matching answers in order; else each answer
 * must appear as some numeric stdout line.
 */
export function stdoutConfirmsShortAnswers(
  stdout: string,
  answers: string[],
): boolean {
  const expected = answers.map((a) => String(a ?? '').trim()).filter(Boolean);
  if (!expected.length) return false;
  const lines = extractNumericStdoutLines(stdout);
  if (lines.length >= expected.length) {
    const tail = lines.slice(-expected.length);
    if (expected.every((a, i) => numbersClose(a, tail[i]))) return true;
  }
  return expected.every((a) => lines.some((l) => numbersClose(a, l)));
}

function pickAnswerLanguage(
  preferred: 'python' | 'r',
  answerCode: CodeByLanguage,
): 'python' | 'r' | null {
  const pref = preferred === 'r' ? 'r' : 'python';
  const other = pref === 'python' ? 'r' : 'python';
  if ((answerCode[pref] ?? '').trim()) return pref;
  if ((answerCode[other] ?? '').trim()) return other;
  return null;
}

async function runtimeHasResultCsv(
  language: 'python' | 'r',
): Promise<boolean> {
  if (language === 'python') {
    const py = await preloadPyodide();
    return Boolean(py.FS.analyzePath('result.csv').exists);
  }
  const { readWebRFileText } = await import('@/runtimes/webrRuntime');
  try {
    const text = await readWebRFileText('result.csv');
    return text.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Hydrate linked CSVs from internal storage, mount them, run answer code, and
 * confirm the problem is actually solvable with those files before bank save.
 */
export async function verifyDraftSolvedWithStoredCsv(
  input: VerifySolveInput,
): Promise<VerifySolveResult> {
  const csvIds = linkedCsvAssetIds(input.project, input.assetIds);
  if (!csvIds.length) {
    return {
      ok: false,
      error:
        'VERIFY_FAILED: no linked .csv assets in internal storage — attach or generate CSV first',
      regenerate: true,
    };
  }

  const lang = pickAnswerLanguage(input.language, input.answerCode);
  if (!lang) {
    return {
      ok: false,
      error: 'VERIFY_FAILED: answer code is empty — write and run answer code first',
      regenerate: true,
    };
  }

  const source = input.answerCode[lang] ?? '';
  const { withProjectAssetContents } = await import('@/lib/assetStore');
  const hydrated = await withProjectAssetContents(input.project, input.assetIds);
  // Keep hydrated bodies on the caller's project for subsequent tools.
  input.project.assets = hydrated.assets;
  const files = resolveAssets(hydrated, input.assetIds);

  let out: { ok: boolean; stdout: string; stderr: string };
  try {
    if (lang === 'python') {
      await preloadPyodide();
      await mountAssetsToPyodide(files);
      out = await runPython(source);
    } else {
      await preloadWebR();
      const { mountAssetsToWebR } = await import('@/runtimes/fsMount');
      await mountAssetsToWebR(files);
      out = await runR(source);
    }
  } catch (err) {
    return {
      ok: false,
      error: `VERIFY_FAILED: ${err instanceof Error ? err.message : String(err)}`,
      regenerate: true,
      language: lang,
    };
  }

  if (stdoutHasNonFiniteAnswer(out.stdout)) {
    return {
      ok: false,
      error:
        'VERIFY_FAILED: answer code printed NaN/Inf against stored CSV — regenerate data/metric',
      regenerate: true,
      language: lang,
      stdout: out.stdout,
      stderr: out.stderr,
    };
  }

  if (!out.ok) {
    return {
      ok: false,
      error:
        'VERIFY_FAILED: answer code failed when run against stored CSV — fix code or data before save',
      regenerate: true,
      language: lang,
      stdout: out.stdout,
      stderr: out.stderr,
    };
  }

  if (input.taskType === 2) {
    const hasResult = await runtimeHasResultCsv(lang);
    if (!hasResult) {
      return {
        ok: false,
        error:
          'VERIFY_FAILED: type 2 answer code must write result.csv using the stored CSV mounts',
        regenerate: true,
        language: lang,
        stdout: out.stdout,
        stderr: out.stderr,
      };
    }
    return {
      ok: true,
      language: lang,
      stdout: out.stdout,
      stderr: out.stderr,
    };
  }

  if (
    !shortAnswersAreFinite(input.shortAnswers, {
      taskType: input.taskType === 1 || input.taskType === 3 ? input.taskType : undefined,
    })
  ) {
    return {
      ok: false,
      error:
        'VERIFY_FAILED: short answers missing or non-finite — set answers from a successful run first',
      regenerate: true,
      language: lang,
      stdout: out.stdout,
      stderr: out.stderr,
    };
  }

  const answers = (input.shortAnswers ?? []).map((a) => String(a).trim());
  if (!stdoutConfirmsShortAnswers(out.stdout, answers)) {
    return {
      ok: false,
      error:
        'VERIFY_FAILED: stored CSV + answer code stdout does not match set short answers — re-run and set answers from stdout',
      regenerate: true,
      language: lang,
      stdout: out.stdout,
      stderr: out.stderr,
    };
  }

  return {
    ok: true,
    language: lang,
    stdout: out.stdout,
    stderr: out.stderr,
  };
}
