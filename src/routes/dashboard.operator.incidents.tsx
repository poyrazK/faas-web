import { useMemo, useState, type ReactNode } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { CheckCircle, RefreshDouble, Server, ShieldCheck, WarningTriangle } from 'iconoir-react';
import {
  ErrorState,
  LoadingState,
  PageHeader,
  Panel,
  StatTile,
} from '@/components/dashboard/primitives';
import { Pill, ResourceTable, type Column } from '@/components/dashboard/resource-table';
import {
  OperatorBuildSweepDialog,
  OperatorLifecycleDialog,
  type OperatorLifecycleTarget,
} from '@/components/dashboard/operator-operations';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import {
  type OperatorAnomalyList,
  type OperatorAuditLog,
  type OperatorBuilderHeartbeats,
  type OperatorEvents,
  type OperatorNode,
  type OperatorWakeLatency,
  type OperatorRateLimits,
  useOperatorAnomalies,
  useOperatorAuditLog,
  useOperatorBuilderHeartbeats,
  useOperatorEvents,
  useOperatorNodeHeartbeats,
  useOperatorNodes,
  useOperatorOverview,
  useOperatorRateLimits,
  useOperatorWakeLatency,
} from '@/lib/api/queries';
import { formatRelative } from '@/lib/mock-data';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/operator/incidents')({
  component: IncidentsPage,
  head: () =>
    consoleHead(
      'operator incident center',
      'Investigate platform health and perform guarded fleet operations.'
    ),
});

const STATE_COLOR: Record<string, string> = {
  active: 'var(--status-good)',
  inactive: 'var(--chart-muted)',
  critical: 'var(--status-critical)',
  warning: 'var(--status-warning)',
};

function formatWhen(value: string | undefined | null): string {
  if (!value) return '—';
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? '—' : formatRelative(timestamp);
}

function formatBytes(value: number | null | undefined): string {
  if (value == null) return '—';
  if (value < 1024 ** 3) {
    return `${(value / 1024 ** 2).toLocaleString(undefined, { maximumFractionDigits: 1 })} MB`;
  }
  return `${(value / 1024 ** 3).toLocaleString(undefined, { maximumFractionDigits: 1 })} GB`;
}

function jsonPreview(value: unknown): string {
  if (value == null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable data]';
  }
}

function QueryState({
  pending,
  error,
  children,
}: {
  pending: boolean;
  error: unknown;
  children: ReactNode;
}) {
  if (pending) return <LoadingState message="Loading operational signals…" />;
  if (error) return <ErrorState error={error} />;
  return <>{children}</>;
}

