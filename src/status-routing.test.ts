import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('public status hosting routes', () => {
  it('proxies legacy JSON before the SPA fallback on both hosts', () => {
    const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
      routes: Array<{ src?: string; dest?: string }>;
    };
    const legacy = vercel.routes.findIndex((route) => route.src === '^/status/slo\\.json$');
    const fallback = vercel.routes.findIndex((route) => route.dest === '/index.html');
    expect(legacy).toBeGreaterThanOrEqual(0);
    expect(legacy).toBeLessThan(fallback);

    const redirects = readFileSync('public/_redirects', 'utf8');
    expect(redirects).toContain(
      '/status/slo.json    https://api.gregale.dev/status/slo.json   200'
    );
    expect(redirects.indexOf('/status/slo.json')).toBeLessThan(redirects.indexOf('/*'));
  });

  it('routes incident permalinks through a noindex document shell', () => {
    const vercel = readFileSync('vercel.json', 'utf8');
    expect(vercel).toContain('/status/incidents/index.html');
    expect(vercel).toContain('X-Robots-Tag');
    const redirects = readFileSync('public/_redirects', 'utf8');
    expect(redirects).toContain('/status/incidents/*    /status/incidents/index.html   200');
  });
});
