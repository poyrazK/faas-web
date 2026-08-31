import { describe, expect, it } from 'vitest';
import { cardExpiring, cardLabel } from './payment-method';

describe('card on file', () => {
  it('formats brand, last4 and expiry', () => {
    expect(cardLabel({ brand: 'visa', last4: '4242', exp_month: 9, exp_year: 2028 })).toBe(
      'Visa •••• 4242 · 09/28'
    );
  });

  it('flags a card expiring within 60 days', () => {
    const pm = { brand: 'mastercard', last4: '1111', exp_month: 9, exp_year: 2026 };
    expect(cardExpiring(pm, new Date('2026-08-31'))).toBe(true);
    expect(cardExpiring(pm, new Date('2026-05-01'))).toBe(false);
  });
});
