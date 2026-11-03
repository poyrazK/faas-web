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

const rates = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: ACCOUNT_CURRENCY,
  minimumFractionDigits: 2,
  maximumFractionDigits: 5,
});

/**
 * A unit price in integer millicents. A rate can be a fraction of a cent (a
 * per-byte price), which `formatMillicents` would round to $0.00, so this
 * keeps every millicent: five decimal places of a dollar.
 */
export function formatMillicentRate(millicents: number): string {
  return rates.format(millicents / 100_000);
}

/**
 * Dollars typed by a person ("10", "$8.50") as exact integer millicents, or
 * undefined. Whole cents only, and no float ever multiplies the amount: the
 * digits are joined, so "0.29" is 29_000 and not 28_999.
 */
export function parseUsdMillicents(text: string): number | undefined {
  const match = /^\$?((?:0|[1-9]\d*))(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) return undefined;
  const value = Number(`${match[1]}${(match[2] ?? '').padEnd(2, '0')}`) * 1000;
  return Number.isSafeInteger(value) ? value : undefined;
}
