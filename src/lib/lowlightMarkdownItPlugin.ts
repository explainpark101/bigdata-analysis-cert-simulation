import type { MarkdownIt as MarkdownItInstance } from 'markdown-it';
import { common, createLowlight } from 'lowlight';
import { toHtml } from 'hast-util-to-html';
import rLang from 'highlight.js/lib/languages/r';

const lowlight = createLowlight(common);
if (!lowlight.registered('r')) {
  lowlight.register('r', rLang);
}

const LANG_ALIASES: Record<string, string> = {
  py: 'python',
  python3: 'python',
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  rs: 'rust',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  rb: 'ruby',
  yml: 'yaml',
  md: 'markdown',
  plaintext: 'plaintext',
  text: 'plaintext',
  txt: 'plaintext',
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeLang(raw: string): string {
  const key = raw.trim().toLowerCase();
  if (!key) return '';
  return LANG_ALIASES[key] ?? key;
}

function highlightLine(line: string, lang: string): string {
  if (!line) return ' ';
  try {
    if (lang && lowlight.registered(lang)) {
      return toHtml(lowlight.highlight(lang, line));
    }
    return escapeHtml(line);
  } catch {
    return escapeHtml(line);
  }
}

function renderHighlightedLines(code: string, lang: string): string {
  const lines = code.replace(/\n$/, '').split('\n');
  return lines
    .map((line, i) => {
      const src = highlightLine(line, lang);
      return [
        '<span class="md-code-line">',
        `<span class="md-code-gutter" aria-hidden="true">${i + 1}</span>`,
        `<span class="md-code-src">${src}</span>`,
        '</span>',
      ].join('');
    })
    .join('');
}

/** Fence blocks → lowlight HTML with per-line gutters. */
export function lowlightMarkdownItPlugin(md: MarkdownItInstance): void {
  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx]!;
    const info = (token.info || '').trim();
    const langName = info.split(/\s+/u)[0] ?? '';
    const lang = normalizeLang(langName);
    const body = renderHighlightedLines(token.content, lang);
    const safeLang = lang ? md.utils.escapeHtml(lang) : '';
    const langClass = safeLang ? ` language-${safeLang}` : '';
    return [
      `<pre class="md-code-block hljs${langClass}"`,
      safeLang ? ` data-lang="${safeLang}"` : '',
      '>',
      `<code class="hljs${langClass}">`,
      body,
      '</code></pre>\n',
    ].join('');
  };
}
