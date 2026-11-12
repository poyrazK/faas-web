// Walks the whole console against the mock API and fails on the states a
// screenshot would have caught and a unit test never will: an error boundary,
// a spinner nothing resolves, a path the mock does not answer, a page that
// threw. Vitest covers logic; this covers "does the console actually render".
//
//   npm run dev:mock &          # or MOCK_EMPTY=1 for the empty workspace
//   npm run tour
//
// Playwright is not a dependency of this project — it pulls ~100MB of browser
// per platform, which is a lot to ask of everyone for one script. Install it
// when you want to run this:
//
//   npm i -D playwright && npx playwright install chromium
//
// Env: BASE_URL (default http://localhost:3000), SHOTS (directory, optional),
// SETTLE (ms to wait per page, default 2200 — raise it for a slow API), and
// TOUR_SCOPE=overview for the focused Overview interaction regression.

import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const SETTLE = Number(process.env.SETTLE ?? 2200);
const SHOTS = process.env.SHOTS;
const OVERVIEW_ONLY = process.env.TOUR_SCOPE === 'overview';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error(
    'tour: playwright is not installed.\n  npm i -D playwright && npx playwright install chromium'
  );
  process.exit(2);
}

/** Account-level pages, plus the per-app routes that still resolve standalone. */
const PAGES = [
  '',
  'apps',
  'projects',
  'analytics',
  'releases',
  'builds',
  'crons',
  'instances',
  'domains',
  'edge-rules',
  'storage',
  'invocations',
  'audit',
  'usage',
  'budgets',
  'invoices',
  'plans',
  'keys',
  'team',
  'security',
  'settings',
  'secrets',
  'env',
  'logs',
  'metrics',
  'routes',
  'queues',
  'upstreams',
  'alerts',
  'webhooks',
];

const APP_TABS = [
  'Metrics',
  'Deployments',
  'Logs',
  'Routes',
  'Environment',
  'Queues',
  'Upstreams',
  'Alerts',
  'Webhooks',
  'General',
  'Runtime',
  'Health and releases',
  'Source and access',
  'Wakes',
];

if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const failures = [];
const pageErrors = [];
const unmocked = new Set();
page.on('pageerror', (e) => pageErrors.push(String(e).split('\n')[0]));
// A blocked font, fetch, style or script is invisible to the DOM checks below
// and to a user with no console open. Chromium reports each one as a console
// error naming the directive; the dev server and `vite preview` both send the
// policy (see src/lib/security-headers.ts), so this is checked on every tour.
const cspViolations = [];
page.on('console', (msg) => {
  const text = msg.text();
  if (msg.type() === 'error' && /Content Security Policy/.test(text)) {
    cspViolations.push(text.replace(/\s+/g, ' ').slice(0, 200));
  }
});
page.on('response', (r) => {
  if (r.url().includes('/v1/') && r.status() === 404) unmocked.add(new URL(r.url()).pathname);
});

// The dev bypass, set the way the button sets it — the tour is a design check,
// not an auth test, and real sign-in has its own coverage.
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  localStorage.setItem('gregale.session', JSON.stringify({ email: 'design@gregale.dev' }));
  localStorage.setItem('gregale.onboarded', 'true');
  localStorage.setItem('gregale.dev-bypass', 'true');
});

async function visit(url, name) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(SETTLE);
  const text = await page
    .locator('#main')
    .innerText()
    .catch(() => '');
  const bad = [];

  if (text.includes('This page hit an error')) bad.push('error boundary');
  // Past the settle window, "Loading…" means a query that will never resolve —
  // usually one gated on a value that never arrives.
  if (/Loading|Querying/.test(text)) bad.push('stuck loading');
  // An in-flight or failed read dressed up as "there is nothing here".
  if (/Loading|Querying/.test(text) && /No .* (match|yet)|belong to an app/.test(text))
    bad.push('contradictory state');
  if (!text.trim()) bad.push('empty page');

  if (bad.length) failures.push(`${name}: ${bad.join(', ')}`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name.replace(/[^\w.-]+/g, '_')}.png` });
  return bad.length === 0;
}

/**
 * Exercise the controls whose behavior depends on real browser hit testing.
 *
 * DOM tests can invoke these handlers directly even when a decorative fixed
 * layer is sitting above them. The tour checks both pointer and keyboard paths
 * in the layout the customer actually receives.
 */
async function exerciseOverviewControls() {
  const timeseries = (since) => (request) => {
    const url = new URL(request.url());
    return (
      request.method() === 'GET' &&
      url.pathname.endsWith('/analytics/timeseries') &&
      url.searchParams.get('since') === since
    );
  };
  const windowGroup = page.getByRole('group', { name: 'Time window', exact: true });
  await windowGroup.scrollIntoViewIfNeeded();

  // Pointer: the window drives every tile's series and is kept in the URL.
  await Promise.all([
    page.waitForRequest(timeseries('7d')),
    windowGroup.getByRole('button', { name: '7d', exact: true }).click(),
  ]);
  if (new URL(page.url()).searchParams.get('range') !== '7d')
    throw new Error('the 7d window is not in the URL');

  // Keyboard: back to 24 hours.
  await windowGroup.getByRole('button', { name: '24h', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !new URL(location.href).searchParams.has('range'));

  const refresh = page.getByRole('button', { name: 'Refresh', exact: true });
  await Promise.all([page.waitForRequest(timeseries('24h')), refresh.click()]);
  await refresh.focus();
  await Promise.all([page.waitForRequest(timeseries('24h')), page.keyboard.press('Enter')]);
}

const tourPages = OVERVIEW_ONLY ? [''] : PAGES;
for (const p of tourPages) {
  const ready = await visit(`${BASE}/dashboard/${p}`, p || 'index');
  const hasControls =
    p === '' && (await page.getByRole('group', { name: 'Time window', exact: true }).count()) > 0;
  if (p === '' && ready && (OVERVIEW_ONLY || hasControls)) {
    try {
      await exerciseOverviewControls();
    } catch (error) {
      failures.push(`index: overview controls: ${String(error).split('\n')[0]}`);
    }
  }
}

// The app detail page carries every per-app resource; each tab is its own render.
const slug = await page.evaluate(async (base) => {
  const res = await fetch(`${base}/v1/apps`, { credentials: 'include' });
  const apps = await res.json();
  return Array.isArray(apps) && apps.length ? apps[0].slug : '';
}, BASE);

if (slug && !OVERVIEW_ONLY) {
  for (const tab of APP_TABS)
    await visit(`${BASE}/dashboard/apps/${slug}?tab=${tab}`, `app.${tab}`);
} else if (!OVERVIEW_ONLY) {
  console.log(
    'tour: no apps in this workspace — skipped the app tabs (expected under MOCK_EMPTY=1)'
  );
}

await browser.close();

const problems = [
  ...failures,
  ...[...unmocked].map((p) => `unmocked path: ${p}`),
  ...pageErrors.map((e) => `page error: ${e}`),
  ...[...new Set(cspViolations)].map((v) => `csp violation: ${v}`),
];

if (problems.length) {
  console.error(`tour: ${problems.length} problem(s)`);
  for (const p of problems) console.error('  -', p);
  process.exit(1);
}
console.log(
  `tour: ok — ${tourPages.length} pages${slug && !OVERVIEW_ONLY ? ` + ${APP_TABS.length} app tabs` : ''}, no errors`
);
