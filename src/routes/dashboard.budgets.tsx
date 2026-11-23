import { createFileRoute, redirect } from '@tanstack/react-router';

// Budgets moved into Billing › Spending limits; old links land on that section.
export const Route = createFileRoute('/dashboard/budgets')({
  beforeLoad: () => {
    throw redirect({ to: '/dashboard/limits', hash: 'budgets', replace: true });
  },
});
