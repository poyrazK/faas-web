import { describe, expect, it } from 'vitest';
import { breakCounts, isBlocking } from './diff-gate';
import type { components } from '@/lib/api/schema';

type Resp = components['schemas']['DiffResponse'];
const resp = (severities: ('error' | 'warn')[], blocking: boolean): Resp => ({
  slug: 'hello',
  blocking,
  diff: {
    slug: 'hello',
    changes: [],
    breaks: severities.map((severity, i) => ({ code: `c${i}`, severity, reason: 'r' })),
  },
});

/**
 * Lenient = the server's `blocking` bit (errors only). Strict = the CLI's
 * `--strict`: a warning is enough to stop the save.
 */
describe('isBlocking', () => {
  it('follows the server bit when lenient', () => {
    expect(isBlocking(resp(['warn'], false), false)).toBe(false);
    expect(isBlocking(resp(['error'], true), false)).toBe(true);
  });
  it('treats warnings as blocking when strict', () => {
    expect(isBlocking(resp(['warn'], false), true)).toBe(true);
    expect(isBlocking(resp([], false), true)).toBe(false);
  });
});

describe('breakCounts', () => {
  it('counts by severity', () => {
    expect(breakCounts(resp(['warn', 'warn', 'error'], true))).toEqual({ error: 1, warn: 2 });
  });
});
