import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@/components/dashboard/primitives';
import { AppScope, AppSelect, useSelectedApp } from '@/components/dashboard/app-select';
import { consoleHead } from '@/lib/seo';
import { MirrorsBody } from '@/components/dashboard/pages/mirrors';

export const Route = createFileRoute('/dashboard/mirrors')({
  component: MirrorsPage,
  head: () => consoleHead('mirrors'),
});

function MirrorsPage() {
  const appState = useSelectedApp();
  const { slug, select, apps } = appState;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Mirrors"
        actions={<AppSelect slug={slug} onSelect={select} apps={apps} />}
      />
      <AppScope state={appState} resource="mirror rules">
        <MirrorsBody slug={slug} />
      </AppScope>
    </div>
  );
}
