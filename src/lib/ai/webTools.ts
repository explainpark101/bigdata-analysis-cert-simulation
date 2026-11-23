import type { ChatToolDef } from '@/lib/ai/openaiCompatible';

const MAX_SNIPPET = 400;
const MAX_PAGE_CHARS = 14_000;
const FETCH_TIMEOUT_MS = 25_000;

export interface WebSearchHit {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

export const WEB_TOOL_DEFS: ChatToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        'Search the public web for documentation, facts, APIs, exam tips, or examples. Prefer this before guessing. Returns titles, URLs, and short snippets.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query (Korean or English)',
          },
          limit: {
            type: 'integer',
            description: 'Max results (1–8, default 5)',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch_url',
      description:
        'Fetch a URL and return readable text/markdown for the main content. Use after web_search when you need details from a specific page (docs, blog, Wikipedia, GitHub README, etc.).',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Absolute http(s) URL to read',
          },
          max_chars: {
            type: 'integer',
            description: `Max characters to return (default ${MAX_PAGE_CHARS})`,
          },
        },
        required: ['url'],
      },
    },
  },
];

export function isWebToolName(name: string): boolean {
  return name === 'web_search' || name === 'fetch_url';
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function withTimeout(ms: number): AbortSignal {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}

async function fetchText(
  url: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; text: string }> {
  try {
    const res = await fetch(url, {
      ...init,
      signal: init?.signal ?? withTimeout(FETCH_TIMEOUT_MS),
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      text: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Browser-only CORS fallback. In Tauri, `globalThis.fetch` is already
 * routed through the Rust HTTP plugin, so the first direct fetch usually
 * succeeds and this path is unused.
 */
async function viaAllOrigins(targetUrl: string): Promise<string | null> {
  const proxied = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
  const res = await fetchText(proxied);
  if (!res.ok || !res.text.trim()) return null;
  return res.text;
}

async function searchWikipedia(
  query: string,
  lang: 'ko' | 'en',
  limit: number,
): Promise<WebSearchHit[]> {
  const api = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=${limit}&format=json&origin=*`;
  const res = await fetchText(api);
  if (!res.ok) return [];
  try {
    const json = JSON.parse(res.text) as {
      query?: { search?: Array<{ title: string; snippet: string }> };
    };
    const rows = json.query?.search ?? [];
    return rows.map((row) => ({
      title: row.title,
      url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(row.title.replace(/ /g, '_'))}`,
      snippet: clip(row.snippet.replace(/<[^>]+>/g, ''), MAX_SNIPPET),
      source: `wikipedia:${lang}`,
    }));
  } catch {
    return [];
  }
}

function decodeDdgHref(href: string): string {
  try {
    if (href.startsWith('//')) href = `https:${href}`;
    const u = new URL(href);
    const uddg = u.searchParams.get('uddg');
    if (uddg) return decodeURIComponent(uddg);
    return href;
  } catch {
    return href;
  }
}

async function searchDuckDuckGoHtml(
  query: string,
  limit: number,
): Promise<WebSearchHit[]> {
  const target = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const html = await viaAllOrigins(target);
  if (!html) return [];

  const hits: WebSearchHit[] = [];
  const re =
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snipRe =
    /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>|<td[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/td>/gi;

  const snippets: string[] = [];
  let sm: RegExpExecArray | null;
  while ((sm = snipRe.exec(html)) !== null) {
    snippets.push(clip((sm[1] || sm[2] || '').replace(/<[^>]+>/g, ''), MAX_SNIPPET));
  }

  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(html)) !== null && hits.length < limit) {
    const url = decodeDdgHref(m[1]);
    if (!/^https?:\/\//i.test(url)) continue;
    if (url.includes('duckduckgo.com')) continue;
    const title = clip(m[2].replace(/<[^>]+>/g, ''), 160);
    hits.push({
      title: title || url,
      url,
      snippet: snippets[i] ?? '',
      source: 'duckduckgo',
    });
    i += 1;
  }
  return hits;
}

async function searchDuckDuckGoInstant(query: string): Promise<WebSearchHit[]> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  // Instant Answer often lacks CORS — try direct then proxy
  let text = (await fetchText(url)).text;
  if (!text.trim().startsWith('{')) {
    text = (await viaAllOrigins(url)) ?? '';
  }
  if (!text.trim().startsWith('{')) return [];
  try {
    const json = JSON.parse(text) as {
      AbstractText?: string;
      AbstractURL?: string;
      Heading?: string;
      RelatedTopics?: Array<
        | { Text?: string; FirstURL?: string }
        | { Topics?: Array<{ Text?: string; FirstURL?: string }> }
      >;
      Results?: Array<{ Text?: string; FirstURL?: string }>;
    };
    const hits: WebSearchHit[] = [];
    if (json.AbstractText && json.AbstractURL) {
      hits.push({
        title: json.Heading || query,
        url: json.AbstractURL,
        snippet: clip(json.AbstractText, MAX_SNIPPET),
        source: 'duckduckgo-ia',
      });
    }
    const flatten = (
      items: typeof json.RelatedTopics | typeof json.Results,
    ) => {
      if (!items) return;
      for (const item of items) {
        if (!item) continue;
        if ('FirstURL' in item && item.FirstURL) {
          hits.push({
            title: clip((item.Text ?? item.FirstURL).split(' - ')[0], 160),
            url: item.FirstURL,
            snippet: clip(item.Text ?? '', MAX_SNIPPET),
            source: 'duckduckgo-ia',
          });
        } else if ('Topics' in item && item.Topics) {
          flatten(item.Topics);
        }
      }
    };
    flatten(json.Results);
    flatten(json.RelatedTopics);
    return hits;
  } catch {
    return [];
  }
}

