import { useMemo } from 'react';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import {
  PageHeader,
  Panel,
  StatTile,
  InlinePhase,
  queryPhase,
} from '@/components/dashboard/primitives';
import { Pill, ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { TriggerRecords } from '@/components/dashboard/trigger-records';
import { TriggerDeadLetter } from '@/components/dashboard/trigger-dlq';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/api/errors';
import { useApps, useSetTriggerEnabled, useTriggerMetrics, useTriggers } from '@/lib/api/queries';
import { slugIndex } from '@/lib/api/adapters';
import type { JobsSelectionProps } from './jobs-search';
import { TriggerConfiguration } from '@/components/dashboard/trigger-detail';

/**
 * Event sources, from `/v1/triggers`.
 *
 * One primitive behind six kinds (spec §4.10): a cron schedule, a Kafka
 * consumer group, a NATS durable, a Redis stream group, an SQS-compatible
 * long poll, and the in-platform queue. The console showed only crons, which
 * is one of the six — a Kafka trigger set up from the CLI was invisible here.
 *
 * `config` is opaque at the wire level and differs per kind, so it is printed
 * as JSON rather than given per-kind labels the API does not promise.
 */
interface TriggerRow {
  id: string;
  kind: string;
  slug: string;
  app: string;
  enabled: boolean;
  batch: string;
  attempts: number;
}

const KIND_COLOR: Record<string, string> = {
  cron: 'var(--cat-compute)',
  kafka: 'var(--cat-network)',
  nats: 'var(--cat-network)',
  redis_streams: 'var(--cat-storage)',
  sqs_compat: 'var(--cat-storage)',
  queue: 'var(--cat-security)',
};

function TriggerDetail({
  triggerId,
  label,
  search,
  onSelection,
}: { triggerId: string; label: string } & JobsSelectionProps) {
  const tab = search.triggerView ?? 'records';
  const metrics = useTriggerMetrics(triggerId);
  const m = metrics.data;
  const phase = queryPhase({ error: metrics.error, loading: metrics.isPending, isEmpty: !m });

  return (
    <Panel
      title={label}
      description="What this trigger has taken off its source, and where it went."
    >
      {phase !== 'ready' || !m ? (
        <InlinePhase phase={phase} error={metrics.error} loadingMessage="Reading counts…" />
      ) : (
        <div className="mb-5 grid gap-4 sm:grid-cols-3 xl:grid-cols-5">
          <StatTile label="Pending" value={String(m.pending_count)} />
          <StatTile label="Claimed" value={String(m.claimed_count)} />
          <StatTile label="Succeeded" value={String(m.succeeded_count)} />
          <StatTile label="Retry" value={String(m.retry_count)} />
          <StatTile label="Dead letter" value={String(m.dead_letter_count)} />
        </div>
      )}

      <div className="mb-3 flex gap-2">
        {(['records', 'dlq'] as const).map((t) => (
          <Button
            key={t}
            size="xs"
            variant={tab === t ? 'default' : 'secondary'}
            aria-pressed={tab === t}
            onClick={() => onSelection({ triggerView: t })}
          >
            {t === 'records' ? 'Records' : 'Dead letter'}
          </Button>
        ))}
      </div>

      {tab === 'records' ? (
        <TriggerRecords triggerId={triggerId} />
      ) : (
        <TriggerDeadLetter triggerId={triggerId} />
      )}
      <div className="mt-5">
        <TriggerConfiguration triggerId={triggerId} />
      </div>
    </Panel>
  );
}

export function TriggersBody({ search, onSelection }: JobsSelectionProps) {
  const { toast } = useToast();
  const { data, isPending, error, refetch } = useTriggers();
  const { data: apps } = useApps();
  const setEnabled = useSetTriggerEnabled();

  const rows = useMemo<TriggerRow[]>(() => {
    const bySlug = slugIndex(apps ?? []);
    return (data ?? []).map((t) => ({
      id: t.id,
      kind: t.kind,
      slug: t.slug ?? t.kind,
      app: bySlug.get(t.app_id) ?? t.app_id,
      enabled: t.enabled,
      batch: `${t.batch_size_max} / ${t.batch_window_ms}ms`,
      attempts: t.max_attempts,
    }));
  }, [data, apps]);
  const selected = rows.find((trigger) => trigger.id === search.trigger);

  const toggle = (row: TriggerRow, enabled: boolean) =>
    void setEnabled
      .mutateAsync({ id: row.id, enabled })
      .then(() =>
        toast({ kind: 'success', title: enabled ? `Resumed ${row.slug}` : `Paused ${row.slug}` })
      )
      .catch((err: unknown) =>
        toast({ kind: 'error', title: 'Could not update', description: errorMessage(err) })
      );

  const columns: Column<TriggerRow>[] = [
    {
      key: 'kind',
      label: 'Kind',
      width: 'w-36',
      render: (t) => <Pill label={t.kind} color={KIND_COLOR[t.kind]} />,
    },
    {
      key: 'slug',
      label: 'Trigger',
      render: (t) => (
        <button
          type="button"
          onClick={() =>
            onSelection({
              trigger: search.trigger === t.id ? undefined : t.id,
              triggerView: undefined,
            })
          }
          className="font-mono text-xs underline-offset-2 hover:underline"
        >
          {t.slug}
        </button>
      ),
    },
    {
      key: 'app',
      label: 'Fires',
      render: (t) => <span className="font-mono text-xs text-muted-foreground">{t.app}</span>,
    },
    {
      key: 'batch',
      label: 'Batch / window',
      render: (t) => <span className="font-mono text-xs text-muted-foreground">{t.batch}</span>,
    },
    {
      key: 'attempts',
      label: 'Attempts',
      numeric: true,
      width: 'w-24',
      render: (t) => <span className="[font-variant-numeric:tabular-nums]">{t.attempts}</span>,
    },
    {
      key: 'enabled',
      label: 'Enabled',
      width: 'w-24',
      render: (t) => (
        <Switch
          size="sm"
          checked={t.enabled}
          onCheckedChange={(on) => toggle(t, on)}
          aria-label={`${t.enabled ? 'Pause' : 'Resume'} ${t.slug}`}
          className="data-[state=checked]:bg-brand"
        />
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Triggers"
        description="Event sources that invoke an app — cron, Kafka, NATS, Redis Streams, an SQS-compatible queue, or the in-platform queue. Defined in gregale.yaml and the CLI; paused, inspected and recovered here."
      />

      {search.trigger && data && !selected && <p role="status">Trigger not found</p>}
      <ResourceTable
        rows={rows}
        columns={columns}
        initialSort={{ key: 'slug', dir: 'asc' }}
        searchKeys={['slug', 'app', 'kind']}
        searchPlaceholder="Filter by trigger, app, or kind…"
        emptyMessage="No triggers yet. Declare them in gregale.yaml and deploy."
        minWidth="min-w-[880px]"
        loading={isPending}
        error={error}
        onRetry={() => void refetch()}
      />

      {selected && (
        <TriggerDetail
          triggerId={selected.id}
          label={`${selected.kind} · ${selected.slug}`}
          search={search}
          onSelection={onSelection}
        />
      )}
    </div>
  );
}
