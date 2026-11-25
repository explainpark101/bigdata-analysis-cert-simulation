/**
 * In the Tauri WebView, route absolute http(s) `fetch` through the Rust
 * `@tauri-apps/plugin-http` client (CORS-free). Same-origin / relative /
 * blob / data requests stay on the native browser fetch.
 *
 * Browser (`bun run dev`) keeps native fetch unchanged.
 */

import { isTauriRuntime } from '@/lib/tauriRuntime';

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function shouldProxy(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

let installed = false;

export async function installTauriFetchProxy(): Promise<void> {
  if (installed || !isTauriRuntime()) return;
  installed = true;

  const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
  const nativeFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = requestUrl(input);
    if (!shouldProxy(url)) {
      return nativeFetch(input, init);
    }

    // Prefer URL string + init so plugin-http gets a clean absolute URL.
    // If a Request was passed, merge its method/headers/body when init omits them.
    if (input instanceof Request && init == null) {
      const headers = new Headers(input.headers);
      const body =
        input.method === 'GET' || input.method === 'HEAD'
          ? undefined
          : await input.clone().arrayBuffer();
      return tauriFetch(url, {
        method: input.method,
        headers,
        body,
        signal: input.signal,
      });
    }

    return tauriFetch(url, init);
  }) as typeof fetch;
}

// Side-effect install as early as the module graph allows.
void installTauriFetchProxy();
