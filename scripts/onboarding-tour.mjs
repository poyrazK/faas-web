// Run against a fresh mock server: VITE_FEATURE_ONBOARDING_V2=1 MOCK_EMPTY=1 npm run dev:mock
// Optional FAILURE_URL points at another fresh server with MOCK_BUILD_FAIL=1.
// Install Playwright separately, as for tour.mjs. PLAYWRIGHT_MODULE and
// CHROMIUM_EXECUTABLE_PATH support an external installation/system browser.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const base = process.env.BASE_URL ?? 'http://localhost:3000';
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH });
const errors = [];
async function fresh(url = base) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  const posts = [];
  page.on('request', (r) => {
    if (r.method() === 'POST') posts.push({ path: new URL(r.url()).pathname, body: r.postData() });
  });
  await page.route('**/v1/account', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const account = await response.json();
    await route.fulfill({
      response,
      json: {
        ...account,
        plan: 'free',
        limits: { ...account.limits, plan: 'free', ram_mb: 128, deployed_apps: 3 },
      },
    });
  });
  await page.goto(url);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('gregale.session', JSON.stringify({ email: 'design@gregale.dev' }));
  });
  return { page, posts, context };
}
async function shot(page, name) {
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
    `${name}: horizontal overflow`
  );
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
}
async function live(page) {
  await page
    .getByRole('heading', { name: 'Your app is live', exact: true })
    .waitFor({ timeout: 35000 });
}
try {
  const sample = await fresh();
  const { page, posts } = sample;
  // Reproduce a real fresh OAuth handoff: no local user hint when StrictMode boots.
  await page.evaluate(() => {
    localStorage.removeItem('gregale.session');
    sessionStorage.setItem('gregale.oauth-pending', 'true');
  });
  await page.goto(base);
  await page.getByRole('heading', { name: 'Get your first app live' }).waitFor();
  await shot(page, 'start-1440');
  await page.getByRole('button', { name: 'Explore the console' }).click();
  await page.waitForURL('**/dashboard');
  // Dismissal also writes the legacy marker so a flag rollback keeps the console reachable.
  assert.equal(await page.evaluate(() => localStorage.getItem('gregale.onboarded')), 'true');
  assert.equal(
    await page.evaluate(() =>
      Object.keys(localStorage).some(
        (key) =>
          key.startsWith('gregale.onboarding.v2.') &&
          JSON.parse(localStorage.getItem(key)).dismissed === true
      )
    ),
    true
  );
  const deploySample = page.getByRole('link', { name: 'Deploy a sample', exact: true });
  await deploySample.focus();
  await page.keyboard.press('Enter');
  await page.getByLabel('App name', { exact: true }).waitFor();
  await shot(page, 'sample-configure-1440');
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'sample-configure-390');
  await page.getByRole('button', { name: 'Deploy sample', exact: true }).click();
  await page.getByRole('heading', { name: 'Your first deployment' }).waitFor();
  await page.waitForFunction(() =>
    Object.keys(localStorage).some((key) => {
      if (!key.startsWith('gregale.onboarding.v2.')) return false;
      try {
        const record = JSON.parse(localStorage.getItem(key));
        return record.draft?.phase === 'accepted' && record.draft?.deployment;
      } catch {
        return false;
      }
    })
  );
  await page.reload();
  await live(page);
  assert.equal(posts.filter((p) => p.path === '/v1/apps').length, 1);
  assert.equal(posts.filter((p) => /^\/v1\/apps\/[^/]+\/deployments$/.test(p.path)).length, 1);
  assert.equal(
    posts.some((p) => /install|source-ref|invoke/.test(p.path)),
    false
  );
  const endpoint = await page
    .getByRole('link', { name: 'Open app', exact: true })
    .getAttribute('href');
  assert.match(endpoint, /^https:\/\//);
  await page.getByRole('button', { name: 'Copy: curl command' }).waitFor();
  await shot(page, 'sample-live-390');
  await sample.context.close();
  console.log(
    'PASS fresh OAuth, explore/resume, Free sample, reload during build, keyboard, 1440/390'
  );

  const git = await fresh();
  const sha = 'a'.repeat(40);
  await git.page.goto(`${base}/onboarding?step=source`);
  await git.page.getByRole('button', { name: 'Choose a repository' }).click();
  await git.page.getByRole('button', { name: 'Connect GitHub', exact: true }).waitFor();
  await git.page.goto(
    `${base}/onboarding?source=git&repo=acme-corp%2Fwebhook-router&ref=${sha}&step=setup`
  );
  await git.page.getByRole('button', { name: 'Connect GitHub', exact: true }).click();
  await git.page.getByLabel('Branch, tag or commit', { exact: true }).waitFor();
  await git.page.getByRole('radio', { name: 'acme-corp/webhook-router', exact: true }).waitFor();
  await git.page.getByText('One service detected (Procfile).', { exact: true }).waitFor();
  assert.equal(
    await git.page.getByLabel('Branch, tag or commit', { exact: true }).inputValue(),
    sha
  );
  const connect = git.posts.find((p) => p.path === '/dashboard/install/connect');
  assert.equal(
    new URLSearchParams(connect.body).get('return_to'),
    '/dashboard/settings?section=integrations'
  );
  await git.page.getByRole('button', { name: 'Continue', exact: true }).click();
  await git.page.getByLabel('App name', { exact: true }).waitFor();
  await git.page.goBack();
  assert.equal(
    await git.page.getByLabel('Branch, tag or commit', { exact: true }).inputValue(),
    sha
  );
  await git.page.goForward();
  await git.page
    .getByLabel('App name', { exact: true })
    .fill(`repo-${crypto.randomUUID().slice(0, 8)}`);
  await shot(git.page, 'repository-configure-1440');
  await git.page.getByRole('button', { name: 'Deploy app', exact: true }).click();
  await live(git.page);
  const source = git.posts.find((p) => p.path.endsWith('/deployments/source-ref'));
  assert.equal(JSON.parse(source.body).ref, sha);
  assert.equal(git.posts.filter((p) => p.path === '/v1/apps').length, 1);
  const mono = await fresh();
  await mono.page.goto(
    `${base}/onboarding?source=git&repo=acme-corp%2Fcheckout&ref=develop&step=setup`
  );
  await mono.page.getByRole('button', { name: 'Import as a project' }).click();
  await mono.page.getByRole('heading', { name: 'Import a project', exact: true }).waitFor();
  const imported = new URL(mono.page.url());
  assert.equal(imported.pathname, '/dashboard/apps/new');
  assert.equal(imported.searchParams.get('slug'), 'checkout');
  assert.equal(imported.searchParams.get('branch'), 'develop');
  assert.equal(mono.posts.filter((p) => p.path === '/v1/apps').length, 0);
  await mono.context.close();
  await git.context.close();
  console.log(
    'PASS GitHub installation return, immutable ref, Back/Forward, repository deployment, monorepo import handoff'
  );

  const unknown = await fresh();
  await unknown.page.route('**/v1/apps/*/deployments', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fetch(); // The server commits; the browser loses its receipt.
    await route.abort('failed');
  });
  await unknown.page.goto(`${base}/onboarding?source=function&step=configure`);
  await unknown.page.getByRole('button', { name: 'Deploy sample', exact: true }).click();
  await unknown.page.getByRole('heading', { name: 'Check your deployment outcome' }).waitFor();
  await unknown.page.reload();
  await unknown.page.getByRole('button', { name: 'Use this deployment' }).waitFor();
  assert.equal(
    unknown.posts.filter((p) => /^\/v1\/apps\/[^/]+\/deployments$/.test(p.path)).length,
    1
  );
  await unknown.page.getByRole('button', { name: 'Use this deployment' }).click();
  await live(unknown.page);
  await unknown.context.close();
  console.log(
    'PASS committed request with lost response, reload without replay, explicit history reconciliation'
  );

  const unavailable = await fresh();
  await unavailable.page.route('**/v1/apps', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({
          status: 503,
          contentType: 'application/problem+json',
          body: JSON.stringify({ status: 503, code: 'unavailable', title: 'Unavailable' }),
        })
      : route.continue()
  );
  await unavailable.page.goto(`${base}/onboarding?source=function&step=configure`);
  await unavailable.page.getByRole('button', { name: 'Retry app lookup', exact: true }).waitFor();
  assert.equal(
    await unavailable.page.getByRole('button', { name: 'Deploy sample', exact: true }).isDisabled(),
    true
  );
  assert.equal(
    unavailable.posts.some((p) => p.path === '/v1/apps'),
    false
  );
  await unavailable.context.close();
  console.log('PASS visible inventory failure blocks creation');

  if (process.env.FAILURE_URL) {
    const failed = await fresh(process.env.FAILURE_URL);
    await failed.page.goto(`${process.env.FAILURE_URL}/onboarding?source=function&step=configure`);
    await failed.page.getByRole('button', { name: 'Deploy sample', exact: true }).click();
    await failed.page
      .getByRole('button', { name: 'Retry original deployment' })
      .waitFor({ timeout: 35000 });
    assert.equal(await failed.page.getByRole('link', { name: 'Open app', exact: true }).count(), 0);
    await failed.page.getByRole('button', { name: 'Retry original deployment' }).click();
    await failed.page.getByRole('button', { name: 'Retry deployment', exact: true }).click();
    await failed.page
      .getByRole('button', { name: 'Retry original deployment' })
      .waitFor({ timeout: 35000 });
    assert.equal(failed.posts.filter((p) => p.path === '/v1/apps').length, 1);
    assert.equal(failed.posts.filter((p) => p.path.endsWith('/retry')).length, 1);
    await failed.context.close();
    console.log(
      'PASS failed build, logs/recovery and explicit retained-source retry in the same app'
    );
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
