import MarkdownIt from 'markdown-it';
import TurndownService from 'turndown';
import { betterMdMarkdownItPlugin } from './betterMdMarkdownItPlugin';
import { buildAssetUrlMap, type MediaAsset } from './assetMedia';

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: false,
});
betterMdMarkdownItPlugin(md);

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
): string {
  let html = md.render(source ?? '');
  if (assets?.length) {
    html = rewriteImageSrcs(html, buildAssetUrlMap(assets));
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
): string {
  return renderMarkdown(source, assets);
}
