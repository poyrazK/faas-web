/**
 * Every amount apid reports for an account (overage, caps, forecasts, invoices,
 * outbound AI cost) is in US dollars: faas `pkg/financial/currency.go` and
 * ADR-1430. One formatter, so a currency change is one line.
 */
export const ACCOUNT_CURRENCY = 'USD' as const;

const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: ACCOUNT_CURRENCY });

/** Integer cents, as the overage cap and invoices carry them. */
export function formatCents(cents: number): string {
  return dollars.format(cents / 100);
}

/** Integer millicents (1/1000 of a cent), as forecasts and AI usage carry them. */
export function formatMillicents(millicents: number): string {
  return dollars.format(millicents / 100_000);
}
