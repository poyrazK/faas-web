import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { atomFeed } from './feed.mjs';
import { writeIndexNowKey } from './indexnow-key.mjs';
import { docsLastModified, sitemapXml } from './sitemap.mjs';

/**
 * Writes a real HTML document for each public route.
 *
 * The app is a client-rendered SPA, so every URL used to serve the same empty
 * `index.html`. That is fine for browsers and for crawlers that execute JS,
 * but social unfurlers (Slack, Twitter, iMessage) do not run JS — they read
 * the markup as served, and so previewed every link as the home page.
 *
 * Each route here is rendered at build time and written to its own
 * `index.html`, so the tags and copy are in the document before any script
 * runs. The SPA then mounts over it (`createRoot`, not `hydrateRoot` — see
 * the note in `src/main.tsx`), and the SPA fallback in `_redirects` /
 * `vercel.json` continues to serve anything not listed here.
 *
 * Only public routes are prerendered. Everything under /dashboard is behind
 * auth and has nothing to say to a crawler.
 */

/**
 * Docs routes are derived from the manifest rather than listed here, so adding
 * a page to the table of contents cannot leave it unprerendered and absent from
 * the sitemap. Same reasoning as generating robots.txt below.
 */
const { DOC_ENTRIES, DOC_SECTIONS } = await import('../src/lib/docs-manifest.ts');
const DOC_BY_SLUG = new Map(
  DOC_SECTIONS.flatMap((section) =>
    section.entries.map((entry) => [entry.slug, { entry, sectionTitle: section.title }])
  )
);
const DOCS_DATES = docsLastModified();
const {
  AGENT_GUARDRAILS_SLUG,
  FASTAPI_COST_SLUG,
  PAAS_COST_MODEL_SLUG,
  RESEARCH_PUBLICATIONS,
  RESEARCH_TITLE,
  SNAPSHOT_RESTORE_SLUG,
} = await import('../src/lib/research.ts');
const { ARTICLES, ARTICLES_TITLE, plainFaq } = await import('../src/lib/articles.ts');
const { buildApiReference } = await import('../src/lib/api-reference/build.ts');
const { load: parseYaml } = await import('js-yaml');
const OPENAPI_YAML = readFileSync('api/openapi.yaml', 'utf8');
const OPENAPI_DOC = parseYaml(OPENAPI_YAML);
// The API reference is derived from the vendored spec the same way: one page
// per group, so a group the spec gains is prerendered and in the sitemap.
const API_ROUTES = [
  '/docs/api',
  ...buildApiReference(OPENAPI_DOC).map((group) => `/docs/api/${group.id}`),
];
const { parsePlanCatalog } = await import('../src/lib/plan-catalog-parser.ts');
const { LANDING_FAQ, faqJsonLd, pricingFaq, pricingJsonLd } = await import('../src/lib/faq.ts');
// Read the same generated catalog the pricing page renders, so the Offer
// prices in the structured data cannot disagree with the visible columns.
const PLAN_CATALOG = parsePlanCatalog(readFileSync('content/docs/plans.md', 'utf8'));
const { COMPARISON_SLUGS, COMPARISONS_CHECKED, comparisons } =
  await import('../src/lib/compare.ts');
const COMPARE_ROUTES = COMPARISON_SLUGS.map((slug) => `/vs/${slug}`);
const COMPARISONS = new Map(comparisons(PLAN_CATALOG).map((c) => [`/vs/${c.slug}`, c]));
const DOC_ROUTES = ['/docs', ...DOC_ENTRIES.map((entry) => `/docs/${entry.slug}`), ...API_ROUTES];
const RESEARCH_BY_ROUTE = new Map(
  RESEARCH_PUBLICATIONS.map((publication) => [`/research/${publication.slug}`, publication])
);
const RESEARCH_ROUTES = ['/research', ...RESEARCH_BY_ROUTE.keys()];
const ARTICLE_BY_ROUTE = new Map(ARTICLES.map((article) => [`/articles/${article.slug}`, article]));
const ARTICLE_ROUTES = ['/articles', ...ARTICLE_BY_ROUTE.keys()];

