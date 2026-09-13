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

export const Route = createFileRoute('/dashboard/triggers/new')({
  component: NewTriggerPage,
  head: () => consoleHead('new trigger'),
});

function NewTriggerPage() {
  const { account, loading, apiReachable, refreshAccount } = useAuth();
  const apps = useApps();

  if (!apiReachable) {
    return <UnreachableState onRetry={() => void refreshAccount()} />;
  }
  if (loading || !account || apps.isPending) {
    return <LoadingState message="Reading trigger capabilities…" />;
  }
  if (apps.error) {
    return <ErrorState error={apps.error} onRetry={() => void apps.refetch()} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Create trigger"
        description="Bind an event source to one destination app and define its delivery contract."
      />
      <CreateTrigger account={account} apps={apps.data ?? []} />
    </div>
  );
}
