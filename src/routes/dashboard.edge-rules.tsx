import { EdgeRulesBody } from '@/components/dashboard/pages/edge-rules';
import { PageHeader } from '@/components/dashboard/primitives';
import { consoleHead } from '@/lib/seo';
import { createFileRoute } from '@tanstack/react-router';
import { withProductionBanner } from '@/components/dashboard/production-only-banner';

export const Route = createFileRoute('/dashboard/edge-rules')({
  component: withProductionBanner('edge rules', EdgeRulesPage),
  head: () => consoleHead('edge-rules'),
});

function EdgeRulesPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Edge Rules"
        help="Applied at the gateway, in priority order, before a request reaches an app."
      />
      <EdgeRulesBody />
    </div>
  );
}
