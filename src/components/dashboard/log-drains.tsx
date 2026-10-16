import { useId, useState } from 'react';
import { Plus, Trash } from 'iconoir-react';
import { Area, AreaChart, Grid, Tooltip, XAxis, YAxis } from '@/components/dither-kit';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { FIELD, FieldError } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/api/errors';
import {
  useCreateLogDrain,
  useDeleteLogDrain,
  useLogDrainAnalytics,
  useLogDrainHealth,
  useLogDrains,
  useUpdateLogDrain,
  type LogDrain,
  type LogDrainKind,
  type LogDrainWindow,
} from '@/lib/api/log-drains';
import { cn } from '@/lib/utils';
import { PlanGated } from './plan-gated';
import { InlinePhase, Panel, StatTile, queryPhase } from './primitives';
import { Pill, ResourceTable, type Column } from './resource-table';
import { SegmentedControl } from './tabs';

const KINDS: { value: LogDrainKind; label: string }[] = [
  { value: 'http_json', label: 'HTTP (JSON lines)' },
  { value: 'otlp', label: 'OpenTelemetry (OTLP)' },
];
const WINDOWS: LogDrainWindow[] = ['1h', '24h', '7d', '30d'];
const HEALTH: Record<string, string> = {
  healthy: 'var(--status-good)',
  degraded: 'var(--status-warning)',
  inactive: 'var(--muted-foreground)',
  unknown: 'var(--muted-foreground)',
};

function validUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Where this app's runtime logs go besides the console: an HTTP endpoint that
 * takes JSON lines, or an OTLP collector. The auth header is write-only —
 * sealed at rest, shown back only masked — and every destination reports its
 * own delivery health and hourly delivery history.
 */
export function LogDrainsBody({ slug }: { slug: string }) {
  const drains = useLogDrains(slug);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const rows = drains.data ?? [];
  const columns: Column<LogDrain>[] = [
    {
      key: 'target_url',
      label: 'Destination',
      render: (d) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-mono text-xs">{d.target_url}</span>
          <span className="text-xs text-muted-foreground">
            {KINDS.find((k) => k.value === d.kind)?.label ?? d.kind}
            {d.auth_header_masked && ' · auth header set'}
          </span>
        </span>
      ),
    },
    {
      key: 'enabled',
      label: 'Status',
      width: 'w-28',
      render: (d) => (
        <Pill
          label={d.enabled ? 'enabled' : 'paused'}
          color={d.enabled ? 'var(--status-good)' : undefined}
        />
      ),
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      <PlanGated error={drains.error} feature="Log drains">
        <Panel
          title="Log drains"
          description="Send this app's runtime logs to your own HTTP endpoint or OpenTelemetry collector."
          actions={
            <Button size="sm" className="gap-1.5" onClick={() => setAdding(true)}>
              <Plus className="h-3.5 w-3.5" />
              Add destination
            </Button>
          }
          padded={false}
        >
          <ResourceTable
            rows={rows}
            columns={columns}
            emptyMessage="No log destinations yet. Logs stay in the console until you add one."
            loading={drains.isPending}
            error={drains.error}
            onRetry={() => void drains.refetch()}
            onRowClick={(d) => setSelected(d.id)}
          />
        </Panel>
      </PlanGated>
      {selected && rows.some((d) => d.id === selected) && (
        <LogDrainDetail
          slug={slug}
          drain={rows.find((d) => d.id === selected)!}
          onClose={() => setSelected(null)}
        />
      )}
      {adding && <AddLogDrain slug={slug} onClose={() => setAdding(false)} />}
    </div>
  );
}

function AddLogDrain({ slug, onClose }: { slug: string; onClose: () => void }) {
  const create = useCreateLogDrain(slug);
  const { toast } = useToast();
  const [kind, setKind] = useState<LogDrainKind>('http_json');
  const [url, setUrl] = useState('');
  const [auth, setAuth] = useState('');
  const [attempted, setAttempted] = useState(false);
  const formId = useId();
  const urlError = attempted && !validUrl(url) ? 'Enter an http(s) URL.' : undefined;
  const authError =
    attempted && auth && !/^[^:\s]+:\s*\S/.test(auth)
      ? 'Use one "Name: value" pair, for example "Authorization: Bearer …".'
      : undefined;
  const submit = async () => {
    setAttempted(true);
    if (!validUrl(url) || (auth && !/^[^:\s]+:\s*\S/.test(auth))) return;
    try {
      await create.mutateAsync({
        kind,
        target_url: url.trim(),
        ...(auth ? { auth_header: auth } : {}),
        enabled: true,
      });
      toast({ kind: 'success', title: 'Log destination added' });
      onClose();
    } catch (err) {
      toast({ kind: 'error', title: 'Could not add', description: errorMessage(err) });
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Add a log destination"
      description="Runtime logs from every instance are delivered with retries; failures show in the destination's health."
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" busy={create.isPending} onClick={() => void submit()}>
            Add destination
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="flex flex-col gap-1.5 text-xs font-medium">
          Format
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as LogDrainKind)}
            className={FIELD}
          >
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${formId}-url`} className="text-xs font-medium">
            Endpoint URL
          </label>
          <input
            id={`${formId}-url`}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://logs.example.com/ingest"
            spellCheck={false}
            aria-invalid={urlError ? true : undefined}
            aria-describedby={urlError ? `${formId}-url-error` : undefined}
            className={cn(FIELD, 'font-mono')}
          />
          {urlError && <FieldError id={`${formId}-url-error`}>{urlError}</FieldError>}
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${formId}-auth`} className="text-xs font-medium">
            Auth header (optional)
          </label>
          <input
            id={`${formId}-auth`}
            value={auth}
            onChange={(event) => setAuth(event.target.value)}
            placeholder="Authorization: Bearer …"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={authError ? true : undefined}
            aria-describedby={`${formId}-auth-hint${authError ? ` ${formId}-auth-error` : ''}`}
            className={cn(FIELD, 'font-mono')}
          />
          <span id={`${formId}-auth-hint`} className="text-xs text-muted-foreground">
            Sealed when saved and never shown again.
          </span>
          {authError && <FieldError id={`${formId}-auth-error`}>{authError}</FieldError>}
        </div>
      </form>
    </Modal>
  );
}

