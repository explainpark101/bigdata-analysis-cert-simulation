import type { MarkdownIt as MarkdownItInstance, StateInline, StateBlock } from 'markdown-it';
import { renderKatexToString } from '@/lib/katexLoader';

const DOLLAR = 0x24;

/**
 * Inline `$...$` (not `$$`). Skips currency-like `$5` when no closing pair.
 */
function mathInline(state: StateInline, silent: boolean): boolean {
  const start = state.pos;
  const src = state.src;
  const max = state.posMax;
  if (src.charCodeAt(start) !== DOLLAR) return false;
  if (src.charCodeAt(start + 1) === DOLLAR) return false;

  // Find closing $ not escaped
  let pos = start + 1;
  let found = -1;
  while (pos < max) {
    if (src.charCodeAt(pos) === DOLLAR) {
      // count backslashes
      let back = 0;
      for (let i = pos - 1; i >= start && src[i] === '\\'; i--) back++;
      if (back % 2 === 0) {
        found = pos;
        break;
      }
    }
    pos++;
  }
  if (found < 0 || found === start + 1) return false;

  const tex = src.slice(start + 1, found);
  if (!tex.trim()) return false;

  if (!silent) {
    const token = state.push('math_inline', 'math', 0);
    token.content = tex;
    token.markup = '$';
  }
  state.pos = found + 1;
  return true;
}

/**
 * Block `$$...$$` on its own lines (or same-line $$...$$).
 */
function mathBlock(
  state: StateBlock,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean {
  const start = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];
  const src = state.src;

  if (start + 2 > max) return false;
  if (src.slice(start, start + 2) !== '$$') return false;

  let first = src.slice(start + 2, max).trimEnd();
  let nextLine = startLine;
  let content = '';

  if (first.endsWith('$$') && first.length > 2) {
    content = first.slice(0, -2).trim();
  } else {
    if (first) content = first;
    nextLine = startLine + 1;
    for (; nextLine < endLine; nextLine++) {
      const lineStart = state.bMarks[nextLine] + state.tShift[nextLine];
      const lineMax = state.eMarks[nextLine];
      const line = src.slice(lineStart, lineMax);
      if (line.trim() === '$$') break;
      content += (content ? '\n' : '') + line;
      if (line.includes('$$')) {
        const idx = line.indexOf('$$');
        content = (content.slice(0, content.length - line.length) + line.slice(0, idx)).trim();
        break;
      }
    }
    if (nextLine >= endLine && !src.slice(start).includes('\n$$')) {
      // unclosed
      return false;
    }
  }

  if (silent) return true;

  const token = state.push('math_block', 'math', 0);
  token.block = true;
  token.content = content.trim();
  token.markup = '$$';
  token.map = [startLine, nextLine + 1];

  state.line = nextLine + 1;
  return true;
}

/** Enable `$…$` / `$$…$$` → KaTeX HTML in markdown-it. */
export function katexMarkdownItPlugin(md: MarkdownItInstance): void {
  md.inline.ruler.before('escape', 'math_inline', mathInline);
  md.block.ruler.before('fence', 'math_block', mathBlock, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  });

  md.renderer.rules.math_inline = (tokens, idx) =>
    renderKatexToString(tokens[idx].content, false);

  md.renderer.rules.math_block = (tokens, idx) =>
    `<div class="katex-display-wrap">${renderKatexToString(tokens[idx].content, true)}</div>\n`;
}

export default katexMarkdownItPlugin;
