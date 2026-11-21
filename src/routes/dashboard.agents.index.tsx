import { createFileRoute } from '@tanstack/react-router';
import { AgentsPage } from '@/components/dashboard/agents/agents-page';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/agents/')({
  component: AgentsPage,
  head: () => consoleHead('agents'),
});
