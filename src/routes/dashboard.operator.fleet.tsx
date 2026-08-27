import { useMemo, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowRight, RefreshDouble, Server, ShieldCheck, WarningTriangle } from 'iconoir-react';
import {
  ErrorState,
  LoadingState,
  PageHeader,
  Panel,
  StatTile,
} from '@/components/dashboard/primitives';
import { Pill, ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import {
  OperatorIntentDialog,
  OperatorRecoveryDialog,
  type RecoveryTarget,
} from '@/components/dashboard/operator-recovery';
import {
  type OperatorInstance,
  type OperatorNode,
  useOperatorAppDetail,
  useOperatorCapacity,
  useOperatorNodeDetail,
  useOperatorNodes,
  useOperatorOverview,
} from '@/lib/api/queries';
import { formatRelative } from '@/lib/mock-data';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/operator/fleet')({
  component: FleetPage,
  head: () =>
    consoleHead('operator fleet', 'Inspect nodes, capacity, and live workload placement.'),
});

const STATE_COLOR: Record<string, string> = {
  RUNNING: 'var(--status-good)',
  WAKING: 'var(--status-warning)',
  COLD_BOOTING: 'var(--status-warning)',
  PARKED: 'var(--chart-muted)',
  STOPPED: 'var(--chart-muted)',
  FAILED: 'var(--status-critical)',
};

function formatWhen(value: string | undefined | null): string {
  if (!value) return '—';
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? '—' : formatRelative(timestamp);
}

function formatMB(value: number): string {
  if (value < 1024) return `${value.toLocaleString()} MB`;
  return `${(value / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} GB`;
}

function formatBytes(value: number | null | undefined): string {
  if (value == null) return '—';
  if (value < 1024 ** 3)
    return `${(value / 1024 ** 2).toLocaleString(undefined, { maximumFractionDigits: 1 })} MB`;
  return `${(value / 1024 ** 3).toLocaleString(undefined, { maximumFractionDigits: 1 })} GB`;
}

interface CapacityRow {
  id: string;
  name: string;
  active: string;
  vcpus: string;
  memory: number;
  used: number;
  headroom: number;
  instances: number;
  apps: number;
  tenants: number;
}

