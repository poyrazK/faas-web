import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

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
    title: 'Gregale — Serverless on real microVMs',
  },
  { route: '/login', file: 'dist/login/index.html', title: 'Sign in · Gregale' },
  { route: '/signup', file: 'dist/signup/index.html', title: 'Create account · Gregale' },
  { route: '/status', file: 'dist/status/index.html', title: 'Status · Gregale' },
  {
    route: '/status/incidents/:id',
    file: 'dist/status/incidents/index.html',
    title: 'Status event · Gregale',
  },
];

const built = existsSync('dist/index.html');
const describeBuilt = built ? describe : describe.skip;

describeBuilt('prerendered pages', () => {
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

  describe('robots.txt', () => {
    const robots =
      built && existsSync('dist/robots.txt') ? readFileSync('dist/robots.txt', 'utf8') : '';

    it('is written', () => {
      expect(robots).toContain('User-agent: *');
    });

    it('keeps crawlers out of the auth-gated console', () => {
      // Following these only ever reaches a login screen.
      expect(robots).toContain('Disallow: /dashboard');
      expect(robots).toContain('Disallow: /onboarding');
    });

    it('leaves the marketing site crawlable', () => {
      expect(robots).toContain('Allow: /');
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
    const landing = readFileSync('dist/index.html', 'utf8');

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
