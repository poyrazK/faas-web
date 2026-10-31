import { createFileRoute } from '@tanstack/react-router';
import {
  IntegrationsBody,
  type IntegrationsView,
} from '@/components/dashboard/outbound/integrations-body';
import { consoleHead } from '@/lib/seo';
import { withCapability } from '@/components/dashboard/capability-gate';

export const Route = createFileRoute('/dashboard/integrations')({
  // Gated like its nav item: a bookmarked URL explains itself when off.
  component: withCapability('outbound-integrations', 'Integrations', IntegrationsPage),
  head: () => consoleHead('integrations'),
  validateSearch: (search: Record<string, unknown>): { view?: 'ai' } =>
    search.view === 'ai' ? { view: 'ai' } : {},
});

function IntegrationsPage() {
  const { view } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <IntegrationsBody
      view={view === 'ai' ? 'ai' : 'integrations'}
      onView={(next: IntegrationsView) =>
        void navigate({ search: next === 'ai' ? { view: 'ai' } : {}, replace: true })
      }
    />
  );
}
