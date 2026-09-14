import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface Route {
  src?: string;
  dest?: string;
  status?: number;
}

interface HeaderGroup {
  source: string;
  headers: Array<{ key: string; value: string }>;
}

const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
  routes: Route[];
  headers: HeaderGroup[];
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
    const all = config.headers.find((group) => group.source === '/(.*)');
    const headers = new Map(all?.headers.map(({ key, value }) => [key, value]));

    expect(headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(headers.get('Content-Security-Policy')).toContain("object-src 'none'");
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('X-Frame-Options')).toBe('DENY');
    expect(headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(headers.get('Permissions-Policy')).toContain('camera=()');
    expect(headers.has('Access-Control-Allow-Origin')).toBe(false);
  });
});
