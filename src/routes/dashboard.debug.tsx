import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { PageHeader, Panel } from '@/components/dashboard/primitives';
import { AppScope, AppSelect, useSelectedApp } from '@/components/dashboard/app-select';
import { DebugRequests } from '@/components/dashboard/debug-requests';
import { DebugRegressions } from '@/components/dashboard/debug-regressions';
import { DebugCompare } from '@/components/dashboard/debug-compare';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/debug')({
  component: DebugPage,
  head: () => consoleHead('debug'),
});

/**
 * The production debugger (ADR-127), from `/v1/apps/{slug}/debug/*`.
 *
 * Three questions, in the order you ask them when something is wrong: what
 * did the gateway actually serve, what has the platform decided is slower
 * than it was, and did a particular deployment cause it.
 *
 * Everything here is scalars and discrete rows — per-request latencies, named
 * percentiles, a ratio the API computed. There is no time series behind any
 * of it, so there are no charts: a line between two percentiles would be a
 * shape nobody measured.
 */

const TABS = [
  { id: 'requests', label: 'Requests' },
  { id: 'regressions', label: 'Regressions' },
  { id: 'compare', label: 'Compare' },
] as const;

type Tab = (typeof TABS)[number]['id'];

export function DebugBody({ slug }: { slug: string }) {
  const [tab, setTab] = useState<Tab>('requests');

  return (
    <Panel
      title="Debugger"
      description="Per-request telemetry recorded at the gateway. Route templates, not expanded URLs."
      actions={
        <div className="flex gap-2">
          {TABS.map((t) => (
            <Button
              key={t.id}
              size="xs"
              variant={tab === t.id ? 'default' : 'secondary'}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </Button>
          ))}
        </div>
      }
    >
      {tab === 'requests' && <DebugRequests slug={slug} />}
      {tab === 'regressions' && <DebugRegressions slug={slug} />}
      {tab === 'compare' && <DebugCompare slug={slug} />}
    </Panel>
  );
}

function DebugPage() {
  const appState = useSelectedApp();
  const { slug, select, apps } = appState;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Debugger"
        description="What the gateway served, what got slower, and which deployment did it."
        actions={<AppSelect slug={slug} onSelect={select} apps={apps} />}
      />
      <AppScope state={appState} resource="request telemetry">
        <DebugBody slug={slug} />
      </AppScope>
    </div>
  );
}
