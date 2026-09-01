import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

/**
 * The dev mock (`mock/plugin.ts`) is a second implementation of the API
 * surface, and nothing else keeps it aligned with `api/openapi.yaml`. This
 * pins the cheap half of that alignment: every path the mock answers must
 * exist in the spec, so a renamed or removed endpoint fails here instead of
 * shipping a fixture for a URL the real API no longer serves.
 *
 * The reverse direction is deliberately not asserted — the mock answers a
 * subset, and an unmocked path already announces itself as `404 not_mocked`
 * on the dev server.
 */

// Vitest runs from the repo root; jsdom rewrites `import.meta.url` to an
// http URL, so plain cwd-relative paths are the reliable route to the files.
const SPEC = readFileSync(resolve('api/openapi.yaml'), 'utf8');
const MOCK = readFileSync(resolve('mock/plugin.ts'), 'utf8');

/**
 * Routes apid serves same-origin but outside the spec's `paths`: the
 * cookie-session flows, and the account event tail (SSE; upstream ticket T4
 * in the validated gap matrix — remove it here once the spec documents it).
 */
const OUTSIDE_SPEC = new Set(['/login', '/signup', '/login/forgot', '/v1/events']);

it('every mocked route exists in the OpenAPI spec', () => {
  const specPaths = new Set([...SPEC.matchAll(/^ {2}(\/[^\s:]+):/gm)].map((m) => m[1]));
  // Sanity: both parses actually found things, or the assertion below would
  // pass vacuously after a format change.
  expect(specPaths.size).toBeGreaterThan(100);

  const mocked = [...MOCK.matchAll(/^route\('(?:GET|POST|PUT|PATCH|DELETE)', '([^']+)'/gm)].map(
    (m) => m[1]
  );
  expect(mocked.length).toBeGreaterThan(50);

  const missing = mocked.filter((path) => !OUTSIDE_SPEC.has(path) && !specPaths.has(path));
  expect(missing).toEqual([]);
});

it('every route registration is top-level', () => {
  // Routes register as module-level side effects; a `route(` call that ends
  // up inside another handler's body (a botched splice) is dead code the dev
  // server never registers, and the assertion above skips it too — its
  // regex is anchored to column 0. An indented call is therefore always a
  // mistake.
  const buried = [...MOCK.matchAll(/^[ \t]+route\('/gm)];
  expect(buried).toEqual([]);
});
