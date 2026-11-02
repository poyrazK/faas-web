import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@/components/dashboard/primitives';
import { AppScope, AppSelect, useSelectedApp } from '@/components/dashboard/app-select';
import { consoleHead } from '@/lib/seo';
import { RoutesBody } from '@/components/dashboard/pages/routes';

export const Route = createFileRoute('/dashboard/routes')({
  component: ApisPage,
  head: () => consoleHead('routes'),
});

function ApisPage() {
  const appState = useSelectedApp();
  const { slug, select, apps } = appState;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="APIs"
        description="Routes observed at the gateway for this app. Discovered from traffic, not declared."
        actions={<AppSelect slug={slug} onSelect={select} apps={apps} />}
      />

      <AppScope state={appState} resource="routes">
        <RoutesBody
          slug={slug}
          baseUrl={
            apps.find((app) => app.slug === slug)?.visibility === 'internal'
              ? undefined
              : apps.find((app) => app.slug === slug)?.url
          }
        />
      </AppScope>
    </div>
  );
}