const PRICING_ROUTE = '/pricing';
const PLAN_DOC_ROUTE = '/docs/plans';
const PRICING_FEED = '/pricing.json';
/** Articles and research reports as one Atom feed, newest first. */
const ATOM_FEED = '/feed.xml';
const ATOM_FEED_TITLE = 'Gregale articles and research';
const INCIDENT_SHELL_ROUTE = '/status/incidents/00000000-0000-4000-8000-000000000000';
const NOT_FOUND_ROUTE = '/404';
const ROUTES = [
  '/',
  '/login',
  '/signup',
  '/status',
  '/will-it-run',
  PRICING_ROUTE,
  ...COMPARE_ROUTES,
  '/contact',
  NOT_FOUND_ROUTE,
  INCIDENT_SHELL_ROUTE,
  ...DOC_ROUTES,
  ...RESEARCH_ROUTES,
  ...ARTICLE_ROUTES,
];

/** Routes worth indexing. /login and /signup are prerendered so their link
 *  previews are right, but they are not search results. Docs are the opposite:
 *  they are most of the reason anyone would find this site through a search. */
const INDEXABLE = [
  '/',
  '/status',
  '/will-it-run',
  PRICING_ROUTE,
  ...COMPARE_ROUTES,
  ...DOC_ROUTES,
  ...RESEARCH_ROUTES,
  ...ARTICLE_ROUTES,
];

const DIST = 'dist';
const TEMPLATE = join(DIST, 'index.html');

/**
 * Absolute base URL. Canonical links, `og:url`, the sitemap, and the
 * structured data all need one, and there is no way to derive it from the
 * build.
 *
 * Defaults to the production domain: shipping without canonicals and a
 * sitemap cost the site its indexation once already ("skipped…" in a CI log
 * is too easy to miss). `SITE_URL` in the environment still overrides for
 * previews and forks.
 */
const PRODUCTION_URL = 'https://gregale.dev';
const SITE_URL = (process.env.SITE_URL ?? PRODUCTION_URL).replace(/\/$/, '');
const productionSite =
  SITE_URL === PRODUCTION_URL &&
  (!process.env.VERCEL_ENV || process.env.VERCEL_ENV === 'production');

/** Social preview card, if one has been added to `public/`. */
const OG_IMAGE = 'og.png';

// `SITE_URL` has its trailing slash stripped and every route starts with one,
// so the home page canonicalises to `https://host/` rather than the bare host.
const absolute = (path) => SITE_URL + path;

const { render } = await import('../dist-ssr/prerender.js');

const template = readFileSync(TEMPLATE, 'utf8');

/** Escapes a value for an HTML attribute. */
const attr = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/**
 * Collapses the matched routes' meta into one tag per key, last wins — a
 * leaf route's title must beat the root's fallback.
 */
function dedupe(meta) {
  const byKey = new Map();
  for (const tag of meta) {
    if (!tag) continue;
    const key = 'title' in tag ? 'title' : (tag.name ?? tag.property);
    if (key) byKey.set(key, tag);
  }
  return [...byKey.values()];
}

function renderTags(meta) {
  return meta
    .map((tag) => {
      if ('title' in tag) return `<title>${attr(tag.title)}</title>`;
      const key = tag.name ? 'name' : 'property';
      return `<meta ${key}="${attr(tag[key] ?? tag.property)}" content="${attr(tag.content)}" />`;
    })
    .join('\n    ');
}

/** Strips the static tags the template ships so they cannot end up duplicated. */
function stripStaticHead(html) {
  return html
    .replace(/\s*<title>[\s\S]*?<\/title>/, '')
    .replace(/\s*<meta\s+name="description"[\s\S]*?\/>/, '')
    .replace(/\s*<meta\s+property="og:title"[\s\S]*?\/>/, '')
    .replace(/\s*<meta\s+property="og:description"[\s\S]*?\/>/, '');
}

