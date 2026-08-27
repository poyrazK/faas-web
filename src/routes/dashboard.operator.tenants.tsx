import { useMemo, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowRight, CheckCircle, RefreshDouble, WarningTriangle } from 'iconoir-react';
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
  OperatorLifecycleDialog,
  type OperatorLifecycleTarget,
} from '@/components/dashboard/operator-operations';
import {
  type OperatorTenant,
  useOperatorTenant360,
  useOperatorTenantActivity,
  useOperatorTenants,
} from '@/lib/api/queries';
import { formatRelative } from '@/lib/mock-data';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/operator/tenants')({
  component: TenantsPage,
  head: () =>
    consoleHead(
      'operator customers',
      'Inspect tenant activity, applications, usage, and billing context.'
    ),
});

const STATUS_COLOR: Record<string, string> = {
  active: 'var(--status-good)',
  past_due: 'var(--status-warning)',
  suspended: 'var(--status-critical)',
};

function formatWhen(value: string | undefined | null): string {
  if (!value) return '—';
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? '—' : formatRelative(timestamp);
}

function formatMoney(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

interface TenantRow extends OperatorTenant {
  id: string;
}

function TenantDrawer({
  tenant,
  month,
  onClose,
  onRecovery,
  onAccountAction,
}: {
  tenant: TenantRow | null;
  month: string;
  onClose: () => void;
  onRecovery: (target: RecoveryTarget) => void;
  onAccountAction: (target: OperatorLifecycleTarget) => void;
}) {
  const detail = useOperatorTenant360(tenant?.account_id ?? '', month);
  const activity = useOperatorTenantActivity(tenant?.account_id ?? '');
  const data = detail.data;

  return (
    <Modal
      open={Boolean(tenant)}
      onClose={onClose}
      title={data ? `Tenant ${data.account.account_id.slice(0, 12)}` : 'Tenant 360'}
      description="Safe operational context. Email is redacted by default and secrets never cross this boundary."
      width="max-w-6xl"
    >
      {detail.isPending ? (
        <LoadingState message="Loading tenant 360…" />
      ) : detail.error ? (
        <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
      ) : data ? (
        <div className="flex max-h-[72vh] flex-col gap-5 overflow-y-auto">
          <div className="grid gap-3 sm:grid-cols-4">
            <Metric label="Plan" value={data.account.plan} />
            <Metric label="Status" value={data.account.status} />
            <Metric label="Apps" value={`${data.apps.length}`} />
            <Metric label="Created" value={formatWhen(data.account.created_at)} />
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatTile label="Requests" value={data.usage.requests.toLocaleString()} />
            <StatTile label="CPU hours" value={data.usage.used_cpu_hours.toFixed(2)} />
            <StatTile label="GB-hours" value={data.usage.used_gb_hours.toFixed(2)} />
            <StatTile
              label="Overage"
              value={formatMoney(data.usage.overage_cents)}
              tone={data.usage.overage_cents > 0 ? 'red' : undefined}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel
              title="Applications"
              description="Cold-boot recovery invalidates snapshots for the next wake."
              padded={false}
            >
              {data.apps.length === 0 ? (
                <p className="px-5 py-6 text-sm text-muted-foreground">No applications.</p>
              ) : (
                <div className="divide-y divide-border">
                  {data.apps.map((app) => (
                    <div key={app.id} className="flex items-center justify-between gap-3 px-5 py-3">
                      <div className="min-w-0">
                        <p className="truncate font-mono text-xs">{app.slug}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {app.status} · {app.deployments} deployments
                        </p>
                      </div>
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() =>
                          onRecovery({ kind: 'force-cold-boot', slug: app.slug, label: app.slug })
                        }
                      >
                        Cold boot next wake
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel
              title="Billing context"
              description={`Usage window: ${data.usage.month}`}
              padded={false}
            >
              <div className="divide-y divide-border">
                <div className="grid grid-cols-2 gap-3 px-5 py-3 text-xs">
                  <Metric
                    label="Current overage"
                    value={formatMoney(data.billing.current_month_overage_cents)}
                  />
                  <Metric
                    label="Active credits"
                    value={formatMoney(data.billing.active_credits_cents)}
                  />
                  <Metric
                    label="Overage cap"
                    value={
                      data.billing.overage_cap_cents == null
                        ? 'None'
                        : formatMoney(data.billing.overage_cap_cents)
                    }
                  />
                  <Metric label="Invoices" value={`${data.billing.invoices.length}`} />
                </div>
                {data.billing.invoices.slice(0, 4).map((invoice) => (
                  <div
                    key={invoice.id}
                    className="flex items-center justify-between gap-3 px-5 py-3 text-xs"
                  >
                    <div>
                      <p className="font-mono">{invoice.number || invoice.id.slice(0, 12)}</p>
                      <p className="mt-1 text-muted-foreground">
                        {invoice.status} · {invoice.currency}
                      </p>
                    </div>
                    <span className="font-mono">
                      {formatMoney(invoice.total_cents, invoice.currency)}
                    </span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          <Panel
            title="Recent activity"
            description="Metadata only: no request payloads, results, headers, or secret values."
            padded={false}
          >
            {activity.isPending ? (
              <div className="flex items-center gap-2 px-5 py-6 text-sm text-muted-foreground">
                <RefreshDouble className="h-4 w-4 animate-spin" /> Loading activity…
              </div>
            ) : activity.error ? (
              <div className="px-5 py-6">
                <ErrorState error={activity.error} onRetry={() => void activity.refetch()} />
              </div>
            ) : activity.data &&
              (activity.data.invocations.length > 0 || activity.data.audit_events.length > 0) ? (
              <>
                {activity.data.invocations.length > 0 ? (
                  <div className="divide-y divide-border">
                    {activity.data.invocations.slice(0, 8).map((invocation) => (
                      <div
                        key={invocation.id}
                        className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-mono text-xs">
                            {invocation.app_slug ?? invocation.app_id.slice(0, 12)}{' '}
                            {invocation.method} {invocation.path}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatWhen(invocation.created_at)} · {invocation.source} ·{' '}
                            {invocation.attempts} attempt{invocation.attempts === 1 ? '' : 's'}
                          </p>
                        </div>
                        <Pill
                          label={invocation.outcome || invocation.state}
                          color={
                            invocation.outcome === 'success' || invocation.outcome === 'succeeded'
                              ? 'var(--status-good)'
                              : invocation.last_error
                                ? 'var(--status-critical)'
                                : undefined
                          }
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="px-5 py-4 text-xs text-muted-foreground">No invocation activity.</p>
                )}
                {activity.data.audit_events.length > 0 && (
                  <div className="border-t border-border">
                    <p className="label-mono px-5 py-3 text-muted-foreground">Audit events</p>
                    <div className="divide-y divide-border">
                      {activity.data.audit_events.slice(0, 6).map((event) => (
                        <div
                          key={event.id}
                          className="flex items-center justify-between gap-3 px-5 py-3 text-xs"
                        >
                          <span className="font-mono">{event.kind}</span>
                          <span className="text-muted-foreground">{formatWhen(event.at)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p className="px-5 py-6 text-sm text-muted-foreground">
                No invocation activity in the current window.
              </p>
            )}
          </Panel>

          <Panel title="Identity and access" padded>
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric label="Account ID" value={data.account.account_id} />
              <Metric label="MFA" value={data.account.mfa_enrolled ? 'Enrolled' : 'Not enrolled'} />
              <Metric
                label="API keys"
                value={`${data.api_keys.active} active · ${data.api_keys.revoked} revoked`}
              />
              <Metric
                label="Sessions"
                value={`${data.sessions.active} active · ${data.sessions.revoked} revoked`}
              />
              <Metric label="Personal org" value={data.account.is_personal ? 'Yes' : 'No'} />
              <Metric label="Org" value={data.account.org_slug || '—'} />
            </div>
            <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
              {data.account.status === 'suspended' ? (
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() =>
                    onAccountAction({
                      kind: 'account',
                      id: data.account.account_id,
                      action: 'restore',
                      label: data.account.account_id,
                    })
                  }
                >
                  Restore account
                </Button>
              ) : (
                <Button
                  size="xs"
                  variant="destructive"
                  onClick={() =>
                    onAccountAction({
                      kind: 'account',
                      id: data.account.account_id,
                      action: 'suspend',
                      label: data.account.account_id,
                    })
                  }
                >
                  Suspend account
                </Button>
              )}
              <Button
                size="xs"
                variant="outline"
                onClick={() =>
                  onAccountAction({
                    kind: 'account',
                    id: data.account.account_id,
                    action: 'revoke-sessions',
                    label: data.account.account_id,
                  })
                }
              >
                Revoke sessions
              </Button>
            </div>
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

function TenantsPage() {
  const [selected, setSelected] = useState<TenantRow | null>(null);
  const [recovery, setRecovery] = useState<RecoveryTarget | null>(null);
  const [accountAction, setAccountAction] = useState<OperatorLifecycleTarget | null>(null);
  const [intentId, setIntentId] = useState<string | null>(null);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [tenantCursors, setTenantCursors] = useState<(string | undefined)[]>([undefined]);
  const tenantCursor = tenantCursors[tenantCursors.length - 1];
  const tenants = useOperatorTenants(200, tenantCursor);

  const rows = useMemo<TenantRow[]>(
    () => (tenants.data?.items ?? []).map((tenant) => ({ ...tenant, id: tenant.account_id })),
    [tenants.data]
  );

  const columns: Column<TenantRow>[] = [
    {
      key: 'account_id',
      label: 'Tenant',
      render: (row) => <span className="font-mono text-xs">{row.account_id.slice(0, 16)}…</span>,
    },
    { key: 'plan', label: 'Plan', render: (row) => <Pill label={row.plan} /> },
    {
      key: 'status',
      label: 'Status',
      render: (row) => <Pill label={row.status} color={STATUS_COLOR[row.status]} />,
    },
    { key: 'apps_count', label: 'Apps', numeric: true },
    { key: 'deployments_live_count', label: 'Live deploys', numeric: true },
    {
      key: 'mfa_enrolled',
      label: 'MFA',
      render: (row) =>
        row.mfa_enrolled ? (
          <CheckCircle
            className="h-4 w-4"
            style={{ color: 'var(--status-good)' }}
            aria-label="MFA enrolled"
          />
        ) : (
          <WarningTriangle
            className="h-4 w-4"
            style={{ color: 'var(--status-warning)' }}
            aria-label="MFA not enrolled"
          />
        ),
    },
    {
      key: 'created_at',
      label: 'Created',
      render: (row) => (
        <span className="text-xs text-muted-foreground">{formatWhen(row.created_at)}</span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Customers"
        description="Answer who is using the platform, what they are running, and what happened recently without opening an SSH session."
        actions={
          <div className="flex flex-wrap gap-2">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="label-mono">Usage month</span>
              <input
                type="month"
                value={month}
                onChange={(event) => setMonth(event.target.value)}
                className="h-8 rounded-md border border-border bg-background px-2 text-xs"
              />
            </label>
            <Button asChild size="sm" variant="outline">
              <Link to="/dashboard/operator/fleet">
                Fleet <ArrowRight className="h-3 w-3" />
              </Link>
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          label="Tenants"
          value={tenants.data ? `${tenants.data.items.length}` : undefined}
          state={tenants.error ? 'unavailable' : tenants.isPending ? 'loading' : 'ready'}
        />
        <StatTile
          label="Active"
          value={
            tenants.data
              ? `${tenants.data.items.filter((row) => row.status === 'active').length}`
              : undefined
          }
          state={tenants.error ? 'unavailable' : tenants.isPending ? 'loading' : 'ready'}
        />
        <StatTile
          label="MFA enrolled"
          value={
            tenants.data
              ? `${tenants.data.items.filter((row) => row.mfa_enrolled).length}`
              : undefined
          }
          state={tenants.error ? 'unavailable' : tenants.isPending ? 'loading' : 'ready'}
        />
      </div>

      <Panel
        title="Tenant inventory"
        description="Email stays redacted. Select a row for the tenant 360 view."
        lit
        padded={false}
        actions={
          tenants.data && (tenants.data.next_cursor || tenantCursors.length > 1) ? (
            <div className="flex items-center gap-1.5">
              <Button
                size="xs"
                variant="ghost"
                disabled={tenantCursors.length <= 1 || tenants.isFetching}
                onClick={() => setTenantCursors((current) => current.slice(0, -1))}
              >
                Previous
              </Button>
              <span className="px-1 text-xs text-muted-foreground">
                Page {tenantCursors.length}
              </span>
              <Button
                size="xs"
                variant="ghost"
                disabled={!tenants.data.next_cursor || tenants.isFetching}
                onClick={() => {
                  if (tenants.data?.next_cursor) {
                    setTenantCursors((current) => [...current, tenants.data!.next_cursor]);
                  }
                }}
              >
                Next
              </Button>
            </div>
          ) : undefined
        }
      >
        <div className="p-5">
          <ResourceTable
            rows={rows}
            columns={columns}
            initialSort={{ key: 'created_at', dir: 'desc' }}
            searchKeys={['account_id', 'plan', 'status', 'org_slug']}
            searchPlaceholder="Filter by account, plan, status, or org…"
            emptyMessage="No tenants are registered."
            minWidth="min-w-[950px]"
            loading={tenants.isPending}
            error={tenants.error}
            onRetry={() => void tenants.refetch()}
            onRowClick={setSelected}
          />
        </div>
      </Panel>

      <TenantDrawer
        tenant={selected}
        month={month}
        onClose={() => setSelected(null)}
        onRecovery={setRecovery}
        onAccountAction={setAccountAction}
      />
      <OperatorLifecycleDialog
        key={
          accountAction?.kind === 'account'
            ? `${accountAction.id}-${accountAction.action}`
            : 'account-action-closed'
        }
        target={accountAction}
        onClose={() => setAccountAction(null)}
        onCompleted={() => void tenants.refetch()}
      />
      <OperatorRecoveryDialog
        key={
          recovery
            ? `${recovery.kind}-${'slug' in recovery ? recovery.slug : recovery.id}`
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
