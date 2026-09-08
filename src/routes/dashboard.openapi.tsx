import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@/components/dashboard/primitives';
import { AppScope, AppSelect, useSelectedApp } from '@/components/dashboard/app-select';
import { OpenAPIImport } from '@/components/dashboard/openapi-import';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/openapi')({
  component: OpenAPIPage,
  head: () => consoleHead('openapi'),
});

export function OpenAPIBody({ slug }: { slug: string }) {
  return <OpenAPIImport slug={slug} />;
}

function OpenAPIPage() {
  const appState = useSelectedApp();
  const { slug, select, apps } = appState;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="OpenAPI"
        description="Import your API description, preview the edge rules it suggests, and read what the platform captured from the app itself."
        actions={<AppSelect slug={slug} onSelect={select} apps={apps} />}
      />
      <AppScope state={appState} resource="OpenAPI documents">
        <OpenAPIBody slug={slug} />
      </AppScope>
    </div>
  );
}
