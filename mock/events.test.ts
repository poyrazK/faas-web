import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

/**
 * `src/lib/mock-spec-drift.test.ts` scans `mock/plugin.ts` only. The Events
 * and Integrations mocks register from this module, so the same guarantee —
 * every mocked path exists in `api/openapi.yaml` — is pinned here.
 */
const SPEC = readFileSync(resolve('api/openapi.yaml'), 'utf8');
const MOCK = readFileSync(resolve('mock/events.ts'), 'utf8');

it('answers only paths the OpenAPI spec defines', () => {
  const specPaths = new Set([...SPEC.matchAll(/^ {2}(\/\S+):\s*$/gm)].map((m) => m[1]));
  const mocked = [
    ...MOCK.matchAll(/\broute\(\s*'(?:GET|POST|PUT|PATCH|DELETE)',\s*'([^']+)'/g),
  ].map((m) => m[1]);
  expect(mocked.length).toBeGreaterThan(20);
  expect(mocked.filter((path) => !specPaths.has(path))).toEqual([]);
});
