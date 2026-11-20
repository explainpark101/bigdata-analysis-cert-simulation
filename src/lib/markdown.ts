import MarkdownIt from 'markdown-it';
import TurndownService from 'turndown';
import { betterMdMarkdownItPlugin } from './betterMdMarkdownItPlugin';

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: false,
});
betterMdMarkdownItPlugin(md);

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

turndown.addRule('boldAsB', {
  filter: ['b', 'strong'],
  replacement: (content) => `**${content}**`,
});

export function renderMarkdown(source: string): string {
  return md.render(source ?? '');
}

export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html ?? '');
}

export function markdownToHtmlFragment(source: string): string {
  return renderMarkdown(source);
}
