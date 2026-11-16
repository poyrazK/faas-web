import { describe, expect, it } from 'vitest';
import { invoiceStatusWord, invoicesAnswer, type InvoiceFacts } from './invoice-words';

const inv = (
  number: string,
  status: string,
  createdAt: string,
  total = '€58.31'
): InvoiceFacts => ({
  number,
  status,
  total,
  createdAt,
});

describe('invoicesAnswer', () => {
  it('says when there are none', () => {
    expect(invoicesAnswer([], false).tone).toBe('none');
  });

  it('puts an uncollected invoice first, then one awaiting payment', () => {
    expect(
      invoicesAnswer(
        [inv('A', 'open', '2026-11-01'), inv('B', 'uncollectible', '2026-10-01', '€9.00')],
        false
      ).sentence
    ).toBe(
      'Invoice B for €9.00 could not be collected. Update your payment method in the billing portal.'
    );
    expect(
      invoicesAnswer([inv('A', 'open', '2026-11-01'), inv('B', 'paid', '2026-10-01')], false)
    ).toEqual({
      tone: 'warning',
      sentence: 'Invoice A for €58.31 is awaiting payment.',
    });
  });

  it('speaks of recent invoices while older pages are unread', () => {
    const paid = [inv('A', 'paid', '2026-10-01', '€1.00'), inv('B', 'paid', '2026-11-01', '€2.00')];
    expect(invoicesAnswer(paid, true).sentence).toBe(
      'Your 2 most recent invoices are paid; the latest was €2.00. Nothing needs your attention.'
    );
    expect(invoicesAnswer(paid, false).sentence).toMatch(/^All 2 invoices are paid/);
  });
});

describe('invoiceStatusWord', () => {
  it('words provider statuses and keeps unknown ones as they are', () => {
    expect(invoiceStatusWord('open')).toBe('Awaiting payment');
    expect(invoiceStatusWord('refunded')).toBe('Refunded');
  });
});
