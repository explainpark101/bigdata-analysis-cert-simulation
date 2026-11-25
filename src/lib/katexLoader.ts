/**
 * KaTeX via installed `katex` package (not CDN).
 */
import katex from 'katex';

export function renderKatexToString(
  tex: string,
  displayMode: boolean,
): string {
  try {
    return katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      output: 'html',
    });
  } catch {
    const tag = displayMode ? 'div' : 'span';
    const escaped = tex
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `<${tag} class="katex-error">${escaped}</${tag}>`;
  }
}
