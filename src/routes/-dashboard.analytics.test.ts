import { describe, expect, it } from 'vitest';
import { Route } from './dashboard.analytics';

const validate = Route.options.validateSearch as (search: Record<string, unknown>) => unknown;

describe('Analytics search', () => {
  it('keeps the window and drops the per-app filters that moved to Metrics', () => {
    expect(validate({ window: '7d', group: 'route', route: '/orders' })).toEqual({ window: '7d' });
  });

  it('keeps an old app link so it can be redirected', () => {
    expect(validate({ app: 'alpha', wake: 'w1' })).toEqual({ app: 'alpha', wake: 'w1' });
  });
});
