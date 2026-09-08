import { Panel, StatTile } from '@/components/dashboard/primitives';
import { errorMessage } from '@/lib/api/errors';
import { useObjectStorageUsage } from '@/lib/api/object-storage';

/**
 * Object-storage accounting for the account, against the caps it is measured
 * against (`policy`) and what it has cost so far (`charges`).
 *
 * `usage.fresh` is the field that decides whether these numbers can be
 * trusted right now: the report is compiled periodically, and a stale one is
 * said to be stale rather than presented as current. Costs arrive in
 * millicents, so they are converted once, here, and never rounded into a
 * shape the invoice will not match.
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

function money(millicents: number, currency = 'USD'): string {
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

export function ObjectStorageUsagePanel() {
  const query = useObjectStorageUsage();
  const data = query.data;
  const state = query.isPending ? 'loading' : query.error ? 'unavailable' : 'ready';
  const usage = data?.usage;
  const policy = data?.policy;
  const charges = data?.charges;

  return (
    <Panel
      title="Object storage"
      description={
        usage
          ? `Since ${new Date(usage.period_start).toLocaleDateString()}.${usage.fresh ? '' : ' The last report is stale; these figures lag behind.'}`
          : 'Stored bytes, requests and egress for the account.'
      }
    >
      {query.error ? (
        <p className="text-sm text-muted-foreground">{errorMessage(query.error)}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Stored"
            value={usage ? bytes(usage.observed_bytes) : undefined}
            note={usage && policy ? pct(usage.observed_bytes, policy.max_account_bytes) : undefined}
            state={state}
          />
          <StatTile
            label="Requests"
            value={usage?.request_count}
            note={policy ? `cap ${policy.max_monthly_requests.toLocaleString()}/month` : undefined}
            state={state}
            tone="grey"
          />
          <StatTile
            label="Egress"
            value={usage ? bytes(usage.egress_bytes) : undefined}
            note={policy ? `cap ${bytes(policy.max_monthly_egress_bytes)}/month` : undefined}
            state={state}
            tone="orange"
          />
          <StatTile
            label="Cost so far"
            value={
              charges
                ? money(charges.total_millicents, charges.currency)
                : usage
                  ? money(usage.cost_millicents)
                  : undefined
            }
            note={
              charges
                ? `storage ${money(charges.storage_millicents, charges.currency)} · requests ${money(charges.requests_millicents, charges.currency)} · egress ${money(charges.egress_millicents, charges.currency)}`
                : undefined
            }
            state={state}
          />
        </div>
      )}
    </Panel>
  );
}
