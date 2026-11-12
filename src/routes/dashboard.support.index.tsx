import { createFileRoute } from '@tanstack/react-router';
import { SupportPage } from '@/components/dashboard/support/support-page';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/support/')({
  validateSearch: (search: Record<string, unknown>): { scope?: 'personal' } => ({
    scope: search.scope === 'personal' ? 'personal' : undefined,
  }),
  component: Page,
  head: () => consoleHead('support'),
});
function Page() {
  return <SupportPage personal={Route.useSearch().scope === 'personal'} />;
}
