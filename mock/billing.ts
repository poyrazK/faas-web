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
