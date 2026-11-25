import { createHash } from 'node:crypto';

/** The workflow artifact that carries the last submitted release's hashes. */
export const CONTENT_ARTIFACT = 'indexnow-content';
export const CONTENT_FILE = 'indexnow-content.json';

const hash = /^[a-f0-9]{16}$/;

function text(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * What a search engine indexes on a prerendered page: its title, description
 * and main content. The header, footer, JSON-LD and asset links are left out,
 * so a site-wide template change does not count as every page changing.
 */
export function contentHash(doc) {
  const title = /<title>([\s\S]*?)<\/title>/.exec(doc)?.[1] ?? '';
  const description = /<meta name="description" content="([^"]*)"/.exec(doc)?.[1] ?? '';
  const main = /<main[\s>][\s\S]*?<\/main>/.exec(doc)?.[0] ?? doc;
  return createHash('sha256')
    .update([title, description, text(main)].join('\n'))
    .digest('hex')
    .slice(0, 16);
}

/** A path-to-hash map, or undefined when the value is not one. */
export function contentHashes(value, paths) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value);
  if (!entries.every(([path, digest]) => typeof digest === 'string' && hash.test(digest))) {
    return undefined;
  }
  if (paths && !entries.every(([path]) => paths.includes(path))) return undefined;
  return Object.fromEntries(entries);
}

/** The live paths whose content is new, or differs from the last submitted release. */
export function contentChangedPaths(previous, current, livePaths) {
  return livePaths.filter((path) => !current[path] || current[path] !== previous[path]);
}
