import { createFileRoute } from '@tanstack/react-router';
import { AgentPolicyPage } from '@/components/dashboard/agents/agent-policy-page';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/agents/policy')({
  component: AgentPolicyPage,
  head: () => consoleHead('agents'),
});
