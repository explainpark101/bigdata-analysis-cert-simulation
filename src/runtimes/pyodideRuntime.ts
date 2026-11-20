import type { RunResult } from '@/types/exam';
import { PYODIDE_LOAD_PACKAGES } from '@/data/packages';

/** Keep in sync with package.json `pyodide` version (CDN full build). */
export const PYODIDE_VERSION = '314.0.8';

type PyodideInterface = {
  runPythonAsync: (code: string) => Promise<unknown>;
  loadPackage: (names: string | string[]) => Promise<void>;
  setStdout: (opts: { batched: (text: string) => void }) => void;
  setStderr: (opts: { batched: (text: string) => void }) => void;
  FS: {
    readFile: (path: string, opts?: { encoding?: string }) => string | Uint8Array;
    analyzePath: (path: string) => { exists: boolean };
  };
};

let pyodidePromise: Promise<PyodideInterface> | null = null;

async function loadPyodideModule(): Promise<PyodideInterface> {
  const indexURL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
  const { loadPyodide } = await import(
    /* @vite-ignore */ `${indexURL}pyodide.mjs`
  );
  const pyodide = (await loadPyodide({ indexURL })) as PyodideInterface;

  try {
    await pyodide.loadPackage([...PYODIDE_LOAD_PACKAGES]);
  } catch (err) {
    console.warn('Some Pyodide packages failed to load', err);
    await pyodide.loadPackage(['numpy', 'pandas', 'micropip']);
  }

  return pyodide;
}

export function preloadPyodide(): Promise<PyodideInterface> {
  if (!pyodidePromise) {
    pyodidePromise = loadPyodideModule();
  }
  return pyodidePromise;
}

export async function runPython(code: string): Promise<RunResult> {
  const started = performance.now();
  const stdout: string[] = [];
  const stderr: string[] = [];

  try {
    const pyodide = await preloadPyodide();
    pyodide.setStdout({
      batched: (text) => {
        stdout.push(text);
      },
    });
    pyodide.setStderr({
      batched: (text) => {
        stderr.push(text);
      },
    });
    await pyodide.runPythonAsync(code);
    return {
      ok: true,
      stdout: stdout.join('\n'),
      stderr: stderr.join('\n'),
      durationMs: Math.round(performance.now() - started),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      stdout: stdout.join('\n'),
      stderr: stderr.concat(message).join('\n'),
      durationMs: Math.round(performance.now() - started),
    };
  }
}

/** Download a file written into the Pyodide virtual filesystem (e.g. result.csv). */
export async function downloadPyodideFile(
  path: string,
  downloadName?: string,
): Promise<void> {
  const pyodide = await preloadPyodide();
  const info = pyodide.FS.analyzePath(path);
  if (!info.exists) {
    throw new Error(`File not found in runtime FS: ${path}`);
  }
  const data = pyodide.FS.readFile(path, { encoding: 'utf8' });
  const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = downloadName || path.split('/').pop() || 'result.csv';
  a.click();
  URL.revokeObjectURL(url);
}
