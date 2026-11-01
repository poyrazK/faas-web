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

const SCOPES = ['src/components/dashboard', 'src/routes'];

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

/**
 * TanStack's auto code splitting moves a route's `component` into a lazy
 * chunk, but anything else a route file exports stays in the entry chunk with
 * the route tree, along with everything it imports — and the plugin does not
 * warn about it. Fifteen route files once exported their page bodies
 * for the app detail tabs, which put the console on the landing page. A body
 * shared between pages lives in `components/`; the route file declares
 * `Route` and nothing else.
 */
describe('route files', () => {
  // A plain number the test waits on; it costs the entry chunk nothing.
  const ALLOWED: Record<string, string[]> = { 'will-it-run.tsx': ['MIN_TRANSITION_MS'] };

  const routeFiles = readdirSync(resolve('src/routes')).filter(
    (name) => name.endsWith('.tsx') && !name.startsWith('-') && !/\.test\./.test(name)
  );

  it('scans a real tree', () => {
    expect(routeFiles.length).toBeGreaterThan(30);
  });

  it('export only Route, so the code splitter can keep pages out of the entry chunk', () => {
    const offenders = routeFiles.flatMap((name) => {
      const source = readFileSync(resolve('src/routes', name), 'utf8');
      const exported = [
        ...source.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/gm),
      ].map(([, ident]) => ident);
      const reexports = source.match(/^export\s*\{|^export\s+\*|^export\s+default/m)
        ? ['(re-export)']
        : [];
      return [...exported, ...reexports]
        .filter((ident) => ident !== 'Route' && !(ALLOWED[name] ?? []).includes(ident))
        .map((ident) => `${name}: ${ident}`);
    });
    expect(offenders).toEqual([]);
  });
});
