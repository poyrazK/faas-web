import { createFileRoute } from '@tanstack/react-router';
import { SupportConversationPage } from '@/components/dashboard/support/support-conversation';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/support/$ticket')({
  component: Page,
  head: () => consoleHead('support'),
});
function Page() {
  return <SupportConversationPage ticket={Route.useParams().ticket} />;
}
