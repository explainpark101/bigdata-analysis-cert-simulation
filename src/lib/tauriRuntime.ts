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

/**
 * Absolute filesystem path for a File selected in the Tauri WebView.
 * HTML file inputs and dialogs often attach `.path` — prefer Rust zip/asset
 * commands with that path so bytes never cross the WebView IPC as JSON.
 */
export function tauriFilePath(source: File | string): string | null {
  if (typeof source === 'string') {
    const s = source.trim();
    return s ? s : null;
  }
  const path = (source as File & { path?: string }).path;
  if (typeof path === 'string' && path.trim()) return path.trim();
  return null;
}
