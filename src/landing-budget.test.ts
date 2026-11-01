import { existsSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

/**
 * A size budget for what the landing page loads before anything else.
 *
 * On 2026-10-31 `/` loaded 3.0 MB: a 2.1 MB entry script carrying every
 * vendored docs page and most of the console, and a 1.9 MB PNG drawn at 300px.
 * None of it showed up in a test, because nothing measured it. These ceilings
 * sit about 10% above what the page loaded once that was fixed, so they catch
 * a regression of that kind, not ordinary growth.
 *
 * Raising one is allowed, and it is a decision: say in the PR what the page
 * gained. Lowering one after a saving is always welcome.
 *
 * Reads `dist/`, so it only runs after a build — CI builds before `check`.
 */

/** Entry scripts and stylesheets `dist/index.html` references, gzip -9.
 *  Measured 300,816 B on 2026-11-01. Lazy route chunks are not counted. */
const ENTRY_GZIP_BUDGET = 330 * 1024;

/** Any single image the landing markup references. The largest, the hero
 *  emblem's 1040w WebP fallback, measured 165,210 B on 2026-11-01. */
const IMAGE_BUDGET = 200 * 1024;

const built = existsSync('dist/index.html');
const describeBuilt = built ? describe : describe.skip;

describeBuilt('landing page budget', () => {
  const html = built ? readFileSync('dist/index.html', 'utf8') : '';

  const entry = [
    ...html.matchAll(/<script[^>]*\ssrc="(\/assets\/[^"]+\.js)"/g),
    ...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="(\/assets\/[^"]+\.css)"/g),
  ].map(([, path]) => path);

  // Same-origin images the page itself loads: src, every srcset candidate, and
  // the icons. Absolute URLs in Open Graph metadata are for unfurlers, not
  // for the page, and are left out.
  const images = new Set(
    [...html.matchAll(/\s(?:src|srcSet|srcset|href)="([^"]+)"/g)]
      .flatMap(([, value]) => value.split(',').map((candidate) => candidate.trim().split(/\s+/)[0]))
      .filter((path) => /^\/(?!\/)[^"]+\.(?:png|jpe?g|webp|avif|gif|svg|ico)$/.test(path))
  );

  it('finds the entry script and stylesheet, so the budget is not vacuous', () => {
    expect(entry.some((path) => path.endsWith('.js'))).toBe(true);
    expect(entry.some((path) => path.endsWith('.css'))).toBe(true);
    expect(images.size).toBeGreaterThan(0);
  });

  it(`keeps the entry scripts and styles under ${ENTRY_GZIP_BUDGET / 1024} KiB gzipped`, () => {
    const sizes = entry.map((path) => ({
      path,
      gzip: gzipSync(readFileSync(`dist${path}`), { level: 9 }).length,
    }));
    const total = sizes.reduce((sum, { gzip }) => sum + gzip, 0);
    expect(total, JSON.stringify(sizes)).toBeLessThanOrEqual(ENTRY_GZIP_BUDGET);
  });

  it(`keeps every landing image under ${IMAGE_BUDGET / 1024} KiB`, () => {
    const over = [...images]
      .map((path) => ({ path, bytes: statSync(`dist${path}`).size }))
      .filter(({ bytes }) => bytes > IMAGE_BUDGET);
    expect(over).toEqual([]);
  });
});
