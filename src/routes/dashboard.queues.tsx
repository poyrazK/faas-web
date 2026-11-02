import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@/components/dashboard/primitives';
import { AppScope, AppSelect, useSelectedApp } from '@/components/dashboard/app-select';
import { consoleHead } from '@/lib/seo';
import { QueuesBody } from '@/components/dashboard/pages/queues';

export const Route = createFileRoute('/dashboard/queues')({
  component: QueuesPage,
  head: () => consoleHead('queues'),
});

function QueuesPage() {
  const appState = useSelectedApp();
  const { slug, select, apps } = appState;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Queues"
        description="One FIFO queue per app. Messages here are peeked, not received — browsing never claims work from your consumers."
        actions={<AppSelect slug={slug} onSelect={select} apps={apps} />}
      />

      <AppScope state={appState} resource="queue jobs">
        <QueuesBody slug={slug} />
      </AppScope>
    </div>
  );
}
