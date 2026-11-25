/**
 * Production browser-boundary smoke. Run after Vercel promotes main:
 *
 *   npm run smoke:hosting
 *   GREGALE_SITE_URL=https://preview.example npm run smoke:hosting
 */

const base = (process.env.GREGALE_SITE_URL ?? 'https://gregale.dev').replace(/\/$/, '');
const paths = [
  '/',
  '/dashboard',
  '/dashboard/apps',
  '/dashboard/settings?section=integrations',
  '/dashboard/apps/new',
];
const required = {
  'content-security-policy': [
    "frame-ancestors 'none'",
    "object-src 'none'",
    "form-action 'self' https://github.com;",
  ],
  'x-content-type-options': ['nosniff'],
  'x-frame-options': ['DENY'],
  'referrer-policy': ['strict-origin-when-cross-origin'],
  'permissions-policy': ['camera=()', 'microphone=()'],
};

const failures = [];
for (const path of paths) {
  let response;
  try {
    response = await fetch(base + path, { redirect: 'follow' });
  } catch (error) {
    failures.push(`${path}: request failed: ${error}`);
    continue;
  }
  if (!response.ok) failures.push(`${path}: HTTP ${response.status}`);
  for (const [name, fragments] of Object.entries(required)) {
    const value = response.headers.get(name) ?? '';
    for (const fragment of fragments) {
      if (!value.includes(fragment)) failures.push(`${path}: ${name} is missing ${fragment}`);
    }
  }
  const cors = response.headers.get('access-control-allow-origin');
  if (cors !== null && cors !== 'https://gregale.dev') {
    failures.push(`${path}: unsafe access-control-allow-origin ${cors}`);
  }
}

for (const path of [
  '/docs/definitely-not-a-page',
  '/definitely-not-a-page',
  '/dashboard/definitely-not-a-page',
  '/assets/definitely-missing.js',
]) {
  try {
    const response = await fetch(base + path);
    if (response.status !== 404)
      failures.push(`${path}: expected HTTP 404, got ${response.status}`);
  } catch (error) {
    failures.push(`${path}: request failed: ${error}`);
  }
}

const discoveryPaths = [
  '/llms.txt',
  '/llms-small.txt',
  '/pricing.json',
  '/.well-known/mcp/server-card.json',
  '/openapi.yaml',
  '/openapi.json',
];
for (const path of discoveryPaths) {
  try {
    const response = await fetch(base + path, { redirect: 'follow' });
    if (!response.ok) failures.push(`${path}: expected HTTP 200, got ${response.status}`);
    if (response.headers.get('access-control-allow-origin') !== '*') {
      failures.push(`${path}: expected Access-Control-Allow-Origin: *`);
    }
  } catch (error) {
    failures.push(`${path}: request failed: ${error}`);
  }
}

for (const path of [
  '/docs/quickstart',
  '/articles/best-cloud-for-ai-coding-agents',
  '/vs/cloud-run',
]) {
  try {
    const response = await fetch(base + path, {
      headers: { accept: 'text/markdown' },
      redirect: 'follow',
    });
    if (!response.ok)
      failures.push(`${path} (markdown): expected HTTP 200, got ${response.status}`);
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('text/markdown')) {
      failures.push(`${path} (markdown): expected text/markdown, got ${contentType}`);
    }
    if (response.headers.get('access-control-allow-origin') !== '*') {
      failures.push(`${path} (markdown): expected Access-Control-Allow-Origin: *`);
    }
    const vary = (response.headers.get('vary') ?? '').toLowerCase();
    if (!vary.includes('accept')) {
      failures.push(`${path} (markdown): expected Vary to include Accept`);
    }
    const link = response.headers.get('link') ?? '';
    if (!link.includes('rel="canonical"')) {
      failures.push(`${path} (markdown): expected Link canonical header`);
    }
  } catch (error) {
    failures.push(`${path} (markdown): request failed: ${error}`);
  }
}

try {
  const response = await fetch(`${base}/docs/quickstart`, { redirect: 'follow' });
  const html = await response.text();
  for (const snippet of ['TechArticle', 'BreadcrumbList', 'href="/llms.txt"']) {
    if (!html.includes(snippet)) failures.push(`/docs/quickstart: HTML is missing ${snippet}`);
  }
} catch (error) {
  failures.push(`/docs/quickstart (HTML): request failed: ${error}`);
}

if (failures.length) {
  console.error(`hosting smoke failed for ${base}:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(
  `hosting smoke passed for ${paths.length} browser routes, ${discoveryPaths.length} discovery endpoints, and markdown negotiation on ${base}`
);
