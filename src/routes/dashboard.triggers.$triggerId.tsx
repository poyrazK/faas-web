import { createFileRoute, useParams } from '@tanstack/react-router';
import { TriggerDetail } from '@/components/dashboard/trigger-detail';
import { ErrorState, LoadingState, UnreachableState } from '@/components/dashboard/primitives';
import { useApps } from '@/lib/api/queries';
import { useAuth } from '@/lib/auth';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/triggers/$triggerId')({
  component: TriggerDetailPage,
  head: () => consoleHead('trigger'),
});

function TriggerDetailPage() {
  const { triggerId } = useParams({ from: '/dashboard/triggers/$triggerId' });
  const auth = useAuth();
  const apps = useApps();

  if (!auth.apiReachable) {
    return <UnreachableState onRetry={() => void auth.refreshAccount()} />;
  }
  if (auth.loading || !auth.account || apps.isPending) {
    return <LoadingState message="Reading trigger context…" />;
  }
  if (apps.error) {
    return <ErrorState error={apps.error} onRetry={() => void apps.refetch()} />;
  }
  return <TriggerDetail triggerId={triggerId} account={auth.account} apps={apps.data ?? []} />;
}
