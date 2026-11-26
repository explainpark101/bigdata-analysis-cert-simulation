import MarkdownIt from 'markdown-it';
import TurndownService from 'turndown';
import { betterMdMarkdownItPlugin } from './betterMdMarkdownItPlugin';
import { katexMarkdownItPlugin } from './katexMarkdownItPlugin';
import { buildAssetUrlMap, type MediaAsset } from './assetMedia';

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: false,
});
betterMdMarkdownItPlugin(md);
katexMarkdownItPlugin(md);

function tableCellText(cell: Element): string {
  return (cell.textContent ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n+/g, ' ')
    .trim();
}

/** Convert an HTML <table> to a GFM pipe table (keeps WYSIWYG round-trips). */
function htmlTableToMarkdown(table: HTMLTableElement): string {
  const rows = Array.from(table.querySelectorAll('tr'));
  if (!rows.length) return '';

  const matrix = rows.map((tr) =>
    Array.from(tr.querySelectorAll('th, td')).map(tableCellText),
  );
  const colCount = Math.max(0, ...matrix.map((r) => r.length));
  if (!colCount) return '';

  const normalized = matrix.map((row) => {
    const next = row.slice(0, colCount);
    while (next.length < colCount) next.push('');
    return next;
  });

  const header = normalized[0]!;
  const body = normalized.slice(1);
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...body.map((r) => `| ${r.join(' | ')} |`),
  ];
  return `\n\n${lines.join('\n')}\n\n`;
}

function createTurndown(dataUrlToPath?: Map<string, string>): TurndownService {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });

  turndown.addRule('boldAsB', {
    filter: ['b', 'strong'],
    replacement: (content) => `**${content}**`,
  });

  // Keep table structure; blank out sections/rows/cells so they are not emitted twice.
  turndown.addRule('table', {
    filter: 'table',
    replacement: (_content, node) =>
      htmlTableToMarkdown(node as HTMLTableElement),
  });
  turndown.addRule('tableSection', {
    filter: ['thead', 'tbody', 'tfoot'],
    replacement: (content) => content,
  });
  turndown.addRule('tableRow', {
    filter: 'tr',
    replacement: () => '',
  });
  turndown.addRule('tableCell', {
    filter: ['th', 'td'],
    replacement: () => '',
  });

  turndown.addRule('assetImage', {
    filter: 'img',
    replacement: (_content, node) => {
      const el = node as HTMLElement;
      const path =
        el.getAttribute('data-asset-path') ||
        dataUrlToPath?.get(el.getAttribute('src') || '') ||
        '';
      const alt = el.getAttribute('alt') || '';
      if (!path || path.startsWith('data:') || path.startsWith('http')) {
        return '';
      }
      return `![${alt}](${path})`;
    },
  });

  return turndown;
}

function rewriteImageSrcs(html: string, urlMap: Map<string, string>): string {
  return html.replace(
    /<img\b([^>]*?)\bsrc=(["'])([^"']+)\2([^>]*)>/gi,
    (full, pre, quote, src, post) => {
      const key = String(src).replace(/^\.\//, '');
      const resolved =
        urlMap.get(String(src)) ?? urlMap.get(key) ?? urlMap.get(`./${key}`);
      if (!resolved) return full;
      if (/\bdata-asset-path=/.test(full)) {
        return full.replace(
          /src=(["'])([^"']+)\1/,
          `src=$1${resolved}$1`,
        );
      }
      return `<img${pre}src=${quote}${resolved}${quote} data-asset-path=${quote}${key}${quote}${post}>`;
    },
  );
}

export function renderMarkdown(
  source: string,
  assets?: MediaAsset[],
  urlMap?: Map<string, string>,
): string {
  let html = md.render(source ?? '');
  const map =
    urlMap ?? (assets?.length ? buildAssetUrlMap(assets) : undefined);
  if (map?.size) {
    html = rewriteImageSrcs(html, map);
  }
  return html;
}

export function htmlToMarkdown(
  html: string,
  options?: { dataUrlToPath?: Map<string, string> },
): string {
  return createTurndown(options?.dataUrlToPath).turndown(html ?? '');
}

export function markdownToHtmlFragment(
  source: string,
  assets?: MediaAsset[],
  urlMap?: Map<string, string>,
): string {
  return renderMarkdown(source, assets, urlMap);
}
