import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@/components/dashboard/primitives';
import { AppScope, AppSelect, useSelectedApp } from '@/components/dashboard/app-select';
import { consoleHead } from '@/lib/seo';
import { EnvBody } from '@/components/dashboard/pages/env';

export const Route = createFileRoute('/dashboard/env')({
  component: EnvPage,
  head: () => consoleHead('env'),
});

function EnvPage() {
  const appState = useSelectedApp();
  const { slug, select, apps } = appState;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Env vars"
        help="Injected at boot. Credentials belong in Secrets."
        actions={<AppSelect slug={slug} onSelect={select} apps={apps} />}
      />

      <AppScope state={appState} resource="environment variables">
        <EnvBody slug={slug} />
      </AppScope>
    </div>
  );
}
