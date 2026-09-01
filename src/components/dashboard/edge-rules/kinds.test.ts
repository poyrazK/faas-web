import { describe, expect, it } from 'vitest';
import { KINDS, KIND_ORDER, summarise } from './kinds';

describe('cache kind', () => {
  it('is the fourteenth kind, with the API defaults as its empty action', () => {
    expect(KIND_ORDER).toContain('cache');
    expect(KINDS.cache.empty()).toEqual({ max_age_seconds: 60, stale_if_error_seconds: 300 });
  });

  it('summarises the freshness window and rejects out-of-cap values', () => {
    expect(summarise('cache', { max_age_seconds: 120, stale_if_error_seconds: 300 })).toBe(
      'fresh 120 s · stale-on-error 300 s'
    );
    expect(KINDS.cache.validate({ max_age_seconds: 7200, stale_if_error_seconds: 300 })).toEqual({
      max_age_seconds: 'At most 3600 s.',
    });
    expect(KINDS.cache.validate({ max_age_seconds: 60, stale_if_error_seconds: 0 })).toEqual({
      stale_if_error_seconds: 'Between 1 and 300 s.',
    });
  });
});
