import { createFileRoute, redirect } from '@tanstack/react-router';
import { AgentPolicyPage } from '@/components/dashboard/agents/agent-policy-page';
import { featureFlags } from '@/lib/feature-flags';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/agents/policy')({
  // Held back by the `agents` build flag, like the Agents list.
  beforeLoad: () => {
    if (!featureFlags.agents) throw redirect({ to: '/dashboard', replace: true });
  },
  component: featureFlags.agents ? AgentPolicyPage : () => null,
  head: () => consoleHead('agents'),
});
