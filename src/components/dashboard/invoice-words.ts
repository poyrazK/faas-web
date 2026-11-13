/**
 * The Invoices page in plain words (docs/console-plain-english.md): one state
 * sentence over the loaded invoices, and each provider status as a word.
 * Built only from the invoice list; while older pages are unread the sentence
 * speaks of the recent invoices, never of "every" invoice.
 */

export type InvoiceTone = 'good' | 'warning' | 'critical' | 'none';

/** Provider lifecycle words (Invoice.status); the exact status stays in a title. */
export const INVOICE_STATUS_WORDS: Record<string, string> = {
  paid: 'Paid',
  open: 'Awaiting payment',
  draft: 'Draft',
  void: 'Voided',
  uncollectible: 'Not collected',
};

export const invoiceStatusWord = (status: string) =>
  INVOICE_STATUS_WORDS[status] ?? status.charAt(0).toUpperCase() + status.slice(1);

export interface InvoiceFacts {
  number: string;
  status: string;
  /** Already formatted in the invoice's own currency. */
  total: string;
  createdAt: string;
}

export function invoicesAnswer(
  invoices: readonly InvoiceFacts[],
  more: boolean
): { tone: InvoiceTone; sentence: string } {
  if (invoices.length === 0)
    return {
      tone: 'none',
      sentence: 'You have no invoices yet. They appear here once a billing period closes.',
    };
  const one = (list: readonly InvoiceFacts[], verb: string, verbs: string) =>
    list.length === 1
      ? `Invoice ${list[0].number} for ${list[0].total} ${verb}.`
      : `${list.length} invoices ${verbs}.`;

  const uncollected = invoices.filter((i) => i.status === 'uncollectible');
  if (uncollected.length)
    return {
      tone: 'critical',
      sentence: `${one(uncollected, 'could not be collected', 'could not be collected')} Update your payment method in the billing portal.`,
    };
  const open = invoices.filter((i) => i.status === 'open');
  if (open.length)
    return {
      tone: 'warning',
      sentence: one(open, 'is awaiting payment', 'are awaiting payment'),
    };
  const billed = invoices.filter((i) => i.status === 'paid');
  if (billed.length === 0)
    return { tone: 'none', sentence: 'No invoice is due. Nothing needs your attention.' };
  const latest = [...billed].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  const all =
    billed.length === 1
      ? 'Your invoice is paid'
      : more
        ? `Your ${billed.length} most recent invoices are paid`
        : `All ${billed.length} invoices are paid`;
  return {
    tone: 'good',
    sentence: `${all}; the latest was ${latest.total}. Nothing needs your attention.`,
  };
}
