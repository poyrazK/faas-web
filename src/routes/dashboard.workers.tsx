import { useMemo, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { PageHeader } from '@/components/dashboard/primitives';
import { InstanceDetail } from '@/components/dashboard/instance-detail';
import { Pill, ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { useApps, useInstances } from '@/lib/api/queries';
import { slugIndex } from '@/lib/api/adapters';
import { formatRelative } from '@/lib/mock-data';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/workers')({
  component: WorkersPage,
  validateSearch: (
    raw: Record<string, unknown>
  ): Record<string, unknown> & { instance?: string; q?: string } => ({
    ...raw,
    instance: typeof raw.instance === 'string' && raw.instance.trim() ? raw.instance : undefined,
    q: typeof raw.q === 'string' && raw.q.trim() ? raw.q : undefined,
  }),
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
  const appQuery = useApps();
  const apps = appQuery.data;
  const { instance: selectedId, q = '' } = Route.useSearch();
  const [revealRequest, setRevealRequest] = useState(0);
  const navigate = Route.useNavigate();
  const select = (instance?: string) =>
    void navigate({
      search: (current) => ({ ...current, instance }),
      hash: true,
      resetScroll: false,
    });
  const selected = data?.instances.find((instance) => instance.id === selectedId);
  const selectedSlug = apps?.find((app) => app.id === selected?.app_id)?.slug;

  const rows = useMemo<InstanceRow[]>(() => {
    const bySlug = slugIndex(apps ?? []);
    return (data?.instances ?? []).map((i) => ({
      id: i.id,
      app: bySlug.get(i.app_id) ?? i.app_id,
      state: i.state,
      ramMb: i.ram_mb,
      startedAt: i.started_at ?? '',
      lastRequestAt: i.last_request_at ?? '',
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
      priority: 'secondary',
      numeric: true,
      width: 'w-28',
      render: (i) => <span className="[font-variant-numeric:tabular-nums]">{i.ramMb} MB</span>,
    },
    {
      key: 'startedAt',
      label: 'Started',
      priority: 'secondary',
      numeric: true,
      render: (i) => (
        <span className="text-xs text-muted-foreground">{formatWhen(i.startedAt)}</span>
      ),
    },
    {
      key: 'lastRequestAt',
      label: 'Last request',
      priority: 'secondary',
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
      <ResourceTable
        rows={rows}
        columns={columns}
        initialSort={{ key: 'startedAt', dir: 'desc' }}
        searchKeys={['app', 'state', 'id']}
        searchPlaceholder="Filter by app or state…"
        query={q}
        onQueryChange={(query) =>
          void navigate({
            search: (current) => ({ ...current, q: query || undefined }),
            hash: true,
            resetScroll: false,
          })
        }
        emptyMessage="No instances running — everything is parked."
        emptyAction={
          <Link to="/dashboard/workflows" className="text-sm underline underline-offset-4">
            View apps
          </Link>
        }
        minWidth="min-w-[900px]"
        loading={isPending}
        error={error}
        onRetry={() => void refetch()}
        onRowClick={(instance) => {
          if (instance.id === selectedId) setRevealRequest((request) => request + 1);
          else select(instance.id);
        }}
      />
      {selectedId && (
        <InstanceDetail
          id={selectedId}
          revealRequest={revealRequest}
          instance={selected}
          slug={selectedSlug}
          loading={isPending}
          error={error}
          onRetry={() => void refetch()}
          appsLoading={appQuery.isPending}
          appsError={appQuery.error}
          onRetryApps={() => void appQuery.refetch()}
          onClose={() => select()}
        />
      )}
    </div>
  );
}
