import { useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { InlinePhase, PageHeader, queryPhase } from '@/components/dashboard/primitives';
import { Modal } from '@/components/ui/modal';
import { Pill, ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { useApps, useInstances, useWakeTimeline } from '@/lib/api/queries';
import { slugIndex } from '@/lib/api/adapters';
import { formatRelative } from '@/lib/mock-data';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/workers')({
  component: WorkersPage,
  head: () => consoleHead('workers'),
});

/**
 * Live microVM instances, from `/v1/instances`.
 *
 * This page previously invented a pool of long-lived "workers". The platform
 * does not have those: it has Firecracker VMs that wake on a request and park
 * again when idle, so an empty table here is the healthy scaled-to-zero state,
 * not an outage. The empty copy says so.
 */
interface InstanceRow {
  wakeId: string;
  id: string;
  app: string;
  state: string;
  ramMb: number;
  startedAt: string;
  lastRequestAt: string;
}

const STATE_COLOR: Record<string, string> = {
  running: 'var(--status-good)',
  ready: 'var(--status-good)',
  waking: 'var(--status-warning)',
  parked: 'var(--chart-muted)',
  failed: 'var(--status-critical)',
};

function formatWhen(value: string | null | undefined): string {
  if (!value) return '—';
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? '—' : formatRelative(ms);
}

function WorkersPage() {
  const { data, isPending, error, refetch } = useInstances();
  const { data: apps } = useApps();
  const [timeline, setTimeline] = useState<{ slug: string; wakeId: string } | null>(null);

  const rows = useMemo<InstanceRow[]>(() => {
    const bySlug = slugIndex(apps ?? []);
    return (data?.instances ?? []).map((i) => ({
      id: i.id,
      app: bySlug.get(i.app_id) ?? i.app_id,
      state: i.state,
      ramMb: i.ram_mb,
      startedAt: i.started_at ?? '',
      lastRequestAt: i.last_request_at ?? '',
      wakeId: i.wake_id ?? '',
    }));
  }, [data, apps]);

  const columns: Column<InstanceRow>[] = [
    {
      key: 'app',
      label: 'App',
      render: (i) => <span className="font-mono text-xs">{i.app}</span>,
    },
    {
      key: 'state',
      label: 'State',
      width: 'w-32',
      render: (i) => <Pill label={i.state} color={STATE_COLOR[i.state.toLowerCase()]} />,
    },
    {
      key: 'ramMb',
      label: 'RAM',
      numeric: true,
      width: 'w-28',
      render: (i) => <span className="[font-variant-numeric:tabular-nums]">{i.ramMb} MB</span>,
    },
    {
      key: 'startedAt',
      label: 'Started',
      numeric: true,
      render: (i) => (
        <span className="text-xs text-muted-foreground">{formatWhen(i.startedAt)}</span>
      ),
    },
    {
      key: 'lastRequestAt',
      label: 'Last request',
      numeric: true,
      render: (i) => (
        <span className="text-xs text-muted-foreground">{formatWhen(i.lastRequestAt)}</span>
      ),
    },
    {
      key: 'id',
      label: 'Instance',
      render: (i) => <span className="font-mono text-xs text-muted-foreground">{i.id}</span>,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Instances"
        description="Firecracker microVMs currently alive. Apps park when idle, so an empty list means everything scaled to zero."
      />
      <WakeTimelineModal target={timeline} onClose={() => setTimeline(null)} />
      <ResourceTable
        rows={rows}
        columns={columns}
        initialSort={{ key: 'startedAt', dir: 'desc' }}
        searchKeys={['app', 'state', 'id']}
        searchPlaceholder="Filter by app or state…"
        emptyMessage="No instances running — everything is parked."
        minWidth="min-w-[900px]"
        loading={isPending}
        error={error}
        onRetry={() => void refetch()}
        rowActions={(i) =>
          i.wakeId ? (
            <button
              type="button"
              onClick={() => setTimeline({ slug: i.app, wakeId: i.wakeId })}
              className="pressable rounded text-xs text-muted-foreground hover:text-foreground"
            >
              Timeline
            </button>
          ) : null
        }
      />
    </div>
  );
}

/**
 * The canonical wake timeline for one instance's wake attempt — every frame
 * schedd recorded, with elapsed deltas, so a slow cold start can be read
 * stage by stage instead of guessed at.
 */
function WakeTimelineModal({
  target,
  onClose,
}: {
  target: { slug: string; wakeId: string } | null;
  onClose: () => void;
}) {
  const q = useWakeTimeline(target?.slug ?? '', target?.wakeId ?? '');
  const events = q.data?.events ?? [];
  const phase = queryPhase({ error: q.error, loading: q.isPending, isEmpty: events.length === 0 });
  const t0 = events.length ? Date.parse(events[0].at) : 0;

  return (
    <Modal
      open={target !== null}
      onClose={onClose}
      title="Wake timeline"
      description={target ? `${target.slug} · ${target.wakeId.slice(0, 13)}` : undefined}
      width="max-w-xl"
    >
      {phase !== 'ready' ? (
        <InlinePhase
          phase={phase}
          error={q.error}
          loadingMessage="Reading the timeline…"
          emptyMessage="No frames recorded for this wake."
        />
      ) : (
        <ol className="flex flex-col">
          {events.map((e, i) => {
            const dt = Math.max(0, Date.parse(e.at) - t0);
            return (
              <li
                key={`${e.at}-${i}`}
                className="flex items-baseline gap-4 border-b border-border py-2 text-xs last:border-0"
              >
                <span className="w-16 shrink-0 text-right font-mono text-muted-foreground [font-variant-numeric:tabular-nums]">
                  +{dt} ms
                </span>
                <span className="font-mono">{e.kind}</span>
                {e.actor && <span className="text-muted-foreground">{e.actor}</span>}
              </li>
            );
          })}
        </ol>
      )}
    </Modal>
  );
}
