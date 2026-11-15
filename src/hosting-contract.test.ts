import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { securityHeaders } from '@/lib/security-headers';
import { DOC_ENTRIES } from '@/lib/docs-manifest';
import { DOC_ALIASES } from '@/lib/docs-catalog';

interface Route {
  src?: string;
  dest?: string;
  status?: number;
  headers?: Record<string, string>;
  continue?: boolean;
}

const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
  routes: Route[];
};

function beforeFilesystem(path: string) {
  const filesystem = config.routes.findIndex((route) => 'handle' in route);
  return config.routes
    .slice(0, filesystem)
    .find((route) => route.src && !route.continue && new RegExp(route.src).test(path));
}

function alternateHostRule(path: string) {
  return readFileSync('public/_redirects', 'utf8')
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('#'))
    .map((line) => line.trim().split(/\s+/))
    .find(([source]) => {
      const pattern = source
        .split('/')
        .map((segment) =>
          segment === '*'
            ? '.*'
            : segment.startsWith(':')
              ? '[^/]+'
              : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        )
        .join('/');
      return new RegExp(`^${pattern}$`).test(path);
    });
}

describe('public hosting contract', () => {
  it.each([
    '/docs/api',
    '/docs/api/apps',
    '/docs/api/apps/',
    '/docs/api/deployments',
    '/docs/api/not-a-group',
    '/docs/api/apps.md',
    '/docs/api/not-a-group/child',
  ])('lets the filesystem resolve API reference path %s without a parent redirect', (path) => {
    expect(beforeFilesystem(path)).toBeUndefined();
    expect(alternateHostRule(path)).toBeUndefined();
  });

  it('preserves legacy child links for every published guide and alias', () => {
    const parents = new Set([
      ...DOC_ENTRIES.map((entry) => entry.slug),
      ...Object.keys(DOC_ALIASES).filter((slug) => !slug.includes('/')),
    ]);
    for (const parent of parents) {
      const path = `/docs/${parent}/legacy-section`;
      expect(beforeFilesystem(path), path).toMatchObject({
        status: 308,
        headers: { Location: '/docs/$1' },
      });
      expect(alternateHostRule(path), path).toEqual([
        `/docs/${parent}/*`,
        `/docs/${parent}`,
        '301',
      ]);
    }
  });

  it('returns a host-level 404 for unknown documentation routes', () => {
    const filesystem = config.routes.findIndex((route) => 'handle' in route);
    const docs404 = config.routes.findIndex(
      (route) => route.src === '^/docs(?:/.*)?$' && route.status === 404
    );
    const spa = config.routes.findIndex((route) => route.dest === '/index.html');

    expect(docs404).toBeGreaterThan(filesystem);
    expect(spa).toBeGreaterThan(docs404);
    expect(config.routes[docs404]?.dest).toBe('/404.html');
  });

  it('applies the browser security boundary to every route', () => {
    const apiEnd = config.routes.findIndex((route) => route.src === '^/logout$');
    const filesystem = config.routes.findIndex((route) => 'handle' in route);
    const boundary = config.routes.findIndex(
      (route) => route.src === '^/(.*)$' && route.continue === true
    );

    expect(boundary).toBeGreaterThan(apiEnd);
    expect(boundary).toBeLessThan(filesystem);
  });

  it('serves exactly the policy src/lib/security-headers.ts defines', () => {
    const boundary = config.routes.find(
      (route) => route.src === '^/(.*)$' && route.continue === true
    );
    // On failure: copy `securityHeaders('production')` into vercel.json —
    // Vercel reads JSON, so the literal is a copy and this test keeps it honest.
    expect(boundary?.headers).toEqual(securityHeaders('production'));
  });
});

it('loads fonts from this origin, not a CDN', () => {
  // The policy is `font-src 'self'` and `style-src 'self'`; a CDN tag in the
  // document would be blocked, and a CDN rule in the stylesheet likewise.
  const thirdParty = /fonts\.googleapis\.com|fonts\.gstatic\.com|fontshare\.com/;
  expect(readFileSync('index.html', 'utf8')).not.toMatch(thirdParty);
  const fonts = readFileSync('src/fonts.css', 'utf8');
  expect(fonts).not.toMatch(thirdParty);
  for (const family of ['Familjen Grotesk', 'Spline Sans Mono', 'Satoshi']) {
    expect(fonts).toContain(`font-family: '${family}'`);
  }
  // Relative, so Vite content-hashes the files into /assets/, where the
  // immutable cache rule above already applies; see prerender.test.ts.
  expect(fonts.match(/url\('\.\/fonts\/[a-z0-9-]+\.woff2'\)/g)).toHaveLength(8);
});

/** Model only the post-filesystem fallbacks: published documents and assets
 * have already resolved; missing routes must never receive the landing shell. */
function fallbackFor(path: string) {
  const filesystem = config.routes.findIndex((route) => 'handle' in route);
  return config.routes
    .slice(filesystem + 1)
    .find((route) => route.src && new RegExp(route.src).test(path));
}

it.each([
  '/privacy',
  '/terms',
  '/not-a-page',
  '/dashboard/not-a-page',
  '/assets/missing.js',
  '/docs/not-a-page',
  '/docs/api/not-a-group',
  '/docs/api.md',
  '/docs/api/apps.md',
])('returns 404 for an unpublished URL %s', (path) => {
  expect(fallbackFor(path)).toMatchObject({ status: 404, dest: '/404.html' });
});

it('preserves every registered app route as a deep link', () => {
  const source = readFileSync('src/routeTree.gen.ts', 'utf8');
  // The component gallery is dev-only and must 404 in production.
  const devOnly = new Set(['/dashboard/kit']);
  const paths = [...source.matchAll(/^ {2}'(\/(?:dashboard|onboarding|invite)[^']*)': typeof/gm)]
    .map((match) => match[1])
    .filter((path) => !devOnly.has(path));
  expect(paths.length).toBeGreaterThan(40);
  for (const path of paths) {
    // A route id's trailing `_` un-nests it from its parent's layout
    // (`releases_/$id/approval`); the URL has no underscore.
    const concrete = path.replace(/\$[^/]+/g, 'example-id').replace(/_(?=\/|$)/g, '');
    expect(fallbackFor(concrete), concrete).toMatchObject({ dest: '/index.html' });
    expect(fallbackFor(concrete)?.status, concrete).not.toBe(404);
  }
});

it('keeps the alternate static-host rules scoped to registered app routes', () => {
  const redirects = readFileSync('public/_redirects', 'utf8')
    .split('\n')
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.trim().split(/\s+/));
  const appRules = redirects.filter(([, target]) => target === '/index.html');
  expect(appRules.length).toBeGreaterThan(40);
  for (const [source] of appRules) {
    expect(source).not.toContain('*');
    expect(fallbackFor(source.replace(/:[^/]+/g, 'example-id'))?.dest).toBe('/index.html');
  }
});
