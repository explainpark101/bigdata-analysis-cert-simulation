import { readPyodideFileText } from '@/runtimes/pyodideRuntime';
import { readWebRFileText } from '@/runtimes/webrRuntime';

function candidatePaths(path: string): string[] {
  const norm = path.replace(/^\.\//, '').replace(/\\/g, '/');
  const base = norm.includes('/') ? norm.slice(norm.lastIndexOf('/') + 1) : norm;
  return [...new Set([norm, base, `./${base}`, `./${norm}`])];
}

async function readPyodideCandidates(path: string): Promise<string | null> {
  for (const p of candidatePaths(path)) {
    try {
      const text = await readPyodideFileText(p);
      if (text.trim()) return text;
    } catch {
      /* try next */
    }
  }
  return null;
}

async function readWebRCandidates(path: string): Promise<string | null> {
  for (const p of candidatePaths(path)) {
    try {
      const text = await readWebRFileText(p);
      if (text.trim()) return text;
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * Read type-2 submit artifact (usually result.csv) from the active runtime FS.
 * R → webR VFS; Python → Pyodide FS. Falls back to the other runtime once.
 */
export async function readExamResultCsv(
  language: 'python' | 'r',
  path = 'result.csv',
): Promise<string> {
  if (language === 'r') {
    const fromR = await readWebRCandidates(path);
    if (fromR) return fromR;
    const fromPy = await readPyodideCandidates(path);
    if (fromPy) return fromPy;
    throw new Error(
      `${path} 을 webR에서 찾지 못했습니다. write.csv(..., "${path}", row.names = FALSE) 후 다시 제출하세요.`,
    );
  }

  const fromPy = await readPyodideCandidates(path);
  if (fromPy) return fromPy;
  const fromR = await readWebRCandidates(path);
  if (fromR) return fromR;
  throw new Error(
    `${path} 을 찾지 못했습니다. to_csv("${path}", index=False) 후 다시 제출하세요.`,
  );
}
