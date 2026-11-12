import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@/components/dashboard/primitives';
import { AppScope, AppSelect, useSelectedApp } from '@/components/dashboard/app-select';
import { consoleHead } from '@/lib/seo';
import { OpenAPIBody } from '@/components/dashboard/pages/openapi';

export const Route = createFileRoute('/dashboard/openapi')({
  component: OpenAPIPage,
  head: () => consoleHead('openapi'),
});

function OpenAPIPage() {
  const appState = useSelectedApp();
  const { slug, select, apps } = appState;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="OpenAPI"
        actions={<AppSelect slug={slug} onSelect={select} apps={apps} />}
      />
      <AppScope state={appState} resource="OpenAPI documents">
        <OpenAPIBody slug={slug} />
      </AppScope>
    </div>
  );
}
