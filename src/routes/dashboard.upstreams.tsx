import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@/components/dashboard/primitives';
import { AppScope, AppSelect, useSelectedApp } from '@/components/dashboard/app-select';
import { consoleHead } from '@/lib/seo';
import { UpstreamsBody } from '@/components/dashboard/pages/upstreams';

export const Route = createFileRoute('/dashboard/upstreams')({
  component: UpstreamsPage,
  head: () => consoleHead('upstreams'),
});

function UpstreamsPage() {
  const appState = useSelectedApp();
  const { slug, select, apps } = appState;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Upstreams"
        description="External services this app reaches. Mostly discovered from egress; hostnames are hashed, never stored in the clear."
        actions={<AppSelect slug={slug} onSelect={select} apps={apps} />}
      />
      <AppScope state={appState} resource="upstreams">
        <UpstreamsBody slug={slug} />
      </AppScope>
    </div>
  );
}
