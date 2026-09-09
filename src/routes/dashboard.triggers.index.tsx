import { useMemo } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Plus } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  UnreachableState,
} from '@/components/dashboard/primitives';
import { Pill, ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { errorMessage } from '@/lib/api/errors';
import { slugIndex } from '@/lib/api/adapters';
import { useApps, useSetTriggerEnabled, useTriggers } from '@/lib/api/queries';
import { useAuth } from '@/lib/auth';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/triggers/')({
  component: TriggersPage,
  head: () => consoleHead('triggers'),
});

interface TriggerRow {
  id: string;
  kind: string;
  slug: string;
  app: string;
  enabled: boolean;
  status: string;
  batch: string;
  attempts: number;
  updated: string;
}

const KIND_COLOR: Record<string, string> = {
  cron: 'var(--cat-compute)',
  kafka: 'var(--cat-network)',
  nats: 'var(--cat-network)',
  redis_streams: 'var(--cat-storage)',
  sqs_compat: 'var(--cat-storage)',
  queue: 'var(--cat-security)',
};

export function TriggersPage() {
  const { toast } = useToast();
  const auth = useAuth();
  const triggers = useTriggers();
  const apps = useApps();
  const setEnabled = useSetTriggerEnabled();

  const rows = useMemo<TriggerRow[]>(() => {
    const bySlug = slugIndex(apps.data ?? []);
    return (triggers.data ?? []).map((trigger) => ({
      id: trigger.id,
      kind: trigger.kind,
      slug: trigger.slug ?? trigger.kind,
      app: bySlug.get(trigger.app_id) ?? trigger.app_id,
      enabled: trigger.enabled,
      status: trigger.enabled ? 'enabled' : 'paused',
      batch: `${trigger.batch_size_max} / ${trigger.batch_window_ms}ms`,
      attempts: trigger.max_attempts,
      updated: new Date(trigger.updated_at).toLocaleString(),
    }));
  }, [triggers.data, apps.data]);

  const toggle = (row: TriggerRow, enabled: boolean) =>
    void setEnabled
      .mutateAsync({ id: row.id, enabled })
      .then(() =>
        toast({ kind: 'success', title: enabled ? `Resumed ${row.slug}` : `Paused ${row.slug}` })
      )
      .catch((error: unknown) =>
        toast({ kind: 'error', title: 'Could not update', description: errorMessage(error) })
      );

  const columns: Column<TriggerRow>[] = [
    {
      key: 'kind',
      label: 'Kind',
      width: 'w-36',
      render: (row) => <Pill label={row.kind} color={KIND_COLOR[row.kind]} />,
    },
    {
      key: 'slug',
      label: 'Trigger',
      render: (row) =>
        row.kind === 'cron' ? (
          <Link to="/dashboard/crons" className="font-mono text-xs text-brand hover:underline">
            {row.slug}
          </Link>
        ) : (
          <Link
            to="/dashboard/triggers/$triggerId"
            params={{ triggerId: row.id }}
            className="font-mono text-xs text-brand hover:underline"
          >
            {row.slug}
          </Link>
        ),
    },
    {
      key: 'app',
      label: 'Destination',
      render: (row) => <span className="font-mono text-xs text-muted-foreground">{row.app}</span>,
    },
    {
      key: 'status',
      label: 'Status',
      width: 'w-24',
      render: (row) => (
        <Pill
          label={row.status}
          color={row.enabled ? 'var(--status-good)' : 'var(--status-idle)'}
        />
      ),
    },
    {
      key: 'batch',
      label: 'Batch / window',
      render: (row) => <span className="font-mono text-xs text-muted-foreground">{row.batch}</span>,
    },
    {
      key: 'attempts',
      label: 'Attempts',
      numeric: true,
      width: 'w-24',
      render: (row) => <span className="font-mono text-xs">{row.attempts}</span>,
    },
    {
      key: 'updated',
      label: 'Updated',
      render: (row) => <span className="text-xs text-muted-foreground">{row.updated}</span>,
    },
    {
      key: 'enabled',
      label: 'Polling',
      width: 'w-20',
      render: (row) => (
        <Switch
          size="sm"
          checked={row.enabled}
          disabled={setEnabled.isPending && setEnabled.variables?.id === row.id}
          onCheckedChange={(enabled) => toggle(row, enabled)}
          aria-label={`${row.enabled ? 'Pause' : 'Resume'} ${row.slug}`}
          className="data-[state=checked]:bg-brand"
        />
      ),
    },
  ];

  const action = auth.account?.limits.triggers_allowed ? (
    <Button asChild size="sm">
      <Link to="/dashboard/triggers/new">
        <Plus /> Create trigger
      </Link>
    </Button>
  ) : (
    <Button asChild size="sm" variant="secondary">
      <Link to="/dashboard/plans">Compare plans</Link>
    </Button>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Triggers"
        description="Event sources that poll, batch, and invoke an app. Cron schedules remain on the Crons page."
        actions={action}
      />

      {!auth.apiReachable ? (
        <UnreachableState onRetry={() => void auth.refreshAccount()} />
      ) : auth.loading || !auth.account || apps.isPending ? (
        <LoadingState message="Reading triggers…" />
      ) : apps.error ? (
        <ErrorState error={apps.error} onRetry={() => void apps.refetch()} />
      ) : apps.data?.length === 0 ? (
        <EmptyState
          message="Create an app before adding a trigger."
          action={
            <Link to="/dashboard/workflows/new" className="text-xs text-brand hover:underline">
              Create app
            </Link>
          }
        />
      ) : (
        <ResourceTable
          rows={rows}
          columns={columns}
          initialSort={{ key: 'slug', dir: 'asc' }}
          searchKeys={['slug', 'app', 'kind', 'status']}
          searchPlaceholder="Filter by trigger, app, kind, or status…"
          emptyMessage="No triggers yet. Bind an event source to an app."
          minWidth="min-w-[1080px]"
          loading={triggers.isPending}
          error={triggers.error}
          onRetry={() => void triggers.refetch()}
        />
      )}
    </div>
  );
}
