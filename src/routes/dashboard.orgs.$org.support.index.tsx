import { createFileRoute } from '@tanstack/react-router';
import { SupportPage } from '@/components/dashboard/support/support-page';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/orgs/$org/support/')({
  component: Page,
  head: () => consoleHead('support'),
});
function Page() {
  return <SupportPage org={Route.useParams().org} />;
}
