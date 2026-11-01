import { useId, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Plus, Trash } from 'iconoir-react';
import { Area, AreaChart, Grid, Tooltip, XAxis, YAxis } from '@/components/dither-kit';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { CopyIconButton } from '@/components/ui/copy-button';
import { FIELD, FieldError, fieldErrorProps } from '@/components/ui/field';
import { IconButton } from '@/components/ui/icon-button';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { useCapability, useCapabilityAccess } from '@/lib/api/capabilities';
import {
  CUSTOM_METRIC_RANGES,
  customMetricNameError,
  customMetricValueError,
  useCustomMetricSeries,
  useCustomMetrics,
  useDeleteCustomMetric,
  usePushCustomMetric,
  type CustomMetric,
  type CustomMetricRange,
} from '@/lib/api/custom-metrics';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { cn } from '@/lib/utils';
import { CapabilityGate } from './capability-gate';
import { Timestamp } from './events/event-format';
import { InlinePhase, Panel, queryPhase } from './primitives';
import { Pill, ResourceTable, type Column } from './resource-table';
import { SegmentedControl } from './tabs';

const DOCS = '/docs/scaling-policy#custom-metrics';

/**
 * Custom metrics on App › Metrics, behind the `custom-metrics` capability so
 * an account without it never calls routes apid answers with 404.
 */
export function CustomMetricsPanel({ slug }: { slug: string }) {
  return (
    <CapabilityGate capability="custom-metrics" title="Custom metrics">
      <CustomMetricsBody slug={slug} />
    </CapabilityGate>
  );
}

type Row = CustomMetric & { id: string };

function capFull(max: number) {
  return `This app already holds ${max} metrics, the maximum. Pushing to an existing name always works; delete one to free a slot.`;
}

/**
 * Numbers only the app's own domain knows — a queue backlog, orders pending —
 * pushed by the customer's own infrastructure (faas ADR-202). apid keeps the
 * latest value per name and a scaling target can scale on it; where history
 * is recorded (ADR-745) the selected metric is charted.
 */
