import { describe, expect, it } from 'vitest';
import { ANALYTICS_GROUPS } from '@/components/dashboard/analytics-search';
import { Route } from './dashboard.analytics';

const validate = Route.options.validateSearch as (search: Record<string, unknown>) => unknown;

describe('Analytics search', () => {
  it.each(ANALYTICS_GROUPS.map((group) => group.value))(
    'keeps the %s grouping the selector offers',
    (group) => {
      expect(validate({ group })).toMatchObject({ group });
    }
  );

  it('drops a grouping the API does not offer', () => {
    expect(validate({ group: 'planet' })).not.toHaveProperty('group');
  });
});
