import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@/components/dashboard/primitives';
import { consoleHead } from '@/lib/seo';
import { EdgeRulesBody } from '@/components/dashboard/pages/edge-rules';

export const Route = createFileRoute('/dashboard/edge-rules')({
  component: EdgeRulesPage,
  head: () => consoleHead('edge-rules'),
});

function EdgeRulesPage() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Edge rules"
        help="Applied at the gateway, in priority order, before a request reaches an app."
      />
      <EdgeRulesBody />
    </div>
  );
}
