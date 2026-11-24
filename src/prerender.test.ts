import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePlanCatalog } from './lib/plan-catalog-parser';

/**
 * Guards the prerendered output.
 *
 * These read `dist/`, so they only run after a build. Skipped otherwise
 * rather than failing, so `npm run test` on a clean checkout is still green.
 * CI builds *before* running `check` precisely so these do not skip there —
 * see the ordering note in .github/workflows/ci.yml.
 */

const PAGES = [
  {
    route: '/',
    file: 'dist/index.html',
    title: 'Gregale — Deploy APIs and backends that scale to zero',
  },
  { route: '/login', file: 'dist/login/index.html', title: 'Sign in · Gregale' },
  { route: '/signup', file: 'dist/signup/index.html', title: 'Create account · Gregale' },
  { route: '/status', file: 'dist/status/index.html', title: 'Status · Gregale' },
  { route: '/pricing', file: 'dist/pricing/index.html', title: 'Pricing · Gregale' },
  {
    route: '/status/incidents/:id',
    file: 'dist/status/incidents/index.html',
    title: 'Status event · Gregale',
  },
];

const built = existsSync('dist/index.html');
const describeBuilt = built ? describe : describe.skip;

describeBuilt('prerendered pages', () => {
  it('gives /pricing one Offer per plan and its FAQ as structured data', () => {
    const html = readFileSync('dist/pricing/index.html', 'utf8');
    const json = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1];
    expect(json).toBeDefined();
    const graph = JSON.parse(json!)['@graph'] as { '@type': string; offers?: unknown[] }[];
    expect(graph.map((node) => node['@type'])).toEqual(['SoftwareApplication', 'FAQPage']);
    expect(graph[0].offers?.length).toBeGreaterThan(0);
  });

  it('links the DPA to the legal pages on the current origin', () => {
    const html = readFileSync('dist/docs/dpa/index.html', 'utf8');
    expect(html).toContain('href="/terms"');
    expect(html).toContain('href="/docs/subprocessors"');
  });

  for (const page of PAGES) {
    describe(page.route, () => {
      const html = built ? readFileSync(page.file, 'utf8') : '';
      const head = html.slice(0, html.indexOf('</head>'));
      const body = html.slice(html.indexOf('<body'));

      it('exists as its own document', () => {
        expect(existsSync(page.file)).toBe(true);
      });

      it('carries its own title, in the head', () => {
        expect(head).toContain(`<title>${page.title}</title>`);
      });

      it('has exactly one title — a second is an SEO smell and ambiguous', () => {
        expect(html.match(/<title>/g)).toHaveLength(1);
      });

      it('leaves no metadata stranded in the body, where unfurlers miss it', () => {
        expect(body).not.toContain('<title>');
        expect(body).not.toMatch(/<meta\s+property="og:/);
      });

      it('restates og:title to match the page', () => {
        expect(head).toContain(`<meta property="og:title" content="${page.title}" />`);
        expect(head.match(/property="og:title"/g)).toHaveLength(1);
      });

      it('carries exactly one description', () => {
        expect(head.match(/name="description"/g)).toHaveLength(1);
      });

      it('ships real markup, not an empty mount point', () => {
        // The whole point: a consumer that runs no JS still gets content.
        expect(html).not.toContain('<div id="root"></div>');
        const text = body
          .replace(/<script[\s\S]*?<\/script>/g, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        expect(text.length).toBeGreaterThan(100);
      });

      it('still loads the app bundle, so the SPA takes over', () => {
        expect(html).toMatch(/<script[^>]+type="module"[^>]+src="\/assets\/[^"]+\.js"/);
      });
    });
  }

  it('gives each route a distinct title', () => {
    const titles = PAGES.map(
      (p) => readFileSync(p.file, 'utf8').match(/<title>([^<]*)<\/title>/)![1]
    );
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('does not ship the SSR bundle', () => {
    expect(existsSync('dist-ssr')).toBe(false);
  });

  it('advertises Markdown only for docs that have a built Markdown copy', () => {
    expect(readFileSync('dist/docs/deploy-fastapi/index.html', 'utf8')).toContain(
      '<link rel="alternate" type="text/markdown" href="/docs/deploy-fastapi.md" />'
    );
    expect(existsSync('dist/docs/deploy-fastapi.md')).toBe(true);
    expect(readFileSync('dist/docs/api/apps/index.html', 'utf8')).not.toContain(
      'type="text/markdown"'
    );
  });

  it('publishes the research report, data, and citation metadata at stable URLs', () => {
    const route = '/research/firecracker-snapshot-restore-ssd-2026-09-09';
    const index = readFileSync('dist/research/index.html', 'utf8');
    const report = readFileSync(`dist${route}/index.html`, 'utf8');
    const summary = JSON.parse(readFileSync(`dist${route}/summary.json`, 'utf8'));
    const json = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(report)?.[1];

    expect(index).toContain(`href="${route}"`);
    expect(readFileSync('dist/index.html', 'utf8')).toContain('href="/research"');
    expect(report).toContain(`rel="canonical" href="https://gregale.dev${route}"`);
    expect(report).toContain(`type="text/markdown" href="${route}.md"`);
    expect(report).toContain(summary.platform_ms.p95.toFixed(3) + ' ms');
    expect(summary).not.toHaveProperty('public_request_ms');
    expect(readFileSync(`dist${route}/samples.csv`, 'utf8')).not.toContain('public_request_us');
    expect(JSON.parse(json!)).toMatchObject({
      '@type': 'TechArticle',
      datePublished: '2026-11-24',
      mainEntityOfPage: `https://gregale.dev${route}`,
    });
    for (const file of ['samples.csv', 'summary.json', 'analyze.py']) {
      expect(report).toContain(`href="${route}/${file}"`);
      expect(existsSync(`dist${route}/${file}`)).toBe(true);
    }
    expect(readFileSync('dist/sitemap.xml', 'utf8')).toContain(
      `<loc>https://gregale.dev${route}</loc>`
    );
    expect(readFileSync('dist/llms.txt', 'utf8')).toContain(`https://gregale.dev${route}.md`);
    const markdown = readFileSync(`dist${route}.md`, 'utf8');
    expect(markdown).toContain(`https://gregale.dev${route}/samples.csv`);
    for (const page of [index, report, markdown]) {
      expect(page).not.toMatch(/public request time|502\.180 ms/i);
    }
  });

  describe('robots.txt', () => {
    const robots =
      built && existsSync('dist/robots.txt') ? readFileSync('dist/robots.txt', 'utf8') : '';

    it.each(['OAI-SearchBot', 'GPTBot', 'ChatGPT-User', '*'])(
      'lets %s crawl public pages and excludes the auth-gated console',
      (agent) => {
        expect(robots.split('\n\n')).toContain(
          `User-agent: ${agent}\nDisallow: /dashboard\nDisallow: /onboarding\nAllow: /`
        );
      }
    );
  });

  describe('API reference', () => {
    it('prerenders a group with its operations in the markup', () => {
      const html = readFileSync('dist/docs/api/apps/index.html', 'utf8');
      expect(html).toContain('<title>Apps API · Gregale</title>');
      expect(html).toContain('id="createApp"');
      expect(html).toContain('/v1/apps');
    });

    it('lists the index and every group in the sitemap', () => {
      const sitemap = readFileSync('dist/sitemap.xml', 'utf8');
      expect(sitemap).toContain('<loc>https://gregale.dev/docs/api</loc>');
      expect(sitemap).toContain('<loc>https://gregale.dev/docs/api/deployments</loc>');
    });
  });

  describe('indexing directives', () => {
    it('lets the landing page be indexed', () => {
      expect(readFileSync('dist/index.html', 'utf8')).not.toContain('name="robots"');
    });

    it('indexes the public status overview', () => {
      expect(readFileSync('dist/status/index.html', 'utf8')).not.toContain('name="robots"');
      expect(readFileSync('dist/sitemap.xml', 'utf8')).toContain(
        '<loc>https://gregale.dev/status</loc>'
      );
      expect(readFileSync('dist/sitemap.xml', 'utf8')).not.toContain('/status/incidents/');
    });

    it('omits modification dates for the live status overview', () => {
      const sitemap = readFileSync('dist/sitemap.xml', 'utf8');
      expect(sitemap).toMatch(/<loc>https:\/\/gregale\.dev\/status<\/loc>\s*<\/url>/);
    });

    it('serves direct incident links from a noindex status-event shell', () => {
      const incident = readFileSync('dist/status/incidents/index.html', 'utf8');
      expect(incident).toContain('content="noindex, follow"');
      expect(incident).toContain('Gregale Status');
      expect(incident).not.toContain('rel="canonical"');
      expect(incident).not.toContain('application/ld+json');
    });

    it('prerenders meaningful styled status fallback content', () => {
      const status = readFileSync('dist/status/index.html', 'utf8');
      expect(status).toContain('API &amp; Console');
      expect(status).toContain('Observability');
      expect(status).toMatch(/href="\/assets\/[^"]+\.css"/);
    });

    it('keeps the auth pages out of search results', () => {
      // Prerendered for link previews, but they are not search results.
      for (const file of ['dist/login/index.html', 'dist/signup/index.html']) {
        expect(readFileSync(file, 'utf8')).toContain('content="noindex, follow"');
      }
    });
  });

  it('publishes and links JSON pricing derived from the published plan table', () => {
    const catalog = parsePlanCatalog(readFileSync('content/docs/plans.md', 'utf8'));
    expect(JSON.parse(readFileSync('dist/pricing.json', 'utf8'))).toEqual({
      source: 'https://gregale.dev/docs/plans',
      billingInterval: 'month',
      pricesExcludeTax: true,
      currency: catalog.currency,
      plans: [
        { ...catalog.plans[0], computeOverage: { policy: 'hard-cap' } },
        ...catalog.plans.slice(1).map((plan) => ({
          ...plan,
          computeOverage: {
            policy: 'metered',
            pricePerGbRamHour: catalog.overagePerGbHour,
            subjectToSpendCap: true,
          },
        })),
      ],
    });
    for (const path of ['dist/pricing/index.html', 'dist/docs/plans/index.html']) {
      expect(readFileSync(path, 'utf8')).toContain(
        '<link rel="alternate" type="application/json" href="/pricing.json" />'
      );
    }
  });

  /**
   * Prerendered markup has to be *visible*, not merely present.
   *
   * Motion serialises its `initial` prop into the static HTML, so a
   * mount-triggered entrance above the fold ships as `style="opacity:0"` and
   * stays invisible until the bundle downloads and hydrates. The hero emblem
   * carries no animation, so it was the one thing that painted — the mark
   * alone on an otherwise blank page for as long as the network took.
   *
   * Below the fold is a different case and deliberately not asserted here:
   * `whileInView` content is supposed to start hidden.
   */
  describe('above-the-fold content paints without JS', () => {
    const landing = built ? readFileSync('dist/index.html', 'utf8') : '';

    function openingTag(tag: string): string {
      const m = landing.match(new RegExp(`<${tag}[^>]*>`));
      expect(m, `no <${tag}> in the prerendered landing page`).not.toBeNull();
      return m![0];
    }

    it('does not ship the nav hidden', () => {
      expect(openingTag('header')).not.toMatch(/opacity:\s*0/);
    });

    it('does not ship the headline hidden', () => {
      expect(openingTag('h1')).not.toMatch(/opacity:\s*0/);
    });

    it('does not let the emblem be the only thing painted', () => {
      // The emblem renders at opacity 1. If the headline needs JS to become
      // visible and the emblem does not, the mark flashes on its own.
      const emblem = landing.match(/<div[^>]*data-emblem[^>]*>/)?.[0] ?? '';
      expect(emblem).toContain('opacity:1');
      expect(openingTag('h1')).not.toMatch(/opacity:\s*0/);
    });
  });
});

/**
 * The JSON-LD block is the copy a search engine reads, and nothing in the
 * component tests covers it. Both guards below are for claims that were
 * wrong here while the visible page was right: a bare wake figure with its
 * measurement boundary stripped off, and an "open source" description of a
 * repository whose LICENSE is proprietary.
 */
describeBuilt('fonts', () => {
  // Self-hosted and content-hashed: every @font-face in the built CSS points at
  // /assets/<name>-<hash>.woff2, which vercel.json caches for a year, and no
  // rule still points at the unhashed /fonts/ path or at a CDN.
  it('are served as hashed assets from this origin', () => {
    const css = readdirSync('dist/assets')
      .filter((f) => f.endsWith('.css'))
      .map((f) => readFileSync(`dist/assets/${f}`, 'utf8'))
      .join('\n');
    const refs = css.match(/url\(\/assets\/[a-z0-9-]+-[A-Za-z0-9_-]+\.woff2\)/g) ?? [];
    expect(new Set(refs).size).toBe(8);
    expect(css).not.toMatch(/\/fonts\/|googleapis|gstatic|fontshare/);
    for (const ref of new Set(refs)) {
      expect(existsSync(`dist${ref.slice('url('.length, -1)}`), ref).toBe(true);
    }
  });
});

describeBuilt('structured data', () => {
  const ld = built
    ? (readFileSync('dist/index.html', 'utf8').match(
        /<script type="application\/ld\+json">([\s\S]*?)<\/script>/
      )?.[1] ?? '')
    : '';

  it('is present on the landing page', () => {
    expect(JSON.parse(ld)['@graph']).toBeInstanceOf(Array);
  });

  it('does not state the wake figure without its measurement boundary', () => {
    expect(ld).not.toMatch(/350\s*ms/);
  });

  it('does not call a proprietary product open source', () => {
    expect(ld).not.toMatch(/open[\s-]?source/i);
  });
});
