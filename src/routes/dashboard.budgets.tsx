import { createFileRoute } from '@tanstack/react-router';
import { withCapability } from '@/components/dashboard/capability-gate';
import { BudgetsPage } from '@/components/dashboard/budgets/budgets-page';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/budgets')({
  // Gated like its nav item: a bookmarked URL explains itself when off.
  component: withCapability('budgets', 'Budgets', BudgetsPage),
  head: () => consoleHead('budgets'),
});