function LogDrainDetail({
  slug,
  drain,
  onClose,
}: {
  slug: string;
  drain: LogDrain;
  onClose: () => void;
}) {
  const [window, setWindow] = useState<LogDrainWindow>('24h');
  const health = useLogDrainHealth(slug, drain.id);
  const analytics = useLogDrainAnalytics(slug, drain.id, window);
  const update = useUpdateLogDrain(slug);
  const remove = useDeleteLogDrain(slug);
  const confirm = useConfirm();
  const { toast } = useToast();
  const h = health.data;
  const points = (analytics.data?.buckets ?? []).map((b) => ({
    at: new Date(b.start).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit' }),
    delivered: b.delivered,
    failed: b.failed + b.dropped,
  }));
  const setEnabled = (enabled: boolean) =>
    void update
      .mutateAsync({ id: drain.id, body: { enabled } })
      .catch((err: unknown) =>
        toast({ kind: 'error', title: 'Could not update', description: errorMessage(err) })
      );
  return (
    <Panel
      title={drain.target_url}
      description={KINDS.find((k) => k.value === drain.kind)?.label ?? drain.kind}
      actions={
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs">
            <Switch
              checked={drain.enabled}
              onCheckedChange={setEnabled}
              aria-label="Deliver logs to this destination"
            />
            {drain.enabled ? 'Enabled' : 'Paused'}
          </label>
          <Button
            size="xs"
            variant="outline"
            className="gap-1"
            onClick={async () => {
              if (
                !(await confirm({
                  title: 'Delete this log destination?',
                  description:
                    'Logs stop being delivered to it immediately. Logs already delivered are unaffected.',
                  confirmLabel: 'Delete destination',
                  destructive: true,
                }))
              )
                return;
              void remove
                .mutateAsync(drain.id)
                .then(() => {
                  toast({ kind: 'success', title: 'Log destination deleted' });
                  onClose();
                })
                .catch((err: unknown) =>
                  toast({
                    kind: 'error',
                    title: 'Could not delete',
                    description: errorMessage(err),
                  })
                );
            }}
          >
            <Trash className="h-3.5 w-3.5" />
            Delete
          </Button>
          <Button size="xs" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {h ? (
          <>
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <span
                aria-hidden
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: HEALTH[h.status] ?? HEALTH.unknown }}
              />
              <span className="font-medium">{h.status}</span>
              {h.last_error && <span className="text-muted-foreground">{h.last_error}</span>}
            </p>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile label="Delivered" value={h.delivered_total.toLocaleString()} />
              <StatTile label="Failed" value={h.failed_total.toLocaleString()} />
              <StatTile label="Dropped" value={h.dropped_total.toLocaleString()} />
              <StatTile label="Queue" value={`${h.queue_depth} / ${h.queue_capacity}`} />
            </div>
            {(h.dead_letter_total > 0 || h.gaps_total > 0) && (
              <p className="text-xs text-muted-foreground">
                {h.dead_letter_total} records dead-lettered · {h.gaps_total} stream gaps
              </p>
            )}
          </>
        ) : (
          <InlinePhase
            phase={queryPhase({ error: health.error, loading: health.isPending })}
            error={health.error}
            loadingMessage="Reading delivery health…"
            onRetry={() => void health.refetch()}
          />
        )}
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="label-mono text-muted-foreground">Delivery</p>
            <SegmentedControl
              label="Delivery window"
              value={window}
              options={WINDOWS.map((w) => ({ key: w, label: w }))}
              onChange={setWindow}
            />
          </div>
          {points.length >= 2 ? (
            <AreaChart
              data={points}
              config={{
                delivered: { label: 'Delivered', color: 'green' },
                failed: { label: 'Failed or dropped', color: 'red' },
              }}
              className="h-40 w-full"
            >
              <Grid />
              <XAxis dataKey="at" />
              <YAxis />
              <Tooltip />
              <Area dataKey="delivered" />
              <Area dataKey="failed" />
            </AreaChart>
          ) : (
            <InlinePhase
              phase={queryPhase({
                error: analytics.error,
                loading: analytics.isPending,
                isEmpty: true,
              })}
              error={analytics.error}
              emptyMessage="Not enough delivery history in this window to draw."
              onRetry={() => void analytics.refetch()}
            />
          )}
          {analytics.data && (
            <p className="mt-2 text-xs text-muted-foreground">
              {(analytics.data.summary.success_rate * 100).toFixed(1)}% delivered ·{' '}
              {Math.round(analytics.data.summary.average_latency_ms)} ms average delivery ·{' '}
              {analytics.data.summary.retries} retries
            </p>
          )}
        </div>
      </div>
    </Panel>
  );
}