let written = 0;
for (const route of ROUTES) {
  const incidentShell = route === INCIDENT_SHELL_ROUTE;
  const { html, meta } = await render(route);
  const tags = renderTags(dedupe(meta));

  let doc = stripStaticHead(template);
  doc = doc.replace('</head>', `  ${tags}\n  </head>`);

  // Canonical and og:url can only be written here — the router knows the
  // route, but not the host it will be served from.
  const perRoute = [];
  if (SITE_URL && !incidentShell && route !== NOT_FOUND_ROUTE) {
    perRoute.push(`<link rel="canonical" href="${attr(absolute(route))}" />`);
    perRoute.push(`<meta property="og:url" content="${attr(absolute(route))}" />`);
    if (existsSync(join('public', OG_IMAGE))) {
      const image = SITE_URL + '/' + OG_IMAGE;
      perRoute.push(`<meta property="og:image" content="${attr(image)}" />`);
      perRoute.push('<meta property="og:image:width" content="1200" />');
      perRoute.push('<meta property="og:image:height" content="630" />');
      perRoute.push(`<meta name="twitter:image" content="${attr(image)}" />`);
    }
  }
  // Only guides have Markdown copies. The API reference uses OpenAPI.
  const docSlug = route.startsWith('/docs/') ? route.slice('/docs/'.length) : '';
  const docMeta = DOC_BY_SLUG.get(docSlug);
  if (docMeta || DOC_ENTRIES.some((entry) => entry.slug === docSlug)) {
    perRoute.push(`<link rel="alternate" type="text/markdown" href="/docs/${attr(docSlug)}.md" />`);
  }
  if (docMeta && SITE_URL) {
    const docModified = DOCS_DATES.get(route);
    const ld = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'TechArticle',
          '@id': `${absolute(route)}#article`,
          headline: docMeta.entry.title,
          description: docMeta.entry.summary,
          mainEntityOfPage: absolute(route),
          ...(docModified ? { dateModified: docModified } : {}),
          author: { '@type': 'Organization', name: 'Gregale', url: `${SITE_URL}/` },
          publisher: { '@id': `${SITE_URL}/#org` },
          isPartOf: {
            '@type': 'WebSite',
            name: 'Gregale Documentation',
            url: absolute('/docs'),
          },
        },
        {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/` },
            { '@type': 'ListItem', position: 2, name: 'Documentation', item: absolute('/docs') },
            { '@type': 'ListItem', position: 3, name: docMeta.entry.title, item: absolute(route) },
          ],
        },
      ],
    };
    perRoute.push(
      `<script type="application/ld+json">${JSON.stringify(ld).replaceAll('<', '\\u003c')}</script>`
    );
  }
  const publication = RESEARCH_BY_ROUTE.get(route);
  if (publication) {
    perRoute.push(`<link rel="alternate" type="text/markdown" href="${attr(route)}.md" />`);
    if (SITE_URL) {
      const ld = {
        '@context': 'https://schema.org',
        '@type': 'TechArticle',
        headline: publication.title,
        description: publication.summary,
        datePublished: publication.publishedOn,
        mainEntityOfPage: absolute(route),
        author: {
          '@type': 'Organization',
          name: 'Gregale Engineering',
          url: absolute('/research'),
        },
        publisher: { '@id': `${SITE_URL}/#org` },
        isPartOf: { '@type': 'WebSite', name: RESEARCH_TITLE, url: absolute('/research') },
      };
      perRoute.push(
        `<script type="application/ld+json">${JSON.stringify(ld).replaceAll('<', '\\u003c')}</script>`
      );
      const datasetLd = {
        '@context': 'https://schema.org',
        '@type': 'Dataset',
        '@id': `${absolute(route)}#dataset`,
        name: `${publication.title} — dataset and reproduction kit`,
        description: publication.summary,
        url: absolute(route),
        datePublished: publication.publishedOn,
        temporalCoverage: publication.measuredOn,
        creator: {
          '@type': 'Organization',
          name: 'Gregale Engineering',
          url: absolute('/research'),
        },
        publisher: { '@id': `${SITE_URL}/#org` },
        isAccessibleForFree: true,
        distribution: publication.datasetDownloads.map((file) => ({
          '@type': 'DataDownload',
          name: file.name,
          encodingFormat: file.encodingFormat,
          contentUrl: `${absolute(route)}/${file.path}`,
        })),
      };
      perRoute.push(
        `<script type="application/ld+json">${JSON.stringify(datasetLd).replaceAll('<', '\\u003c')}</script>`
      );
    }
  }
  // Articles: the article itself and its questions, from the same registry
  // the page renders, so the FAQ in the structured data matches the page.
  const article = ARTICLE_BY_ROUTE.get(route);
  if (article) {
    perRoute.push(`<link rel="alternate" type="text/markdown" href="${attr(route)}.md" />`);
    if (SITE_URL) {
      const ld = {
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'TechArticle',
            '@id': `${absolute(route)}#article`,
            headline: article.title,
            description: article.summary,
            datePublished: article.publishedOn,
            dateModified: article.updatedOn,
            mainEntityOfPage: absolute(route),
            author: { '@id': `${SITE_URL}/#org` },
            publisher: { '@id': `${SITE_URL}/#org` },
            isPartOf: { '@type': 'WebSite', name: ARTICLES_TITLE, url: absolute('/articles') },
          },
          { ...faqJsonLd(plainFaq(article.faq)), '@id': `${absolute(route)}#faq` },
        ],
      };
      perRoute.push(
        `<script type="application/ld+json">${JSON.stringify(ld).replaceAll('<', '\\u003c')}</script>`
      );
    }
  }
  if (COMPARISONS.has(route)) {
    perRoute.push(`<link rel="alternate" type="text/markdown" href="${attr(route)}.md" />`);
  }
  // Feed readers and aggregators find the feed from the pages it covers.
  if (route === '/' || ARTICLE_ROUTES.includes(route) || RESEARCH_ROUTES.includes(route)) {
    perRoute.push(
      `<link rel="alternate" type="application/atom+xml" title="${ATOM_FEED_TITLE}" href="${ATOM_FEED}" />`
    );
  }
  // Every indexable page names the agent index, so an agent landing on any
  // public doc, article, research kit or comparison finds llms.txt directly.
  if (INDEXABLE.includes(route)) {
    perRoute.push('<link rel="alternate" type="text/plain" title="llms.txt" href="/llms.txt" />');
  }
  if (route === '/' && productionSite) {
    for (const [name, value] of [
      ['google-site-verification', process.env.GOOGLE_SITE_VERIFICATION],
      ['msvalidate.01', process.env.BING_SITE_VERIFICATION],
    ]) {
      if (value?.trim()) perRoute.push(`<meta name="${name}" content="${attr(value.trim())}" />`);
    }
  }
  if (route === '/docs/api') {
    perRoute.push(
      '<link rel="alternate" type="application/yaml" title="OpenAPI specification (YAML)" href="/openapi.yaml" />',
      '<link rel="alternate" type="application/json" title="OpenAPI specification (JSON)" href="/openapi.json" />'
    );
  }
  if (route === PRICING_ROUTE || route === PLAN_DOC_ROUTE) {
    perRoute.push(`<link rel="alternate" type="application/json" href="${PRICING_FEED}" />`);
  }
  // Keeps a non-indexable page out of results without hiding it from the
  // unfurler, which ignores robots meta.
  if (!INDEXABLE.includes(route)) {
    perRoute.push('<meta name="robots" content="noindex, follow" />');
  }

  // Structured data, home page only: who the organisation is, what the
  // software is, and that this site is its home. Serialised with `<`
  // escaped so page content can never break out of the script element.
  if (route === '/' && SITE_URL) {
    const ld = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Organization',
          '@id': `${SITE_URL}/#org`,
          name: 'Gregale',
          url: `${SITE_URL}/`,
          logo: `${SITE_URL}/logo.png`,
          // The organisation's own profiles, so search and AI answers tie
          // them to this site rather than to the Mediterranean wind.
          sameAs: [
            'https://github.com/gregale-dev',
            'https://github.com/gregale-dev/benchmarks',
            'https://github.com/gregale-dev/gregale-js',
            'https://github.com/gregale-dev/gregale-python',
            'https://github.com/gregale-dev/gregale-go',
            'https://www.linkedin.com/company/gregale/',
            'https://www.producthunt.com/products/gregale',
            'https://www.crunchbase.com/organization/gregale',
            'https://www.npmjs.com/package/gregale',
          ],
        },
        {
          '@type': 'WebSite',
          '@id': `${SITE_URL}/#site`,
          name: 'Gregale',
          url: `${SITE_URL}/`,
          publisher: { '@id': `${SITE_URL}/#org` },
        },
        {
          '@type': 'SoftwareApplication',
          '@id': `${SITE_URL}/#software`,
          publisher: { '@id': `${SITE_URL}/#org` },
          name: 'Gregale',
          applicationCategory: 'DeveloperApplication',
          operatingSystem: 'Linux',
          url: `${SITE_URL}/`,
          description:
            'Deploy APIs, jobs, Postgres and MCP servers in one command. Each app gets a ' +
            'Firecracker microVM; canary releases roll back on errors. Built for coding agents.',
          softwareHelp: `${SITE_URL}/docs`,
          offers: {
            '@type': 'AggregateOffer',
            priceCurrency: PLAN_CATALOG.currency,
            lowPrice: Math.min(...PLAN_CATALOG.plans.map((p) => p.monthly)),
            highPrice: Math.max(...PLAN_CATALOG.plans.map((p) => p.monthly)),
            offerCount: PLAN_CATALOG.plans.length,
            url: absolute(PRICING_ROUTE),
          },
          featureList: [
            'Firecracker microVM isolation per app',
            'Automatic 1% to 100% canary releases with 5xx rollback',
            'Idle pause after ~1 second with memory snapshot wake',
            'Managed PostgreSQL with code and database point-in-time rollback',
            'Scoped AI coding agent keys with human approval gates, cost preview and undo',
            'Hosted OAuth MCP server and per-PR preview environments',
          ],
        },
        // The "A few practical questions" cards, from the same strings.
        { ...faqJsonLd(LANDING_FAQ), '@id': `${SITE_URL}/#faq` },
      ],
    };
    perRoute.push(
      `<script type="application/ld+json">${JSON.stringify(ld).replaceAll('<', '\\u003c')}</script>`
    );
  }
  // Pricing: one Offer per plan and the page's questions, both read from
  // the generated catalog the page itself renders.
  if (route === PRICING_ROUTE && SITE_URL) {
    const ld = {
      '@context': 'https://schema.org',
      '@graph': [
        pricingJsonLd(PLAN_CATALOG, SITE_URL),
        { ...faqJsonLd(pricingFaq(PLAN_CATALOG)), '@id': `${SITE_URL}/pricing#faq` },
      ],
    };
    perRoute.push(
      `<script type="application/ld+json">${JSON.stringify(ld).replaceAll('<', '\\u003c')}</script>`
    );
  }
  // Comparison pages: their questions, from the same module the page renders.
  const comparison = COMPARISONS.get(route);
  if (comparison && SITE_URL) {
    const ld = {
      '@context': 'https://schema.org',
      ...faqJsonLd(comparison.faq),
      '@id': `${SITE_URL}${route}#faq`,
    };
    perRoute.push(
      `<script type="application/ld+json">${JSON.stringify(ld).replaceAll('<', '\\u003c')}</script>`
    );
  }
  if (perRoute.length) {
    doc = doc.replace('</head>', `  ${perRoute.join('\n    ')}\n  </head>`);
  }

  // `HeadContent` renders its tags as real elements wherever it sits in the
  // tree, so `renderToString` emits them inline at the top of #root. They are
  // already hoisted into <head> above, and a second <title> in the body is
  // exactly what an SEO audit flags — so drop the inline copies.
  //
  // Safe to drop: the client mounts fresh rather than hydrating, and React
  // re-hoists its own copies into <head> on mount. `src/prerender.test.ts`
  // asserts the body stays clean.
  //
  // React 19 also hoists <link rel="preload"> the same way, and those emit
  // before the title on the landing page — so the run has to be matched as a
  // whole. The preloads are worth keeping, just in <head> where they can
  // actually start a fetch early, so they are moved rather than dropped.
  const bodyHead = /^(?:<title>[\s\S]*?<\/title>|<meta\b[^>]*?\/?>|<link\b[^>]*?\/?>)+/;

  const rootDiv = '<div id="root"></div>';
  if (!doc.includes(rootDiv)) {
    throw new Error('Could not find the #root mount point in dist/index.html');
  }
  // Keep the hoisted <link>s (preloads), drop the title/meta — those are
  // already resolved into <head> above, from the router's own state.
  const hoisted = html.match(bodyHead)?.[0] ?? '';
  const links = hoisted.match(/<link\b[^>]*?\/?>/g)?.join('\n    ') ?? '';
  if (links) doc = doc.replace('</head>', `  ${links}\n  </head>`);

  doc = doc.replace(rootDiv, `<div id="root">${html.replace(bodyHead, '')}</div>`);

  const outFile =
    route === '/'
      ? TEMPLATE
      : route === NOT_FOUND_ROUTE
        ? join(DIST, '404.html')
        : incidentShell
          ? join(DIST, 'status', 'incidents', 'index.html')
          : join(DIST, route, 'index.html');
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, doc);

  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  console.log(`  prerendered ${route.padEnd(9)} ${text.length} chars of text`);
  written++;
}

