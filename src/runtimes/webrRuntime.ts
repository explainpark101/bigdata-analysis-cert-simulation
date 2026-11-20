import type { RunResult } from '@/types/exam';

/** Keep in sync with package.json `webr` version. */
export const WEBR_VERSION = '0.6.1';

type WebRInstance = {
  init: () => Promise<unknown>;
  Shelter: new () => Promise<{
    captureR: (
      code: string,
      options?: { throwJsException?: boolean },
    ) => Promise<{
      output: Array<{ type: string; data: unknown }>;
    }>;
    purge: () => Promise<void>;
  }>;
};

let webrPromise: Promise<WebRInstance> | null = null;

async function loadWebR(): Promise<WebRInstance> {
  const { WebR } = await import('webr');
  const webR = new WebR({
    baseUrl: `https://webr.r-wasm.org/v${WEBR_VERSION}/`,
  }) as unknown as WebRInstance;
  await webR.init();
  return webR;
}

export function preloadWebR(): Promise<WebRInstance> {
  if (!webrPromise) {
    webrPromise = loadWebR();
  }
  return webrPromise;
}

export async function runR(code: string): Promise<RunResult> {
  const started = performance.now();
  try {
    const webR = await preloadWebR();
    const shelter = await new webR.Shelter();
    const cap = await shelter.captureR(code, { throwJsException: false });
    const stdout: string[] = [];
    const stderr: string[] = [];

    for (const item of cap.output) {
      if (item.type === 'stdout' && typeof item.data === 'string') {
        stdout.push(item.data);
      } else if (item.type === 'stderr' && typeof item.data === 'string') {
        stderr.push(item.data);
      } else if (item.type === 'error') {
        stderr.push(String(item.data));
      } else if (item.type === 'warning' || item.type === 'message') {
        stderr.push(`[${item.type}] ${String(item.data)}`);
      }
    }

    await shelter.purge();
    return {
      ok: stderr.length === 0 || stdout.length > 0,
      stdout: stdout.join('\n'),
      stderr: stderr.join('\n'),
      durationMs: Math.round(performance.now() - started),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      stdout: '',
      stderr: message,
      durationMs: Math.round(performance.now() - started),
    };
  }
}
