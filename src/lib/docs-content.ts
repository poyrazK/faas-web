/**
 * Loads one vendored docs page at a time, and pulls a table of contents out
 * of it.
 *
 * Each page is its own chunk: `import.meta.glob` without `eager` gives a
 * loader per file, so a reader of /docs/cli downloads the CLI guide and
 * nothing else. The `/docs/$slug` loader awaits it, and `scripts/prerender.mjs`
 * renders through the loader, so crawlers and unfurlers still get the full
 * page in the HTML.
 *
 * The whole corpus at once, for search and tests, is `docs-corpus.ts`.
 */

const LOADERS = import.meta.glob('/content/docs/*.md', {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>;

/**
 * A Windows checkout can vendor these files with CRLF endings, and `.` in a
 * JS regex refuses to match `\r` — which silently breaks `stripTitle` and
 * renders the title twice. Normalising once heals every consumer, the
 * copy-to-clipboard text included.
 */
export function normalizeDocSource(raw: string): string {
  return raw.replace(/\r\n/g, '\n');
}

export async function loadDocSource(slug: string): Promise<string | undefined> {
  const load = LOADERS[`/content/docs/${slug}.md`];
  return load ? normalizeDocSource(await load()) : undefined;
}

export interface Heading {
  /** Anchor target; matches the id the renderer puts on the heading. */
  id: string;
  text: string;
  /** 2 or 3. `#` is the page title and is rendered from the manifest instead. */
  level: number;
}

/**
 * GitHub-compatible heading slugs, so an anchor copied from the source
 * markdown lands in the same place here.
 */
export function slugifyHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');
}

/**
 * Headings for the on-page contents.
 *
 * Fenced code blocks are stripped first: a `# comment` inside a bash sample is
 * not a heading, and treating it as one puts nonsense in the sidebar.
 */
export function extractHeadings(markdown: string): Heading[] {
  const withoutCode = markdown.replace(/```[\s\S]*?```/g, '');
  const headings: Heading[] = [];

  for (const line of withoutCode.split('\n')) {
    const match = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const text = match[2].replace(/`/g, '');
    headings.push({ id: slugifyHeading(text), text, level: match[1].length });
  }

  return headings;
}

/**
 * Estimated reading time, for the index cards and the page header.
 *
 * Prose pace (~220 wpm) over a plain word split. Code samples and tables count
 * as words, which overweights them slightly — close enough for a label that is
 * explicitly an estimate ("~3 min"), and honest enough not to need more.
 */
export function readingMinutes(markdown: string): number {
  const words = markdown.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

/**
 * Drops the leading `# Title` line.
 *
 * The page renders its title from the manifest, which is the string that is
 * also in the nav, the `<title>`, and the index card. Letting the markdown
 * supply a second one would put two different titles on the same page.
 */
export function stripTitle(markdown: string): string {
  return markdown.replace(/^#\s+.+?\n+/, '');
}
