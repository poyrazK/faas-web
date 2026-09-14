/**
 * Production browser-boundary smoke. Run after Vercel promotes main:
 *
 *   npm run smoke:hosting
 *   GREGALE_SITE_URL=https://preview.example npm run smoke:hosting
 */

const base = (process.env.GREGALE_SITE_URL ?? 'https://gregale.dev').replace(/\/$/, '');
const paths = ['/', '/dashboard', '/dashboard/workflows'];
const required = {
  'content-security-policy': ["frame-ancestors 'none'", "object-src 'none'"],
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

for (const path of ['/docs/definitely-not-a-page', '/definitely-not-a-page', '/dashboard/definitely-not-a-page', '/assets/definitely-missing.js']) {
  try {
    const response = await fetch(base + path);
    if (response.status !== 404) failures.push(`${path}: expected HTTP 404, got ${response.status}`);
  } catch (error) {
    failures.push(`${path}: request failed: ${error}`);
  }
}

if (failures.length) {
  console.error(`hosting smoke failed for ${base}:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`hosting smoke passed for ${paths.length} routes on ${base}`);
