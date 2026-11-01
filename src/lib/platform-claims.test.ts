import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOC_ENTRIES } from './docs-manifest';
import { INSTALL_COMMAND, RESTORE_CONTEXT, RESTORE_TARGET } from './platform-claims';

/**
 * The public copy that must not drift, enforced.
 *
 * Two claims have already drifted once each: the install command (the site
 * advertised the stable npm tag while every release was a prerelease, so
 * visitors got an older CLI than the beta channel — faas-web#120) and the
 * wake figure (restated without its measurement boundary in places the
 * landing page did not cover — faas-web#95). Both now have one home in
 * `platform-claims.ts`; this test fails the moment a second copy appears.
 */

const SCAN_ROOTS = ['src', 'index.html'];
const GENERATED = /routeTree\.gen\.ts$|schema\.d\.ts$/;

function walk(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path).flatMap((name) => walk(join(path, name)));
}

/** Every hand-written source file that can carry public copy. */
const sources = SCAN_ROOTS.flatMap((root) => walk(resolve(root)))
  .filter((f) => /\.(tsx?|html|md|txt)$/.test(f))
  .filter((f) => !/\.test\.tsx?$/.test(f) && !GENERATED.test(f))
  .concat(
    // Locally authored docs are ours to keep consistent; vendored ones are
    // fixed upstream and re-pulled.
    DOC_ENTRIES.filter((e) => e.local).map((e) => resolve('content/docs', `${e.slug}.md`))
  );

const claimsFile = resolve('src/lib/platform-claims.ts');

describe('install command', () => {
  it('advertises the beta npm channel while every release is a prerelease', () => {
    expect(INSTALL_COMMAND).toBe('npm install -g gregale@rc');
  });

  it('is never restated without the tag anywhere on the site', () => {
    // A pinned version (`gregale@0.1.18`) is a documented choice; the bare
    // package name is the drift this guards against.
    const offenders = sources.filter((f) =>
      /npm (install|i) -g gregale(?![@\w])/.test(readFileSync(f, 'utf8'))
    );
    expect(offenders).toEqual([]);
  });
});

describe('wake figure', () => {
  it('scans a real tree', () => {
    expect(sources.length).toBeGreaterThan(100);
  });

  it('appears only inside the sanctioned claim', () => {
    const offenders = sources
      .filter((f) => f !== claimsFile)
      .filter((f) => /\b350\s*ms\b/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('keeps the statistic and its boundary together', () => {
    expect(RESTORE_TARGET).toMatch(/platform-only/);
    expect(RESTORE_TARGET).toMatch(/p95/);
    expect(RESTORE_CONTEXT).toMatch(/cold boot/i);
  });
});

describe('llms.txt', () => {
  it('is generated at build rather than committed', () => {
    // A committed copy is a second home for every claim above.
    expect(existsSync(resolve('public/llms.txt'))).toBe(false);
  });
});
