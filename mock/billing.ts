import type { components } from '../src/lib/api/schema';

type S = components['schemas'];

/**
 * The account's daily rollups for the current UTC month, as apid's
 * `compute.daily` carries them (faas usage_analytics.go usageDailyPoints):
 * oldest first, one row per day with usage, the busiest app named. Seeded off
 * the day so a reload draws the same bars. A quiet day mid-month has no row,
 * so the console's "no rollup" caption can be seen, and the rows sum to a
 * little under the live total, because rollups trail it.
 */
export function mockDailyUsage(
  usedGbHours: number,
  month: string,
  now: number,
  slugs: string[]
): S['DailyUsagePoint'][] {
  const today = new Date(now);
  if (usedGbHours <= 0 || month !== today.toISOString().slice(0, 7)) return [];
  const days = today.getUTCDate();
  const weights = Array.from({ length: days }, (_, i) =>
    // Day 5 has no row; day 12 is a spike, so "biggest day" has an answer.
    i === 4 && days > 6 ? 0 : 1 + 0.6 * Math.sin(i * 1.7) + (i === 11 ? 2.4 : 0)
  );
  const total = weights.reduce((sum, w) => sum + w, 0);
  const rolledUp = usedGbHours * 0.97;
  return weights.flatMap((weight, i) => {
    if (weight === 0) return [];
    const gb = Math.round((rolledUp * weight * 100) / total) / 100;
    const date = `${month}-${String(i + 1).padStart(2, '0')}`;
    const slug = slugs.length ? slugs[(i * 7) % slugs.length] : undefined;
    return [
      {
        date,
        gb_hours: gb,
        ...(slug ? { top_app_slug: slug, top_app_gb_hours: Math.round(gb * 55) / 100 } : {}),
      },
    ];
  });
}

/** Managed PostgreSQL this month, inside its allowance (ManagedPostgresUsageResponse). */
export function mockManagedPostgresUsage(now: number): S['ManagedPostgresUsageResponse'] {
  const d = new Date(now);
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const gibMonth = 2 ** 30 * 31 * 24 * 3600;
  return {
    period_start: start.toISOString(),
    observed_at: new Date(now - 4 * 60_000).toISOString(),
    policy_enabled: true,
    fresh: true,
    guardrail_state: 'healthy',
    ready_databases: 1,
    database_limit: 3,
    storage_limit_bytes: 10 * 2 ** 30,
    compute_unit_seconds: 151_200,
    compute_allowance_unit_seconds: 720_000,
    compute_ceiling_unit_seconds: 1_440_000,
    compute_cap_state: 'healthy',
    overage_enabled: false,
    storage_byte_seconds: Math.round(1.8 * gibMonth),
    storage_byte_seconds_limit: 10 * gibMonth,
    storage_byte_seconds_remaining: Math.round(8.2 * gibMonth),
    history_byte_seconds: Math.round(0.4 * gibMonth),
    egress_bytes: 2_412_000_000,
  };
}

/**
 * What `POST /v1/invoices/{id}/refresh` reports for a stored invoice: an open
 * invoice is still being drafted at the provider, so its lines fall back to one
 * total (`incomplete`); a settled one comes back detailed.
 */