function dedupeHits(hits: WebSearchHit[], limit: number): WebSearchHit[] {
  const seen = new Set<string>();
  const out: WebSearchHit[] = [];
  for (const h of hits) {
    const key = h.url.replace(/\/$/, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
    if (out.length >= limit) break;
  }
  return out;
}

export async function webSearch(
  query: string,
  limit = 5,
): Promise<{ ok: boolean; query: string; results: WebSearchHit[]; error?: string }> {
  const q = query.trim();
  if (!q) {
    return { ok: false, query: q, results: [], error: 'empty query' };
  }
  const n = Math.min(8, Math.max(1, Number(limit) || 5));
  try {
    const batches = await Promise.all([
      searchWikipedia(q, 'ko', n),
      searchWikipedia(q, 'en', Math.min(3, n)),
      searchDuckDuckGoHtml(q, n),
      searchDuckDuckGoInstant(q),
    ]);
    const results = dedupeHits(batches.flat(), n);
    if (!results.length) {
      return {
        ok: false,
        query: q,
        results: [],
        error: 'No results (network/CORS). Try a different query or fetch_url with a known docs URL.',
      };
    }
    return { ok: true, query: q, results };
  } catch (err) {
    return {
      ok: false,
      query: q,
      results: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function normalizeHttpUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

async function readViaJina(url: string): Promise<string | null> {
  const endpoint = `https://r.jina.ai/${url}`;
  const res = await fetchText(endpoint, {
    headers: {
      Accept: 'text/plain',
      'X-Return-Format': 'markdown',
    },
  });
  if (!res.ok || !res.text.trim()) return null;
  // Jina sometimes returns JSON error payloads as text
  if (res.text.startsWith('{') && /"code"\s*:/.test(res.text.slice(0, 80))) {
    return null;
  }
  return res.text;
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function fetchUrl(
  rawUrl: string,
  maxChars = MAX_PAGE_CHARS,
): Promise<{
  ok: boolean;
  url: string;
  text?: string;
  truncated?: boolean;
  via?: string;
  error?: string;
}> {
  const url = normalizeHttpUrl(rawUrl);
  if (!url) {
    return { ok: false, url: rawUrl, error: 'invalid http(s) URL' };
  }
  const cap = Math.min(40_000, Math.max(2_000, Number(maxChars) || MAX_PAGE_CHARS));

  const jina = await readViaJina(url);
  if (jina) {
    const truncated = jina.length > cap;
    return {
      ok: true,
      url,
      text: truncated ? `${jina.slice(0, cap)}\n…[truncated]` : jina,
      truncated,
      via: 'r.jina.ai',
    };
  }

  const proxied = await viaAllOrigins(url);
  if (proxied) {
    const text = proxied.trim().startsWith('<')
      ? htmlToText(proxied)
      : proxied;
    if (text.trim()) {
      const truncated = text.length > cap;
      return {
        ok: true,
        url,
        text: truncated ? `${text.slice(0, cap)}\n…[truncated]` : text,
        truncated,
        via: 'allorigins',
      };
    }
  }

  const direct = await fetchText(url);
  if (direct.ok && direct.text.trim()) {
    const text = direct.text.trim().startsWith('<')
      ? htmlToText(direct.text)
      : direct.text;
    const truncated = text.length > cap;
    return {
      ok: true,
      url,
      text: truncated ? `${text.slice(0, cap)}\n…[truncated]` : text,
      truncated,
      via: 'direct',
    };
  }

  return {
    ok: false,
    url,
    error:
      direct.text ||
      'Failed to fetch (CORS/network). Try another URL or rely on web_search snippets.',
  };
}

/** Execute web_search / fetch_url and return a JSON string for the tool channel. */
export async function runWebTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  if (name === 'web_search') {
    const query = String(args.query ?? '');
    const limit = Number(args.limit ?? 5);
    return JSON.stringify(await webSearch(query, limit));
  }
  if (name === 'fetch_url') {
    const url = String(args.url ?? '');
    const maxChars = Number(args.max_chars ?? MAX_PAGE_CHARS);
    return JSON.stringify(await fetchUrl(url, maxChars));
  }
  return JSON.stringify({ ok: false, error: `unknown web tool ${name}` });
}
