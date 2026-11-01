import { DOC_SECTIONS, findDoc, type DocEntry } from './docs-manifest.ts';
import { resolveDocHref } from './docs-links.ts';

/**
 * Documentation for coding agents, written by `scripts/prerender.mjs`:
 *
 * - `/llms.txt` — the llmstxt.org index: the hand-written intro in
 *   `content/llms-intro.md`, then every page in manifest order.
 * - `/llms-full.txt` — the intro and every page in one file.
 * - `/docs/<slug>.md` — each page as Markdown.
 *
 * Generated from the manifest for the same reason as the sitemap: adding a
 * page to the table of contents cannot leave it out of what agents read. The
 * curation is the manifest's too — nothing unpublished reaches these files.
 *
 * Imported by plain Node at build time, so imports use explicit `.ts`
 * extensions and nothing here touches `import.meta.glob`.
 */

/** Background reading. llms.txt calls this section "Optional": agents may skip it. */
const OPTIONAL_SECTION = 'Trust';

const AGENTS_SLUG = 'agents';

export const markdownUrl = (siteUrl: string, slug: string): string => `${siteUrl}/docs/${slug}.md`;

/** One docs page as Markdown, with the manifest's title and summary. */
export function markdownPage(entry: DocEntry, source: string, siteUrl: string): string {
  const body = source.replace(/\r\n/g, '\n').replace(/^#\s+.+?\n+/, '');
  return (
    [
      `# ${entry.title}`,
      `> ${entry.summary}`,
      absoluteLinks(body, entry.source, siteUrl).trim(),
      `Source: ${siteUrl}/docs/${entry.slug}`,
    ].join('\n\n') + '\n'
  );
}

export function llmsIndex(intro: string, siteUrl: string): string {
  const parts = [intro.trim()];
  if (findDoc(AGENTS_SLUG)) {
    parts.push(
      `Coding agents: start with [Use Gregale from coding agents](${markdownUrl(siteUrl, AGENTS_SLUG)}). ` +
        `[llms-full.txt](${siteUrl}/llms-full.txt) holds every page below in one file.`
    );
  }
  const sections = [
    ...DOC_SECTIONS.filter((section) => section.title !== OPTIONAL_SECTION),
    ...DOC_SECTIONS.filter((section) => section.title === OPTIONAL_SECTION),
  ];
  for (const section of sections) {
    const heading = section.title === OPTIONAL_SECTION ? 'Optional' : section.title;
    const links = section.entries.map(
      (entry) => `- [${entry.title}](${markdownUrl(siteUrl, entry.slug)}): ${entry.summary}`
    );
    parts.push(`## ${heading}\n\n${links.join('\n')}`);
  }
  return parts.join('\n\n') + '\n';
}

export function llmsFull(intro: string, pages: string[]): string {
  return [intro.trim(), ...pages.map((page) => page.trim())].join('\n\n') + '\n';
}

/**
 * Makes every link in `markdown` work outside the site: published pages point
 * at their Markdown copy, unpublished ones at GitHub, root-relative paths at
 * the site. Fenced code and inline code spans are left exactly as written.
 */
export function absoluteLinks(markdown: string, sourcePath: string, siteUrl: string): string {
  const target = (href: string): string => {
    const resolved = resolveDocHref(href, sourcePath, (slug) => markdownUrl(siteUrl, slug));
    const route = /^\/docs\/([^/#?]+)(.*)$/.exec(resolved);
    if (route && findDoc(route[1])) return markdownUrl(siteUrl, route[1]) + route[2];
    return resolved.startsWith('/') && !resolved.startsWith('//') ? siteUrl + resolved : resolved;
  };

  let fence: string | undefined;
  return markdown
    .split('\n')
    .map((line) => {
      const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
      if (marker && !fence) {
        fence = marker;
        return line;
      }
      if (fence) {
        if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
        return line;
      }

      const definition = /^(\s*\[[^\]]+\]:\s*)(\S+)(.*)$/.exec(line);
      if (definition) return definition[1] + target(definition[2]) + definition[3];

      return line
        .split(/(`+[^`]*`+)/)
        .map((part) =>
          part.startsWith('`')
            ? part
            : part.replace(
                /\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g,
                (_, href: string, title: string) => `](${target(href)}${title})`
              )
        )
        .join('');
    })
    .join('\n');
}