export function mockInvoiceRefresh(invoice: S['Invoice']): S['InvoiceRefreshResponse'] {
  const settled = invoice.status !== 'open' && invoice.status !== 'draft';
  return {
    invoice_id: invoice.id,
    provider: invoice.provider,
    detailed: settled,
    line_items: settled ? 3 : 1,
    ...(settled ? {} : { source_gap: 'incomplete' as const }),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Each organization's spend cap, defaulting to one more allowance of overage
 * on a paid plan, as apid seeds it (docs/billing.md "Spend cap": Hobby $2,
 * Pro $10, Scale $30; none on Free).
 */
const DEFAULT_CAP_CENTS: Record<string, number | null> = {
  free: null,
  hobby: 200,
  pro: 1000,
  scale: 3000,
};
const orgCaps = new Map<string, number | null>();

export function orgOverageCap(slug: string, plan: string): number | null {
  if (!orgCaps.has(slug)) orgCaps.set(slug, DEFAULT_CAP_CENTS[plan] ?? null);
  return orgCaps.get(slug) ?? null;
}

export function setOrgOverageCap(slug: string, cents: number | null) {
  orgCaps.set(slug, cents);
}

const MB_SECONDS_PER_GB_HOUR = 1024 * 3600;
/** $0.01 per GB-hour of overage (faas pkg/api/limits.go:7224, ADR-1430). */
const COMPUTE_MILLICENTS_PER_GB_HOUR = 1_000;
/** Compute use as a share of the allowance, by months back from the current one. */
const COMPUTE_SHARE = [0, 1.18, 0.86, 0.41];
const MINUTE = 60_000;

/** Splits an integer total by weights so the parts sum to it exactly. */
function split(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const parts = weights.map((w) => Math.floor((total * w) / sum));
  parts[0] += total - parts.reduce((a, b) => a + b, 0);
  return parts;
}

/**
 * `GET /v1/billing/costs` for one UTC month (faas
 * pkg/billing/financial_visibility.go): compute priced live with the plan's
 * allowance, and interface egress observed with its price off, so its traffic
 * is non-billable. Retention began on the 10th three months back, so that
 * month reports `retention_started_during_or_after_period` and missing
 * sampling windows, and earlier months have no evidence at all; the current
 * month's egress has missing windows too, as delayed egress coverage does
 * (docs/billing.md). Invoices are the seeded ones whose period ends in the
 * month, unreconciled.
 */
export function mockFinancialCosts(opts: {
  month: string;
  now: number;
  accountId: string;
  plan: S['FinancialPriceContract']['plan'];
  includedGbHours: number;
  invoices: S['Invoice'][];
  apps: { id: string; slug: string }[];
}): S['FinancialCostsResponse'] {
  const { month, now } = opts;
  const [y, m] = month.split('-').map(Number);
  const start = Date.UTC(y, m - 1, 1);
  const end = Date.UTC(y, m, 1);
  const today = new Date(now);
  const retainedFrom = Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 3, 10, 6);
  const asOf = Math.min(end, Math.floor(now / MINUTE) * MINUTE);
  const current = end > now;
  const back = (today.getUTCFullYear() - y) * 12 + today.getUTCMonth() - (m - 1);
  const expected = Math.floor((asOf - start) / MINUTE);
  const retained = Math.max(0, Math.floor((asOf - Math.max(start, retainedFrom)) / MINUTE));
  const beforeRetention = start < retainedFrom;
  const iso = (ms: number) => new Date(ms).toISOString();

  const share = current ? 1.1 * (expected / ((end - start) / MINUTE)) : (COMPUTE_SHARE[back] ?? 0);
  const quantity =
    retained === 0 ? 0 : Math.round(opts.includedGbHours * share * MB_SECONDS_PER_GB_HOUR);
  const included = opts.includedGbHours * MB_SECONDS_PER_GB_HOUR;
  const priced = (q: number) =>
    Math.round((q * COMPUTE_MILLICENTS_PER_GB_HOUR) / MB_SECONDS_PER_GB_HOUR);
  const gross = priced(quantity);
  const allowance = priced(Math.min(quantity, included));
  const net = gross - allowance;
  const computePrice: S['FinancialPrice'] = {
    version: `compute-${opts.plan}-v1`,
    meter: 'compute',
    currency: 'USD',
    unit: 'mb_seconds',
    unit_quantity: MB_SECONDS_PER_GB_HOUR,
    millicents_per_unit: COMPUTE_MILLICENTS_PER_GB_HOUR,
    included_quantity: included,
  };
  const egressPrice: S['FinancialPrice'] = {
    version: 'egress-off-v1',
    meter: 'egress',
    currency: 'USD',
    unit: 'interface_bytes',
    unit_quantity: 1,
    millicents_per_unit: 0,
    included_quantity: 0,
  };
  const apps = opts.apps.slice(0, 3);
  const weights = [5, 3, 2].slice(0, apps.length);
  const allocations: S['FinancialAllocation'][] =
    quantity > 0 && apps.length
      ? apps.map((app, i) => ({
          attribution: { app_id: app.id, name: app.slug },
          quantity: split(quantity, weights)[i],
          gross_millicents: split(gross, weights)[i],
          allowance_millicents: split(allowance, weights)[i],
          net_millicents: split(net, weights)[i],
        }))
      : [];
  const reasons = (missing: boolean) => [
    ...(beforeRetention ? ['retention_started_during_or_after_period'] : []),
    ...(missing ? ['missing_sampling_windows'] : []),
  ];
  const forecast = (
    meter: string,
    price: S['FinancialPrice'],
    projected?: number
  ): S['FinancialForecast'] => ({
    method: 'elapsed_time_run_rate_v1',
    available: projected !== undefined,
    ...(projected === undefined ? { reason: current ? 'meter_not_billed' : 'period_closed' } : {}),
    account_id: opts.accountId,
    period_start: iso(start),
    period_end: iso(end),
    complete_through: iso(asOf),
    price_version: price.version,
    meter,
    currency: 'USD',
    ...(projected !== undefined
      ? {
          projected_quantity: projected,
          projected_net_millicents: priced(projected) - priced(Math.min(projected, included)),
        }
      : {}),
  });
  const computeMinutes = beforeRetention ? retained : expected;
  const egressMinutes = beforeRetention
    ? retained
    : current
      ? Math.max(0, expected - 95)
      : expected;
  const egressBytes = quantity > 0 ? Math.round(quantity * 1_450) : 0;
  const contract = (
    price: S['FinancialPrice'],
    mode: 'live' | 'off'
  ): S['FinancialPriceContract'] => ({
    price,
    plan: opts.plan,
    effective_from: iso(retainedFrom),
    delivery_mode: mode,
  });

  const meters: S['FinancialMeterCosts'][] = [
    {
      meter: 'compute',
      coverage: {
        complete: !beforeRetention && expected > 0 && computeMinutes === expected,
        fresh: true,
        expected_minutes: expected,
        complete_minutes: computeMinutes,
        unpriced_quantity: 0,
        non_billable_quantity: 0,
        reasons: reasons(computeMinutes !== expected),
      },
      accrued: {
        meter: 'compute',
        quantity,
        included_quantity: Math.min(quantity, included),
        net_millicents: net,
        allowance_method: 'largest_recorded_grant_shared_by_quantity',
        contracts: [
          {
            price: computePrice,
            quantity,
            included_quantity: Math.min(quantity, included),
            gross_millicents: gross,
            allowance_millicents: allowance,
            net_millicents: net,
            allocation_method: 'quantity_largest_remainder',
            allocations,
          },
        ],
      },
      // One complete day before a run rate (docs/billing.md, Coverage).
      forecast: forecast(
        'compute',
        computePrice,
        current && expected >= 1440
          ? Math.round((quantity * (end - start)) / MINUTE / expected)
          : undefined
      ),
      price_contracts: [contract(computePrice, 'live')],
    },
    {
      meter: 'egress',
      coverage: {
        complete: !beforeRetention && expected > 0 && egressMinutes === expected,
        fresh: true,
        expected_minutes: expected,
        complete_minutes: egressMinutes,
        unpriced_quantity: 0,
        non_billable_quantity: egressBytes,
        reasons: reasons(egressMinutes !== expected),
      },
      // No live price, so nothing is costed (financial_visibility.go:196-230).
      accrued: {
        meter: 'egress',
        quantity: 0,
        included_quantity: 0,
        net_millicents: 0,
        allowance_method: 'largest_recorded_grant_shared_by_quantity',
        contracts: [],
      },
      forecast: forecast('egress', egressPrice),
      price_contracts: [contract(egressPrice, 'off')],
    },
  ];

  return {
    account_id: opts.accountId,
    currency: 'USD',
    period_start: iso(start),
    period_end: iso(end),
    as_of: iso(asOf),
    retained_from: iso(retainedFrom),
    evidence_through_id: quantity > 0 ? 4_000 - back : 0,
    known_usage_millicents: net,
    meters,
    scope: 'retained_compute_and_interface_egress',
    invoices: opts.invoices.filter((i) => {
      const t = Date.parse(i.period_end);
      return t >= start && t < end;
    }),
    invoice_reconciliation: 'not_reconciled',
    missing_bill_components: [
      'subscription_and_addons',
      'credits_and_adjustments',
      'tax',
      'external_and_managed_resource_meters',
    ],
  };
}
