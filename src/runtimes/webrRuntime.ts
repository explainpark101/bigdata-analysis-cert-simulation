import type { RunResult } from '@/types/exam';
import { withRunTimeout } from '@/lib/runTimeout';

/** Keep in sync with package.json `webr` version. */
export const WEBR_VERSION = '0.6.1';

/** webR default working directory — relative paths like data/*.csv resolve here. */
export const WEBR_HOME = '/home/web_user';

type RObjectLike = {
  toString?: () => Promise<string> | string;
  pluck?: (...path: string[]) => Promise<unknown>;
};

type WebRShelter = {
  captureR: (
    code: string,
    options?: {
      throwJsException?: boolean;
      captureGraphics?: boolean;
      /** Print last expression like an R console (head(df) without print()). */
      withAutoprint?: boolean;
      captureStreams?: boolean;
      captureConditions?: boolean;
    },
  ) => Promise<{
    result: RObjectLike;
    output: Array<{ type: string; data: unknown }>;
  }>;
  purge: () => Promise<void>;
};

type WebRInstance = {
  init: () => Promise<unknown>;
  evalRVoid: (code: string) => Promise<void>;
  FS: {
    mkdir: (path: string) => Promise<unknown>;
    writeFile: (path: string, data: ArrayBufferView, flags?: string) => Promise<void>;
    readFile: (path: string) => Promise<Uint8Array | string>;
    analyzePath?: (path: string) => Promise<{ exists: boolean }>;
  };
  Shelter: new () => Promise<WebRShelter>;
};

let webrPromise: Promise<WebRInstance> | null = null;
const installedPackages = new Set<string>();

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

/**
 * R condition proxies (error/warning/message) are not JS-stringifiable.
 * Calling String(robj) throws "Cannot convert object to primitive value".
 */
async function formatCaptureData(data: unknown): Promise<string> {
  if (data == null) return '';
  if (typeof data === 'string') return data;
  if (typeof data === 'number' || typeof data === 'boolean') return String(data);

  const obj = data as RObjectLike;
  try {
    if (typeof obj.pluck === 'function') {
      for (const path of [
        ['message'],
        ['data', 'message'],
        ['call'],
      ] as string[][]) {
        try {
          const plucked = await obj.pluck(...path);
          if (plucked == null) continue;
          if (typeof plucked === 'string') return plucked;
          const nested = plucked as RObjectLike;
          if (typeof nested.toString === 'function') {
            const s = await nested.toString();
            if (typeof s === 'string' && s.length && s !== '[object Object]') {
              return s;
            }
          }
        } catch {
          /* try next path */
        }
      }
    }
    if (typeof obj.toString === 'function') {
      const s = await obj.toString();
      if (
        typeof s === 'string' &&
        s.length &&
        s !== '[object Object]' &&
        !/^\[object RObject/i.test(s)
      ) {
        return s;
      }
    }
  } catch {
    /* fall through */
  }
  return '';
}

function detectLibraryCalls(code: string): string[] {
  const names = new Set<string>();
  const re =
    /(?:library|require)\s*\(\s*['"]?([A-Za-z][A-Za-z0-9.]*)['"]?\s*[,)]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    names.add(m[1]);
  }
  return [...names];
}

/** Install packages referenced by library()/require() via webr::install. */
async function ensurePackages(
  webR: WebRInstance,
  code: string,
): Promise<string[]> {
  const wanted = detectLibraryCalls(code).filter((p) => !installedPackages.has(p));
  if (!wanted.length) return [];

  const notes: string[] = [];
  const pkgVec = wanted.map((p) => `"${p}"`).join(', ');
  try {
    await webR.evalRVoid(
      `webr::install(c(${pkgVec}), quiet = TRUE)`,
    );
    for (const p of wanted) installedPackages.add(p);
    notes.push(`[webR] installed: ${wanted.join(', ')}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    notes.push(`[webR] package install failed: ${message}`);
  }
  return notes;
}

export async function ensureWebRDir(path: string): Promise<void> {
  const webR = await preloadWebR();
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  let cur = '';
  for (const part of parts) {
    cur += `/${part}`;
    try {
      await webR.FS.mkdir(cur);
    } catch {
      /* exists */
    }
  }
}

/**
 * Write a UTF-8 / binary file under WEBR_HOME so relative paths work
 * (e.g. read.csv("data/foo.csv")).
 */
export async function writeWebRFile(
  relativePath: string,
  content: string | Uint8Array,
): Promise<string> {
  const webR = await preloadWebR();
  const rel = relativePath.replace(/^\.\//, '').replace(/\\/g, '/').replace(/^\/+/, '');
  const abs = `${WEBR_HOME}/${rel}`;
  const dir = abs.slice(0, abs.lastIndexOf('/'));
  if (dir) await ensureWebRDir(dir);

  const bytes =
    typeof content === 'string'
      ? new TextEncoder().encode(content)
      : content;
  await webR.FS.writeFile(abs, bytes);
  return abs;
}

export async function readWebRFileText(relativePath: string): Promise<string> {
  const webR = await preloadWebR();
  const rel = relativePath.replace(/^\.\//, '').replace(/\\/g, '/').replace(/^\/+/, '');
  const abs = rel.startsWith(WEBR_HOME) ? rel : `${WEBR_HOME}/${rel}`;
  const data = await webR.FS.readFile(abs);
  if (typeof data === 'string') return data;
  return new TextDecoder().decode(data);
}

export async function runR(
  code: string,
  opts?: { timeoutMs?: number },
): Promise<RunResult> {
  const started = performance.now();

  try {
    const webR = await preloadWebR();
    // Package install can take minutes on first use — keep it outside run timeout.
    const installNotes = await ensurePackages(webR, code);

    const execute = async (): Promise<RunResult> => {
      const shelter = await new webR.Shelter();
      // withAutoprint: true → console-style print of the last expression
      // (e.g. head(df) without wrapping print()).
      const cap = await shelter.captureR(code, {
        throwJsException: false,
        captureGraphics: false,
        captureStreams: true,
        captureConditions: true,
        withAutoprint: true,
      });

      const stdout: string[] = [...installNotes];
      const stderr: string[] = [];
      let hadError = false;

      for (const item of cap.output) {
        // stdout/stderr are plain strings; conditions are RObject proxies.
        if (item.type === 'stdout' || item.type === 'stderr') {
          const text =
            typeof item.data === 'string'
              ? item.data
              : await formatCaptureData(item.data);
          if (!text) continue;
          if (item.type === 'stdout') stdout.push(text);
          else stderr.push(text);
          continue;
        }

        const text = await formatCaptureData(item.data);
        if (!text || /^\[object RObject/i.test(text)) continue;
        if (item.type === 'error') {
          hadError = true;
          stderr.push(text);
        } else if (item.type === 'warning' || item.type === 'message') {
          stderr.push(`[${item.type}] ${text}`);
        }
      }

      await shelter.purge();
      return {
        ok: !hadError,
        stdout: stdout.join('\n'),
        stderr: stderr.join('\n'),
        durationMs: Math.round(performance.now() - started),
      };
    };

    const timeoutMs = opts?.timeoutMs;
    if (timeoutMs == null || timeoutMs <= 0) return execute();
    return withRunTimeout(execute(), timeoutMs);
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
