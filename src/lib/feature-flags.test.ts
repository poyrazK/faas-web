import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { enabled, featureFlags } from './feature-flags';

const REGISTRY = resolve('src/lib/feature-flags.ts');

/**
 * `enabled` is the whole of the semantics, so it is what gets pinned — not
 * whichever flags happen to be live this week. Adding or retiring a real flag
 * should never disturb this suite.
 */
describe('enabled', () => {
  it.each(['1', 'true'])('enables for %j', (value) => {
    expect(enabled(value)).toBe(true);
  });

  // Whitespace is deliberately not trimmed: a Vercel value with a stray space
  // is a mistake, and the safe reading of a mistake is "off".
  it.each(['', ' ', '0', 'false', 'TRUE', 'True', ' 1', '1 ', 'yes', 'on', 'enabled'])(
    'fails closed for %j',
    (value) => {
      expect(enabled(value)).toBe(false);
    }
  );

  it('fails closed when the variable is absent', () => {
    // Vite omits an unset variable from the inlined object rather than setting
    // it empty, so `undefined` is the case that actually ships.
    expect(enabled(undefined)).toBe(false);
  });
});

describe('the registry', () => {
  it('exposes a boolean per flag', () => {
    const values = Object.values(featureFlags);
    expect(values.length).toBeGreaterThan(0);
    expect(values.every((v) => typeof v === 'boolean')).toBe(true);
  });

  /**
   * The two properties the build depends on, asserted against the source
   * because they are not observable from the resolved values:
   *
   *  - every variable is `VITE_FEATURE_*` — the `VITE_` half is what exposes it
   *    to the client at all, the `FEATURE_` half is what makes the access rule
   *    below greppable;
   *  - every access is a literal `import.meta.env.VITE_FEATURE_X`, because a
   *    lookup table or an `Object.freeze` wrapper stops Rollup folding the
   *    comparison, and the code behind a disabled flag then ships to the
   *    browser instead of being eliminated.
   */
  // Comments in this file discuss `Object.freeze` and `import.meta.env` by
  // name, so the assertions below read code only — otherwise the prose
  // explaining the rule would trip the rule.
  const source = readFileSync(REGISTRY, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

  it('reads only VITE_FEATURE_* variables', () => {
    const names = [...source.matchAll(/import\.meta\.env\.(\w+)/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((n) => !n.startsWith('VITE_FEATURE_'))).toEqual([]);
  });

  it('accesses each flag literally, so the dead branch folds away', () => {
    expect(source).not.toMatch(/Object\.freeze/);
    // Any computed access — env[name], destructuring, a spread — breaks folding.
    expect(source).not.toMatch(/import\.meta\.env\s*\[/);
    expect(source).not.toMatch(/\.\.\.import\.meta\.env/);
  });
});

/**
 * The access rule, enforced. `conventions.test.ts` is deliberately scoped to
 * `src/components/dashboard` and `src/routes`; a flag can be read anywhere, so
 * this assertion carries its own walk rather than widening that one.
 */
describe('feature flag access', () => {
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return walk(full);
      return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [full] : [];
    });
  }

  const files = walk(resolve('src')).filter((f) => f !== REGISTRY);

  it('scans a real tree', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it('reads VITE_FEATURE_* only through the registry', () => {
    const offenders = files
      .filter((f) => /import\.meta\.env\b[^\n]*VITE_FEATURE_/.test(readFileSync(f, 'utf8')))
      .map((f) => f.replace(`${resolve('.')}/`, ''));
    expect(offenders).toEqual([]);
  });
});
