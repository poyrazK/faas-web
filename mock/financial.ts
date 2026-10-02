import type { components } from '../src/lib/api/schema';
import * as db from './data';

// Dev-only retained-evidence fixture. A partial first period cannot produce a
// forecast, even when its observed costs and allocation sums are known.
export function financialReport(month: string): components['schemas']['FinancialCostsResponse'] {
  const start = new Date(`${month}-01T00:00:00Z`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  const asOf = new Date(Math.min(Date.now(), end.getTime()));
  const app = db.apps[0];
  const net = app ? 10000 : 0;
  const price = {
    version: 'mock-compute-pro-v1',
    meter: 'compute',
    currency: 'EUR' as const,
    unit: 'mb_seconds',
    unit_quantity: 3686400,
    millicents_per_unit: 1000,
    included_quantity: 250 * 3686400,
  };
  return {
    account_id: db.account.id ?? 'mock-account',
    currency: 'EUR',
    period_start: start.toISOString(),
    period_end: end.toISOString(),
    as_of: asOf.toISOString(),
    retained_from: new Date(start.getTime() + 3600000).toISOString(),
    evidence_through_id: app ? 1 : 0,
    known_usage_millicents: net,
    scope: 'retained_compute_and_interface_egress',
    invoices: [],
    invoice_reconciliation: 'not_reconciled',
    missing_bill_components: [
      'subscription_and_addons',
      'credits_and_adjustments',
      'tax',
      'external_and_managed_resource_meters',
    ],
    meters: [
      {
        meter: 'compute',
        coverage: {
          complete: false,
          fresh: true,
          expected_minutes: Math.max(0, Math.floor((asOf.getTime() - start.getTime()) / 60000)),
          complete_minutes: 0,
          unpriced_quantity: 0,
          non_billable_quantity: 0,
          reasons: ['retention_started_during_or_after_period'],
        },
        accrued: {
          meter: 'compute',
          quantity: app ? 260 * 3686400 : 0,
          included_quantity: app ? price.included_quantity : 0,
          net_millicents: net,
          allowance_method: 'maximum_period_grant_quantity_share_v1',
          contracts: [
            {
              price,
              quantity: app ? 260 * 3686400 : 0,
              included_quantity: app ? price.included_quantity : 0,
              gross_millicents: app ? 260000 : 0,
              allowance_millicents: app ? 250000 : 0,
              net_millicents: net,
              allocation_method: 'quantity_share_largest_remainder_v1',
              allocations: app
                ? [
                    {
                      attribution: { app_id: app.id, name: app.slug },
                      quantity: 260 * 3686400,
                      gross_millicents: 260000,
                      allowance_millicents: 250000,
                      net_millicents: net,
                    },
                  ]
                : [],
            },
          ],
        },
        forecast: {
          account_id: db.account.id ?? 'mock-account',
          period_start: start.toISOString(),
          period_end: end.toISOString(),
          complete_through: asOf.toISOString(),
          price_version: price.version,
          meter: 'compute',
          currency: 'EUR',
          method: 'elapsed_time_run_rate_v1',
          available: false,
          reason: 'incomplete_coverage',
        },
        price_contracts: [
          { price, plan: 'pro', effective_from: start.toISOString(), delivery_mode: 'live' },
        ],
      },
    ],
  };
}
