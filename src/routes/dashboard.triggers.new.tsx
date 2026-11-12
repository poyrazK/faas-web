import { createFileRoute } from '@tanstack/react-router';
import { CreateTrigger } from '@/components/dashboard/trigger-create';
import {
  ErrorState,
  LoadingState,
  PageHeader,
  UnreachableState,
} from '@/components/dashboard/primitives';
import { useAuth } from '@/lib/auth';
import { useApps } from '@/lib/api/queries';
import { consoleHead } from '@/lib/seo';
import { inScope } from '@/lib/project-scope';
import { useScopeGate } from '@/components/dashboard/scope-gate';

export const Route = createFileRoute('/dashboard/triggers/new')({
  component: NewTriggerPage,
  head: () => consoleHead('new trigger'),
});

function NewTriggerPage() {
  const { account, loading, apiReachable, refreshAccount } = useAuth();
  const apps = useApps();
  // Inside a project, a new trigger fires one of the project's apps.
  const gate = useScopeGate();

  if (!apiReachable) {
    return <UnreachableState onRetry={() => void refreshAccount()} />;
  }
  if (loading || !account || apps.isPending || gate.pending) {
    return <LoadingState message="Reading trigger capabilities…" />;
  }
  if (apps.error) {
    return <ErrorState error={apps.error} onRetry={() => void apps.refetch()} />;
  }
  if (gate.error) {
    return <ErrorState error={gate.error} onRetry={gate.retry} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Create trigger" />
      <CreateTrigger
        account={account}
        apps={inScope(apps.data ?? [], gate.scope, (app) => app.slug)}
      />
    </div>
  );
}
