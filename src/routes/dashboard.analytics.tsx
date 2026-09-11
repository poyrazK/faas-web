import { createFileRoute } from '@tanstack/react-router';
import { AnalyticsSection } from '@/components/dashboard/analytics-section';
import { AppScope, useSelectedApp } from '@/components/dashboard/app-select';
import { PageHeader } from '@/components/dashboard/primitives';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/analytics')({
  component: AnalyticsPage,
  head: () => consoleHead('analytics'),
});

function AnalyticsPage() {
  const appState = useSelectedApp();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Analytics"
        description="Request traffic, latency, and errors for the selected app."
      />
      <AppScope state={appState} resource="analytics">
        <AnalyticsSection apps={appState.apps} slug={appState.slug} onSelectApp={appState.select} />
      </AppScope>
    </div>
  );
}
