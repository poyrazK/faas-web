import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@/components/dashboard/primitives';
import { AppScope, AppSelect, useSelectedApp } from '@/components/dashboard/app-select';
import { consoleHead } from '@/lib/seo';
import { TenantSurfacesBody } from '@/components/dashboard/pages/tenant-surfaces';

export const Route = createFileRoute('/dashboard/tenant-surfaces')({
  component: TenantSurfacesPage,
  head: () => consoleHead('tenant-surfaces'),
});

function TenantSurfacesPage() {
  const appState = useSelectedApp();
  const { slug, select, apps } = appState;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Tenant surfaces"
        actions={<AppSelect slug={slug} onSelect={select} apps={apps} />}
      />
      <AppScope state={appState} resource="tenant surfaces">
        <TenantSurfacesBody slug={slug} />
      </AppScope>
    </div>
  );
}
