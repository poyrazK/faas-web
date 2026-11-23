import { createFileRoute, redirect } from '@tanstack/react-router';
import { AgentsPage } from '@/components/dashboard/agents/agents-page';
import { featureFlags } from '@/lib/feature-flags';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/agents/')({
  // Held back by the `agents` build flag: off, a bookmarked URL lands on the
  // Overview and the page is folded out of the bundle.
  beforeLoad: () => {
    if (!featureFlags.agents) throw redirect({ to: '/dashboard', replace: true });
  },
  component: featureFlags.agents ? AgentsPage : () => null,
  head: () => consoleHead('agents'),
});