/* ------------------------------------------------------------------ *
 * robots.txt and sitemap.xml
 *
 * Generated here rather than committed to `public/`, so the route list has
 * one source of truth: adding a route to ROUTES above cannot leave the
 * sitemap stale.
 * ------------------------------------------------------------------ */

// Named crawler groups take precedence over the wildcard, so apply the
// private-route exclusions to each group. GPTBot has its own training policy.
const robots = [
  ...[
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
  ].flatMap((agent) => [
    `User-agent: ${agent}`,
    'Disallow: /dashboard',
    'Disallow: /onboarding',
    'Allow: /',
    '',
  ]),
  ...(SITE_URL ? [`Sitemap: ${SITE_URL}/sitemap.xml`] : []),
  '',
].join('\n');

writeFileSync(join(DIST, 'robots.txt'), robots);
console.log('  wrote robots.txt');

/**
 * Modification dates for routes that are not docs pages (those come from Git
 * in sitemap.mjs): the dates the registries already state, so the sitemap
 * cannot claim a change the page does not show.
 */
const latest = (dates) => dates.reduce((a, b) => (a > b ? a : b));
const PAGE_DATES = new Map([
  ...[...ARTICLE_BY_ROUTE].map(([route, article]) => [route, article.updatedOn]),
  ['/articles', latest(ARTICLES.map((article) => article.updatedOn))],
  ...[...RESEARCH_BY_ROUTE].map(([route, publication]) => [route, publication.publishedOn]),
  ['/research', latest(RESEARCH_PUBLICATIONS.map((publication) => publication.publishedOn))],
  ...COMPARE_ROUTES.map((route) => [route, COMPARISONS_CHECKED]),
]);

