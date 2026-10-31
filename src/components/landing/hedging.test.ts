import { readdirSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The homepage says "beta" once, next to the primary call to action.
 *
 * Before this guard, some form of "public beta / in preview / non-critical
 * workload / illustrative / limits apply" appeared in six places on the
 * landing page. Each one was honest, and together they read as a lack of
 * confidence. The maturity statement now lives in one sentence under the
 * hero's sign-up button; the feature explorer keeps a compact label only on
 * features that are *not* in beta, which is the one case where the reader
 * needs to know.
 */

const HEDGE = /public beta|in preview|non-critical|illustrative|limits apply|guide coming soon/i;

/** The one sentence is allowed here; `platform-claims.ts` is its future home. */
const ALLOWED = new Set(['hero.tsx', 'platform-claims.ts']);

const landing = resolve('src/components/landing');
const files = readdirSync(landing)
  .filter((name) => /\.tsx?$/.test(name) && !/\.test\./.test(name))
  .map((name) => resolve(landing, name))
  .concat([
    resolve('src/routes/index.tsx'),
    resolve('src/lib/seo.ts'),
    resolve('src/lib/platform-claims.ts'),
    resolve('index.html'),
  ]);

/** Code comments explain intent and may use any word; only copy counts. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('landing page hedging', () => {
  it('scans the landing sources', () => {
    expect(files.length).toBeGreaterThan(15);
  });

  it('states the beta once, under the primary call to action', () => {
    const offenders = files
      .filter((f) => !ALLOWED.has(basename(f)))
      .filter((f) => HEDGE.test(stripComments(readFileSync(f, 'utf8'))))
      .map((f) => basename(f));
    expect(offenders).toEqual([]);
  });

  it('keeps that one statement in the hero', () => {
    const hero = stripComments(readFileSync(resolve(landing, 'hero.tsx'), 'utf8'));
    const claims = stripComments(readFileSync(resolve('src/lib/platform-claims.ts'), 'utf8'));
    const text = `${hero}\n${claims}`.replace(/\s+/g, ' ');
    expect(text.match(/public beta/gi)).toHaveLength(1);
    expect(text).not.toMatch(/non-critical|illustrative|guide coming soon/i);
  });
});
