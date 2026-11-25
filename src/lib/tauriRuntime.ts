/** Detect Tauri WebView vs plain browser. */

import { isTauri } from '@tauri-apps/api/core';

export function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (isTauri()) return true;
  } catch {
    /* core helper unavailable in some test hosts */
  }
  const w = window as Window & {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
    isTauri?: boolean;
  };
  if (w.__TAURI_INTERNALS__ || w.__TAURI__ || w.isTauri) return true;
  return /\bTauri\b/i.test(navigator.userAgent ?? '');
}

/** True absolute FS path — rejects browser `C:\fakepath\...` placeholders. */
export function isRealFsPath(path: string): boolean {
  const p = path.trim();
  if (!p || /fakepath/i.test(p)) return false;
  if (/^[a-zA-Z]:[\\/]/.test(p)) return true;
  if (p.startsWith('\\\\') || p.startsWith('//')) return true;
  if (p.startsWith('/')) return true;
  return false;
}

/**
 * Absolute filesystem path for a File selected in the Tauri WebView.
 * HTML file inputs often omit `.path` or set a fakepath — callers must stage
 * those Blobs to a temp file before Rust zip import.
 */
export function tauriFilePath(source: File | string): string | null {
  if (typeof source === 'string') {
    return isRealFsPath(source) ? source.trim() : null;
  }
  const path = (source as File & { path?: string }).path;
  if (typeof path === 'string' && isRealFsPath(path)) return path.trim();
  return null;
}
