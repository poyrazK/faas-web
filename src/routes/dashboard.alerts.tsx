import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@/components/dashboard/primitives';
import { AppScope, AppSelect, useSelectedApp } from '@/components/dashboard/app-select';
import { consoleHead } from '@/lib/seo';
import { AlertsBody } from '@/components/dashboard/pages/alerts';

export const Route = createFileRoute('/dashboard/alerts')({
  component: AlertsPage,
  head: () => consoleHead('alerts'),
});

function AlertsPage() {
  const appState = useSelectedApp();
  const { slug, select, apps } = appState;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Alerts"
        actions={<AppSelect slug={slug} onSelect={select} apps={apps} />}
      />
      <AppScope state={appState} resource="alert rules">
        <AlertsBody slug={slug} />
      </AppScope>
    </div>
  );
}
