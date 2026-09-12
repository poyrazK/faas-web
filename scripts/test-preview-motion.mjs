// Run against the dev server: BASE_URL=http://localhost:3022 node scripts/test-preview-motion.mjs
// Like tour.mjs, uses an optional Playwright install. A preinstalled module and
// browser can be supplied through PLAYWRIGHT_MODULE and BROWSER_PATH.
import assert from 'node:assert/strict';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || undefined });
const base = process.env.BASE_URL || 'http://localhost:3000';
const running = (figure) =>
  figure.evaluate(
    (el) => el.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').length
  );

try {
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion });
    await page.goto(base, { waitUntil: 'networkidle' });
    const section = page.locator('#deploy');
    await section.scrollIntoViewIfNeeded();
    assert.equal(
      await running(section.getByRole('figure').first()),
      0,
      'No preview animation on page load'
    );
    for (const index of [0, 1, 3]) {
      // Isolate each case from the preceding keyboard-driven page scroll.
      await page.goto(base, { waitUntil: 'networkidle' });
      await section.scrollIntoViewIfNeeded();
      const card = section.getByRole('button').nth(index);
      await card.hover({ position: { x: 40, y: 70 } });
      const figure = card.getByRole('figure');
      await page.waitForTimeout(150);
      assert.equal(
        (await running(figure)) > 0,
        reducedMotion === 'no-preference',
        `Card ${index}: hover respects motion preference`
      );
      await page.waitForTimeout(1700);
      assert.equal(await running(figure), 0, 'Sequence settles instead of looping');
      const before = await figure.boundingBox();
      await page.mouse.move(0, 0);
      await page.waitForTimeout(100);
      await card.hover({ position: { x: 40, y: 70 } });
      await page.waitForTimeout(150);
      assert.equal(
        (await running(figure)) > 0,
        reducedMotion === 'no-preference',
        'Re-entering replays the sequence'
      );
      const after = await figure.boundingBox();
      assert.equal(before.width, after.width, 'No width change');
      assert.equal(before.height, after.height, 'No height change');
      await page.mouse.move(0, 0);
      await page.waitForTimeout(100);
      assert.equal(await running(figure), 0, 'Leaving cancels the sequence');
      await page.keyboard.press('Tab');
      await card.focus();
      await page.waitForTimeout(150);
      assert.equal(
        (await running(figure)) > 0,
        reducedMotion === 'no-preference',
        'Keyboard focus also plays the sequence'
      );
      await card.evaluate((el) => el.blur());
      console.log(`${reducedMotion}: card ${index} passed`);
    }
    await page.close();
  }
  const touch = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await touch.goto(base, { waitUntil: 'networkidle' });
  const card = touch.locator('#deploy').getByRole('button').first();
  await card.tap();
  assert.equal(
    await running(card.getByRole('figure')),
    0,
    'Touch does not leave a sticky hover animation'
  );
  assert.equal(
    await touch.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
    'No mobile overflow'
  );
  console.log('Touch passed');
} finally {
  await browser.close();
}
