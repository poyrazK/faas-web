import { createFileRoute } from '@tanstack/react-router';
import { AgentPage } from '@/components/dashboard/agents/agent-page';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/agents/$agentId')({
  component: Page,
  head: () => consoleHead('agents'),
});
function Page() {
  return <AgentPage agentId={Route.useParams().agentId} />;
}