if (SITE_URL) {
  writeFileSync(
    join(DIST, 'sitemap.xml'),
    sitemapXml(SITE_URL, INDEXABLE, {
      dates: PAGE_DATES,
      // The pricing page renders the plan catalog in docs/plans.
      datedLike: { [PRICING_ROUTE]: PLAN_DOC_ROUTE },
      docDates: DOCS_DATES,
    })
  );
  console.log(`  wrote sitemap.xml (${INDEXABLE.length} urls)`);
} else {
  console.log('  skipped sitemap.xml and canonical tags — set SITE_URL to emit them');
}

const pricing = {
  source: absolute(PLAN_DOC_ROUTE),
  billingInterval: 'month',
  pricesExcludeTax: true,
  currency: PLAN_CATALOG.currency,
  plans: PLAN_CATALOG.plans.map((plan) => ({
    ...plan,
    computeOverage:
      plan.name === 'Free'
        ? { policy: 'hard-cap' }
        : {
            policy: 'metered',
            pricePerGbRamHour: PLAN_CATALOG.overagePerGbHour,
            subjectToSpendCap: true,
          },
  })),
};
writeFileSync(join(DIST, PRICING_FEED), JSON.stringify(pricing, null, 2) + '\n');
console.log('  wrote pricing.json');

writeFileSync(join(DIST, 'openapi.yaml'), OPENAPI_YAML);
writeFileSync(join(DIST, 'openapi.json'), JSON.stringify(OPENAPI_DOC, null, 2) + '\n');
console.log('  wrote openapi.yaml and openapi.json');

