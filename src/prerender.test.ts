import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { comparisons } from './lib/compare';
import { parsePlanCatalog } from './lib/plan-catalog-parser';
import { SOLUTIONS } from './lib/solutions';

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
    title: 'Gregale — Backend cloud for APIs, Postgres &amp; coding agents',
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

  it('keeps every page description within a search snippet', () => {
    // Bing Webmaster Tools reports a description outside 25–160 characters
    // as an error on the page.
    const decode = (text: string) =>
      text
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
    const outside: string[] = [];
    const files = readdirSync('dist', { recursive: true, encoding: 'utf8' });
    for (const file of files.filter((name) => name.endsWith('index.html'))) {
      const html = readFileSync(`dist/${file}`, 'utf8');
      const content = /<meta name="description" content="([^"]*)"/.exec(html)?.[1];
      if (content === undefined) continue;
      const length = decode(content).length;
      if (length < 25 || length > 160) outside.push(`${file}: ${length}`);
    }
    expect(outside).toEqual([]);
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

  it.each([
    ['dist/index.html', '/index.md', 'https://gregale.dev/'],
    ['dist/pricing/index.html', '/pricing.md', 'https://gregale.dev/pricing'],
    ['dist/docs/index.html', '/docs.md', 'https://gregale.dev/docs'],
    ['dist/articles/index.html', '/articles.md', 'https://gregale.dev/articles'],
    ['dist/features/index.html', '/features.md', 'https://gregale.dev/features'],
    ['dist/templates/index.html', '/templates.md', 'https://gregale.dev/templates'],
    ['dist/research/index.html', '/research.md', 'https://gregale.dev/research'],
  ])('publishes %s as Markdown at %s', (html, markdown, canonical) => {
    expect(readFileSync(html, 'utf8')).toContain(
      `<link rel="alternate" type="text/markdown" href="${markdown}" />`
    );
    const page = readFileSync(`dist${markdown}`, 'utf8');
    expect(page.startsWith('# ')).toBe(true);
    expect(page.trimEnd().endsWith(`Canonical URL: ${canonical}`)).toBe(true);
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
    for (const file of [
      'samples.csv',
      'summary.json',
      'analyze.py',
      'README.md',
      'reproduction.tar.gz',
    ]) {
      expect(report).toContain(`href="${route}/${file}"`);
      expect(existsSync(`dist${route}/${file}`)).toBe(true);
    }
    const ldBlocks = [
      ...report.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g),
    ].map((match) => JSON.parse(match[1]));
    const dataset = ldBlocks.find((node) => node['@type'] === 'Dataset');
    expect(dataset).toMatchObject({
      '@type': 'Dataset',
      '@id': `https://gregale.dev${route}#dataset`,
      isAccessibleForFree: true,
      temporalCoverage: '2026-09-09',
    });
    expect(dataset.distribution.map((entry: { contentUrl: string }) => entry.contentUrl)).toEqual(
      expect.arrayContaining([
        `https://gregale.dev${route}/reproduction.tar.gz`,
        `https://gregale.dev${route}/samples.csv`,
      ])
    );
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

  it('publishes the FastAPI cost study and links it from pricing and deployment docs', () => {
    const route = '/research/intermittent-fastapi-cost-2026-11-24';
    const report = readFileSync(`dist${route}/index.html`, 'utf8');
    const summary = JSON.parse(readFileSync(`dist${route}/summary.json`, 'utf8'));

    for (const page of ['research', 'pricing', 'docs/deploy-fastapi']) {
      expect(readFileSync(`dist/${page}/index.html`, 'utf8')).toContain(`href="${route}"`);
    }
    expect(readFileSync('dist/docs/deploy-fastapi.md', 'utf8')).toContain(
      `https://gregale.dev${route}`
    );
    expect(readFileSync('dist/docs/scale-to-zero.md', 'utf8')).toContain(
      'scheduler interval from `wake.boot_started` to `wake.boot_completed`'
    );
    expect(report).toContain(`rel="canonical" href="https://gregale.dev${route}"`);
    expect(report).toContain(`type="text/markdown" href="${route}.md"`);
    expect(report).toContain(
      `${summary.burst_compute_reduction_percent.toFixed(1)}% less billable compute`
    );
    expect(report).toContain(summary.totals.spread.gb_ram_hours.toFixed(6));
    expect(report).toContain(summary.totals.burst.gb_ram_hours.toFixed(6));
    for (const file of [
      'reproduction.tar.gz',
      'traffic.csv',
      'ledger.json',
      'states.csv',
      'pricing.json',
      'summary.json',
      'run.py',
      'analyze.py',
      'fixture/main.py',
      'fixture/requirements.txt',
      'fixture/gregale.yaml',
    ]) {
      expect(report).toContain(`href="${route}/${file}"`);
      expect(existsSync(`dist${route}/${file}`)).toBe(true);
    }
    expect(existsSync(`dist${route}/README.md`)).toBe(true);
    const ldBlocks = [
      ...report.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g),
    ].map((match) => JSON.parse(match[1]));
    const dataset = ldBlocks.find((node) => node['@type'] === 'Dataset');
    expect(dataset).toMatchObject({
      '@type': 'Dataset',
      '@id': `https://gregale.dev${route}#dataset`,
      isAccessibleForFree: true,
      temporalCoverage: '2026-11-24',
    });
    expect(dataset.distribution.map((entry: { contentUrl: string }) => entry.contentUrl)).toContain(
      `https://gregale.dev${route}/reproduction.tar.gz`
    );
    expect(readFileSync('dist/sitemap.xml', 'utf8')).toContain(
      `<loc>https://gregale.dev${route}</loc>`
    );
    expect(readFileSync('dist/llms.txt', 'utf8')).toContain(`https://gregale.dev${route}.md`);
  });

  it('publishes each article as answer-first HTML with matching FAQ data', () => {
    const cases = [
      { slug: 'canary-deploys', doc: 'rollouts', answer: 'every production release is a canary' },
      { slug: 'microvm-isolation', doc: 'security', answer: 'in its own Firecracker microVM' },
      {
        slug: 'preview-environments',
        doc: 'preview-environments',
        answer: 'creates a preview environment for every pull request',
      },
      {
        slug: 'mcp-server-hosting',
        doc: 'mcp-hosting',
        answer: 'Host a remote MCP server',
        modified: '2026-11-25',
      },
      {
        slug: 'backend-without-devops',
        doc: 'getting-started',
        answer: 'A startup without a DevOps engineer should host its backend',
        modified: '2026-11-26',
      },
    ];
    for (const { slug, doc, answer, modified } of cases) {
      const route = `/articles/${slug}`;
      const html = readFileSync(`dist${route}/index.html`, 'utf8');
      const json = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1];
      const graph = JSON.parse(json!)['@graph'];
      const faq = graph.find((node: { '@type': string }) => node['@type'] === 'FAQPage');
      const questions = faq.mainEntity.map((entry: { name: string }) => entry.name);

      expect(html).toContain(answer);
      expect(html).toContain(`rel="canonical" href="https://gregale.dev${route}"`);
      expect(html).toContain(`type="text/markdown" href="${route}.md"`);
      expect(graph[0]).toMatchObject({
        '@type': 'TechArticle',
        dateModified: modified ?? '2026-11-24',
      });
      expect(questions.length).toBeGreaterThan(0);
      for (const question of questions) expect(html).toContain(question.replaceAll("'", '&#x27;'));
      expect(JSON.stringify(faq)).not.toContain('`');
      for (const page of ['articles', `docs/${doc}`]) {
        expect(readFileSync(`dist/${page}/index.html`, 'utf8')).toContain(`href="${route}"`);
      }
      expect(readFileSync('dist/sitemap.xml', 'utf8')).toContain(
        `<loc>https://gregale.dev${route}</loc>`
      );
      expect(readFileSync('dist/llms.txt', 'utf8')).toContain(`https://gregale.dev${route}.md`);
      expect(readFileSync(`dist${route}.md`, 'utf8')).toContain(questions[0]);
    }
    expect(readFileSync('dist/index.html', 'utf8')).toContain('href="/articles"');
  });

  it('publishes the 4 framework + Postgres answer articles with doc cross-links and /deploy links', () => {
    const frameworkCases = [
      {
        slug: 'host-nextjs-postgres-outside-vercel',
        doc: 'deploy-nextjs',
        repo: 'nextjs-postgres-starter',
      },
      {
        slug: 'host-bun-hono-postgres-api',
        doc: 'deploy-bun',
        repo: 'bun-hono-postgres-starter',
      },
      {
        slug: 'host-django-postgres-migrations-rollback',
        doc: 'deploy-django',
        repo: 'postgres-migration-rollback-demo',
      },
      {
        slug: 'host-go-api-scale-to-zero',
        doc: 'deploy-go',
        repo: 'mcp-server-go',
      },
    ];
    for (const { slug, doc, repo } of frameworkCases) {
      const route = `/articles/${slug}`;
      const html = readFileSync(`dist${route}/index.html`, 'utf8');
      const md = readFileSync(`dist${route}.md`, 'utf8');
      const json = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1];
      const graph = JSON.parse(json!)['@graph'];
      const faq = graph.find((node: { '@type': string }) => node['@type'] === 'FAQPage');

      expect(graph[0]).toMatchObject({ '@type': 'TechArticle', dateModified: '2026-11-26' });
      expect(faq.mainEntity.length).toBeGreaterThanOrEqual(3);
      expect(JSON.stringify(faq)).not.toContain('`');
      expect(html).toContain(`/deploy?repo=https://github.com/gregale-dev/${repo}`);
      expect(md).toContain(`/deploy?repo=https://github.com/gregale-dev/${repo}`);
      expect(readFileSync('dist/articles/index.html', 'utf8')).toContain(`href="${route}"`);
      expect(readFileSync(`dist/docs/${doc}/index.html`, 'utf8')).toContain(`href="${route}"`);
      expect(readFileSync(`dist/docs/${doc}.md`, 'utf8')).toContain(`https://gregale.dev${route}`);
      expect(readFileSync('dist/sitemap.xml', 'utf8')).toContain(
        `<loc>https://gregale.dev${route}</loc>`
      );
      expect(readFileSync('dist/llms.txt', 'utf8')).toContain(`https://gregale.dev${route}.md`);
    }
  });

  it('publishes the 4 untapped capability articles with schema, doc cross-links, sitemap and llms.txt', () => {
    const cases = [
      {
        slug: 'direct-browser-uploads-resumable-multipart-storage',
        docs: ['object-storage'],
      },
      {
        slug: 'delayed-tasks-without-redis-scale-to-zero',
        docs: ['crons', 'event-driven'],
      },
      {
        slug: 'preview-deploy-diff-and-environment-drift',
        docs: ['releases', 'env'],
      },
      {
        slug: 'debug-production-5xx-crash-snapshots-and-profile-diffs',
        docs: ['tracing', 'troubleshooting'],
      },
    ];
    for (const { slug, docs } of cases) {
      const route = `/articles/${slug}`;
      const html = readFileSync(`dist${route}/index.html`, 'utf8');
      const md = readFileSync(`dist${route}.md`, 'utf8');
      const json = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1];
      const graph = JSON.parse(json!)['@graph'];
      const faq = graph.find((node: { '@type': string }) => node['@type'] === 'FAQPage');

      expect(graph[0]).toMatchObject({ '@type': 'TechArticle', datePublished: '2026-11-27' });
      expect(faq.mainEntity.length).toBeGreaterThanOrEqual(3);
      expect(JSON.stringify(faq)).not.toContain('`');
      expect(md).toContain(`Canonical URL: https://gregale.dev${route}`);
      expect(readFileSync('dist/articles/index.html', 'utf8')).toContain(`href="${route}"`);
      for (const doc of docs) {
        expect(readFileSync(`dist/docs/${doc}/index.html`, 'utf8')).toContain(`href="${route}"`);
        expect(readFileSync(`dist/docs/${doc}.md`, 'utf8')).toContain(
          `https://gregale.dev${route}`
        );
      }
      expect(readFileSync('dist/sitemap.xml', 'utf8')).toContain(
        `<loc>https://gregale.dev${route}</loc>`
      );
      expect(readFileSync('dist/llms.txt', 'utf8')).toContain(`https://gregale.dev${route}.md`);
    }
  });

  it('publishes the /features hub and all 8 flagship feature pages with schema and Markdown', () => {
    const slugs = [
      'database-rollbacks',
      'edge-security',
      'realtime-scale-to-zero',
      'durable-webhooks-and-workflows',
      'firecracker-scale-to-zero',
      'zero-secret-outbound',
      'mcp-hosting',
      'strict-budgets',
    ];
    const hub = readFileSync('dist/features/index.html', 'utf8');
    const sitemap = readFileSync('dist/sitemap.xml', 'utf8');
    const llms = readFileSync('dist/llms.txt', 'utf8');
    const full = readFileSync('dist/llms-full.txt', 'utf8');

    expect(readFileSync('dist/index.html', 'utf8')).toContain('href="/features"');
    expect(hub).toContain('rel="canonical" href="https://gregale.dev/features"');
    expect(hub).toContain('type="text/markdown" href="/features.md"');
    expect(sitemap).toContain('<loc>https://gregale.dev/features</loc>');

    for (const slug of slugs) {
      const route = `/features/${slug}`;
      const html = readFileSync(`dist${route}/index.html`, 'utf8');
      const md = readFileSync(`dist${route}.md`, 'utf8');
      const json = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1];
      const graph = JSON.parse(json!)['@graph'];
      const faq = graph.find((node: { '@type': string }) => node['@type'] === 'FAQPage');

      expect(hub).toContain(`href="${route}"`);
      expect(html).toContain(`rel="canonical" href="https://gregale.dev${route}"`);
      expect(html).toContain(`type="text/markdown" href="${route}.md"`);
      expect(graph[0]).toMatchObject({ '@type': 'TechArticle', dateModified: '2026-11-26' });
      expect(faq.mainEntity.length).toBeGreaterThan(0);
      expect(JSON.stringify(faq)).not.toContain('`');
      expect(md).toContain(`Canonical URL: https://gregale.dev${route}`);
      expect(full).toContain(md.split('\n')[0]);
      expect(sitemap).toContain(`<loc>https://gregale.dev${route}</loc>`);
      expect(llms).toContain(`https://gregale.dev${route}.md`);
    }

    const vercel = readFileSync('vercel.json', 'utf8');
    expect(vercel).toContain('^/(pricing|docs|solutions|articles|research|features|templates)$');
    expect(vercel).toContain('^/(solutions|articles|research|features|vs)/([a-z0-9_-]+)$');
    expect(readFileSync('dist/features/database-rollbacks/index.html', 'utf8')).toContain(
      'https://github.com/gregale-dev/postgres-migration-rollback-demo'
    );
    expect(readFileSync('dist/templates/index.html', 'utf8')).toContain(
      'https://github.com/gregale-dev/setup-gregale'
    );
    expect(readFileSync('dist/templates/index.html', 'utf8')).toContain(
      'https://github.com/gregale-dev/community/discussions'
    );
    expect(readFileSync('dist/templates/index.html', 'utf8')).toContain(
      '/deploy?repo=https%3A%2F%2Fgithub.com%2Fgregale-dev%2Fpostgres-migration-rollback-demo'
    );
    expect(readFileSync('dist/deploy/index.html', 'utf8')).toContain('Deploy on Gregale');
    expect(readFileSync('dist/deploy-badge.svg', 'utf8')).toContain('Deploy on Gregale');
    expect(readFileSync('dist/templates.md', 'utf8')).toContain(
      'https://github.com/gregale-dev/community/discussions'
    );
    expect(readFileSync('dist/llms.txt', 'utf8')).toContain('https://gregale.dev/templates.md');
  });

  it('publishes each alternatives roundup and links it from its comparison page', () => {
    const cases = [
      {
        slug: 'railway-alternatives',
        vs: 'railway',
        doc: 'migrate-from-railway',
        date: '2026-11-28',
      },
      {
        slug: 'heroku-alternatives',
        vs: 'heroku',
        doc: 'migrate-from-heroku',
        date: '2026-11-28',
      },
      {
        slug: 'render-alternatives',
        vs: 'render',
        doc: 'migrate-from-render',
        date: '2026-11-28',
      },
      { slug: 'flyio-alternatives', vs: 'fly', doc: 'migrate-from-fly', date: '2026-11-28' },
      {
        slug: 'cloud-run-alternatives',
        vs: 'cloud-run',
        doc: 'migrate-from-cloud-run',
        date: '2026-11-26',
      },
      { slug: 'vercel-alternatives', vs: 'vercel', doc: 'migrate-from-vercel', date: '2026-11-26' },
      { slug: 'koyeb-alternatives', vs: 'koyeb', doc: 'migrate-from-koyeb', date: '2026-11-26' },
      {
        slug: 'northflank-alternatives',
        vs: 'northflank',
        doc: 'migrate-from-northflank',
        date: '2026-11-26',
      },
      { slug: 'coolify-alternatives', vs: 'coolify', doc: null, date: '2026-11-26' },
      {
        slug: 'cloudflare-workers-alternatives',
        vs: 'cloudflare-workers',
        doc: null,
        date: '2026-11-26',
      },
      {
        slug: 'aws-app-runner-alternatives',
        vs: 'aws',
        doc: null,
        date: '2026-11-26',
      },
      {
        slug: 'digitalocean-app-platform-alternatives',
        vs: 'digitalocean',
        doc: 'migrate-from-digitalocean',
        date: '2026-11-26',
      },
      {
        slug: 'replit-alternatives',
        vs: 'replit',
        doc: 'migrate-from-replit',
        date: '2026-11-26',
      },
    ];
    for (const { slug, vs, doc, date } of cases) {
      const route = `/articles/${slug}`;
      const html = readFileSync(`dist${route}/index.html`, 'utf8');
      const json = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1];
      const graph = JSON.parse(json!)['@graph'];
      const faq = graph.find((node: { '@type': string }) => node['@type'] === 'FAQPage');

      expect(html).toContain('alternatives in 2026');
      expect(html).toContain('Gregale publishes this page');
      expect(graph[0]).toMatchObject({ '@type': 'TechArticle', dateModified: date });
      expect(faq.mainEntity.length).toBeGreaterThan(0);
      for (const page of ['articles', `vs/${vs}`, ...(doc ? [`docs/${doc}`] : [])]) {
        expect(readFileSync(`dist/${page}/index.html`, 'utf8')).toContain(`href="${route}"`);
      }
      expect(html).toContain(`href="/vs/${vs}"`);
      expect(readFileSync('dist/sitemap.xml', 'utf8')).toContain(
        `<loc>https://gregale.dev${route}</loc>`
      );
      expect(readFileSync('dist/llms.txt', 'utf8')).toContain(`https://gregale.dev${route}.md`);
    }
  });

  it('publishes the 4 untapped capability articles with schema, doc cross-links, sitemap and llms.txt', () => {
    const cases = [
      {
        slug: 'direct-browser-uploads-resumable-multipart-storage',
        docs: ['object-storage'],
      },
      {
        slug: 'delayed-tasks-without-redis-scale-to-zero',
        docs: ['crons', 'event-driven'],
      },
      {
        slug: 'preview-deploy-diff-and-environment-drift',
        docs: ['releases', 'env'],
      },
      {
        slug: 'debug-production-5xx-crash-snapshots-and-profile-diffs',
        docs: ['tracing', 'troubleshooting'],
      },
    ];
    for (const { slug, docs } of cases) {
      const route = `/articles/${slug}`;
      const html = readFileSync(`dist${route}/index.html`, 'utf8');
      const md = readFileSync(`dist${route}.md`, 'utf8');
      const json = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1];
      const graph = JSON.parse(json!)['@graph'];
      const faq = graph.find((node: { '@type': string }) => node['@type'] === 'FAQPage');

      expect(graph[0]).toMatchObject({ '@type': 'TechArticle', datePublished: '2026-11-27' });
      expect(faq.mainEntity.length).toBeGreaterThanOrEqual(3);
      expect(JSON.stringify(faq)).not.toContain('`');
      expect(md).toContain(`Canonical URL: https://gregale.dev${route}`);
      expect(readFileSync('dist/articles/index.html', 'utf8')).toContain(`href="${route}"`);
      for (const doc of docs) {
        expect(readFileSync(`dist/docs/${doc}/index.html`, 'utf8')).toContain(`href="${route}"`);
        expect(readFileSync(`dist/docs/${doc}.md`, 'utf8')).toContain(
          `https://gregale.dev${route}`
        );
      }
      expect(readFileSync('dist/sitemap.xml', 'utf8')).toContain(
        `<loc>https://gregale.dev${route}</loc>`
      );
      expect(readFileSync('dist/llms.txt', 'utf8')).toContain(`https://gregale.dev${route}.md`);
    }
  });

  it('publishes all 6 new migration docs with markdown copies, sitemap and llms.txt', () => {
    const slugs = [
      'migrate-from-vercel',
      'migrate-from-cloud-run',
      'migrate-from-koyeb',
      'migrate-from-northflank',
      'migrate-from-digitalocean',
      'migrate-from-replit',
    ];
    const sitemap = readFileSync('dist/sitemap.xml', 'utf8');
    const llms = readFileSync('dist/llms.txt', 'utf8');
    for (const slug of slugs) {
      const html = readFileSync(`dist/docs/${slug}/index.html`, 'utf8');
      const md = readFileSync(`dist/docs/${slug}.md`, 'utf8');
      expect(html).toContain('How ');
      expect(md).not.toContain('https://github.com/poyrazK/faas/blob/main/content/docs/');
      expect(sitemap).toContain(`<loc>https://gregale.dev/docs/${slug}</loc>`);
      expect(llms).toContain(`https://gregale.dev/docs/${slug}.md`);
    }
  });

  it('publishes each comparison page as Markdown and lists it for agents', () => {
    const llms = readFileSync('dist/llms.txt', 'utf8');
    const full = readFileSync('dist/llms-full.txt', 'utf8');
    const catalog = parsePlanCatalog(readFileSync('content/docs/plans.md', 'utf8'));
    for (const slug of [
      'heroku',
      'render',
      'railway',
      'fly',
      'cloud-run',
      'vercel',
      'koyeb',
      'northflank',
      'coolify',
      'cloudflare-workers',
      'aws',
      'digitalocean',
      'replit',
    ]) {
      const route = `/vs/${slug}`;
      const markdown = readFileSync(`dist${route}.md`, 'utf8');
      expect(markdown.startsWith('# Gregale vs ')).toBe(true);
      expect(markdown).toContain(`Canonical URL: https://gregale.dev${route}`);
      expect(full).toContain(markdown.split('\n')[0]);
      expect(readFileSync(`dist${route}/index.html`, 'utf8')).toContain(
        `type="text/markdown" href="${route}.md"`
      );
      expect(llms).toContain(`https://gregale.dev${route}.md`);
      // Each page links its own handful of guides, not every article: a shared
      // list made the /vs pages near-duplicates of each other.
      const html = readFileSync(`dist${route}/index.html`, 'utf8');
      const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
      const articleLinks = new Set(main.match(/href="\/articles\/[^"]+"/g));
      expect(articleLinks.size, route).toBeLessThanOrEqual(10);
      const guides = comparisons(catalog).find((c) => c.slug === slug)!.articles;
      for (const guide of guides) expect(main, route).toContain(`href="/articles/${guide}"`);
    }
  });

  it('publishes the AI coding agents guide article and links it from agent docs', () => {
    const route = '/articles/best-cloud-for-ai-coding-agents';
    const html = readFileSync(`dist${route}/index.html`, 'utf8');
    const json = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1];
    const graph = JSON.parse(json!)['@graph'];
    expect(graph[0]).toMatchObject({ '@type': 'TechArticle', dateModified: '2026-11-26' });
    expect(readFileSync('dist/docs/agents/index.html', 'utf8')).toContain(`href="${route}"`);
    expect(readFileSync('dist/docs/agents.md', 'utf8')).toContain(`https://gregale.dev${route}`);
    expect(readFileSync('dist/llms.txt', 'utf8')).toContain(`https://gregale.dev${route}.md`);

    for (const [slug, doc] of [
      ['cursor-deploy-production-safely', 'cursor'],
      ['codex-deploy-production-safely', 'codex'],
      ['gemini-cli-deploy-production-safely', 'gemini-cli'],
    ]) {
      const agentRoute = `/articles/${slug}`;
      const agentHtml = readFileSync(`dist${agentRoute}/index.html`, 'utf8');
      const agentJson = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(
        agentHtml
      )?.[1];
      const agentGraph = JSON.parse(agentJson!)['@graph'];
      expect(agentGraph[0]).toMatchObject({ '@type': 'TechArticle', dateModified: '2026-11-25' });
      expect(readFileSync(`dist/docs/${doc}/index.html`, 'utf8')).toContain(`href="${agentRoute}"`);
      expect(readFileSync('dist/llms.txt', 'utf8')).toContain(
        `https://gregale.dev${agentRoute}.md`
      );
    }
  });

  it('publishes each niche capability article with schema, feeds and doc cross-links', () => {
    const cases = [
      { slug: 'websockets-sse-scale-to-zero', doc: 'realtime' },
      { slug: 'durable-inbound-webhooks-scale-to-zero', doc: 'inbound-webhooks' },
      { slug: 'declarative-edge-response-cache', doc: 'cache' },
      { slug: 'zero-secret-outbound-api-relay', doc: 'outbound-integrations' },
      { slug: 'openapi-breaking-change-deploy-gate', doc: 'api-hosting-openapi' },
      { slug: 'durable-code-workflows-scale-to-zero', doc: 'code-workflows' },
      { slug: 'zero-restart-secret-rotation', doc: 'secrets', modified: '2026-11-27' },
      { slug: 'private-microservice-networking-no-vpc', doc: 'internal-services' },
      { slug: 'sidecar-companions-without-kubernetes', doc: 'companions' },
      { slug: 'pull-queue-workers-workload-identity', doc: 'queue-pull-leases' },
      { slug: 'hard-cloud-spend-caps', doc: 'cost-controls', modified: '2026-11-28' },
      { slug: 'zero-code-otel-sql-regression-tracing', doc: 'tracing' },
      { slug: 'autoscale-from-zero-kafka-lag-custom-metrics', doc: 'scaling-policy' },
      { slug: 'promote-staging-to-production-without-rebuilding', doc: 'environment-promotion' },
      { slug: 'synthetic-uptime-checks-scale-to-zero', doc: 'synthetic-checks' },
      { slug: 'static-egress-ip-scale-to-zero', doc: 'static-egress-ip' },
      { slug: 'atomic-multi-service-releases', doc: 'project-releases' },
      { slug: 'pre-traffic-service-binding-verification', doc: 'service-bindings' },
      { slug: 'deploy-freezes-release-approvals-schedules', doc: 'release-controls' },
      { slug: 'edge-rules-rate-limiting-trace-testing', doc: 'edge-rules' },
      { slug: 'scale-to-zero-cron-jobs-event-triggers', doc: 'crons' },
      { slug: 'private-object-storage-without-s3-iam', doc: 'object-storage' },
      { slug: 'ssrf-protection-egress-denylist-paas', doc: 'egress-denylist' },
      { slug: 'stored-workflow-recovery-missed-schedules', doc: 'stored-workflows-recovery' },
      { slug: 'deploy-docker-container-scale-to-zero-no-rewrite', doc: 'container-compatibility' },
      { slug: 'antigravity-ide-mcp-server-deploy', doc: 'antigravity' },
      { slug: 'stop-bot-traffic-cloud-bill-shock', doc: 'security' },
      { slug: 'deploy-vibe-coded-app-to-production', doc: 'agents' },
      { slug: 'host-python-fastmcp-server', doc: 'mcp-hosting' },
      { slug: 'remote-dev-environment-without-docker-desktop', doc: 'dev' },
      { slug: 'password-protect-app-basic-auth-ip-allowlist', doc: 'auth', modified: '2026-11-27' },
      {
        slug: 'run-code-on-file-upload-bucket-trigger',
        doc: 'object-storage',
        modified: '2026-11-27',
      },
      {
        slug: 'chained-cold-starts-wake-services-together',
        doc: 'multi-service',
        modified: '2026-11-27',
      },
    ];
    const articlesIndex = readFileSync('dist/articles/index.html', 'utf8');
    const sitemap = readFileSync('dist/sitemap.xml', 'utf8');
    const feed = readFileSync('dist/feed.xml', 'utf8');
    const llms = readFileSync('dist/llms.txt', 'utf8');

    for (const { slug, doc, modified } of cases) {
      const route = `/articles/${slug}`;
      const html = readFileSync(`dist${route}/index.html`, 'utf8');
      const json = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1];
      const graph = JSON.parse(json!)['@graph'];
      const faq = graph.find((node: { '@type': string }) => node['@type'] === 'FAQPage');

      expect(html).toContain(`rel="canonical" href="https://gregale.dev${route}"`);
      expect(html).toContain(`type="text/markdown" href="${route}.md"`);
      expect(graph[0]).toMatchObject({
        '@type': 'TechArticle',
        dateModified: modified ?? '2026-11-26',
      });
      expect(faq.mainEntity.length).toBeGreaterThan(0);
      expect(JSON.stringify(faq)).not.toContain('`');
      expect(existsSync(`dist${route}.md`)).toBe(true);
      expect(articlesIndex).toContain(`href="${route}"`);
      expect(sitemap).toContain(`<loc>https://gregale.dev${route}</loc>`);
      expect(feed).toContain(`<id>https://gregale.dev${route}</id>`);
      expect(llms).toContain(`https://gregale.dev${route}.md`);
      expect(readFileSync(`dist/docs/${doc}/index.html`, 'utf8')).toContain(`href="${route}"`);
      expect(readFileSync(`dist/docs/${doc}.md`, 'utf8')).toContain(`https://gregale.dev${route}`);
    }
  });

  it('publishes the how-to guides with schema, feeds and links from their docs pages', () => {
    const cases = [
      { slug: 'deploy-docker-compose-app-to-production', doc: 'container-compatibility' },
      { slug: 'show-waking-up-page-during-cold-start', doc: 'scale-to-zero' },
      { slug: 'fix-cors-errors-without-changing-backend-code', doc: 'edge-rules' },
      { slug: 'add-security-headers-hsts-csp-without-code', doc: 'security' },
      { slug: 'rate-limit-api-per-ip-without-code', doc: 'edge-rules' },
    ];
    const articlesIndex = readFileSync('dist/articles/index.html', 'utf8');
    const sitemap = readFileSync('dist/sitemap.xml', 'utf8');
    const feed = readFileSync('dist/feed.xml', 'utf8');
    const llms = readFileSync('dist/llms.txt', 'utf8');

    expect(articlesIndex).toContain('How-to guides');
    for (const { slug, doc } of cases) {
      const route = `/articles/${slug}`;
      const html = readFileSync(`dist${route}/index.html`, 'utf8');
      const json = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1];
      const graph = JSON.parse(json!)['@graph'];
      const faq = graph.find((node: { '@type': string }) => node['@type'] === 'FAQPage');

      expect(html).toContain(`rel="canonical" href="https://gregale.dev${route}"`);
      expect(html).toContain(`type="text/markdown" href="${route}.md"`);
      expect(graph[0]).toMatchObject({ '@type': 'TechArticle', dateModified: '2026-11-27' });
      expect(faq.mainEntity.length).toBeGreaterThan(0);
      expect(JSON.stringify(faq)).not.toContain('`');
      expect(existsSync(`dist${route}.md`)).toBe(true);
      expect(articlesIndex).toContain(`href="${route}"`);
      expect(sitemap).toContain(`<loc>https://gregale.dev${route}</loc>`);
      expect(feed).toContain(`<id>https://gregale.dev${route}</id>`);
      expect(llms).toContain(`https://gregale.dev${route}.md`);
      expect(readFileSync(`dist/docs/${doc}/index.html`, 'utf8')).toContain(`href="${route}"`);
      expect(readFileSync(`dist/docs/${doc}.md`, 'utf8')).toContain(`https://gregale.dev${route}`);
    }
  });

  it('publishes the scale-to-zero pricing comparison and links it from each vendor page and doc', () => {
    const route = '/articles/scale-to-zero-pricing-compared';
    const html = readFileSync(`dist${route}/index.html`, 'utf8');
    const json = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1];
    const graph = JSON.parse(json!)['@graph'];
    const faq = graph.find((node: { '@type': string }) => node['@type'] === 'FAQPage');

    expect(html).toContain(`rel="canonical" href="https://gregale.dev${route}"`);
    expect(graph[0]).toMatchObject({ '@type': 'TechArticle', dateModified: '2026-11-28' });
    expect(faq.mainEntity.length).toBe(3);
    expect(existsSync(`dist${route}.md`)).toBe(true);
    expect(readFileSync('dist/sitemap.xml', 'utf8')).toContain(
      `<loc>https://gregale.dev${route}</loc>`
    );
    expect(readFileSync('dist/feed.xml', 'utf8')).toContain(`<id>https://gregale.dev${route}</id>`);
    expect(readFileSync('dist/llms.txt', 'utf8')).toContain(`https://gregale.dev${route}.md`);
    for (const vendor of ['fly', 'cloud-run', 'railway', 'koyeb', 'render']) {
      expect(readFileSync(`dist/vs/${vendor}/index.html`, 'utf8'), vendor).toContain(
        `href="${route}"`
      );
    }
    for (const doc of ['scale-to-zero', 'plans']) {
      expect(readFileSync(`dist/docs/${doc}/index.html`, 'utf8'), doc).toContain(`href="${route}"`);
    }
  });

  it('publishes the free backend hosting comparison and links it from each vendor page and the plans doc', () => {
    const route = '/articles/free-backend-hosting-tiers-compared';
    const html = readFileSync(`dist${route}/index.html`, 'utf8');
    const json = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1];
    const graph = JSON.parse(json!)['@graph'];
    const faq = graph.find((node: { '@type': string }) => node['@type'] === 'FAQPage');

    expect(html).toContain(`rel="canonical" href="https://gregale.dev${route}"`);
    expect(graph[0]).toMatchObject({ '@type': 'TechArticle', dateModified: '2026-11-28' });
    expect(faq.mainEntity.length).toBe(3);
    expect(existsSync(`dist${route}.md`)).toBe(true);
    expect(readFileSync('dist/sitemap.xml', 'utf8')).toContain(
      `<loc>https://gregale.dev${route}</loc>`
    );
    expect(readFileSync('dist/feed.xml', 'utf8')).toContain(`<id>https://gregale.dev${route}</id>`);
    expect(readFileSync('dist/llms.txt', 'utf8')).toContain(`https://gregale.dev${route}.md`);
    for (const vendor of [
      'cloud-run',
      'aws',
      'cloudflare-workers',
      'render',
      'railway',
      'fly',
      'koyeb',
    ]) {
      expect(readFileSync(`dist/vs/${vendor}/index.html`, 'utf8'), vendor).toContain(
        `href="${route}"`
      );
    }
    expect(readFileSync('dist/docs/plans/index.html', 'utf8')).toContain(`href="${route}"`);
  });

  it('publishes the managed Postgres pricing comparison and links it from each vendor page and the Postgres doc', () => {
    const route = '/articles/managed-postgres-pricing-compared';
    const html = readFileSync(`dist${route}/index.html`, 'utf8');
    const json = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1];
    const graph = JSON.parse(json!)['@graph'];
    const faq = graph.find((node: { '@type': string }) => node['@type'] === 'FAQPage');

    expect(html).toContain(`rel="canonical" href="https://gregale.dev${route}"`);
    expect(graph[0]).toMatchObject({ '@type': 'TechArticle', dateModified: '2026-11-28' });
    expect(faq.mainEntity.length).toBe(3);
    expect(existsSync(`dist${route}.md`)).toBe(true);
    expect(readFileSync('dist/sitemap.xml', 'utf8')).toContain(
      `<loc>https://gregale.dev${route}</loc>`
    );
    expect(readFileSync('dist/feed.xml', 'utf8')).toContain(`<id>https://gregale.dev${route}</id>`);
    expect(readFileSync('dist/llms.txt', 'utf8')).toContain(`https://gregale.dev${route}.md`);
    for (const vendor of ['render', 'railway', 'fly', 'heroku', 'digitalocean']) {
      expect(readFileSync(`dist/vs/${vendor}/index.html`, 'utf8'), vendor).toContain(
        `href="${route}"`
      );
    }
    expect(readFileSync('dist/docs/postgres/index.html', 'utf8')).toContain(`href="${route}"`);
  });

  it('publishes the WebSockets platform comparison and links it from each vendor page, the realtime doc and article', () => {
    const route = '/articles/websockets-scale-to-zero-platforms-compared';
    const html = readFileSync(`dist${route}/index.html`, 'utf8');
    const json = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1];
    const graph = JSON.parse(json!)['@graph'];
    const faq = graph.find((node: { '@type': string }) => node['@type'] === 'FAQPage');

    expect(html).toContain(`rel="canonical" href="https://gregale.dev${route}"`);
    expect(graph[0]).toMatchObject({ '@type': 'TechArticle', dateModified: '2026-11-28' });
    expect(faq.mainEntity.length).toBe(3);
    expect(existsSync(`dist${route}.md`)).toBe(true);
    expect(readFileSync('dist/sitemap.xml', 'utf8')).toContain(
      `<loc>https://gregale.dev${route}</loc>`
    );
    expect(readFileSync('dist/feed.xml', 'utf8')).toContain(`<id>https://gregale.dev${route}</id>`);
    expect(readFileSync('dist/llms.txt', 'utf8')).toContain(`https://gregale.dev${route}.md`);
    for (const vendor of ['cloudflare-workers', 'aws', 'cloud-run', 'fly', 'vercel']) {
      expect(readFileSync(`dist/vs/${vendor}/index.html`, 'utf8'), vendor).toContain(
        `href="${route}"`
      );
    }
    expect(readFileSync('dist/docs/realtime/index.html', 'utf8')).toContain(`href="${route}"`);
    expect(readFileSync('dist/articles/websockets-sse-scale-to-zero/index.html', 'utf8')).toContain(
      `href="${route}"`
    );
  });

  it('publishes /solutions hub and each solution page with schema, Markdown and nav links', () => {
    const hubHtml = readFileSync('dist/solutions/index.html', 'utf8');
    const sitemap = readFileSync('dist/sitemap.xml', 'utf8');
    const llms = readFileSync('dist/llms.txt', 'utf8');
    expect(hubHtml).toContain('rel="canonical" href="https://gregale.dev/solutions"');
    expect(hubHtml).toContain('type="text/markdown" href="/solutions.md"');
    expect(existsSync('dist/solutions.md')).toBe(true);
    expect(sitemap).toContain('<loc>https://gregale.dev/solutions</loc>');
    expect(readFileSync('dist/index.html', 'utf8')).toContain('href="/solutions"');
    expect(readFileSync('dist/articles/index.html', 'utf8')).toContain('href="/solutions"');

    for (const solution of SOLUTIONS) {
      const route = `/solutions/${solution.slug}`;
      const html = readFileSync(`dist${route}/index.html`, 'utf8');
      const json = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1];
      const graph = JSON.parse(json!)['@graph'];
      const faq = graph.find((node: { '@type': string }) => node['@type'] === 'FAQPage');

      expect(html).toContain(solution.title);
      expect(html).toContain(`rel="canonical" href="https://gregale.dev${route}"`);
      expect(html).toContain(`type="text/markdown" href="${route}.md"`);
      expect(graph[0]).toMatchObject({ '@type': 'TechArticle', dateModified: solution.updatedOn });
      expect(faq.mainEntity.length).toBeGreaterThan(0);
      expect(JSON.stringify(faq)).not.toContain('`');
      expect(existsSync(`dist${route}.md`)).toBe(true);
      expect(hubHtml).toContain(`href="${route}"`);
      expect(sitemap).toContain(`<loc>https://gregale.dev${route}</loc>`);
      expect(llms).toContain(`https://gregale.dev${route}.md`);
    }
  });

  it('publishes MCP server card and TechArticle + BreadcrumbList structured data on doc guides', () => {
    const serverCard = JSON.parse(readFileSync('dist/.well-known/mcp/server-card.json', 'utf8'));
    expect(serverCard).toMatchObject({
      serverInfo: { name: 'gregale' },
      transport: { type: 'streamable-http', endpoint: 'https://api.gregale.dev/mcp' },
      authentication: { required: true, schemes: ['oauth2'] },
    });

    const quickstart = readFileSync('dist/docs/quickstart/index.html', 'utf8');
    expect(quickstart).toContain(
      '<link rel="alternate" type="text/plain" title="llms.txt" href="/llms.txt" />'
    );
    const json = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(quickstart)?.[1];
    const graph = JSON.parse(json!)['@graph'];
    expect(graph.find((n: { '@type': string }) => n['@type'] === 'TechArticle')).toMatchObject({
      '@id': 'https://gregale.dev/docs/quickstart#article',
      mainEntityOfPage: 'https://gregale.dev/docs/quickstart',
    });
    expect(
      graph.find((n: { '@type': string }) => n['@type'] === 'BreadcrumbList')?.itemListElement
    ).toHaveLength(3);
  });

  it('publishes an Atom feed of articles and research and links it from their pages', () => {
    const feed = readFileSync('dist/feed.xml', 'utf8');
    const link =
      'type="application/atom+xml" title="Gregale articles and research" href="/feed.xml"';
    expect(feed).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
    for (const route of [
      '/articles/canary-deploys',
      '/research/intermittent-fastapi-cost-2026-11-24',
    ]) {
      expect(feed).toContain(`<id>https://gregale.dev${route}</id>`);
      expect(readFileSync(`dist${route}/index.html`, 'utf8')).toContain(link);
    }
    expect(readFileSync('dist/index.html', 'utf8')).toContain(link);
    expect(readFileSync('dist/pricing/index.html', 'utf8')).not.toContain(link);
  });

  it('dates articles, research and comparison pages in the sitemap', () => {
    const sitemap = readFileSync('dist/sitemap.xml', 'utf8');
    for (const route of [
      '/articles',
      '/articles/canary-deploys',
      '/research',
      '/research/intermittent-fastapi-cost-2026-11-24',
      '/vs/heroku',
    ]) {
      expect(sitemap, route).toMatch(
        new RegExp(
          `<loc>https://gregale\\.dev${route}</loc>\\n    <lastmod>\\d{4}-\\d{2}-\\d{2}</lastmod>`
        )
      );
    }
  });

  it('offers a complete copy of the FastAPI study inputs in one download', () => {
    const slug = 'intermittent-fastapi-cost-2026-11-24';
    const route = `/research/${slug}`;
    const archive = `dist${route}/reproduction.tar.gz`;
    const html = readFileSync(`dist${route}/index.html`, 'utf8');
    const markdown = readFileSync(`dist${route}.md`, 'utf8');

    expect(html).toContain(`href="${route}/reproduction.tar.gz"`);
    expect(markdown).toContain(`https://gregale.dev${route}/reproduction.tar.gz`);
    expect(markdown).toContain('python3 analyze.py --verify');
    const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
    expect(entries.sort()).toEqual(
      [
        'README.md',
        'analyze.py',
        'run.py',
        'traffic.csv',
        'ledger.json',
        'states.csv',
        'pricing.json',
        'summary.json',
        'fixture/.python-version',
        'fixture/gregale.yaml',
        'fixture/main.py',
        'fixture/requirements.txt',
      ]
        .map((file) => `${slug}/${file}`)
        .sort()
    );
  });

  it('publishes the cross-platform PaaS cost model kit and Dataset metadata', () => {
    const slug = 'paas-intermittent-api-cost-model-2026-11-25';
    const route = `/research/${slug}`;
    const archive = `dist${route}/reproduction.tar.gz`;
    const report = readFileSync(`dist${route}/index.html`, 'utf8');
    const markdown = readFileSync(`dist${route}.md`, 'utf8');

    for (const page of ['research', 'docs/plans', 'docs/billing']) {
      expect(readFileSync(`dist/${page}/index.html`, 'utf8')).toContain(`href="${route}"`);
    }
    for (const docSlug of ['plans', 'billing']) {
      expect(readFileSync(`dist/docs/${docSlug}.md`, 'utf8')).toContain(
        `https://gregale.dev${route}`
      );
    }
    expect(report).toContain(`rel="canonical" href="https://gregale.dev${route}"`);
    expect(report).toContain(`type="text/markdown" href="${route}.md"`);
    expect(markdown).toContain(`https://gregale.dev${route}/reproduction.tar.gz`);
    expect(markdown).toContain('python3 analyze.py --verify');
    expect(report).toContain('between_requests');
    for (const amount of ['$10.00', '$22.45', '$33.50', '$41.00']) {
      expect(report).toContain(amount);
    }

    for (const file of [
      'reproduction.tar.gz',
      'vendors.json',
      'scenarios.json',
      'summary.json',
      'analyze.py',
      'README.md',
    ]) {
      expect(report).toContain(`href="${route}/${file}"`);
      expect(existsSync(`dist${route}/${file}`)).toBe(true);
    }

    const ldBlocks = [
      ...report.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g),
    ].map((match) => JSON.parse(match[1]));
    expect(ldBlocks[0]).toMatchObject({
      '@type': 'TechArticle',
      datePublished: '2026-11-25',
      mainEntityOfPage: `https://gregale.dev${route}`,
    });
    const dataset = ldBlocks.find((node) => node['@type'] === 'Dataset');
    expect(dataset).toMatchObject({
      '@type': 'Dataset',
      '@id': `https://gregale.dev${route}#dataset`,
      isAccessibleForFree: true,
      temporalCoverage: '2026-11-25',
    });
    expect(dataset.distribution.map((entry: { contentUrl: string }) => entry.contentUrl)).toEqual(
      expect.arrayContaining([
        `https://gregale.dev${route}/reproduction.tar.gz`,
        `https://gregale.dev${route}/vendors.json`,
      ])
    );

    expect(readFileSync('dist/sitemap.xml', 'utf8')).toContain(
      `<loc>https://gregale.dev${route}</loc>\n    <lastmod>2026-11-25</lastmod>`
    );
    expect(readFileSync('dist/llms.txt', 'utf8')).toContain(`https://gregale.dev${route}.md`);
    expect(readFileSync('dist/feed.xml', 'utf8')).toContain(`<id>https://gregale.dev${route}</id>`);

    const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
    expect(entries.sort()).toEqual(
      ['README.md', 'analyze.py', 'scenarios.json', 'summary.json', 'vendors.json']
        .map((file) => `${slug}/${file}`)
        .sort()
    );
  });

  it('publishes the cloud agent-ops guardrails matrix kit and Dataset metadata', () => {
    const slug = 'agent-ops-guardrails-matrix-2026-11-25';
    const route = `/research/${slug}`;
    const archive = `dist${route}/reproduction.tar.gz`;
    const report = readFileSync(`dist${route}/index.html`, 'utf8');
    const markdown = readFileSync(`dist${route}.md`, 'utf8');

    for (const page of ['research', 'docs/agents']) {
      expect(readFileSync(`dist/${page}/index.html`, 'utf8')).toContain(`href="${route}"`);
    }
    expect(readFileSync('dist/docs/agents.md', 'utf8')).toContain(`https://gregale.dev${route}`);
    expect(report).toContain(`rel="canonical" href="https://gregale.dev${route}"`);
    expect(report).toContain(`type="text/markdown" href="${route}.md"`);
    expect(markdown).toContain(`https://gregale.dev${route}/reproduction.tar.gz`);
    expect(markdown).toContain('python3 analyze.py --verify');
    expect(report).toContain('16/16');

    for (const file of [
      'reproduction.tar.gz',
      'criteria.json',
      'vendors.json',
      'summary.json',
      'analyze.py',
      'README.md',
    ]) {
      expect(report).toContain(`href="${route}/${file}"`);
      expect(existsSync(`dist${route}/${file}`)).toBe(true);
    }

    const ldBlocks = [
      ...report.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g),
    ].map((match) => JSON.parse(match[1]));
    expect(ldBlocks[0]).toMatchObject({
      '@type': 'TechArticle',
      datePublished: '2026-11-25',
      mainEntityOfPage: `https://gregale.dev${route}`,
    });
    const dataset = ldBlocks.find((node) => node['@type'] === 'Dataset');
    expect(dataset).toMatchObject({
      '@type': 'Dataset',
      '@id': `https://gregale.dev${route}#dataset`,
      isAccessibleForFree: true,
      temporalCoverage: '2026-11-25',
    });
    expect(dataset.distribution.map((entry: { contentUrl: string }) => entry.contentUrl)).toEqual(
      expect.arrayContaining([
        `https://gregale.dev${route}/reproduction.tar.gz`,
        `https://gregale.dev${route}/criteria.json`,
      ])
    );

    expect(readFileSync('dist/sitemap.xml', 'utf8')).toContain(
      `<loc>https://gregale.dev${route}</loc>\n    <lastmod>2026-11-25</lastmod>`
    );
    expect(readFileSync('dist/llms.txt', 'utf8')).toContain(`https://gregale.dev${route}.md`);
    expect(readFileSync('dist/feed.xml', 'utf8')).toContain(`<id>https://gregale.dev${route}</id>`);

    const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
    expect(entries.sort()).toEqual(
      ['README.md', 'analyze.py', 'criteria.json', 'summary.json', 'vendors.json']
        .map((file) => `${slug}/${file}`)
        .sort()
    );
  });

  it('publishes the PaaS rollback and migration recovery matrix kit and Dataset metadata', () => {
    const slug = 'paas-rollback-and-migration-recovery-matrix-2026-11-26';
    const route = `/research/${slug}`;
    const archive = `dist${route}/reproduction.tar.gz`;
    const report = readFileSync(`dist${route}/index.html`, 'utf8');
    const markdown = readFileSync(`dist${route}.md`, 'utf8');

    for (const page of ['research', 'docs/releases', 'docs/rollouts', 'docs/postgres']) {
      expect(readFileSync(`dist/${page}/index.html`, 'utf8')).toContain(`href="${route}"`);
    }
    for (const mdDoc of ['releases', 'rollouts', 'postgres']) {
      expect(readFileSync(`dist/docs/${mdDoc}.md`, 'utf8')).toContain(
        `https://gregale.dev${route}`
      );
    }
    expect(report).toContain(`rel="canonical" href="https://gregale.dev${route}"`);
    expect(report).toContain(`type="text/markdown" href="${route}.md"`);
    expect(markdown).toContain(`https://gregale.dev${route}/reproduction.tar.gz`);
    expect(markdown).toContain('python3 analyze.py --verify');
    expect(report).toContain('16/16');

    for (const file of [
      'reproduction.tar.gz',
      'criteria.json',
      'vendors.json',
      'summary.json',
      'analyze.py',
      'README.md',
    ]) {
      expect(report).toContain(`href="${route}/${file}"`);
      expect(existsSync(`dist${route}/${file}`)).toBe(true);
    }

    const ldBlocks = [
      ...report.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g),
    ].map((match) => JSON.parse(match[1]));
    expect(ldBlocks[0]).toMatchObject({
      '@type': 'TechArticle',
      datePublished: '2026-11-26',
      mainEntityOfPage: `https://gregale.dev${route}`,
    });
    const dataset = ldBlocks.find((node) => node['@type'] === 'Dataset');
    expect(dataset).toMatchObject({
      '@type': 'Dataset',
      '@id': `https://gregale.dev${route}#dataset`,
      isAccessibleForFree: true,
      temporalCoverage: '2026-11-26',
    });
    expect(dataset.distribution.map((entry: { contentUrl: string }) => entry.contentUrl)).toEqual(
      expect.arrayContaining([
        `https://gregale.dev${route}/reproduction.tar.gz`,
        `https://gregale.dev${route}/criteria.json`,
      ])
    );

    expect(readFileSync('dist/sitemap.xml', 'utf8')).toContain(
      `<loc>https://gregale.dev${route}</loc>\n    <lastmod>2026-11-26</lastmod>`
    );
    expect(readFileSync('dist/llms.txt', 'utf8')).toContain(`https://gregale.dev${route}.md`);
    expect(readFileSync('dist/feed.xml', 'utf8')).toContain(`<id>https://gregale.dev${route}</id>`);

    const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
    expect(entries.sort()).toEqual(
      ['README.md', 'analyze.py', 'criteria.json', 'summary.json', 'vendors.json']
        .map((file) => `${slug}/${file}`)
        .sort()
    );
  });

  describe('robots.txt', () => {
    const robots =
      built && existsSync('dist/robots.txt') ? readFileSync('dist/robots.txt', 'utf8') : '';

    it.each([
      'OAI-SearchBot',
      'GPTBot',
      'ChatGPT-User',
      'ClaudeBot',
      'Claude-SearchBot',
      'Claude-User',
      'PerplexityBot',
      'Perplexity-User',
      'Google-Extended',
      'Applebot-Extended',
      '*',
    ])('lets %s crawl public pages and excludes the auth-gated console', (agent) => {
      expect(robots.split('\n\n')).toContain(
        `User-agent: ${agent}\nDisallow: /dashboard\nDisallow: /onboarding\nAllow: /`
      );
    });
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
    const graph = JSON.parse(ld)['@graph'] as {
      '@type': string;
      sameAs?: string[];
      offers?: { '@type': string; lowPrice?: number; highPrice?: number };
      featureList?: string[];
    }[];
    expect(graph).toBeInstanceOf(Array);
    const org = graph.find((node) => node['@type'] === 'Organization');
    expect(org?.sameAs).toContain('https://github.com/gregale-dev/benchmarks');
    expect(org?.sameAs).toContain('https://github.com/gregale-dev/community');
    const software = graph.find((node) => node['@type'] === 'SoftwareApplication');
    expect(software?.offers).toMatchObject({ '@type': 'AggregateOffer', lowPrice: 0 });
    expect(software?.featureList?.length).toBeGreaterThanOrEqual(5);
  });

  it('links key wedge pages directly from the landing page and publishes raw OpenAPI specs', () => {
    const landing = readFileSync('dist/index.html', 'utf8');
    for (const path of [
      '/articles/best-cloud-for-ai-coding-agents',
      '/articles/canary-deploys',
      '/articles/rollback-code-and-database',
      '/articles/mcp-server-hosting',
      '/research/paas-intermittent-api-cost-model-2026-11-25',
      '/research/firecracker-snapshot-restore-ssd-2026-09-09',
      '/openapi.yaml',
    ]) {
      expect(landing, path).toContain(`href="${path}"`);
    }

    const openApiJson = JSON.parse(readFileSync('dist/openapi.json', 'utf8'));
    expect(openApiJson.openapi).toMatch(/^3\./);
    expect(readFileSync('dist/openapi.yaml', 'utf8')).toContain('openapi:');

    const apiIndex = readFileSync('dist/docs/api/index.html', 'utf8');
    expect(apiIndex).toContain('type="application/yaml"');
    expect(apiIndex).toContain('href="/openapi.yaml"');
    expect(apiIndex).toContain('type="application/json"');
    expect(apiIndex).toContain('href="/openapi.json"');

    const llms = readFileSync('dist/llms.txt', 'utf8');
    expect(llms).toContain('https://gregale.dev/openapi.yaml');
    expect(llms).toContain('https://gregale.dev/openapi.json');
  });

  it('does not state the wake figure without its measurement boundary', () => {
    expect(ld).not.toMatch(/350\s*ms/);
  });

  it('does not call a proprietary product open source', () => {
    expect(ld).not.toMatch(/open[\s-]?source/i);
  });

  it('indexes /deploy, publishes deploy-button docs, and exposes them in llms.txt', () => {
    const deployHtml = readFileSync('dist/deploy/index.html', 'utf8');
    expect(deployHtml).not.toContain('name="robots"');
    expect(deployHtml).toContain('href="/docs/deploy-button"');

    const docHtml = readFileSync('dist/docs/deploy-button/index.html', 'utf8');
    const docMd = readFileSync('dist/docs/deploy-button.md', 'utf8');
    expect(docHtml).toContain('deploy-badge.svg');
    expect(docHtml).toContain('/deploy?repo=');
    expect(docMd).toContain('https://gregale.dev/deploy-badge.svg');
    expect(docMd).toContain('/deploy?repo=');

    const sitemap = readFileSync('dist/sitemap.xml', 'utf8');
    expect(sitemap).toContain('<loc>https://gregale.dev/deploy</loc>');
    expect(sitemap).toContain('<loc>https://gregale.dev/docs/deploy-button</loc>');

    const llms = readFileSync('dist/llms.txt', 'utf8');
    expect(llms).toContain('https://gregale.dev/docs/deploy-button.md');
    expect(llms).toContain('https://gregale.dev/deploy?repo=');
  });
});
