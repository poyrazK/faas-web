import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The theming rules CLAUDE.md states in prose, enforced: console components
 * are written in tokens, so a literal hex colour or a `dark:` variant in the
 * dashboard tree is a bug waiting for the polarity it was not tested in.
 *
 * Scope is deliberate: `components/ui/` is exempt from the `dark:` rule —
 * shadcn-vendored primitives carry `dark:` styles that are now correctly
 * bound to `.console` — and inline `style={{}}` with `var(--token)` remains
 * the sanctioned escape hatch for dynamic values.
 */

const SCOPES = ['src/components/dashboard', 'src/components/canvas', 'src/routes'];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [full] : [];
  });
}

const files = SCOPES.flatMap((scope) => walk(resolve(scope)));

describe('console theming conventions', () => {
  it('scans a real tree', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it('uses no dark: variants in dashboard components or routes', () => {
    const offenders = files.filter((f) => /["'`\s]dark:/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('uses no literal hex colours in class attributes', () => {
    const offenders = files.filter((f) =>
      /className=[^\n]*#[0-9a-fA-F]{3,8}\b/.test(readFileSync(f, 'utf8'))
    );
    expect(offenders).toEqual([]);
  });

  // A field's label text and its control stack in a column with a gap. A
  // `block` or bare `text-sm` label lets an inline-block control sit flush
  // against its text ("Visibility[select]") or directly under it.
  it('lays labelled fields out as a spaced column', () => {
    const offenders = [...files, resolve('src/components/ui/confirm.tsx')].filter((f) =>
      /<label className="(?:block(?: space-y-[0-9.]+)?|text-sm)"/.test(readFileSync(f, 'utf8'))
    );
    expect(offenders).toEqual([]);
  });
});
