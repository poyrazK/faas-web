import { expect, it } from 'vitest';
import type { components } from './api/schema';
import { cachePurgeSelection, validateCacheAction } from './cache-policy';

type CacheAction = components['schemas']['EdgeRuleCacheAction'];
const action: CacheAction = {
  max_age_seconds: 60,
  stale_while_revalidate_seconds: 0,
  stale_if_error_seconds: 300,
  methods: ['GET', 'HEAD'],
  vary_on: [],
};

it('accepts the server-compatible cache defaults and explicit zero windows', () => {
  expect(validateCacheAction(action)).toEqual({});
  expect(validateCacheAction({ ...action, max_age_seconds: 0, stale_if_error_seconds: 0 })).toEqual(
    {}
  );
  expect(
    validateCacheAction({ max_age_seconds: 60, stale_if_error_seconds: 300 } as CacheAction)
  ).toEqual({});
});

it('rejects out-of-bound or fractional freshness and stale windows', () => {
  expect(
    validateCacheAction({
      ...action,
      max_age_seconds: 3601,
      stale_while_revalidate_seconds: 301,
      stale_if_error_seconds: -1,
    })
  ).toEqual({
    max_age_seconds: expect.any(String),
    stale_while_revalidate_seconds: expect.any(String),
    stale_if_error_seconds: expect.any(String),
  });
  expect(validateCacheAction({ ...action, max_age_seconds: 2.5 })).toHaveProperty(
    'max_age_seconds'
  );
});

it('rejects methods and vary headers outside the closed backend vocabulary', () => {
  expect(
    validateCacheAction({ ...action, methods: ['POST'] as unknown as CacheAction['methods'] })
  ).toHaveProperty('methods');
  expect(
    validateCacheAction({
      ...action,
      vary_on: ['Authorization'] as unknown as CacheAction['vary_on'],
    })
  ).toHaveProperty('vary_on');
});

it('builds exclusive all, path and normalized tag purge requests', () => {
  expect(cachePurgeSelection('all', 'ignored prior input')).toEqual({});
  expect(cachePurgeSelection('path', ' /products/* ')).toEqual({ path: '/products/*' });
  expect(cachePurgeSelection('tag', ' Product:42 ')).toEqual({ tag: 'product:42' });
});

it('rejects invalid or empty targeted purges before a write', () => {
  expect(() => cachePurgeSelection('path', '')).toThrow(/path/i);
  expect(() => cachePurgeSelection('path', '/x'.repeat(513))).toThrow(/long/i);
  expect(() => cachePurgeSelection('tag', 'bad,tag')).toThrow(/tag/i);
  expect(() => cachePurgeSelection('tag', 'a'.repeat(129))).toThrow(/128/);
});
