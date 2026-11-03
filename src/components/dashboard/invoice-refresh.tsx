import { Refresh } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useRefreshInvoice, type InvoiceRefresh } from '@/lib/api/billing-identity';

const PROVIDER_NAMES: Record<string, string> = {
  stripe: 'Stripe',
  paddle: 'Paddle',
  polar: 'Polar',
};

/** Why the provider's lines fell back to one total (InvoiceRefreshResponse.source_gap). */
const GAP: Record<NonNullable<InvoiceRefresh['source_gap']>, string> = {
  unavailable: 'but the provider has no line detail for it',
  incomplete: 'but the provider sent an incomplete set',
  empty: 'but the provider lists none',
  unclassified: 'but some could not be classified',
  tax_in_non_tax_lines: 'but tax is folded into non-tax lines',
  totals_mismatch: "but they do not add up to the invoice's total",
};

const UNCHANGED = 'Amounts and payment state are unchanged.';

/** What a refresh found, in words. Pure, so every gap can be tested. */
export function refreshOutcome(result: InvoiceRefresh): {
  kind: 'success' | 'info';
  description: string;
} {
  const lines = `${result.line_items} line ${result.line_items === 1 ? 'item' : 'items'}`;
  if (result.detailed)
    return { kind: 'success', description: `${lines}, complete and reconciled. ${UNCHANGED}` };
  const gap = result.source_gap ? GAP[result.source_gap] : 'but they are not complete';
  return {
    kind: 'info',
    description: `${lines}, ${gap}, so it is kept as one total. ${UNCHANGED}`,
  };
}

/**
 * A refusal in words, by its code (faas handlers_invoice_refresh.go:79-95). The
 * 422 limit carries its own sentence with the limit in it, so that one is
 * passed through.
 */
export function refreshFailure(err: unknown): string {
  if (err instanceof ApiError)
    switch (err.code) {
      case 'not_implemented':
        return 'Your billing provider does not support refreshing invoice details.';
      case 'conflict':
        return "The invoice changed while it was refreshing, or the provider's copy no longer matches it. Try again in a moment.";
      case 'not_found':
        return 'This invoice is no longer in your billing history.';
      case 'capacity_unavailable':
        return 'The provider could not be reached, so the invoice was not changed. Try again later.';
    }
  return errorMessage(err);
}

/**
 * Re-reads one invoice's line items and lifecycle from the billing provider.
 * Offered only where apid can answer: the caller passes rows of the
 * signed-in account, with billing on, a provider customer linked, and the
 * invoice from the active provider (handlers_invoice_refresh.go:44-60).
 */
export function InvoiceRefreshButton({ id, number }: { id: string; number: string }) {
  const { toast } = useToast();
  const refresh = useRefreshInvoice();
  return (
    <Button
      size="xs"
      variant="ghost"
      className="gap-1.5"
      busy={refresh.isPending}
      aria-label={`Refresh details for ${number}`}
      title="Re-read this invoice's line items from the billing provider"
      onClick={() =>
        void refresh
          .mutateAsync(id)
          .then((result) =>
            toast({
              ...refreshOutcome(result),
              title: `${number} refreshed from ${PROVIDER_NAMES[result.provider] ?? result.provider}`,
            })
          )
          .catch((err: unknown) =>
            toast({
              kind: 'error',
              title: `Could not refresh ${number}`,
              description: refreshFailure(err),
              error: err,
            })
          )
      }
    >
      <Refresh className="h-3 w-3" />
      Refresh
    </Button>
  );
}
