// Run against npm run dev:mock; Playwright is installed separately, as for tour.mjs.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const out = process.env.SHOTS;
if (out) mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultNavigationTimeout(90000);
  page.setDefaultTimeout(30000);
  const base = process.env.BASE_URL ?? 'http://localhost:3000';
  const result = [];
  page.on('pageerror', (e) => result.push({ error: String(e) }));
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.setItem('gregale.session', JSON.stringify({ email: 'design@gregale.dev' }));
    localStorage.setItem('gregale.onboarded', 'true');
    localStorage.setItem('gregale.dev-bypass', 'true');
  });
  await page.goto(base + '/dashboard/kit', { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: 'Overview', exact: true }).waitFor();
  await page.waitForTimeout(500);
  const tabs = page.getByRole('tablist', { name: 'Example tabs' });
  assert.equal(await tabs.getAttribute('data-indicator-ready'), 'true');
  const movement = await tabs.evaluate(async (el) => {
    const samples = [];
    const target = el.querySelectorAll('button')[1];
    target.click();
    for (const ms of [0, 30, 60, 180]) {
      await new Promise((r) => setTimeout(r, ms));
      const line = el.querySelector('.console-selection-indicator');
      samples.push({
        ms,
        transform: getComputedStyle(line).transform,
        inline: line.style.transform,
        transition: getComputedStyle(line).transition,
        animations: line.getAnimations().length,
      });
    }
    return samples;
  });
  result.push({ movement });
  assert.ok(
    movement.some((sample) => sample.animations > 0),
    'selection should travel'
  );
  assert.equal(
    await page.getByRole('tab', { name: 'Settings', exact: true }).getAttribute('aria-selected'),
    'true'
  );
  const travel = await tabs
    .locator('.console-selection-indicator')
    .evaluate((el) => ({ style: el.style.transform, animation: el.getAnimations().length }));
  result.push({ travel });
  await page.getByRole('tab', { name: 'Activity', exact: true }).click();
  await page.getByRole('tab', { name: 'Overview', exact: true }).click();
  await page.keyboard.press('End');
  assert.equal(
    await page
      .getByRole('tab', { name: 'Activity', exact: true })
      .evaluate((el) => el === document.activeElement),
    true
  );
  const button = page.getByRole('button', { name: 'Primary', exact: true });
  await button.hover();
  await page.mouse.down();
  await page.waitForTimeout(180);
  const pressed = await button.evaluate((el) => getComputedStyle(el).transform);
  assert.notEqual(pressed, 'none');
  await page.mouse.up();
  result.push({ pressed });
  const save = page.getByRole('button', { name: /^Save changes/ });
  const before = await save.boundingBox();
  await save.click();
  await page.waitForTimeout(250);
  const after = await save.boundingBox();
  assert.equal(before.width, after.width);
  assert.equal(
    await save.locator('.console-save-confirm').evaluate((el) => getComputedStyle(el).opacity),
    '1'
  );
  await page.waitForTimeout(2000);
  assert.equal(
    await save.locator('.console-save-label').evaluate((el) => getComputedStyle(el).opacity),
    '1'
  );
  result.push({ saveWidth: before.width });
  await page.getByText('Optional settings', { exact: true }).click();
  assert.equal(await page.getByText('Disclosure feedback sample.').isVisible(), true);
  await page.getByText('Optional settings', { exact: true }).click();
  assert.equal(await page.getByText('Disclosure feedback sample.').isVisible(), false);
  if (out) await page.screenshot({ path: out + '/kit-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await page.waitForTimeout(300);
  const alignment = await tabs.evaluate((el) => {
    const chosen = el.querySelector('[aria-selected=true]').getBoundingClientRect();
    const line = el.querySelector('.console-selection-indicator').getBoundingClientRect();
    return {
      dx: Math.abs(chosen.left - line.left),
      dw: Math.abs(chosen.width - line.width),
      dy: Math.abs(chosen.bottom - line.bottom),
    };
  });
  assert.ok(alignment.dx < 1 && alignment.dw < 1 && alignment.dy < 2, JSON.stringify(alignment));
  result.push({ mobileAlignment: alignment });
  if (out) await page.screenshot({ path: out + '/kit-mobile.png', fullPage: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('tab', { name: 'Overview', exact: true }).click();
  assert.equal(
    await tabs
      .locator('.console-selection-indicator')
      .evaluate((el) => getComputedStyle(el).transitionDuration),
    '0s'
  );
  await button.hover();
  await page.mouse.down();
  await page.waitForTimeout(120);
  assert.equal(await button.evaluate((el) => getComputedStyle(el).transform), 'none');
  await page.mouse.up();
  await page.goto(base + '/dashboard', { waitUntil: 'domcontentloaded' });
  await page.getByRole('combobox', { name: 'Search apps, pages, and actions' }).click();
  await page.waitForTimeout(500);
  let beams = await page.evaluate(
    () =>
      document
        .getAnimations()
        .filter((a) => a.animationName?.startsWith('beam-') && a.playState === 'running').length
  );
  assert.equal(beams, 0);
  result.push({ reducedMotionRunningBeams: beams });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForTimeout(600);
  beams = await page.evaluate(
    () =>
      document
        .getAnimations()
        .filter((a) => a.animationName?.startsWith('beam-') && a.playState === 'running').length
  );
  assert.ok(beams > 0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(200);
  beams = await page.evaluate(
    () =>
      document
        .getAnimations()
        .filter((a) => a.animationName?.startsWith('beam-') && a.playState === 'running').length
  );
  assert.equal(beams, 0);
  result.push({ livePreferenceChange: true });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  assert.equal(
    await page.locator('html').evaluate((el) => el.classList.contains('console')),
    false
  );
  result.push({ publicScopeRemoved: true });
  assert.equal(result.filter((r) => r.error).length, 0, JSON.stringify(result));
  if (out) writeFileSync(out + '/browser-results.json', JSON.stringify(result, null, 2));
  console.log(
    'Console microinteractions: passed desktop, mobile, keyboard, reduced motion and public-page scope checks.'
  );
} finally {
  await browser.close();
}
