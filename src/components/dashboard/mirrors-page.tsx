import { PageHeader } from '@/components/dashboard/primitives';
import { AppScope, AppSelect, useSelectedApp } from '@/components/dashboard/app-select';
import { MirrorRules } from '@/components/dashboard/mirrors';

export function MirrorsBody({ slug }: { slug: string }) {
  return <MirrorRules slug={slug} />;
}

export function MirrorsPage() {
  const appState = useSelectedApp();
  const { slug, select, apps } = appState;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Mirrors"
        description="Shadow a share of live traffic to a second deployment and measure what comes back differently."
        actions={<AppSelect slug={slug} onSelect={select} apps={apps} />}
      />
      <AppScope state={appState} resource="mirror rules">
        <MirrorsBody slug={slug} />
      </AppScope>
    </div>
  );
}
