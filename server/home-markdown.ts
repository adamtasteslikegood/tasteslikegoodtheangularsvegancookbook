// The home page as Markdown, for a client that asks for it (KAN-397).
//
// Flask answers `Accept: text/markdown` on /r/<slug> and /browse through md4a.
// "/" is the Angular build's index.html, which Flask does not render, so
// Express answers it here: a hand-written guide (server/public/home.md) with
// the same newest-recipes links the HTML home page carries.

import { NEWEST_RECIPES_HEADING, type NewestRecipe } from './newest-recipes.js';

/** The same string md4a sends, so both halves of the site answer alike. */
export const MARKDOWN_CONTENT_TYPE = 'text/markdown; charset=utf-8';

/**
 * True when `text/markdown` is named as an accepted media range with a
 * non-zero quality. The same rule as md4a's `accepts_markdown`: a wildcard
 * does not count, so a browser or a bare `curl` still gets HTML.
 */
export function acceptsMarkdown(accept: string | undefined): boolean {
  if (!accept) return false;
  for (const range of accept.split(',')) {
    const [media, ...parameters] = range.split(';').map((part) => part.trim().toLowerCase());
    if (media !== 'text/markdown') continue;
    const quality = parameters.find((parameter) => parameter.startsWith('q='))?.slice(2) ?? '1';
    const value = Number(quality);
    if (Number.isFinite(value) && value > 0) return true;
  }
  return false;
}

// Recipe names come from Flask; keep one from breaking out of its link text.
const escapeLinkText = (value: string): string => value.replace(/[\\[\]]/g, '\\$&');

/** The guide, followed by the newest-recipes links when there is a list. */
export function renderHomeMarkdown(guide: string, recipes: readonly NewestRecipe[]): string {
  const body = guide.trimEnd();
  if (recipes.length === 0) return `${body}\n`;
  const links = recipes
    .map((recipe) => `- [${escapeLinkText(recipe.name)}](/r/${recipe.slug})`)
    .join('\n');
  return `${body}\n\n## ${NEWEST_RECIPES_HEADING}\n\n${links}\n`;
}
