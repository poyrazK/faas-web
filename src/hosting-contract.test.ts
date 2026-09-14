import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

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

describe('public hosting contract', () => {
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
    const headers = config.routes[boundary]?.headers ?? {};

    expect(boundary).toBeGreaterThan(apiEnd);
    expect(boundary).toBeLessThan(filesystem);
    expect(headers['Content-Security-Policy']).toContain("frame-ancestors 'none'");
    expect(headers['Content-Security-Policy']).toContain("object-src 'none'");
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['Permissions-Policy']).toContain('camera=()');
    expect(headers['Access-Control-Allow-Origin']).toBe('https://gregale.dev');
  });
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
])('returns 404 for an unpublished URL %s', (path) => {
  expect(fallbackFor(path)).toMatchObject({ status: 404, dest: '/404.html' });
});

it('preserves every registered app route as a deep link', () => {
  const source = readFileSync('src/routeTree.gen.ts', 'utf8');
  const paths = [
    ...source.matchAll(/^ {2}'(\/(?:dashboard|onboarding|invite)[^']*)': typeof/gm),
  ].map((match) => match[1]);
  expect(paths.length).toBeGreaterThan(40);
  for (const path of paths) {
    const concrete = path.replace(/\$[^/]+/g, 'example-id');
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
