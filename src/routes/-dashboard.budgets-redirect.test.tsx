import { isRedirect } from '@tanstack/react-router';
import { expect, it } from 'vitest';
import { Route } from './dashboard.budgets';

it('sends the old Budgets URL to the budgets on Spending limits', () => {
  let thrown: unknown;
  try {
    (Route.options.beforeLoad as unknown as () => void)();
  } catch (error) {
    thrown = error;
  }
  expect(isRedirect(thrown)).toBe(true);
  expect((thrown as { options: { to: string; hash: string } }).options).toMatchObject({
    to: '/dashboard/limits',
    hash: 'budgets',
  });
});
