import { useState } from 'react';
import { Refresh } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useOrgBillingStatus } from '@/lib/api/org-billing';
import {
  useBackfillInvoices,
  useBillingStatus,
  type BackfillTotals,
  type BillingStatus,
} from '@/lib/api/billing-identity';
import { InlinePhase, queryPhase } from './primitives';

const PROVIDER_NAMES: Record<string, string> = {
  stripe: 'Stripe',
  paddle: 'Paddle',
  polar: 'Polar',
};

type Tone = 'good' | 'warning' | 'critical' | 'muted';
const TONE: Record<Tone, string> = {
  good: 'var(--status-good)',
  warning: 'var(--status-warning)',
  critical: 'var(--status-critical)',
  muted: 'var(--chart-muted)',
};

function facts(status: BillingStatus): { label: string; tone: Tone }[] {
  const provider = PROVIDER_NAMES[status.provider] ?? status.provider;
  const out: { label: string; tone: Tone }[] = [
    {
      label: provider ? `Billed through ${provider}` : 'No billing provider configured',
      tone: provider ? 'good' : 'warning',
    },
    status.customer_configured
      ? { label: 'Customer linked', tone: 'good' }
      : { label: 'No billing customer yet', tone: 'muted' },
    status.subscription_configured
      ? { label: 'Subscription attached', tone: 'good' }
      : { label: 'No subscription', tone: 'muted' },
    status.usage_reconciliation_enabled
      ? { label: 'Usage reconciled', tone: 'good' }
      : { label: 'Usage reconciliation off', tone: 'muted' },
  ];
  if (status.account_status === 'past_due')
    out.push({ label: 'Payment past due', tone: 'warning' });
  if (status.account_status === 'suspended') out.push({ label: 'Suspended', tone: 'critical' });
  return out;
}

function summary(totals: BackfillTotals): { title: string; description: string } {
  const provider = PROVIDER_NAMES[totals.provider] ?? totals.provider;
  const more = totals.nextCursor ? ' More provider history remains — continue to import it.' : '';
  if (totals.imported === 0)
    return {
      title: totals.nextCursor ? 'No new invoices yet' : 'Invoices are up to date',
      description: `Checked ${totals.scanned} records at ${provider}.${more}`,
    };
  return {
    title: `${totals.imported} ${totals.imported === 1 ? 'invoice' : 'invoices'} imported`,
    description: `Checked ${totals.scanned} records at ${provider}; ${totals.skipped} already stored or missing the facts to import.${more}`,
  };
}

/**
 * Where invoices come from, as one line over the list, from
 * `GET /v1/billing/status` (faas pkg/apid/apidserver/handlers_billing_status.go).
 *
 * "Refresh invoices" imports provider documents this account is missing via
 * `POST /v1/invoices/backfill`. apid answers 409 without a provider customer
 * and 501 with billing off (handlers_invoice_backfill.go:258,274), so the
 * action only appears when both hold. It inserts missing rows only: existing
 * invoices are never rewritten, and each page commits atomically upstream.
 * In a company workspace the line shows the organization's status and the
 * refresh is left out.
 */
export function InvoiceSource({ org }: { org?: string | null }) {
  const { toast } = useToast();
  // A company reads its own status through the same handler (faas
  // server.go:4723, getBillingStatus). Backfill has no org variant: it imports the
  // signed-in account's invoices only (handlers_invoice_backfill.go:98).
  const personal = useBillingStatus({ enabled: !org });
  const company = useOrgBillingStatus(org ?? '');
  const status = org ? company : personal;
  const backfill = useBackfillInvoices();
  // Held when a walk stopped at its page budget, so the next one resumes.
  const [cursor, setCursor] = useState<string | undefined>();

  // The invoice list already names who can see a company's billing.
  if (org && status.error instanceof ApiError && status.error.code === 'org_role_forbidden')
    return null;
  if (!status.data)
    return (
      <InlinePhase
        phase={queryPhase({ error: status.error, loading: status.isPending })}
        error={status.error}
        loadingMessage="Reading billing status…"
        onRetry={() => void status.refetch()}
      />
    );

  const s = status.data;
  const refresh = () =>
    void backfill
      .mutateAsync(cursor)
      .then((totals) => {
        setCursor(totals.nextCursor);
        toast({ kind: 'success', ...summary(totals) });
      })
      .catch((err: unknown) =>
        toast({
          kind: 'error',
          title: 'Could not refresh invoices',
          description: errorMessage(err),
        })
      );

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-border bg-card px-4 py-2.5">
      {s.enabled ? (
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {facts(s).map((fact) => (
            <li key={fact.label} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: TONE[fact.tone] }}
              />
              {fact.label}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">
          Billing is off on this deployment. Plans are not charged and no invoices are issued.
        </p>
      )}
      {!org && s.enabled && s.customer_configured && (
        <Button
          size="xs"
          variant="ghost"
          className="gap-1.5"
          busy={backfill.isPending}
          aria-label={cursor ? 'Continue refreshing invoices' : 'Refresh invoices'}
          title={`Import invoices from ${PROVIDER_NAMES[s.provider] ?? s.provider} that are missing here`}
          onClick={refresh}
        >
          <Refresh className="h-3 w-3" />
          {cursor ? 'Continue refresh' : 'Refresh invoices'}
        </Button>
      )}
    </div>
  );
}
