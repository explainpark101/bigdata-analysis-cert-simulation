import type { RunResult } from '@/types/exam';

/** Race a run against a wall-clock timeout (ms). */
export function withRunTimeout(
  run: Promise<RunResult>,
  timeoutMs: number,
): Promise<RunResult> {
  const ms = Math.max(1_000, Math.round(timeoutMs));
  const started = performance.now();
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      resolve({
        ok: false,
        stdout: '',
        stderr: `Execution timed out after ${Math.round(ms / 1000)}s (exam max run time).`,
        durationMs: Math.round(performance.now() - started),
      });
    }, ms);

    void run.then(
      (result) => {
        window.clearTimeout(timer);
        resolve(result);
      },
      (err) => {
        window.clearTimeout(timer);
        resolve({
          ok: false,
          stdout: '',
          stderr: err instanceof Error ? err.message : String(err),
          durationMs: Math.round(performance.now() - started),
        });
      },
    );
  });
}

export function maxRunTimeoutMs(maxRunSeconds: number | undefined | null): number {
  const sec =
    typeof maxRunSeconds === 'number' && maxRunSeconds > 0
      ? maxRunSeconds
      : 60;
  return Math.round(sec * 1000);
}