function HeartbeatHistoryModal({ name, onClose }: { name: string | null; onClose: () => void }) {
  const history = useOperatorNodeHeartbeats(name ?? '', 200);
  return (
    <Modal
      open={Boolean(name)}
      onClose={onClose}
      title={name ? `${name} heartbeat history` : 'Heartbeat history'}
      description="Append-only liveness history with gap classification from the control plane."
      width="max-w-4xl"
    >
      {history.isPending ? (
        <LoadingState message="Loading heartbeat history…" />
      ) : history.error ? (
        <ErrorState error={history.error} onRetry={() => void history.refetch()} />
      ) : history.data ? (
        <div className="max-h-[65vh] overflow-y-auto">
          <div className="mb-4 flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>
              Since {new Date(history.data.since).toLocaleString()}
              {history.data.since_clamped ? ' · window capped at 24h' : ''}
            </span>
            <span>{history.data.heartbeats.length} rows</span>
          </div>
          {history.data.heartbeats.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">No heartbeat rows in this window.</p>
          ) : (
            <div className="divide-y divide-border rounded-lg border border-border">
              {history.data.heartbeats.map((heartbeat, index) => (
                <div
                  key={`${heartbeat.received_at}-${index}`}
                  className="flex items-center gap-3 px-4 py-3 text-xs"
                >
                  {heartbeat.stale || heartbeat.missed ? (
                    <WarningTriangle
                      className="h-4 w-4 shrink-0"
                      style={{ color: STATE_COLOR.critical }}
                    />
                  ) : (
                    <CheckCircle
                      className="h-4 w-4 shrink-0"
                      style={{ color: STATE_COLOR.active }}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-mono">{new Date(heartbeat.received_at).toLocaleString()}</p>
                    <p className="mt-1 text-muted-foreground">
                      {heartbeat.source} · gap {heartbeat.gap_to_previous_ms} ms
                    </p>
                  </div>
                  <Pill
                    label={heartbeat.stale ? 'stale' : heartbeat.missed ? 'missed' : 'healthy'}
                    color={
                      heartbeat.stale || heartbeat.missed
                        ? STATE_COLOR.critical
                        : STATE_COLOR.active
                    }
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </Modal>
  );
}

function NodeOperations({
  nodes,
  onAction,
  onHistory,
}: {
  nodes: OperatorNode[];
  onAction: (target: OperatorLifecycleTarget) => void;
  onHistory: (name: string) => void;
}) {
  const rows = useMemo(() => nodes.map((node) => ({ ...node, id: node.id })), [nodes]);
  const columns: Column<OperatorNode>[] = [
    {
      key: 'name',
      label: 'Node',
      render: (row) => (
        <div>
          <p className="font-mono text-xs">{row.name}</p>
          <p className="mt-1 text-[10px] text-muted-foreground">{row.id.slice(0, 12)}…</p>
        </div>
      ),
    },
    {
      key: 'active',
      label: 'State',
      render: (row) => (
        <Pill
          label={row.active ? 'Active' : 'Inactive'}
          color={row.active ? STATE_COLOR.active : STATE_COLOR.inactive}
        />
      ),
    },
    {
      key: 'last_heartbeat_at',
      label: 'Heartbeat',
      render: (row) => formatWhen(row.last_heartbeat_at),
    },
    {
      key: 'cpu_pct_60s',
      label: 'CPU',
      numeric: true,
      render: (row) => (row.cpu_pct_60s == null ? '—' : `${row.cpu_pct_60s.toFixed(1)}%`),
    },
    { key: 'instances_live', label: 'Live VMs', numeric: true },
    {
      key: 'name',
      label: 'Actions',
      sortable: false,
      render: (row) => (
        <div className="flex flex-wrap gap-1.5">
          <Button size="xs" variant="ghost" onClick={() => onHistory(row.name)}>
            History
          </Button>
          {row.active ? (
            <>
              <Button
                size="xs"
                variant="outline"
                onClick={() =>
                  onAction({ kind: 'node', name: row.name, action: 'drain', label: row.name })
                }
              >
                Drain
              </Button>
              <Button
                size="xs"
                variant="destructive"
                onClick={() =>
                  onAction({ kind: 'node', name: row.name, action: 'force-drain', label: row.name })
                }
              >
                Force-drain
              </Button>
            </>
          ) : (
            <Button
              size="xs"
              variant="outline"
              onClick={() =>
                onAction({ kind: 'node', name: row.name, action: 'activate', label: row.name })
              }
            >
              Activate
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <ResourceTable
      rows={rows}
      columns={columns}
      initialSort={{ key: 'name', dir: 'asc' }}
      searchKeys={['name', 'active']}
      searchPlaceholder="Filter by node or state…"
      emptyMessage="No compute nodes are registered."
      minWidth="min-w-[980px]"
    />
  );
}

function BuilderHealth({
  data,
  nodes,
}: {
  data: OperatorBuilderHeartbeats;
  nodes: OperatorNode[];
}) {
  const nodeNames = useMemo(() => new Map(nodes.map((node) => [node.id, node.name])), [nodes]);
  return (
    <Panel
      title="Builder fleet"
      description="Builderd heartbeats are independent from queue depth, so an idle builder remains observable."
      padded={false}
    >
      <div className="border-b border-border px-5 py-4">
        <p className="label-mono text-muted-foreground">Queued builds</p>
        <p className="mt-2 text-2xl font-semibold [font-variant-numeric:tabular-nums]">
          {data.queued_builds}
        </p>
      </div>
      {data.items.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">
          No builder heartbeat has arrived yet. Check builderd registration on the compute node.
        </p>
      ) : (
        <div className="divide-y divide-border">
          {data.items.map((item) => (
            <div key={item.node_id} className="flex items-center gap-3 px-5 py-3 text-xs">
              <Server className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="font-mono">
                  {nodeNames.get(item.node_id) ?? item.node_id.slice(0, 16)}
                </p>
                <p className="mt-1 text-muted-foreground">
                  last tick {formatWhen(item.received_at)}
                </p>
              </div>
              <div className="text-right text-muted-foreground">
                <p>{item.cpu_pct_60s == null ? 'CPU —' : `CPU ${item.cpu_pct_60s.toFixed(1)}%`}</p>
                <p className="mt-1">disk {formatBytes(item.disk_used_bytes)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function WakeLatency({ data }: { data: OperatorWakeLatency }) {
  return (
    <Panel
      title="Wake latency"
      description={`Per-node quantiles over ${data.window}; fleet p95 is ${data.fleet_p95_ms.toFixed(1)} ms.`}
      padded={false}
    >
      {data.quantiles.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">
          No wake samples in the current window.
        </p>
      ) : (
        <div className="divide-y divide-border">
          {data.quantiles.map((row) => (
            <div key={row.node_id} className="grid grid-cols-4 gap-3 px-5 py-3 text-xs">
              <span className="col-span-1 truncate font-mono">
                {row.node_name || row.node_id.slice(0, 12)}
              </span>
              <span>p50 {row.p50_ms.toFixed(1)} ms</span>
              <span>p95 {row.p95_ms.toFixed(1)} ms</span>
              <span className="text-right text-muted-foreground">{row.sample_count} samples</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function AnomalyPanel({ data }: { data: OperatorAnomalyList }) {
  return (
    <Panel
      title="Traffic anomalies"
      description={`Last ${data.window_hours}h against a ${data.baseline_window_days}-day baseline, grouped by ${data.group_by}.`}
      padded={false}
    >
      {data.items.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">No anomalies detected.</p>
      ) : (
        <div className="divide-y divide-border">
          {data.items.map((row, index) => (
            <div
              key={`${row.app_id}-${row.minute}-${index}`}
              className="flex flex-wrap items-center gap-3 px-5 py-3 text-xs"
            >
              <WarningTriangle
                className="h-4 w-4 shrink-0"
                style={{ color: STATE_COLOR.warning }}
              />
              <div className="min-w-0 flex-1">
                <p className="font-mono">{row.node_name || row.app_id.slice(0, 16)}</p>
                <p className="mt-1 text-muted-foreground">
                  account {row.account_id.slice(0, 12)} · {formatWhen(row.minute)} · {row.reason}
                </p>
              </div>
              <Pill
                label={`z ${row.z_score == null ? '—' : row.z_score.toFixed(1)}`}
                color={STATE_COLOR.warning}
              />
              <span className="font-mono">{row.current.toFixed(0)} current</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function RateLimitPanel({ data }: { data: OperatorRateLimits }) {
  return (
    <Panel
      title="Rate-limit signals"
      description={`Durable data covers ${data.window_hours}h and can lag by ${data.lag_seconds}s; live rows are this apid process.`}
      padded={false}
    >
      <div className="grid gap-5 p-5 lg:grid-cols-2">
        <div>
          <p className="label-mono text-muted-foreground">Durable account buckets</p>
          {data.durable.length === 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">No durable rate-limit events.</p>
          ) : (
            <div className="mt-3 divide-y divide-border rounded-lg border border-border">
              {data.durable.slice(0, 8).map((row) => (
                <div
                  key={row.account_id}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
                >
                  <span className="font-mono">{row.account_id.slice(0, 16)}…</span>
                  <span>{row.hits} hits</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <p className="label-mono text-muted-foreground">Live IP buckets</p>
          {data.live.length === 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">No live limiter buckets.</p>
          ) : (
            <div className="mt-3 divide-y divide-border rounded-lg border border-border">
              {data.live.slice(0, 8).map((row) => (
                <div
                  key={row.ip}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
                >
                  <span className="font-mono">{row.ip}</span>
                  <Pill
                    label={
                      row.currently_rate_limited
                        ? `${row.live_hits_30s} blocked`
                        : `${row.live_hits_30s} hits`
                    }
                    color={row.currently_rate_limited ? STATE_COLOR.critical : undefined}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

function ActivityPanel({ audit, events }: { audit: OperatorAuditLog; events: OperatorEvents }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel
        title="Operator audit evidence"
        description="Structured operator actions from the last 24 hours."
        padded={false}
      >
        {audit.items.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            No operator audit actions found.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {audit.items.slice(0, 12).map((row) => (
              <details key={row.id} className="group px-5 py-3 text-xs">
                <summary className="flex cursor-pointer list-none items-center gap-3">
                  {row.is_operator_action ? (
                    <ShieldCheck
                      className="h-4 w-4 shrink-0"
                      style={{ color: STATE_COLOR.active }}
                    />
                  ) : (
                    <CheckCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1 truncate font-mono">{row.kind}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {formatWhen(row.received_at)}
                  </span>
                </summary>
                <p className="mt-2 break-all rounded bg-muted/40 px-3 py-2 font-mono text-[10px] text-muted-foreground">
                  {jsonPreview(row.data) || 'No additional data'}
                </p>
              </details>
            ))}
          </div>
        )}
      </Panel>
      <Panel
        title="Live platform events"
        description="Recent controller and daemon events from the events table."
        padded={false}
      >
        {events.items.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">No live events found.</p>
        ) : (
          <div className="divide-y divide-border">
            {events.items.slice(0, 12).map((row) => (
              <details key={String(row.id)} className="group px-5 py-3 text-xs">
                <summary className="flex cursor-pointer list-none items-center gap-3">
                  <RefreshDouble className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate font-mono">{row.kind}</span>
                  <span className="shrink-0 text-muted-foreground">{formatWhen(row.at)}</span>
                </summary>
                <p className="mt-2 break-all rounded bg-muted/40 px-3 py-2 font-mono text-[10px] text-muted-foreground">
                  actor {row.actor || '—'} · subject {row.subject || '—'}
                  {row.data ? ` · ${jsonPreview(row.data)}` : ''}
                </p>
              </details>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function IncidentsPage() {
  const overview = useOperatorOverview();
  const nodes = useOperatorNodes(true);
  const wakeLatency = useOperatorWakeLatency();
  const anomalies = useOperatorAnomalies();
  const rateLimits = useOperatorRateLimits();
  const audit = useOperatorAuditLog();
  const events = useOperatorEvents();
  const builders = useOperatorBuilderHeartbeats();
  const [lifecycle, setLifecycle] = useState<OperatorLifecycleTarget | null>(null);
  const [historyNode, setHistoryNode] = useState<string | null>(null);
  const [sweepOpen, setSweepOpen] = useState(false);

  const queries = [overview, nodes, wakeLatency, anomalies, rateLimits, audit, events, builders];
  const pending = queries.some((query) => query.isPending);
  const error = queries.find((query) => query.error)?.error;
  const retry = () => queries.forEach((query) => void query.refetch());
  const staleNodes = overview.data?.node_health.filter((node) => node.stale).length ?? 0;
  const liveRateLimited =
    rateLimits.data?.live.filter((row) => row.currently_rate_limited).length ?? 0;
  const nodeRows = nodes.data?.items ?? [];
  const tileState = error
    ? ('unavailable' as const)
    : pending
      ? ('loading' as const)
      : ('ready' as const);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Incident center"
        description="See why the platform is unhealthy, correlate the evidence, and perform guarded operations without SSH."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="destructive" onClick={() => setSweepOpen(true)}>
              Sweep stuck builds
            </Button>
            <Button size="sm" variant="outline" onClick={retry} disabled={pending}>
              <RefreshDouble className={pending ? 'animate-spin' : ''} /> Refresh
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile
          label="Stale nodes"
          value={`${staleNodes}`}
          state={tileState}
          tone={staleNodes ? 'red' : undefined}
        />
        <StatTile
          label="Queued builds"
          value={builders.data ? `${builders.data.queued_builds}` : undefined}
          state={tileState}
        />
        <StatTile
          label="Anomalies"
          value={anomalies.data ? `${anomalies.data.items.length}` : undefined}
          state={tileState}
          tone={anomalies.data?.items.length ? 'red' : undefined}
        />
        <StatTile
          label="Blocked IPs"
          value={`${liveRateLimited}`}
          state={tileState}
          tone={liveRateLimited ? 'red' : undefined}
        />
        <StatTile
          label="Fleet wake p95"
          value={wakeLatency.data ? `${wakeLatency.data.fleet_p95_ms.toFixed(1)} ms` : undefined}
          state={tileState}
        />
      </div>

      {error && !pending && <ErrorState error={error} onRetry={retry} />}

      <Panel
        title="Fleet lifecycle"
        description="Drain, force-drain, or activate nodes with MFA, confirmation, and an audit reason."
        lit
        padded={false}
      >
        <div className="p-5">
          <QueryState pending={nodes.isPending} error={nodes.error}>
            <NodeOperations nodes={nodeRows} onAction={setLifecycle} onHistory={setHistoryNode} />
          </QueryState>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <QueryState pending={builders.isPending} error={builders.error}>
          {builders.data ? <BuilderHealth data={builders.data} nodes={nodeRows} /> : null}
        </QueryState>
        <QueryState pending={wakeLatency.isPending} error={wakeLatency.error}>
          {wakeLatency.data ? <WakeLatency data={wakeLatency.data} /> : null}
        </QueryState>
      </div>

      <QueryState pending={anomalies.isPending} error={anomalies.error}>
        {anomalies.data ? <AnomalyPanel data={anomalies.data} /> : null}
      </QueryState>
      <QueryState pending={rateLimits.isPending} error={rateLimits.error}>
        {rateLimits.data ? <RateLimitPanel data={rateLimits.data} /> : null}
      </QueryState>
      <QueryState pending={audit.isPending || events.isPending} error={audit.error ?? events.error}>
        {audit.data && events.data ? (
          <ActivityPanel audit={audit.data} events={events.data} />
        ) : null}
      </QueryState>

      <OperatorLifecycleDialog
        key={
          lifecycle
            ? `${lifecycle.kind}-${lifecycle.kind === 'node' ? lifecycle.name : lifecycle.id}-${lifecycle.action}`
            : 'lifecycle-closed'
        }
        target={lifecycle}
        onClose={() => setLifecycle(null)}
        onCompleted={retry}
      />
      <HeartbeatHistoryModal name={historyNode} onClose={() => setHistoryNode(null)} />
      <OperatorBuildSweepDialog open={sweepOpen} onClose={() => setSweepOpen(false)} />
    </div>
  );
}
