import { Panel, Stats, StatTile } from '@/components/dashboard/primitives';
import type { components } from '@/lib/api/schema';
import { ACCOUNT_CURRENCY } from '@/lib/money';

type ObjectStorageUsage = components['schemas']['ObjectStorageUsageResponse'];

/**
 * Object-storage accounting for the account, against the caps it is measured
 * against (`policy`) and what it has cost so far (`charges`).
 *
 * `usage.fresh` is the field that decides whether these numbers can be
 * trusted right now: the report is compiled periodically, and a stale one is
 * said to be stale rather than presented as current. Costs arrive in
 * millicents, so they are converted once, here, and never rounded into a
 * shape the invoice will not match.
 *
 * The figures are the `object_storage` block of the account usage projection
 * (`GET /v1/account/usage`), which the Usage page reads once; the block is
 * absent when object storage is not enabled, and the page then omits this.
 */

function bytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let n = value / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

// `ObjectStorageUsage.cost_millicents` is account money, USD (faas
// pkg/financial/currency.go, ADR-1430); the `charges` block names its own.
function money(millicents: number, currency: string = ACCOUNT_CURRENCY): string {
  const amount = millicents / 100_000;
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(amount);
}

function pct(used: number, cap: number): string | undefined {
  if (!cap) return undefined;
  return `${Math.round((used / cap) * 100)}% of ${bytes(cap)}`;
}

export function ObjectStorageUsagePanel({ data }: { data: ObjectStorageUsage }) {
  const { usage, policy, charges } = data;

  return (
    <Panel
      title="Object storage"
      padded={false}
      actions={
        <span className="text-xs text-muted-foreground">
          Since {new Date(usage.period_start).toLocaleDateString()}
          {!usage.fresh && (
            <span style={{ color: 'var(--status-warning)' }}>
              {' '}
              · The last report is stale; these figures lag behind.
            </span>
          )}
        </span>
      }
      help={`Since ${new Date(usage.period_start).toLocaleDateString()}.${usage.fresh ? '' : ' The last report is stale; these figures lag behind.'}`}
    >
      <Stats columns={4}>
        <StatTile
          label="Stored"
          value={bytes(usage.observed_bytes)}
          note={pct(usage.observed_bytes, policy.max_account_bytes)}
        />
        <StatTile
          label="Requests"
          value={usage.request_count}
          note={`cap ${policy.max_monthly_requests.toLocaleString()}/month`}
          tone="grey"
        />
        <StatTile
          label="Storage egress"
          value={bytes(usage.egress_bytes)}
          note={`cap ${bytes(policy.max_monthly_egress_bytes)}/month`}
          tone="orange"
        />
        <StatTile
          label="Cost so far"
          value={
            charges
              ? money(charges.total_millicents, charges.currency)
              : money(usage.cost_millicents)
          }
          note={
            charges
              ? `storage ${money(charges.storage_millicents, charges.currency)} · requests ${money(charges.requests_millicents, charges.currency)} · egress ${money(charges.egress_millicents, charges.currency)}`
              : undefined
          }
        />
      </Stats>
    </Panel>
  );
}
