import { useMemo } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { InlinePhase, PageHeader, queryPhase } from '@/components/dashboard/primitives';
import { InstanceDetail } from '@/components/dashboard/instance-detail';
import { Pill, ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { Button } from '@/components/ui/button';
import { useApps, useInfiniteInstances } from '@/lib/api/queries';
import { slugIndex } from '@/lib/api/adapters';
import { inScope } from '@/lib/project-scope';
import { scopedIn, useScopeGate } from '@/components/dashboard/scope-gate';
import { formatRelative } from '@/lib/mock-data';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/instances')({
  component: WorkersPage,
  validateSearch: (
    raw: Record<string, unknown>
  ): Record<string, unknown> & { instance?: string; q?: string } => ({
    ...raw,
    instance: typeof raw.instance === 'string' && raw.instance.trim() ? raw.instance : undefined,
    q: typeof raw.q === 'string' && raw.q.trim() ? raw.q : undefined,
  }),
  head: () => consoleHead('instances'),
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
  const instances = useInfiniteInstances();
  const appQuery = useApps();
  const apps = appQuery.data;
  const { instance: selectedId, q = '' } = Route.useSearch();
  const navigate = Route.useNavigate();
  const gate = useScopeGate();
  const { scope } = gate;
  const data = useMemo(
    () => instances.data?.pages.flatMap((page) => page.instances) ?? [],
    [instances.data]
  );
  // Keep already loaded rows usable if a later page fails; only an initial
  // failure should replace the table with its full-page error state.
  const listError = data.length === 0 ? instances.error : undefined;
  const listLoading = instances.isPending && !instances.error && data.length === 0;
  // Inside a project an instance is placed by its app's slug, so the app list
  // and project membership must both be known before any row is shown.
  const scopeLoading = Boolean(scope.project) && (gate.pending || appQuery.isPending);
  const scopeError = scope.project ? (gate.error ?? appQuery.error ?? undefined) : undefined;
  const select = (instance?: string) =>
    void navigate({
      search: (current) => ({ ...current, instance }),
      hash: true,
      resetScroll: false,
    });
  const selected = data.find((instance) => instance.id === selectedId);
  const selectedSlug = apps?.find((app) => app.id === selected?.app_id)?.slug;

  const rows = useMemo<InstanceRow[]>(() => {
    const bySlug = slugIndex(apps ?? []);
    const all = data.map((i) => ({
      id: i.id,
      app: bySlug.get(i.app_id) ?? i.app_id,
      state: i.state,
      ramMb: i.ram_mb,
      startedAt: i.started_at ?? '',
      lastRequestAt: i.last_request_at ?? '',
    }));
    return inScope(all, scope, (row) => row.app);
  }, [data, apps, scope]);

  const columns: Column<InstanceRow>[] = [
    {
      key: 'app',
      label: 'App',
      render: (i) => <span className="font-medium">{i.app}</span>,
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
      // The first characters tell instances apart; the full id is on hover
      // and in the detail the row opens.
      render: (i) => (
        <span title={i.id} className="font-mono text-xs text-muted-foreground">
          {i.id.length > 12 ? `${i.id.slice(0, 8)}…` : i.id}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Instances" />
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
            replace: true,
            resetScroll: false,
          })
        }
        emptyMessage={
          scope.project
            ? `No instances running ${scopedIn(scope)} — every app is parked.`
            : 'No instances running — everything is parked.'
        }
        emptyAction={
          <Link to="/dashboard/apps" className="text-sm underline underline-offset-4">
            View apps
          </Link>
        }
        minWidth="min-w-[900px]"
        loading={listLoading || (!listError && !scopeError && scopeLoading)}
        error={listError ?? scopeError}
        onRetry={() => {
          if (gate.error) gate.retry();
          if (appQuery.error) void appQuery.refetch();
          void instances.refetch();
        }}
        onRowClick={(instance) => select(instance.id)}
      />
      {data.length > 0 && Boolean(instances.error) && (
        <div className="flex flex-wrap items-center justify-center gap-3">
          <InlinePhase phase={queryPhase({ error: instances.error })} error={instances.error} />
          <Button
            size="xs"
            variant="ghost"
            onClick={() =>
              void (
                instances.isFetchNextPageError ? instances.fetchNextPage() : instances.refetch()
              ).catch(() => undefined)
            }
          >
            Retry
          </Button>
        </div>
      )}
      {instances.hasNextPage && (
        <div className="flex justify-center">
          <Button
            size="sm"
            variant="outline"
            busy={instances.isFetchingNextPage}
            onClick={() => void instances.fetchNextPage().catch(() => undefined)}
          >
            Load older instances
          </Button>
        </div>
      )}
      {selectedId && (
        <InstanceDetail
          id={selectedId}
          instance={selected}
          slug={selectedSlug}
          loading={listLoading}
          error={listError}
          onRetry={() => void instances.refetch()}
          appsLoading={appQuery.isPending}
          appsError={appQuery.error}
          onRetryApps={() => void appQuery.refetch()}
          onClose={() => select()}
        />
      )}
    </div>
  );
}
