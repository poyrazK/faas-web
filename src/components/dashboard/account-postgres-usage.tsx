import { CheckCircle, Circle, Pause, WarningTriangle } from 'iconoir-react';
import type { components } from '@/lib/api/schema';
import { formatUsageBytes, formatUsageNumber } from '@/lib/usage-format';
import { Panel, StatTile } from './primitives';

type ManagedPostgresUsage = components['schemas']['ManagedPostgresUsageResponse'];

/**
 * apid turns the plan's storage entitlement into byte-seconds over a 31-day
 * month, so GiB-months read back whole (faas cmd/gregale/commands_postgres.go
 * postgresBillingMonthSeconds); the CLI's units are used here too.
 */
const GIB_MONTH_BYTE_SECONDS = 2 ** 30 * 31 * 24 * 3600;
const cuHours = (seconds: number) => `${formatUsageNumber(seconds / 3600)} CU-hours`;
const gibMonths = (byteSeconds: number) =>
  `${formatUsageNumber(byteSeconds / GIB_MONTH_BYTE_SECONDS)} GiB-months`;

type Tone = 'good' | 'muted' | 'warning' | 'critical';
const TONE = {
  good: { color: 'var(--status-good)', icon: CheckCircle },
  muted: { color: 'var(--chart-muted)', icon: Circle },
  warning: { color: 'var(--status-warning)', icon: WarningTriangle },
  critical: { color: 'var(--status-critical)', icon: Pause },
} satisfies Record<Tone, unknown>;

/** The compute cap state when apid meters it, else the storage guardrail, in words. */
export function postgresStanding(usage: ManagedPostgresUsage): { tone: Tone; label: string } {
  switch (usage.compute_cap_state) {
    case 'healthy':
      return { tone: 'good', label: 'Within the compute allowance' };
    case 'warning':
      return { tone: 'warning', label: 'Past 80% of the compute allowance' };
    case 'overage':
      return { tone: 'warning', label: 'In compute overage, up to the ceiling' };
    case 'suspended':
      return { tone: 'critical', label: 'Suspended at the compute ceiling' };
  }
  switch (usage.guardrail_state) {
    case 'reached':
      return { tone: 'critical', label: 'Storage guardrail reached' };
    case 'stale':
      return { tone: 'warning', label: 'Guardrail reading is stale' };
    case 'disabled':
      return { tone: 'muted', label: 'Guardrail not enforced' };
    default:
      return { tone: 'good', label: 'Within the guardrail' };
  }
}

/**
 * Managed PostgreSQL this month, from the `managed_postgres` block of
 * `GET /v1/account/usage`: present only when the plan includes it. Every
 * field is a month-to-date scalar, so it is figures, not a chart.
 */
export function ManagedPostgresUsagePanel({ data }: { data: ManagedPostgresUsage }) {
  const standing = postgresStanding(data);
  const { color, icon: Icon } = TONE[standing.tone];
  return (
    <Panel
      title="Managed PostgreSQL"
      help={`Since ${new Date(data.period_start).toLocaleDateString()}.${data.fresh ? '' : ' The last observation is stale; these figures lag behind.'}`}
      actions={
        <span className="inline-flex items-center gap-1.5 text-xs" style={{ color }}>
          <Icon aria-hidden className="h-3.5 w-3.5" />
          {standing.label}
        </span>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Databases"
          value={`${data.ready_databases} of ${data.database_limit}`}
          tone="grey"
        />
        <StatTile
          label="Compute"
          value={cuHours(data.compute_unit_seconds)}
          note={
            data.compute_allowance_unit_seconds
              ? `of ${cuHours(data.compute_allowance_unit_seconds)} included`
              : undefined
          }
        />
        <StatTile
          label="Storage"
          value={gibMonths(data.storage_byte_seconds)}
          note={`of ${gibMonths(data.storage_byte_seconds_limit)}`}
          tone="orange"
        />
        <StatTile label="Egress" value={formatUsageBytes(data.egress_bytes)} tone="grey" />
      </div>
    </Panel>
  );
}
