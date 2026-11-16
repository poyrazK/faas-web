import { createFileRoute } from '@tanstack/react-router';
import { SupportConversationPage } from '@/components/dashboard/support/support-conversation';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/orgs/$org/support/$ticket')({
  component: Page,
  head: () => consoleHead('support'),
});
function Page() {
  const { org, ticket } = Route.useParams();
  return <SupportConversationPage org={org} ticket={ticket} />;
}
