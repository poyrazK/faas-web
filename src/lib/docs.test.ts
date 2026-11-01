import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DOC_ENTRIES, DOC_SECTIONS, docNeighbours, findDoc } from './docs-manifest';
import { CATALOG_ROUTES, DOC_ALIASES, UNPUBLISHED_DOCS, resolveDocPath } from './docs-catalog';
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

  it('publishes the capability-registry pages with their expected documents', () => {
    const expected = {
      'api-hosting-openapi': '# OpenAPI hosting',
      faas_openapi_spec: '# OpenAPI spec + CI gate',
      'custom-domains': '# Domains',
      'deploy-from-github': '# Deploys',
      security: '# Security',
    };

    for (const [slug, heading] of Object.entries(expected)) {
      expect(findDoc(slug), slug).toBeDefined();
      expect(docSource(slug), slug).toContain(heading);
    }
  });

  it('holds the pages upstream marks unpublished', () => {
    // Preview and internal capabilities; the capability registry still sends
    // `docs_url` for them, and the dashboard drops the link
    // (`safeCapabilityDocs`) rather than 404 on it.
    for (const slug of ['object-storage', 'executions']) {
      expect(findDoc(slug), slug).toBeUndefined();
      expect(UNPUBLISHED_DOCS[slug], slug).toMatch(/(preview|internal) capability/);
    }
    expect(findDoc('runtime-go')).toBeUndefined();
  });

  it('uses unique slugs', () => {
    const slugs = DOC_ENTRIES.map((e) => e.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('uses URL-safe slugs', () => {
    // These become paths and are prerendered to directories, so anything
    // needing escaping would break both.
    for (const entry of DOC_ENTRIES) {
      // Underscores are valid unescaped path characters and preserve the
      // already-published /docs/faas_openapi_spec compatibility URL.
      expect(entry.slug).toMatch(/^[a-z0-9_-]+$/);
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

describe('install guide', () => {
  // faas-web#120: the homepage pointed at a page that assumed the CLI was
  // already installed. The install guide is locally authored because the
  // upstream page ends with operator-only release steps.
  it('is published locally, ahead of the first-deploy guide', () => {
    const entry = findDoc('install');
    expect(entry?.local).toBe(true);
    const slugs = DOC_SECTIONS[0].entries.map((e) => e.slug);
    expect(slugs.indexOf('install')).toBeLessThan(slugs.indexOf('getting-started'));
  });

  it('covers both channels, the beta tag, and the optional-dependency recovery', () => {
    const source = docSource('install') ?? '';
    expect(source).toContain('curl -fsSL https://get.gregale.dev | sh');
    expect(source).toContain('npm install -g gregale@rc');
    expect(source).toContain('--include=optional');
    expect(source).toMatch(/`latest`/);
    expect(source).toMatch(/`rc`/);
  });
});

describe('upstream customer-pages catalog', () => {
  // `poyrazK/faas` only emits docs URLs that are in its catalog, so every
  // catalogued path must land somewhere here: a page, a redirect, or a
  // deliberate "not yet" with a reason. See `docs-catalog.ts`.
  const paths = CATALOG_ROUTES.filter((r) => !r.external && r.path).map((r) => r.path);

  it('vendors a catalog', () => {
    expect(paths.length).toBeGreaterThan(50);
  });

  it('resolves every catalogued path or names why not', () => {
    const unresolved = paths.filter((p) => !resolveDocPath(p) && !(p in UNPUBLISHED_DOCS));
    expect(unresolved).toEqual([]);
  });

  it('drops a path from the unpublished list once it is published', () => {
    const stale = Object.keys(UNPUBLISHED_DOCS).filter((p) => resolveDocPath(p));
    expect(stale).toEqual([]);
  });

  it('aliases the paths that share a published source', () => {
    expect(DOC_ALIASES).toMatchObject({
      orgs: 'account',
      gdpr: 'account',
      builds: 'build',
      deploys: 'deploy-from-github',
      deployments: 'deploy-from-github',
      'build/source': 'deploy-from-github',
      'build/source-ref': 'deploy-from-source',
      'dpa/subprocessors': 'subprocessors',
      sidecars: 'companions',
      domains: 'custom-domains',
    });
  });

  it('collapses a child path onto its parent guide', () => {
    expect(resolveDocPath('domains/verify')).toEqual({ alias: 'custom-domains' });
    expect(resolveDocPath('build/limits')).toEqual({ slug: 'build' });
    expect(resolveDocPath('mcp/hosting')).toBeUndefined();
    expect(resolveDocPath('/docs-does-not-exist/')).toBeUndefined();
  });

  it('redirects every alias at the edge too', () => {
    const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
      routes: { src: string; status?: number; headers?: Record<string, string> }[];
    };
    const netlify = readFileSync('public/_redirects', 'utf8');
    const missing = Object.entries(DOC_ALIASES).flatMap(([alias, target]) => {
      const edge = vercel.routes.some(
        (r) =>
          r.src === `^/docs/${alias}/?$` &&
          r.status === 308 &&
          r.headers?.Location === `/docs/${target}`
      );
      const pages = new RegExp(`^/docs/${alias}\\s+/docs/${target}\\s+301$`, 'm').test(netlify);
      return edge && pages ? [] : [alias];
    });
    expect(missing).toEqual([]);
  });
});