function NodeDetailModal({
  name,
  onClose,
  onRecovery,
  onAppDetail,
}: {
  name: string | null;
  onClose: () => void;
  onRecovery: (target: RecoveryTarget) => void;
  onAppDetail: (id: string) => void;
}) {
  const detail = useOperatorNodeDetail(name ?? '');
  const node = detail.data?.node;

  return (
    <Modal
      open={Boolean(name)}
      onClose={onClose}
      title={node ? `Node ${node.name}` : name ? `Node ${name}` : 'Node'}
      description="Live workload placement and drain safety from the operator projection."
      width="max-w-5xl"
    >
      {detail.isPending ? (
        <LoadingState message="Loading node workloads…" />
      ) : detail.error ? (
        <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
      ) : detail.data ? (
        <div className="flex max-h-[70vh] flex-col gap-5 overflow-y-auto">
          <div className="grid gap-3 sm:grid-cols-4">
            <Metric label="State" value={node?.active ? 'Active' : 'Inactive'} />
            <Metric label="Heartbeat" value={formatWhen(node?.last_heartbeat_at)} />
            <Metric
              label="CPU (60s)"
              value={node?.cpu_pct_60s == null ? '—' : `${node.cpu_pct_60s.toFixed(1)}%`}
            />
            <Metric label="Drain" value={detail.data.drain.drain_safe ? 'Safe' : 'Not safe'} />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Panel title="Node capacity" padded>
              <dl className="grid grid-cols-2 gap-x-5 gap-y-3">
                <Metric label="vCPUs" value={`${node?.vcpus ?? 0}`} />
                <Metric label="Max concurrency" value={`${node?.max_concurrency ?? 0}`} />
                <Metric label="Memory" value={formatMB(node?.mem_mb ?? 0)} />
                <Metric label="RAM used" value={formatMB(node?.ram_used_mb ?? 0)} />
                <Metric label="Headroom" value={formatMB(node?.admission_margin_mb ?? 0)} />
                <Metric label="Disk" value={formatBytes(node?.disk_used_bytes)} />
                <Metric label="Instances" value={`${detail.data.drain.live_instances} live`} />
              </dl>
            </Panel>
            <Panel title="Drain readiness" padded>
              <div className="flex items-start gap-3">
                {detail.data.drain.drain_safe ? (
                  <ShieldCheck className="mt-0.5 h-4 w-4" style={{ color: 'var(--status-good)' }} />
                ) : (
                  <WarningTriangle
                    className="mt-0.5 h-4 w-4"
                    style={{ color: 'var(--status-warning)' }}
                  />
                )}
                <div>
                  <p className="text-sm font-medium">
                    {detail.data.drain.drain_safe
                      ? 'No live workloads observed'
                      : 'Workloads still placed'}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {detail.data.drain.total_instances} total ·{' '}
                    {detail.data.drain.running_instances} running ·{' '}
                    {detail.data.drain.waking_instances} waking ·{' '}
                    {detail.data.drain.cold_booting_instances} cold booting
                  </p>
                </div>
              </div>
            </Panel>
          </div>

          <Panel title="Apps on this node" padded={false}>
            {detail.data.apps.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted-foreground">No apps currently placed.</p>
            ) : (
              <div className="divide-y divide-border">
                {detail.data.apps.map((app) => (
                  <div
                    key={app.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-mono text-xs">{app.slug}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {app.instances_live} live · {formatMB(app.ram_used_mb)} · tenant{' '}
                        {app.account_id.slice(0, 8)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Button variant="outline" size="xs" onClick={() => onAppDetail(app.id)}>
                        Details
                      </Button>
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() =>
                          onRecovery({ kind: 'force-cold-boot', slug: app.slug, label: app.slug })
                        }
                      >
                        Cold boot next wake
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Live instances" padded={false}>
            {detail.data.instances.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted-foreground">
                No live instances currently placed.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      {['App', 'State', 'RAM', 'Last request', 'Recovery'].map((heading) => (
                        <th key={heading} className="label-mono px-4 py-3 text-muted-foreground">
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {detail.data.instances.map((instance) => (
                      <InstanceTableRow
                        key={instance.id}
                        instance={instance}
                        onRecovery={onRecovery}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      ) : null}
    </Modal>
  );
}

function AppDetailModal({
  id,
  onClose,
  onRecovery,
}: {
  id: string | null;
  onClose: () => void;
  onRecovery: (target: RecoveryTarget) => void;
}) {
  const detail = useOperatorAppDetail(id ?? '');
  const app = detail.data?.app;
  const metrics = detail.data?.health.metrics;

  return (
    <Modal
      open={Boolean(id)}
      onClose={onClose}
      title={app ? `App ${app.slug}` : 'App details'}
      description="Deployment, invocation, health, and placement context from the operator projection."
      width="max-w-5xl"
    >
      {detail.isPending ? (
        <LoadingState message="Loading app details…" />
      ) : detail.error ? (
        <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
      ) : detail.data && app && metrics ? (
        <div className="flex max-h-[72vh] flex-col gap-5 overflow-y-auto">
          <div className="grid gap-3 sm:grid-cols-5">
            <Metric label="Status" value={app.status} />
            <Metric label="Runtime" value={app.runtime || app.type} />
            <Metric label="RAM" value={formatMB(app.ram_mb)} />
            <Metric label="Live VMs" value={`${detail.data.instances.length}`} />
            <Metric label="Requests" value={metrics.request_count.toLocaleString()} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile label="p50 latency" value={`${metrics.latency_p50_ms.toFixed(1)} ms`} />
            <StatTile label="p95 latency" value={`${metrics.latency_p95_ms.toFixed(1)} ms`} />
            <StatTile
              label="Error rate"
              value={`${metrics.error_rate_pct.toFixed(2)}%`}
              tone={metrics.error_rate_pct > 0 ? 'red' : undefined}
            />
            <StatTile label="Cold starts" value={`${metrics.cold_start_pct.toFixed(2)}%`} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Deployments" padded={false}>
              <div className="divide-y divide-border">
                {detail.data.deployments.slice(0, 8).map((deployment) => (
                  <div
                    key={deployment.id}
                    className="flex items-center justify-between gap-3 px-5 py-3 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-mono">
                        {deployment.commit_sha ||
                          deployment.image_digest ||
                          deployment.id.slice(0, 12)}
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        {deployment.kind} · {formatWhen(deployment.created_at)}
                      </p>
                    </div>
                    <Pill
                      label={deployment.status}
                      color={deployment.status === 'live' ? 'var(--status-good)' : undefined}
                    />
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title="Current instances" padded={false}>
              <div className="divide-y divide-border">
                {detail.data.instances.length === 0 ? (
                  <p className="px-5 py-6 text-sm text-muted-foreground">No live instances.</p>
                ) : (
                  detail.data.instances.map((instance) => (
                    <div
                      key={instance.id}
                      className="flex items-center justify-between gap-3 px-5 py-3 text-xs"
                    >
                      <div>
                        <p className="font-mono">{instance.node_name || 'unplaced'}</p>
                        <p className="mt-1 text-muted-foreground">
                          {instance.state} · {instance.ram_mb} MB ·{' '}
                          {formatWhen(instance.last_request_at)}
                        </p>
                      </div>
                      {['RUNNING', 'WAKING', 'COLD_BOOTING'].includes(instance.state) && (
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() =>
                            onRecovery({ kind: 'force-park', id: instance.id, label: app.slug })
                          }
                        >
                          Park
                        </Button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </Panel>
          </div>

          <Panel
            title="Recent errors"
            description={`Last 24 hours · source ${metrics.source}`}
            padded={false}
          >
            {detail.data.health.errors.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted-foreground">No grouped errors observed.</p>
            ) : (
              <div className="divide-y divide-border">
                {detail.data.health.errors.map((error) => (
                  <div
                    key={error.fingerprint}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-mono">
                        {error.error_class} · {error.route}
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        {error.count} grouped · HTTP {error.http_status} · {error.sample_message}
                      </p>
                    </div>
                    <span className="font-mono text-muted-foreground">
                      {formatWhen(error.last_seen_at)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      ) : null}
    </Modal>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="label-mono text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate text-xs font-medium">{value}</dd>
    </div>
  );
}

function InstanceTableRow({
  instance,
  onRecovery,
}: {
  instance: OperatorInstance;
  onRecovery: (target: RecoveryTarget) => void;
}) {
  const canPark = ['RUNNING', 'WAKING', 'COLD_BOOTING'].includes(instance.state);
  const canRestart = instance.state === 'RUNNING';
  return (
    <tr>
      <td className="px-4 py-3">
        <p className="font-mono text-xs">{instance.app_slug ?? instance.app_id.slice(0, 12)}</p>
        <p className="mt-1 font-mono text-[10px] text-muted-foreground">
          {instance.id.slice(0, 12)}
        </p>
      </td>
      <td className="px-4 py-3">
        <Pill label={instance.state} color={STATE_COLOR[instance.state]} />
      </td>
      <td className="px-4 py-3 text-xs">{instance.ram_mb} MB</td>
      <td className="px-4 py-3 text-xs text-muted-foreground">
        {formatWhen(instance.last_request_at)}
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1.5">
          {canPark && (
            <Button
              variant="outline"
              size="xs"
              onClick={() =>
                onRecovery({
                  kind: 'force-park',
                  id: instance.id,
                  label: instance.app_slug ?? instance.id,
                })
              }
            >
              Park
            </Button>
          )}
          {canRestart && (
            <Button
              variant="outline"
              size="xs"
              onClick={() =>
                onRecovery({
                  kind: 'force-restart',
                  id: instance.id,
                  label: instance.app_slug ?? instance.id,
                })
              }
            >
              Restart
            </Button>
          )}
          {!canPark && !canRestart && (
            <span className="text-xs text-muted-foreground">No action</span>
          )}
        </div>
      </td>
    </tr>
  );
}

function FleetPage() {
  const overview = useOperatorOverview();
  const capacity = useOperatorCapacity();
  const nodes = useOperatorNodes();
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedApp, setSelectedApp] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<RecoveryTarget | null>(null);
  const [intentId, setIntentId] = useState<string | null>(null);

  const rows = useMemo<CapacityRow[]>(
    () =>
      (capacity.data?.nodes ?? []).map((node) => ({
        id: node.id,
        name: node.name,
        active: node.active ? 'Active' : 'Inactive',
        vcpus: `${node.vcpus} / ${node.vcpu_budget}`,
        memory: node.mem_mb,
        used: node.ram_used_mb,
        headroom: node.admission_margin_mb,
        instances: node.instances_live,
        apps: node.apps_count,
        tenants: node.tenants_count,
      })),
    [capacity.data]
  );

  const columns: Column<CapacityRow>[] = [
    {
      key: 'name',
      label: 'Node',
      render: (row) => <span className="font-mono text-xs">{row.name}</span>,
    },
    {
      key: 'active',
      label: 'State',
      render: (row) => (
        <Pill
          label={row.active}
          color={row.active === 'Active' ? 'var(--status-good)' : 'var(--chart-muted)'}
        />
      ),
    },
    {
      key: 'vcpus',
      label: 'vCPUs',
      render: (row) => <span className="font-mono text-xs">{row.vcpus}</span>,
    },
    { key: 'memory', label: 'RAM', numeric: true, render: (row) => formatMB(row.memory) },
    { key: 'used', label: 'Used', numeric: true, render: (row) => formatMB(row.used) },
    {
      key: 'headroom',
      label: 'Headroom',
      numeric: true,
      render: (row) => (
        <span style={{ color: row.headroom < 0 ? 'var(--status-critical)' : undefined }}>
          {formatMB(row.headroom)}
        </span>
      ),
    },
    { key: 'instances', label: 'Live VMs', numeric: true },
    { key: 'apps', label: 'Apps', numeric: true },
    { key: 'tenants', label: 'Tenants', numeric: true },
  ];

  const isPending = overview.isPending || capacity.isPending || nodes.isPending;
  const error = overview.error ?? capacity.error ?? nodes.error;
  const retry = () => {
    void overview.refetch();
    void capacity.refetch();
    void nodes.refetch();
  };
  const totals = overview.data?.totals;
  const summary = capacity.data?.summary;
  const tileState = error
    ? ('unavailable' as const)
    : isPending
      ? ('loading' as const)
      : ('ready' as const);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Fleet operations"
        description="See which customers and apps are running on each compute node, then initiate audited recovery actions."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <Link to="/dashboard/operator/tenants">
                Customers <ArrowRight className="h-3 w-3" />
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/dashboard/operator">Runtime config</Link>
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Active nodes"
          value={totals ? `${totals.nodes_active}` : undefined}
          state={tileState}
          note={totals ? `${totals.nodes_inactive} inactive` : undefined}
        />
        <StatTile
          label="Live instances"
          value={totals ? `${totals.instances_live}` : undefined}
          state={tileState}
          note={totals ? `${totals.instances_waking} waking` : undefined}
        />
        <StatTile
          label="Admission headroom"
          value={summary ? formatMB(summary.admission_margin_mb) : undefined}
          state={tileState}
          note={summary ? `${formatMB(summary.ram_used_mb)} used` : undefined}
        />
        <StatTile
          label="Unplaced apps"
          value={summary ? `${summary.unplaced_apps}` : undefined}
          state={tileState}
          tone={summary && summary.unplaced_apps > 0 ? 'red' : undefined}
        />
      </div>

      {error && !isPending && <ErrorState error={error} onRetry={retry} />}

      <Panel
        title="Capacity and placement"
        description="Click a node to inspect its current app and microVM inventory."
        lit
        padded={false}
      >
        <div className="p-5">
          <ResourceTable
            rows={rows}
            columns={columns}
            initialSort={{ key: 'name', dir: 'asc' }}
            searchKeys={['name', 'active', 'vcpus']}
            searchPlaceholder="Filter by node or state…"
            emptyMessage="No compute nodes are registered."
            minWidth="min-w-[1100px]"
            loading={isPending}
            error={error}
            onRetry={retry}
            onRowClick={(row) => setSelectedNode(row.name)}
          />
        </div>
      </Panel>

      <Panel
        title="Node health"
        description="Heartbeat freshness is separate from placement capacity."
        padded={false}
      >
        {nodes.data?.items.length ? (
          <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-3">
            {nodes.data.items.map((node) => (
              <NodeHealthCard
                key={node.id}
                node={node}
                onClick={() => setSelectedNode(node.name)}
              />
            ))}
          </div>
        ) : isPending ? (
          <LoadingState message="Loading node health…" />
        ) : (
          <p className="px-5 py-6 text-sm text-muted-foreground">No node health records.</p>
        )}
      </Panel>

      <NodeDetailModal
        name={selectedNode}
        onClose={() => setSelectedNode(null)}
        onRecovery={setRecovery}
        onAppDetail={setSelectedApp}
      />
      <AppDetailModal
        id={selectedApp}
        onClose={() => setSelectedApp(null)}
        onRecovery={setRecovery}
      />
      <OperatorRecoveryDialog
        key={
          recovery
            ? `${recovery.kind}-${'id' in recovery ? recovery.id : recovery.slug}`
            : 'recovery-closed'
        }
        target={recovery}
        onClose={() => setRecovery(null)}
        onAccepted={(accepted) => setIntentId(accepted.intent_id)}
      />
      <OperatorIntentDialog intentId={intentId} onClose={() => setIntentId(null)} />
    </div>
  );
}

function NodeHealthCard({ node, onClick }: { node: OperatorNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-border p-4 text-left transition-colors hover:bg-muted/40"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Server className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-mono text-xs">{node.name}</span>
        </div>
        <Pill
          label={node.active ? 'Active' : 'Inactive'}
          color={node.active ? 'var(--status-good)' : 'var(--chart-muted)'}
        />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
        <Metric
          label="CPU"
          value={node.cpu_pct_60s == null ? '—' : `${node.cpu_pct_60s.toFixed(1)}%`}
        />
        <Metric label="VMs" value={`${node.instances_live}`} />
        <Metric label="Disk" value={formatBytes(node.disk_used_bytes)} />
      </div>
      <p className="mt-3 flex items-center gap-1 text-xs text-muted-foreground">
        <RefreshDouble className="h-3 w-3" /> Heartbeat {formatWhen(node.last_heartbeat_at)}
      </p>
    </button>
  );
}
