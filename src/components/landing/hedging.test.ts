import { readdirSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const RETIRED = /join the beta|public beta|pricing coming soon|after the beta/i;
const HEDGE = /in preview|non-critical|illustrative|limits apply|guide coming soon/i;
const ALLOWED = new Set(['platform-claims.ts']);

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

  it('does not carry the former platform beta or pricing hold copy', () => {
    const offenders = files.filter((f) => RETIRED.test(stripComments(readFileSync(f, 'utf8'))));
    expect(offenders.map((f) => basename(f))).toEqual([]);
  });

  it('keeps the platform availability statement in its shared claim', () => {
    const offenders = files
      .filter((f) => !ALLOWED.has(basename(f)))
      .filter((f) => HEDGE.test(stripComments(readFileSync(f, 'utf8'))))
      .map((f) => basename(f));
    expect(offenders).toEqual([]);
  });

  it('shows the launch and preview wording together in the hero', () => {
    const hero = stripComments(readFileSync(resolve(landing, 'hero.tsx'), 'utf8'));
    const claims = stripComments(readFileSync(resolve('src/lib/platform-claims.ts'), 'utf8'));
    expect(hero).toContain('{PLATFORM_AVAILABILITY}');
    expect(claims).toMatch(/hosting and PR previews are generally available/i);
    expect(claims).toMatch(/MCP hosting and isolated runs are in preview/i);
  });
});