function CustomMetricsBody({ slug }: { slug: string }) {
  const metrics = useCustomMetrics(slug);
  const { capability } = useCapability('custom-metrics');
  const remove = useDeleteCustomMetric(slug);
  const confirm = useConfirm();
  const { toast } = useToast();
  const [pushing, setPushing] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const data = metrics.data;
  const rows: Row[] = (data?.metrics ?? []).map((m) => ({ ...m, id: m.name }));
  // The first metric is charted until another is picked; a deleted choice
  // falls back the same way.
  const selected = rows.some((r) => r.name === chosen) ? chosen : (rows[0]?.name ?? null);
  const maturity =
    capability?.maturity === 'beta' ? 'Beta' : capability?.maturity === 'preview' ? 'Preview' : '';
  const freshMinutes = data ? Math.round(data.freshness_seconds / 60) : 5;
  // A 404 past the capability gate is the app itself: it was deleted, or the
  // caller is not its creator — these routes are not in apid's organization
  // grants (faas pkg/apid/appaccess/routes.go).
  const notFound = metrics.error instanceof ApiError && metrics.error.code === 'not_found';

  const askDelete = async (name: string) => {
    const ok = await confirm({
      title: `Delete ${name}?`,
      description:
        'Its value and its slot are removed. A scaling target on this name gets no signal until something pushes it again.',
      confirmLabel: 'Delete metric',
      destructive: true,
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(name);
      toast({ kind: 'success', title: `${name} deleted` });
    } catch (err) {
      toast({ kind: 'error', title: 'Could not delete', description: errorMessage(err) });
    }
  };

  const columns: Column<Row>[] = [
    {
      key: 'name',
      label: 'Name',
      render: (m) => (
        <span className={cn('font-mono text-xs', m.name === selected && 'text-brand')}>
          {m.name}
        </span>
      ),
    },
    {
      key: 'value',
      label: 'Value',
      numeric: true,
      render: (m) => <span className="tabular-nums">{m.value.toLocaleString()}</span>,
    },
    {
      key: 'kind',
      label: 'Kind',
      width: 'w-28',
      priority: 'secondary',
      render: (m) => <span className="text-xs text-muted-foreground">{m.kind ?? 'gauge'}</span>,
    },
    {
      key: 'observed_at',
      label: 'Last push',
      render: (m) => (
        <span className="flex flex-wrap items-center gap-2 text-xs">
          <Timestamp iso={m.observed_at} />
          {m.kind === 'counter' ? (
            <span className="text-muted-foreground">never scales</span>
          ) : m.stale ? (
            <>
              <Pill label="stale" color="var(--status-warning)" />
              <span className="text-muted-foreground">not scaling</span>
            </>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <Panel
      title="Custom metrics"
      description="Numbers only your app knows, such as a queue backlog, pushed from anywhere and usable as a scaling signal."
      actions={
        <div className="flex items-center gap-2">
          {maturity && <span className="label-mono text-muted-foreground">{maturity}</span>}
          {!notFound && (
            <Button size="sm" className="gap-1.5" onClick={() => setPushing(true)}>
              <Plus className="h-3.5 w-3.5" />
              Push a value
            </Button>
          )}
        </div>
      }
    >
      {notFound ? (
        <p role="status" className="text-sm text-muted-foreground">
          Custom metrics for this app could not be found. The app may have been deleted, or it
          belongs to a company workspace: only the account that created the app can read and push
          its custom metrics.
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {data && (
            <p className="text-xs text-muted-foreground">
              {data.metrics.length} of {data.max_metrics} metrics · values older than {freshMinutes}{' '}
              minutes stop driving scaling
            </p>
          )}
          <ResourceTable
            rows={rows}
            columns={columns}
            emptyMessage="No custom metrics yet. The first push of a name creates it."
            loading={metrics.isPending}
            error={metrics.error}
            onRetry={() => void metrics.refetch()}
            onRowClick={(m) => setChosen(m.name)}
            rowActions={(m) => (
              <IconButton
                aria-label={`Delete ${m.name}`}
                onClick={() => void askDelete(m.name)}
                className="text-muted-foreground hover:text-foreground"
              >
                <Trash className="h-3.5 w-3.5" />
              </IconButton>
            )}
          />
          {selected && (
            <MetricHistory slug={slug} metric={rows.find((r) => r.name === selected)!} />
          )}
          <PushInstructions slug={slug} name={selected ?? 'orders_pending'} />
        </div>
      )}
      {pushing && data && (
        <PushMetric
          slug={slug}
          existing={data.metrics.map((m) => m.name)}
          max={data.max_metrics}
          onClose={() => setPushing(false)}
        />
      )}
    </Panel>
  );
}

function MetricHistory({ slug, metric }: { slug: string; metric: CustomMetric }) {
  const [range, setRange] = useState<CustomMetricRange>('24h');
  const { access } = useCapabilityAccess('custom-metric-history');
  const series = useCustomMetricSeries(slug, metric.name, range, { enabled: access === 'on' });
  const degraded = Boolean(series.data && series.data.source !== 'prometheus');
  const points = (series.data?.points ?? []).map((p) => ({
    at: new Date(p.at).toLocaleString([], {
      month: range === '7d' || range === '15d' ? 'short' : undefined,
      day: range === '7d' || range === '15d' ? 'numeric' : undefined,
      hour: '2-digit',
      minute: '2-digit',
    }),
    value: p.value,
  }));
  const counter = (series.data?.kind ?? metric.kind) === 'counter';
  const off =
    series.error instanceof ApiError && series.error.code === 'custom_metric_history_unavailable';

  let body;
  if (access !== 'on') {
    body = (
      <p className="text-sm text-muted-foreground">
        {access === 'loading'
          ? 'Checking availability…'
          : 'History is not enabled for this account; the latest value above is what scaling reads.'}
      </p>
    );
  } else if (off) {
    body = (
      <p className="text-sm text-muted-foreground">
        History is not recorded on this installation; the latest value above is what scaling reads.
      </p>
    );
  } else if (degraded) {
    body = (
      <p role="status" className="text-sm text-muted-foreground">
        History could not be read ({series.data?.source.replace(/^degraded:\s*/, '')}). Pushes are
        still stored and still drive scaling.
      </p>
    );
  } else if (points.length >= 2) {
    body = (
      <AreaChart
        data={points}
        config={{ value: { label: counter ? 'per second' : metric.name, color: 'green' } }}
        className="h-44 w-full"
      >
        <Grid />
        <XAxis dataKey="at" />
        <YAxis />
        <Tooltip />
        <Area dataKey="value" />
      </AreaChart>
    );
  } else {
    body = (
      <InlinePhase
        phase={queryPhase({ error: series.error, loading: series.isPending, isEmpty: true })}
        error={series.error}
        loadingMessage="Reading history…"
        emptyMessage="Not enough history in this window to draw. Only fresh pushes are recorded."
        onRetry={() => void series.refetch()}
      />
    );
  }

  return (
    <section aria-label={`${metric.name} history`}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="label-mono text-muted-foreground">
          <span className="font-mono normal-case">{metric.name}</span> history
        </p>
        {access === 'on' && !off && (
          <SegmentedControl
            label="History range"
            value={range}
            options={CUSTOM_METRIC_RANGES.map((r) => ({ key: r, label: r }))}
            onChange={setRange}
          />
        )}
      </div>
      {body}
      {access === 'on' && !off && !degraded && points.length >= 2 && (
        <p className="mt-1 text-xs text-muted-foreground">
          {counter && 'A counter is drawn as its per-second rate over 5 minutes. '}
          Only fresh pushes are recorded, for 15 days.
        </p>
      )}
    </section>
  );
}

/** The push request apid documents (docs/scaling-policy.md), for this app. */
function PushInstructions({ slug, name }: { slug: string; name: string }) {
  // apid is served from the console's own origin (lib/api/client.ts).
  const url = `${window.location.origin}/v1/apps/${slug}/custom-metrics/${name}`;
  const command = `curl -X PUT ${url} -H 'Authorization: Bearer <METRICS_KEY>' -H 'Content-Type: application/json' -d '{"value": 1284}'`;
  return (
    <section aria-label="Push from your own code" className="flex flex-col gap-2">
      <p className="label-mono text-muted-foreground">Push from a cron, a trigger or your app</p>
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2">
        <code className="min-w-0 break-all font-mono text-xs text-foreground">{command}</code>
        <CopyIconButton text={command} label="push command" />
      </div>
      <p className="text-xs text-muted-foreground">
        Use an{' '}
        <Link
          to="/dashboard/settings"
          search={{ section: 'api-keys' }}
          className="text-brand underline-offset-4 hover:underline"
        >
          API key
        </Link>{' '}
        with the <code className="font-mono">metrics:write</code> scope. The value is the fleet-wide
        total; scale on it with <code className="font-mono">metric: custom</code> in the app’s
        scaling targets.{' '}
        <a className="text-brand underline-offset-4 hover:underline" href={DOCS}>
          Scaling on custom metrics
        </a>
      </p>
    </section>
  );
}

function PushMetric({
  slug,
  existing,
  max,
  onClose,
}: {
  slug: string;
  existing: string[];
  max: number;
  onClose: () => void;
}) {
  const push = usePushCustomMetric(slug);
  const { toast } = useToast();
  const id = useId();
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const trimmed = name.trim();
  // apid upserts an existing name and refuses only a NEW one at the cap.
  const atCap = existing.length >= max && !existing.includes(trimmed);
  const nameError = attempted
    ? (customMetricNameError(trimmed) ?? (atCap ? capFull(max) : undefined))
    : undefined;
  const valueError = attempted ? customMetricValueError(value) : undefined;
  const code = failure instanceof ApiError ? failure.code : undefined;

  const submit = async () => {
    setAttempted(true);
    setFailure(null);
    if (customMetricNameError(trimmed) || atCap || customMetricValueError(value)) return;
    try {
      await push.mutateAsync({ name: trimmed, value: Number(value) });
      toast({ kind: 'success', title: `${trimmed} pushed` });
      onClose();
    } catch (err) {
      setFailure(err);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Push a value"
      description="Creates the metric on its first push and replaces its value after that."
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" busy={push.isPending} onClick={() => void submit()}>
            Push value
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
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-name`} className="text-xs font-medium">
            Name
          </label>
          <input
            id={`${id}-name`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="orders_pending"
            list={`${id}-names`}
            autoComplete="off"
            spellCheck={false}
            {...fieldErrorProps(nameError, `${id}-name-error`)}
            className={cn(FIELD, 'font-mono')}
          />
          <datalist id={`${id}-names`}>
            {existing.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          {nameError && <FieldError id={`${id}-name-error`}>{nameError}</FieldError>}
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-value`} className="text-xs font-medium">
            Value
          </label>
          <input
            id={`${id}-value`}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="1284"
            inputMode="decimal"
            autoComplete="off"
            {...fieldErrorProps(valueError, `${id}-value-error`)}
            className={cn(FIELD, 'font-mono')}
          />
          <span className="text-xs text-muted-foreground">
            The fleet-wide total; a scaling target divides it by its per-instance value.
          </span>
          {valueError && <FieldError id={`${id}-value-error`}>{valueError}</FieldError>}
        </div>
        {failure !== null && (
          <p role="alert" className="text-xs" style={{ color: 'var(--status-critical)' }}>
            {code === 'custom_metric_limit' ? capFull(max) : errorMessage(failure)}{' '}
            {code === 'plan_custom_metrics_not_allowed' && (
              <Link to="/dashboard/plans" className="text-brand underline">
                Compare plans
              </Link>
            )}
          </p>
        )}
      </form>
    </Modal>
  );
}
