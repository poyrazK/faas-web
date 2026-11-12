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

// A redirect to the docs index also ends in 200. Check the original response,
// page identity and canonical so an edge rule cannot hide a working prerender.
for (const [path, title] of [
  ['/docs/api', 'API reference · Gregale'],
  ['/docs/api/apps', 'Apps API · Gregale'],
  ['/docs/api/deployments', 'Deployments API · Gregale'],
  ['/docs/agents', 'Use Gregale from coding agents · Gregale'],
]) {
  try {
    const response = await fetch(base + path, { redirect: 'manual' });
    if (response.status !== 200) {
      failures.push(`${path}: expected direct HTTP 200, got ${response.status}`);
      continue;
    }
    const html = await response.text();
    if (!response.headers.get('content-type')?.includes('text/html')) {
      failures.push(`${path}: expected HTML`);
    }
    if (!html.includes(`<title>${title}</title>`)) failures.push(`${path}: wrong page title`);
    const canonical = html.match(/<link rel="canonical" href="([^"]+)"/);
    if (!canonical || new URL(canonical[1]).pathname !== path) {
      failures.push(`${path}: missing or incorrect canonical`);
    }
    const alternate = html.match(/<link rel="alternate" type="text\/markdown" href="([^"]+)"/);
    if (path.startsWith('/docs/api') && alternate) {
      failures.push(`${path}: advertises an ungenerated API Markdown copy`);
    }
    if (path === '/docs/agents') {
      if (alternate?.[1] !== '/docs/agents.md') {
        failures.push(`${path}: missing guide Markdown alternate`);
      } else {
        const markdown = await fetch(base + alternate[1], { redirect: 'manual' });
        if (
          markdown.status !== 200 ||
          !markdown.headers.get('content-type')?.includes('text/markdown') ||
          !(await markdown.text()).startsWith('# Use Gregale from coding agents\n')
        ) {
          failures.push(`${alternate[1]}: expected a direct Markdown document`);
        }
      }
    }
  } catch (error) {
    failures.push(`${path}: request failed: ${error}`);
  }
}

for (const path of [
  '/docs/definitely-not-a-page',
  '/docs/api/definitely-not-a-group',
  '/docs/api.md',
  '/docs/api/apps.md',
  '/definitely-not-a-page',
  '/dashboard/definitely-not-a-page',
  '/assets/definitely-missing.js',
]) {
  try {
    const response = await fetch(base + path, { redirect: 'manual' });
    if (response.status !== 404)
      failures.push(`${path}: expected HTTP 404, got ${response.status}`);
  } catch (error) {
    failures.push(`${path}: request failed: ${error}`);
  }
}

if (failures.length) {
  console.error(`hosting smoke failed for ${base}:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(
  `hosting smoke passed for console headers, documentation and missing routes on ${base}`
);
