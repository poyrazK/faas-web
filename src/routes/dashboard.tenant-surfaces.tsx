import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@/components/dashboard/primitives';
import { AppScope, AppSelect, useSelectedApp } from '@/components/dashboard/app-select';
import { TenantSurfaces } from '@/components/dashboard/tenant-surfaces';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/tenant-surfaces')({
  component: TenantSurfacesPage,
  head: () => consoleHead('tenant-surfaces'),
});

export function TenantSurfacesBody({ slug }: { slug: string }) {
  return <TenantSurfaces slug={slug} />;
}

function TenantSurfacesPage() {
  const appState = useSelectedApp();
  const { slug, select, apps } = appState;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Tenant surfaces"
        description="Your customers' own hostnames, grouped under one certificate bundle per surface."
        actions={<AppSelect slug={slug} onSelect={select} apps={apps} />}
      />
      <AppScope state={appState} resource="tenant surfaces">
        <TenantSurfacesBody slug={slug} />
      </AppScope>
    </div>
  );
}
