import { describe, expect, it } from 'vitest';
import { DOC_ENTRIES, DOC_SECTIONS, docNeighbours, findDoc } from './docs-manifest';
import {
  docSource,
  extractHeadings,
  readingMinutes,
  slugifyHeading,
  stripTitle,
} from './docs-content';

/**
 * The manifest and the vendored markdown are maintained separately — one by
 * hand, one by `npm run docs:pull` — so the thing worth testing is that they
 * have not drifted apart. A manifest entry with no file behind it renders a
 * 404 at a URL the sidebar links to, which is exactly the class of dead link
 * the rest of this site was just cleaned of.
 */

describe('docs manifest', () => {
  it('has content vendored for every entry', () => {
    const missing = DOC_ENTRIES.filter((entry) => !docSource(entry.slug)).map((e) => e.slug);
    expect(missing).toEqual([]);
  });

  it('uses unique slugs', () => {
    const slugs = DOC_ENTRIES.map((e) => e.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('uses URL-safe slugs', () => {
    // These become paths and are prerendered to directories, so anything
    // needing escaping would break both.
    for (const entry of DOC_ENTRIES) {
      expect(entry.slug).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('gives every entry a title and a summary', () => {
    // The summary is the meta description, so an empty one ships a page with
    // no description at all.
    for (const entry of DOC_ENTRIES) {
      expect(entry.title.length).toBeGreaterThan(0);
      expect(entry.summary.length).toBeGreaterThan(0);
    }
  });

  it('points every entry at a markdown file upstream', () => {
    for (const entry of DOC_ENTRIES) {
      expect(entry.source).toMatch(/\.md$/);
    }
  });

  it('publishes no runbooks, ADRs, or operator procedures', () => {
    // The curation rule, enforced. These are internal and naming them here
    // means a careless addition fails the suite rather than the security
    // review.
    for (const entry of DOC_ENTRIES) {
      expect(entry.source).not.toMatch(/^docs\/(runbooks|adr|ops|drills)\//);
    }
  });

  it('finds an entry by slug and misses cleanly', () => {
    expect(findDoc('scale-to-zero')?.title).toBe('How scaling to zero works');
    expect(findDoc('does-not-exist')).toBeUndefined();
  });
});

describe('docNeighbours', () => {
  it('has no previous entry at the start and no next at the end', () => {
    const first = DOC_ENTRIES[0].slug;
    const last = DOC_ENTRIES[DOC_ENTRIES.length - 1].slug;
    expect(docNeighbours(first).prev).toBeUndefined();
    expect(docNeighbours(last).next).toBeUndefined();
  });

  it('walks the flat reading order across section boundaries', () => {
    // Reading order is the concatenation of the sections, so the last entry of
    // one section leads into the first of the next.
    const firstSection = DOC_SECTIONS[0].entries;
    const boundary = firstSection[firstSection.length - 1].slug;
    expect(docNeighbours(boundary).next?.slug).toBe(DOC_SECTIONS[1].entries[0].slug);
  });

  it('returns nothing for an unknown slug rather than throwing', () => {
    expect(docNeighbours('nope')).toEqual({});
  });
});

describe('extractHeadings', () => {
  it('collects h2 and h3 but not the page title', () => {
    const headings = extractHeadings('# Title\n\n## First\n\n### Nested\n');
    expect(headings).toEqual([
      { id: 'first', text: 'First', level: 2 },
      { id: 'nested', text: 'Nested', level: 3 },
    ]);
  });

  it('ignores comments inside fenced code blocks', () => {
    // A `# comment` in a bash sample is not a heading, and treating it as one
    // puts nonsense in the on-page contents.
    const markdown = '## Real\n\n```bash\n# not a heading\nfaas app deploy\n```\n';
    expect(extractHeadings(markdown).map((h) => h.text)).toEqual(['Real']);
  });

  it('strips backticks so an anchor matches its visible text', () => {
    expect(extractHeadings('## The `faas` CLI')[0].text).toBe('The faas CLI');
  });
});

describe('slugifyHeading', () => {
  it('matches the GitHub anchor format', () => {
    expect(slugifyHeading('Opting out: keep N instances warm')).toBe(
      'opting-out-keep-n-instances-warm'
    );
  });
});

describe('stripTitle', () => {
  it('drops the leading h1 so the page renders one title, not two', () => {
    expect(stripTitle('# Title\n\nBody text\n')).toBe('Body text\n');
  });

  it('leaves a document that does not start with a heading alone', () => {
    expect(stripTitle('Body text\n')).toBe('Body text\n');
  });
});

describe('readingMinutes', () => {
  it('rounds to whole minutes and never reports zero', () => {
    // A "0 min" label reads as an error, not a short page.
    expect(readingMinutes('a few words only')).toBe(1);
    expect(readingMinutes(Array(660).fill('word').join(' '))).toBe(3);
  });
});

describe('vendored content', () => {
  it('serves LF regardless of checkout line endings', () => {
    // `stripTitle` and the heading scan both assume `\n`; a CRLF checkout
    // (Windows, autocrlf) would otherwise render every title twice.
    for (const entry of DOC_ENTRIES) {
      expect(docSource(entry.slug)).not.toContain('\r');
    }
  });

  it('starts every document with an h1', () => {
    // `stripTitle` assumes it, and the page supplies its own title from the
    // manifest — a document without one would render its first paragraph as
    // though it were the intro.
    for (const entry of DOC_ENTRIES) {
      expect(docSource(entry.slug)?.startsWith('# ')).toBe(true);
    }
  });
});
