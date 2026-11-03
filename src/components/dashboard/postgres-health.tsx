import { CheckCircle, HelpCircle, RefreshDouble, WarningTriangle } from 'iconoir-react';
import { Timestamp } from '@/components/ui/timestamp';
import { InlinePhase, queryPhase } from '@/components/dashboard/primitives';
import { useCapabilityAccess, useCapabilityStage } from '@/lib/api/capabilities';
import {
  usePostgresConnectionBudget,
  usePostgresStatus,
  type PostgresCondition,
  type PostgresConnectionBudget,
} from '@/lib/api/postgres';
import type { PostgresDatabase } from '@/lib/api/queries';
import { StatusTag, type Tone } from './postgres-shared';

/**
 * Two read-only views of one database, both personal-only (the organization
 * routes have neither):
 *
 * - **Conditions** (`GET /v1/postgres/databases/{id}/status`, capability
 *   `resource-conditions`, preview): Ready, Progressing and Degraded, derived
 *   from the database and its cached health (faas pkg/conditions/resources.go).
 *   Ready with reason `suspended` is a database that scaled to zero, which the
 *   next connection wakes; it is not the compute cap.
 * - **Connection planning** (`GET …/connection-budget`): canonical pool
 *   planning from the bindings, not live sessions. Today's adapters have no
 *   verified usable capacity, so the state is usually `unknown`, and the
 *   reasons say why; it is shown as unknown rather than as fitting.
 */

function conditionLook(c: PostgresCondition): { tone: Tone; icon: typeof CheckCircle } {
  if (c.status === 'Unknown') return { tone: 'muted', icon: HelpCircle };
  // Progressing and Degraded are good when False; the rest when True.
  const good =
    c.type === 'Progressing' || c.type === 'Degraded' ? c.status === 'False' : c.status === 'True';
  if (good) return { tone: 'good', icon: CheckCircle };
  if (c.type === 'Progressing') return { tone: 'warning', icon: RefreshDouble };
  return { tone: 'critical', icon: WarningTriangle };
}

function StageTag({ stage }: { stage: string }) {
  if (!stage) return null;
  return (
    <span className="label-mono rounded-full border border-border px-2 py-0.5 text-muted-foreground">
      {stage}
    </span>
  );
}

export function DatabaseConditions({ database }: { database: PostgresDatabase }) {
  const { access } = useCapabilityAccess('resource-conditions');
  const stage = useCapabilityStage('resource-conditions');
  const status = usePostgresStatus(database.id, access === 'on');
  if (access !== 'on') return null;
  return (
    <section aria-label="Conditions" className="flex flex-col gap-2">
      <p className="flex items-center gap-2 label-mono text-muted-foreground">
        Conditions <StageTag stage={stage} />
      </p>
      {status.data ? (
        <>
          <ul className="flex flex-col gap-2">
            {status.data.conditions.map((c) => {
              const look = conditionLook(c);
              return (
                <li key={c.type} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  <StatusTag tone={look.tone} icon={look.icon}>
                    {c.type}: {c.status}
                  </StatusTag>
                  <span className="font-mono text-muted-foreground">{c.reason}</span>
                  <span className="text-muted-foreground">{c.message}</span>
                  {c.since && (
                    <span className="text-muted-foreground">
                      since <Timestamp value={c.since} />
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted-foreground">
            Read <Timestamp value={status.data.observed_at} />. Derived when read; nothing is woken.
          </p>
        </>
      ) : (
        <InlinePhase
          phase={queryPhase({ error: status.error, loading: status.isPending })}
          error={status.error}
          loadingMessage="Reading conditions…"
          onRetry={() => void status.refetch()}
        />
      )}
    </section>
  );
}

const BUDGET: Record<
  PostgresConnectionBudget['state'],
  { tone: Tone; icon: typeof CheckCircle; label: string }
> = {
  unknown: { tone: 'muted', icon: HelpCircle, label: 'Unknown' },
  within_budget: { tone: 'good', icon: CheckCircle, label: 'Within budget' },
  over_budget: { tone: 'critical', icon: WarningTriangle, label: 'Over budget' },
};

/** apid's reason codes (managedpostgres/connection_budget.go), in words. */
const REASONS: Record<string, string> = {
  capacity_unverified: 'The provider has not reported a verified connection capacity.',
  database_not_ready: 'The database is not ready.',
  inventory_stale: 'The binding inventory is older than its freshness window.',
  inventory_truncated: 'Only the first bindings were counted.',
  runtime_inventory_unavailable: 'Instance inventory could not be read.',
  runtime_pool_configuration_unverified: 'Runtime pool sizes are not verified.',
  native_replication_connections_unmodeled: 'Replication connections are not modelled.',
  external_consumers_unobserved: 'Connections from outside Gregale are not observed.',
  migration_demand_unbounded: "A migration binding's demand has no bound.",
  client_pool_sizes_unknown: "Some apps' client pool sizes are unknown.",
  reserved_capacity_exceeds_allocation: 'Reserved connections exceed the allocation.',
};

export function ConnectionBudget({ database }: { database: PostgresDatabase }) {
  const budget = usePostgresConnectionBudget(database.id);
  const data = budget.data;
  const look = data ? BUDGET[data.state] : undefined;
  return (
    <section aria-label="Connection planning" className="flex flex-col gap-2">
      <p className="label-mono text-muted-foreground">Connection planning</p>
      {data && look ? (
        <>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <StatusTag tone={look.tone} icon={look.icon}>
              {look.label}
            </StatusTag>
            <span>{data.demand.modeled_peak_connections} connections at modeled peak</span>
            <span>
              {data.capacity.state === 'verified' && data.capacity.usable_connections !== undefined
                ? `${data.capacity.usable_connections} usable`
                : 'usable capacity unknown'}
            </span>
            <span>
              {data.inventory.bindings} binding{data.inventory.bindings === 1 ? '' : 's'} ·{' '}
              {data.inventory.resident_instances} running, {data.inventory.parked_instances} parked
              instances
            </span>
          </p>
          {data.reasons.length > 0 && (
            <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
              {data.reasons.map((reason) => (
                <li key={reason} className="flex flex-wrap items-baseline gap-x-2">
                  <span>{REASONS[reason] ?? 'Not assessed.'}</span>
                  <code className="font-mono">{reason}</code>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            Planned from the bindings and their runtime pools, not live sessions. Reading it does
            not wake the database or reserve connections.
          </p>
        </>
      ) : (
        <InlinePhase
          phase={queryPhase({ error: budget.error, loading: budget.isPending })}
          error={budget.error}
          loadingMessage="Reading connection planning…"
          onRetry={() => void budget.refetch()}
        />
      )}
    </section>
  );
}
