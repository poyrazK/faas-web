import { createFileRoute, redirect } from '@tanstack/react-router';
import { AgentPage } from '@/components/dashboard/agents/agent-page';
import { featureFlags } from '@/lib/feature-flags';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/agents/$agentId')({
  // Held back by the `agents` build flag, like the list.
  beforeLoad: () => {
    if (!featureFlags.agents) throw redirect({ to: '/dashboard', replace: true });
  },
  component: featureFlags.agents ? Page : () => null,
  head: () => consoleHead('agents'),
});
function Page() {
  return <AgentPage agentId={Route.useParams().agentId} />;
}
