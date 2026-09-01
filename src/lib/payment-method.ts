import type { components } from '@/lib/api/schema';

export type PaymentMethod = components['schemas']['PaymentMethodSummary'];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Visa •••• 4242 · 09/28" — brand, last4, expiry, nothing else exists to show. */
export const cardLabel = (pm: PaymentMethod) =>
  `${cap(pm.brand)} •••• ${pm.last4} · ${String(pm.exp_month).padStart(2, '0')}/${String(pm.exp_year).slice(-2)}`;

/** Cards expire at the end of their month; warn inside 60 days of that. */
export function cardExpiring(pm: PaymentMethod, now: Date): boolean {
  const end = new Date(Date.UTC(pm.exp_year, pm.exp_month, 0, 23, 59, 59));
  return end.getTime() - now.getTime() < 60 * 86_400_000;
}
