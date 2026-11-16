import { HelpTip } from '@/components/dashboard/kit/help-tip';
import { ServiceFigure } from '@/components/dashboard/service-figure';
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
// Whole cents: a fraction of a cent is precision nobody acts on. A non-zero
// amount below a cent still reads as more than nothing.
function money(millicents: number, currency: string = ACCOUNT_CURRENCY): string {
  const amount = millicents / 100_000;
  const format = (n: number) =>
    new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  return amount > 0 && amount < 0.01 ? `< ${format(0.01)}` : format(amount);
}

function pct(used: number, cap: number): string | undefined {
  if (!cap) return undefined;
  return `${Math.round((used / cap) * 100)}% of ${bytes(cap)}`;
}

/**
 * Object storage as a compact block for the Usage page's "Other services":
 * secondary to compute, so four small figures, with the per-part charges one
 * tip away.
 */
export function ObjectStorageUsagePanel({ data }: { data: ObjectStorageUsage }) {
  const { usage, policy, charges } = data;
  const since = new Date(usage.period_start).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });

  return (
    <section
      aria-label="Object storage"
      className="well flex min-w-0 flex-col gap-3 rounded-xl bg-muted/40 p-4"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold">Object storage</h3>
        <span className="text-xs text-muted-foreground">Since {since}</span>
      </header>
      {!usage.fresh && (
        <p className="text-xs" style={{ color: 'var(--status-warning)' }}>
          The last report is stale; these figures lag behind.
        </p>
      )}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <ServiceFigure
          label="Stored"
          value={bytes(usage.observed_bytes)}
          note={pct(usage.observed_bytes, policy.max_account_bytes)}
        />
        <ServiceFigure
          label="Cost so far"
          value={
            charges
              ? money(charges.total_millicents, charges.currency)
              : money(usage.cost_millicents)
          }
          extra={
            charges && (
              <HelpTip label="Object storage charges">
                Storage {money(charges.storage_millicents, charges.currency)} · requests{' '}
                {money(charges.requests_millicents, charges.currency)} · data out{' '}
                {money(charges.egress_millicents, charges.currency)}
              </HelpTip>
            )
          }
        />
        <ServiceFigure
          label="Requests"
          value={usage.request_count.toLocaleString()}
          note={`of ${policy.max_monthly_requests.toLocaleString()} a month`}
        />
        <ServiceFigure
          label="Data out"
          value={bytes(usage.egress_bytes)}
          note={`of ${bytes(policy.max_monthly_egress_bytes)} a month`}
        />
      </dl>
    </section>
  );
}
