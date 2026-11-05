import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@/components/dashboard/primitives';
import { AppScope, AppSelect, useSelectedApp } from '@/components/dashboard/app-select';
import { consoleHead } from '@/lib/seo';
import { SecretsBody } from '@/components/dashboard/pages/secrets';

export const Route = createFileRoute('/dashboard/secrets')({
  component: SecretsPage,
  head: () => consoleHead('secrets'),
});

function SecretsPage() {
  const appState = useSelectedApp();
  const { slug, select, apps } = appState;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Secrets"
        help="Values are sealed and cannot be read back. Set a new value to change one."
        actions={<AppSelect slug={slug} onSelect={select} apps={apps} />}
      />

      <AppScope state={appState} resource="secrets">
        <SecretsBody slug={slug} />
      </AppScope>
    </div>
  );
}
