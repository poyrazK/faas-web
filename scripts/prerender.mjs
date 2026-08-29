import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

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
const { DOC_ENTRIES } = await import('../src/lib/docs-manifest.ts');
const DOC_ROUTES = ['/docs', ...DOC_ENTRIES.map((entry) => `/docs/${entry.slug}`)];

const ROUTES = ['/', '/login', '/signup', ...DOC_ROUTES];

/** Routes worth indexing. /login and /signup are prerendered so their link
 *  previews are right, but they are not search results. Docs are the opposite:
 *  they are most of the reason anyone would find this site through a search. */
const INDEXABLE = ['/', ...DOC_ROUTES];

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
const SITE_URL = (process.env.SITE_URL ?? 'https://gregale.dev').replace(/\/$/, '');

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
  const { html, meta } = await render(route);
  const tags = renderTags(dedupe(meta));

  let doc = stripStaticHead(template);
  doc = doc.replace('</head>', `  ${tags}\n  </head>`);

  // Canonical and og:url can only be written here — the router knows the
  // route, but not the host it will be served from.
  const perRoute = [];
  if (SITE_URL) {
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
          name: 'Gregale',
          applicationCategory: 'DeveloperApplication',
          operatingSystem: 'Linux',
          url: `${SITE_URL}/`,
          description:
            'Open-source serverless on Firecracker microVMs. Functions scale to zero when idle and wake from a snapshot in under 350 ms.',
          softwareHelp: `${SITE_URL}/docs`,
        },
      ],
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

  const outFile = route === '/' ? TEMPLATE : join(DIST, route, 'index.html');
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

// The console is behind auth — a crawler following these gets a login screen
// and nothing else, so keep them out of the index and out of the budget.
const robots = [
  'User-agent: *',
  'Disallow: /dashboard',
  'Disallow: /onboarding',
  'Allow: /',
  ...(SITE_URL ? ['', `Sitemap: ${SITE_URL}/sitemap.xml`] : []),
  '',
].join('\n');

writeFileSync(join(DIST, 'robots.txt'), robots);
console.log('  wrote robots.txt');

if (SITE_URL) {
  const urls = INDEXABLE.map(
    (route) => `  <url>\n    <loc>${absolute(route)}</loc>\n  </url>`
  ).join('\n');

  writeFileSync(
    join(DIST, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
  );
  console.log(`  wrote sitemap.xml (${INDEXABLE.length} urls)`);
} else {
  console.log('  skipped sitemap.xml and canonical tags — set SITE_URL to emit them');
}

// The SSR bundle is a build artifact, not something to deploy.
rmSync('dist-ssr', { recursive: true, force: true });

console.log(`prerendered ${written} routes`);