const mcpServerCard = {
  serverInfo: {
    name: 'gregale',
    title: 'Gregale',
    description:
      'Deploy, inspect, scale, and roll back backend apps and managed PostgreSQL on Gregale from MCP clients.',
  },
  transport: {
    type: 'streamable-http',
    endpoint: 'https://api.gregale.dev/mcp',
  },
  authentication: {
    required: true,
    schemes: ['oauth2'],
    oauthProtectedResource: 'https://api.gregale.dev/.well-known/oauth-protected-resource/mcp',
    oauthAuthorizationServer: 'https://api.gregale.dev/.well-known/oauth-authorization-server/mcp',
  },
  documentationUrl: `${SITE_URL || 'https://gregale.dev'}/docs/agents`,
  websiteUrl: `${SITE_URL || 'https://gregale.dev'}/`,
};
mkdirSync(join(DIST, '.well-known', 'mcp'), { recursive: true });
writeFileSync(
  join(DIST, '.well-known', 'mcp', 'server-card.json'),
  JSON.stringify(mcpServerCard, null, 2) + '\n'
);
console.log('  wrote .well-known/mcp/server-card.json');

/* ------------------------------------------------------------------ *
 * llms.txt, llms-full.txt and a Markdown copy of every docs page
 *
 * For coding agents, which read Markdown far better than a rendered SPA.
 * Built from the same manifest as the docs routes; see src/lib/agent-docs.ts.
 * ------------------------------------------------------------------ */

