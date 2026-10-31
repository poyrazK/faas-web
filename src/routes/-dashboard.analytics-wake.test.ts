import { expect, it } from 'vitest';
import { Route } from './dashboard.analytics';

const validate = Route.options.validateSearch as (
  search: Record<string, unknown>
) => Record<string, unknown>;

it('keeps a wake in the Analytics URL and drops an empty one', () => {
  expect(validate({ app: 'api', wake: 'wk-1' })).toMatchObject({ app: 'api', wake: 'wk-1' });
  expect(validate({ app: 'api', wake: '   ' })).not.toHaveProperty('wake');
  expect(validate({ wake: 42 })).not.toHaveProperty('wake');
});
