import { useMemo } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { OpenNewWindow } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { InlinePhase, PageHeader, Panel, queryPhase } from '@/components/dashboard/primitives';
import { Pill, ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { useToast } from '@/components/ui/toast';
import { useBillingPortal, useBillingPortalInfo, useInvoices } from '@/lib/api/queries';
import { cardExpiring, cardLabel } from '@/lib/payment-method';
import { errorMessage } from '@/lib/api/errors';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/invoices')({
  component: InvoicesPage,
  head: () => consoleHead('invoices'),
});

/**
 * Invoices, from `/v1/invoices`.
 *
 * Amounts are integer cents in a single currency, so they are formatted here
 * rather than trusted to a locale guess. The PDF and any payment action live in
 * the provider's hosted portal — card details never reach this app — so the
 * page links out rather than rendering a document it does not have.
 */
interface InvoiceRow {
  id: string;
  number: string;
  status: string;
  period: string;
  total: number;
  currency: string;
  createdAt: string;
}

const STATUS_COLOR: Record<string, string> = {
  paid: 'var(--status-good)',
  open: 'var(--status-warning)',
  draft: 'var(--chart-muted)',
  void: 'var(--chart-muted)',
  uncollectible: 'var(--status-critical)',
};

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function formatDay(value: string): string {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? '—' : new Date(ms).toLocaleDateString();
}

function InvoicesPage() {
  const { toast } = useToast();
  const { data, isPending, error, refetch } = useInvoices();
  const portal = useBillingPortal();
  const portalInfo = useBillingPortalInfo();

  const rows = useMemo<InvoiceRow[]>(
    () =>
      (data?.items ?? []).map((i) => ({
        id: i.id,
        number: i.number ?? i.provider_invoice_id,
        status: i.status,
        period: `${formatDay(i.period_start)} – ${formatDay(i.period_end)}`,
        total: i.total_cents,
        currency: i.currency,
        createdAt: i.created_at,
      })),
    [data]
  );

  const columns: Column<InvoiceRow>[] = [
    {
      key: 'number',
      label: 'Invoice',
      render: (i) => <span className="font-mono text-xs">{i.number}</span>,
    },
    {
      key: 'status',
      label: 'Status',
      width: 'w-32',
      render: (i) => <Pill label={i.status} color={STATUS_COLOR[i.status]} />,
    },
    { key: 'period', label: 'Period' },
    {
      key: 'total',
      label: 'Total',
      numeric: true,
      render: (i) => (
        <span className="[font-variant-numeric:tabular-nums]">
          {formatMoney(i.total, i.currency)}
        </span>
      ),
    },
    {
      key: 'createdAt',
      label: 'Issued',
      numeric: true,
      render: (i) => (
        <span className="text-xs text-muted-foreground">{formatDay(i.createdAt)}</span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Invoices"
        description="Billing history. Payment methods and PDFs live in the provider's portal."
        actions={
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={portal.isPending}
            onClick={() => {
              void portal
                .mutateAsync()
                .then((result) => {
                  // A full-page navigation, not a fetch — it is another origin.
                  if (result.url) window.location.href = result.url;
                })
                .catch((err: unknown) =>
                  toast({
                    kind: 'error',
                    title: 'Could not open the billing portal',
                    description: errorMessage(err),
                  })
                );
            }}
          >
            <OpenNewWindow className="h-3.5 w-3.5" />
            Billing portal
          </Button>
        }
      />
      <Panel
        title="Payment method"
        description="The card the provider bills. Updating it happens in the billing portal."
      >
        {(() => {
          const phase = queryPhase({
            error: portalInfo.error,
            loading: portalInfo.isPending,
            isEmpty: false,
          });
          if (phase !== 'ready') {
            return (
              <InlinePhase
                phase={phase}
                error={portalInfo.error}
                loadingMessage="Reading the card on file…"
                emptyMessage=""
              />
            );
          }
          const pm = portalInfo.data?.payment_method;
          if (!pm) {
            return (
              <p className="text-sm text-muted-foreground">
                No card on file. Paid plans need one before the first invoice.
              </p>
            );
          }
          return (
            <div className="flex items-center gap-3">
              <span className="font-mono text-sm">{cardLabel(pm)}</span>
              {cardExpiring(pm, new Date()) && (
                <Pill label="expires soon" color="var(--status-warning)" />
              )}
            </div>
          );
        })()}
      </Panel>

      <ResourceTable
        rows={rows}
        columns={columns}
        initialSort={{ key: 'createdAt', dir: 'desc' }}
        searchKeys={['number', 'status']}
        searchPlaceholder="Filter by invoice number…"
        emptyMessage="No invoices yet."
        minWidth="min-w-[760px]"
        loading={isPending}
        error={error}
        onRetry={() => void refetch()}
      />
    </div>
  );
}