const { absoluteLinks, comparisonPage, llmsFull, llmsIndex, llmsSmall, markdownPage } =
  await import('../src/lib/agent-docs.ts');
const llmsIntro = readFileSync(join('content', 'llms-intro.md'), 'utf8');
const pagesBySlug = new Map();
const markdownPages = DOC_ENTRIES.map((entry) => {
  const page = markdownPage(
    entry,
    readFileSync(join('content', 'docs', `${entry.slug}.md`), 'utf8'),
    SITE_URL
  );
  writeFileSync(join(DIST, 'docs', `${entry.slug}.md`), page);
  pagesBySlug.set(entry.slug, page);
  return page;
});
writeFileSync(join(DIST, 'llms.txt'), llmsIndex(llmsIntro, SITE_URL, [...COMPARISONS.values()]));
const researchPages = [...RESEARCH_BY_ROUTE].map(([route, publication]) => {
  const path = `research/${publication.slug}.md`;
  const body = readFileSync(join('content', path), 'utf8');
  const page = [
    `# ${publication.title}`,
    `Gregale Engineering · Published ${publication.publishedOn} · Measured ${publication.measuredOn}`,
    publication.summary,
    absoluteLinks(body, path, SITE_URL).trim(),
    `Canonical URL: ${absolute(route)}`,
    '',
  ].join('\n\n');
  writeFileSync(join(DIST, path), page);
  return page;
});

const articlePages = [...ARTICLE_BY_ROUTE].map(([route, entry]) => {
  const path = `articles/${entry.slug}.md`;
  const body = readFileSync(join('content', path), 'utf8');
  const faq = entry.faq.map((item) => `### ${item.question}\n\n${item.answer}`).join('\n\n');
  const page = [
    `# ${entry.title}`,
    `Gregale · Updated ${entry.updatedOn}`,
    entry.summary,
    absoluteLinks(body, path, SITE_URL).trim(),
    `## Questions\n\n${faq}`,
    `Canonical URL: ${absolute(route)}`,
    '',
  ].join('\n\n');
  writeFileSync(join(DIST, path), page);
  return page;
});

const comparisonPages = [...COMPARISONS].map(([route, comparison]) => {
  const page = comparisonPage(comparison, COMPARISONS_CHECKED, SITE_URL);
  writeFileSync(join(DIST, `${route.slice(1)}.md`), page);
  return page;
});

