// Focused browser acceptance against dev:mock or a built preview:mock.
// PLAYWRIGHT_MODULE can point to an external playwright(-core)/index.mjs.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const base = process.env.BASE_URL ?? 'http://localhost:3000';
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}) });
const failures = [];
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

async function signedInPage(width = 1440) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => {
    localStorage.setItem('gregale.session', JSON.stringify({ email: 'design@gregale.dev' }));
    localStorage.setItem('gregale.onboarded', 'true');
    localStorage.setItem('gregale.dev-bypass', 'true');
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => failures.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && /Content Security Policy/.test(message.text())) failures.push(message.text());
  });
  return page;
}
async function capture(page, name) {
  await page.evaluate(() => window.scrollTo(0, 0));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `${name}: horizontal overflow`);
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
}
let activePage;
try {
  const page = await signedInPage();
  activePage = page;
  await page.goto(`${base}/dashboard/support`);
  await page.getByRole('link', { name: /^Help with a deployment that keeps restarting/ }).waitFor();
  await capture(page, 'support-desktop');
  await page.getByRole('button', { name: 'Start a conversation', exact: true }).click();
  await page.getByLabel('Subject', { exact: true }).fill(`Browser support check ${Date.now()}`);
  await page.getByLabel('Message', { exact: true }).fill('A browser acceptance conversation.');
  await capture(page, 'support-create');
  let dropped = false;
  const createRequests = [];
  await page.route('**/v1/support/tickets', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    createRequests.push({ key: route.request().headers()['idempotency-key'], body: route.request().postData() });
    if (!dropped) {
      dropped = true;
      await route.fetch(); // The backend commits, but its response is lost.
      return route.abort('failed');
    }
    return route.continue();
  });
  await page.getByRole('button', { name: 'Send to support' }).click();
  await page.getByRole('button', { name: 'Retry submission' }).click();
  await page.waitForURL(/\/dashboard\/support\/[^/]+$/);
  assert.equal(createRequests.length, 2);
  assert.deepEqual(createRequests[1], createRequests[0]);
  const personalUrl = page.url();
  const personalId = personalUrl.split('/').at(-1);
  await page.getByLabel('Message', { exact: true }).fill('The next step is still unclear.');
  await page.getByRole('button', { name: 'Send reply', exact: true }).click();
  await page.locator('ol').getByText('The next step is still unclear.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Mark resolved', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Mark resolved', exact: true }).click();
  await page.getByRole('radio', { name: '5', exact: true }).check();
  await page.getByRole('button', { name: 'Send rating', exact: true }).click();
  await page.getByText(/Thanks for your feedback/).waitFor();
  await page.getByLabel('What still needs help?', { exact: true }).fill('The issue has returned.');
  await page.getByRole('button', { name: 'Reopen conversation', exact: true }).click();
  await page.locator('ol').getByText('The issue has returned.', { exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Your reply', exact: true }).waitFor();
  await capture(page, 'support-conversation-desktop');

  await page.goto(`${base}/dashboard/orgs/acme-corp/support`);
  await page.getByRole('heading', { name: 'Your conversations' }).waitFor();
  await page.getByRole('link', { name: /^Help with a deployment that keeps restarting/ }).click();
  await page.waitForURL(/\/dashboard\/orgs\/acme-corp\/support\/[^/]+$/);
  await page.getByRole('heading', { name: 'Conversation', exact: true }).waitFor();
  assert.ok(!page.url().endsWith(personalId));
  await page.reload(); // Backend email URL remains a direct entry point.
  await page.getByRole('heading', { name: 'Conversation', exact: true }).waitFor();
  await capture(page, 'support-organization');
  // An explicit personal email link stays personal even with a company selected.
  const account = await (await page.request.get(`${base}/v1/account`)).json();
  await page.evaluate((id) => localStorage.setItem(`gregale.active-org.${id}`, 'acme-corp'), account.id);
  await page.goto(personalUrl);
  await page.getByText('A browser acceptance conversation.', { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, 'support-conversation-mobile');
  await page.getByRole('link', { name: 'All conversations', exact: true }).click();
  await page.getByRole('heading', { name: 'Your conversations' }).waitFor();
  await capture(page, 'support-mobile');

  const hidden = await signedInPage();
  let hiddenReads = 0;
  hidden.on('request', (request) => { if (/\/v1\/(?:orgs\/[^/]+\/)?support\//.test(request.url())) hiddenReads++; });
  await hidden.route('**/v1/capabilities', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.hidden_capabilities = [...(body.hidden_capabilities ?? []), 'customer-support'];
    await route.fulfill({ response, json: body });
  });
  await hidden.goto(`${base}/dashboard/support`);
  await hidden.getByText('Not enabled for this account', { exact: true }).waitFor();
  assert.equal(hiddenReads, 0, 'Hidden preview made a Support API request');

  const denied = await signedInPage();
  await denied.route('**/v1/orgs/acme-corp/support/tickets', (route) => route.fulfill({ status: 403, contentType: 'application/problem+json', body: JSON.stringify({ status: 403, code: 'support_forbidden', title: 'Support access denied' }) }));
  await denied.goto(`${base}/dashboard/orgs/acme-corp/support`);
  await denied.getByText(/Organization conversations are available to owners and admins/).waitFor();
  assert.equal(await denied.getByRole('button', { name: 'Start a conversation', exact: true }).isDisabled(), true);
  const empty = await signedInPage();
  await empty.route('**/v1/support/tickets', (route) => route.fulfill({ json: { items: [] } }));
  await empty.goto(`${base}/dashboard/support`);
  await empty.getByText('Need a hand? Start a conversation with our team.', { exact: true }).waitFor();
  assert.deepEqual(failures, []);
  console.log('PASS: Support creation with lost-response replay, reply, resolve, rating, reopening, scoped deep links, preview gate, denied/empty states, desktop/mobile layout, and browser/CSP errors.');
} catch (error) {
  if (activePage) {
    console.error(await activePage.locator('#main').innerText());
    if (shots) await activePage.screenshot({ path: `${shots}/support-failure.png`, fullPage: true });
  }
  throw error;
} finally {
  await browser.close();
}
