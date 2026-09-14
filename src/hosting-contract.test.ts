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