writeFileSync(
  join(DIST, ATOM_FEED),
  atomFeed({
    siteUrl: SITE_URL,
    path: ATOM_FEED,
    title: ATOM_FEED_TITLE,
    entries: [
      ...[...ARTICLE_BY_ROUTE].map(([route, article]) => ({
        route,
        title: article.title,
        summary: article.summary,
        published: article.publishedOn,
        updated: article.updatedOn,
      })),
      ...[...RESEARCH_BY_ROUTE].map(([route, publication]) => ({
        route,
        title: publication.title,
        summary: publication.summary,
        published: publication.publishedOn,
        updated: publication.publishedOn,
      })),
    ],
  })
);
console.log('  wrote feed.xml');

// Package the published inputs, with a directory prefix so the archive
// can be extracted anywhere without overwriting unrelated files.
const fastapiReproductionFiles = [
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
];
execFileSync(
  'tar',
  [
    '--format=ustar',
    '-czf',
    join(DIST, 'research', FASTAPI_COST_SLUG, 'reproduction.tar.gz'),
    '-C',
    join(DIST, 'research'),
    ...fastapiReproductionFiles.map((file) => join(FASTAPI_COST_SLUG, file)),
  ],
  { env: { ...process.env, COPYFILE_DISABLE: '1' } }
);

const snapshotRestoreReproductionFiles = ['README.md', 'analyze.py', 'samples.csv', 'summary.json'];
execFileSync(
  'tar',
  [
    '--format=ustar',
    '-czf',
    join(DIST, 'research', SNAPSHOT_RESTORE_SLUG, 'reproduction.tar.gz'),
    '-C',
    join(DIST, 'research'),
    ...snapshotRestoreReproductionFiles.map((file) => join(SNAPSHOT_RESTORE_SLUG, file)),
  ],
  { env: { ...process.env, COPYFILE_DISABLE: '1' } }
);

const paasCostModelReproductionFiles = [
  'README.md',
  'analyze.py',
  'vendors.json',
  'scenarios.json',
  'summary.json',
];
execFileSync(
  'tar',
  [
    '--format=ustar',
    '-czf',
    join(DIST, 'research', PAAS_COST_MODEL_SLUG, 'reproduction.tar.gz'),
    '-C',
    join(DIST, 'research'),
    ...paasCostModelReproductionFiles.map((file) => join(PAAS_COST_MODEL_SLUG, file)),
  ],
  { env: { ...process.env, COPYFILE_DISABLE: '1' } }
);

const agentGuardrailsReproductionFiles = [
  'README.md',
  'analyze.py',
  'criteria.json',
  'vendors.json',
  'summary.json',
];
execFileSync(
  'tar',
  [
    '--format=ustar',
    '-czf',
    join(DIST, 'research', AGENT_GUARDRAILS_SLUG, 'reproduction.tar.gz'),
    '-C',
    join(DIST, 'research'),
    ...agentGuardrailsReproductionFiles.map((file) => join(AGENT_GUARDRAILS_SLUG, file)),
  ],
  { env: { ...process.env, COPYFILE_DISABLE: '1' } }
);

writeFileSync(
  join(DIST, 'llms-full.txt'),
  llmsFull(llmsIntro, [...markdownPages, ...researchPages, ...articlePages, ...comparisonPages])
);
writeFileSync(join(DIST, 'llms-small.txt'), llmsSmall(llmsIntro, pagesBySlug));
console.log(
  `  wrote llms.txt, llms-full.txt, llms-small.txt and ${markdownPages.length + researchPages.length + articlePages.length + comparisonPages.length} Markdown pages`
);

if (productionSite && process.env.INDEXNOW_KEY) {
  writeIndexNowKey(DIST, process.env.INDEXNOW_KEY);
  console.log('  wrote IndexNow key file');
  const commit = process.env.VERCEL_GIT_COMMIT_SHA;
  if (/^[a-f0-9]{40}$/.test(commit ?? '')) {
    writeFileSync(
      join(DIST, 'indexnow-research.json'),
      JSON.stringify({
        commit,
        paths: [
          '/',
          PRICING_ROUTE,
          ...RESEARCH_ROUTES,
          ...ARTICLE_ROUTES,
          ...COMPARE_ROUTES,
          ...DOC_ROUTES,
        ],
      }) + '\n',
      { flag: 'wx' }
    );
  }
}

// The SSR bundle is a build artifact, not something to deploy.
rmSync('dist-ssr', { recursive: true, force: true });

console.log(`prerendered ${written} routes`);
