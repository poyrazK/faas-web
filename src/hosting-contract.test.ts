import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { buildApiReference } from '@/lib/api-reference/build';
import { securityHeaders } from '@/lib/security-headers';

interface Route {
  src?: string;
  dest?: string;
  methods?: string[];
  status?: number;
  has?: { type: string; key: string; value?: string }[];
  headers?: Record<string, string>;
  continue?: boolean;
}

const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
  routes: Route[];
};

describe('public hosting contract', () => {
  it.each(['/terms', '/privacy', '/acceptable-use'])(
    'serves %s from apid before the site fallbacks',
    (path) => {
      for (const method of ['GET', 'HEAD']) {
        const route = config.routes.find(
          (candidate) =>
            candidate.src &&
            !candidate.continue &&
            (!candidate.methods || candidate.methods.includes(method)) &&
            new RegExp(candidate.src).test(path)
        );

        expect(route?.dest).toBe(`https://api.gregale.dev${path}`);
        expect(route?.status).toBeUndefined();
      }
    }
  );

  it.each(['GET', 'POST'])('sends the MFA %s to apid before any app or 404 fallback', (method) => {
    const request = new URL(
      '/dashboard/mfa?next=%2Fcli-auth%3Fcode%3Dfixture%26return%3Dmcp',
      'https://gregale.dev'
    );
    const route = config.routes.find(
      (candidate) =>
        candidate.src &&
        !candidate.continue &&
        (!candidate.methods || candidate.methods.includes(method)) &&
        new RegExp(candidate.src).test(request.pathname)
    );

    expect(route?.dest).toBe('https://api.gregale.dev/dashboard/mfa');
    expect(route?.status).toBeUndefined();
  });

  it('serves the OpenAI plugin domain challenge as plain text', () => {
    // OpenAI verifies the MCP server's domain from a parent hostname:
    // https://gregale.dev/.well-known/openai-apps-challenge holds the token.
    const token = readFileSync('public/.well-known/openai-apps-challenge', 'utf8');
    expect(token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    const filesystem = config.routes.findIndex((route) => 'handle' in route);
    const rule = config.routes
      .slice(0, filesystem)
      .find(
        (route) =>
          route.continue &&
          route.headers?.['Content-Type'] === 'text/plain; charset=utf-8' &&
          new RegExp(route.src!).test('/.well-known/openai-apps-challenge')
      );
    expect(rule).toBeDefined();
  });

  it('keeps MFA server-rendered on alternate static hosts too', () => {
    const rules = readFileSync('public/_redirects', 'utf8')
      .split('\n')
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => line.trim().split(/\s+/));

    expect(rules.find(([source]) => source === '/dashboard/mfa')).toEqual([
      '/dashboard/mfa',
      'https://api.gregale.dev/dashboard/mfa',
      '200',
    ]);
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

  it('serves every API reference page instead of collapsing it onto /docs/api', () => {
    const filesystem = config.routes.findIndex((route) => 'handle' in route);
    const edgeRule = (path: string) =>
      config.routes
        .slice(0, filesystem)
        .find((route) => route.src && !route.continue && new RegExp(route.src).test(path));
    const groups = buildApiReference(load(readFileSync('api/openapi.yaml', 'utf8')));

    expect(groups.length).toBeGreaterThan(0);
    for (const { id } of groups) expect(edgeRule(`/docs/api/${id}`)).toBeUndefined();
    // Guide child paths still collapse onto their parent guide.
    const child = edgeRule('/docs/build/limits');
    expect(child?.status).toBe(308);
    expect(
      '/docs/build/limits'.replace(new RegExp(child?.src ?? ''), child?.headers?.Location ?? '')
    ).toBe('/docs/build');
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

  it('opens CORS and content-negotiates Markdown for public agent discovery paths', () => {
    const filesystem = config.routes.findIndex((route) => 'handle' in route);
    const preFs = config.routes.slice(0, filesystem);

    const corsRule = preFs.find(
      (route) => route.continue && route.headers?.['Access-Control-Allow-Origin'] === '*'
    );
    expect(corsRule?.src).toBeDefined();
    for (const path of [
      '/llms.txt',
      '/llms-full.txt',
      '/llms-small.txt',
      '/pricing.json',
      '/.well-known/mcp/server-card.json',
      '/openapi.yaml',
      '/openapi.json',
      '/docs/quickstart.md',
      '/articles/canary-deploys.md',
      '/vs/vercel.md',
      '/index.md',
      '/pricing.md',
      '/docs.md',
      '/articles.md',
      '/research.md',
    ]) {
      expect(new RegExp(corsRule!.src!).test(path), path).toBe(true);
    }

    const mdRewrite = (path: string) =>
      preFs.find(
        (route) =>
          route.src &&
          !route.continue &&
          route.has?.some((cond) => cond.key === 'accept' && cond.value === '.*text/markdown.*') &&
          new RegExp(route.src).test(path)
      );

    expect(mdRewrite('/docs/quickstart')?.dest).toBe('/docs/$1.md');
    expect(mdRewrite('/articles/best-cloud-for-ai-coding-agents')?.dest).toBe('/$1/$2.md');
    expect(mdRewrite('/vs/cloud-run')?.dest).toBe('/$1/$2.md');
    expect(mdRewrite('/')?.dest).toBe('/index.md');
    for (const path of ['/pricing', '/docs', '/articles', '/research']) {
      expect(mdRewrite(path)?.dest, path).toBe('/$1.md');
    }
    expect(mdRewrite('/dashboard')).toBeUndefined();
    expect(mdRewrite('/status')).toBeUndefined();
    expect(mdRewrite('/docs/api')).toBeUndefined();
    expect(mdRewrite('/docs/api/apps')).toBeUndefined();

    // A cache must not hand the Markdown copy to a browser, or the page to an agent.
    const varies = (path: string) =>
      preFs.some(
        (route) =>
          route.continue && route.headers?.Vary === 'Accept' && new RegExp(route.src!).test(path)
      );
    for (const path of ['/', '/pricing', '/docs', '/articles', '/research', '/docs/quickstart']) {
      expect(varies(path), path).toBe(true);
    }

    const yamlHeader = preFs.find((route) => route.continue && route.src === '^/openapi\\.yaml$');
    expect(yamlHeader?.headers?.['Content-Type']).toBe('application/yaml; charset=utf-8');
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

it.each(['/not-a-page', '/dashboard/not-a-page', '/assets/missing.js', '/docs/not-a-page'])(
  'returns 404 for an unpublished URL %s',
  (path) => {
    expect(fallbackFor(path)).toMatchObject({ status: 404, dest: '/404.html' });
  }
);

it('preserves every registered app route as a deep link', () => {
  const source = readFileSync('src/routeTree.gen.ts', 'utf8');
  // The component gallery is dev-only and must 404 in production.
  const devOnly = new Set(['/dashboard/kit']);
  const paths = [
    ...source.matchAll(/^ {2}'(\/(?:dashboard|onboarding|invite|api-sandbox)[^']*)': typeof/gm),
  ]
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
