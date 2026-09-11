import { useMemo } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { OpenNewWindow } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { InlinePhase, PageHeader, queryPhase } from '@/components/dashboard/primitives';
import { Pill, ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { useToast } from '@/components/ui/toast';
import { useBillingPortal, useInfiniteInvoices } from '@/lib/api/queries';
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
  const invoices = useInfiniteInvoices();
  const portal = useBillingPortal();
  const data = useMemo(
    () => invoices.data?.pages.flatMap((page) => page.items) ?? [],
    [invoices.data]
  );
  // Keep already loaded invoices usable if an older page fails; only an
  // initial failure should replace the table with its full-page error state.
  const listError = data.length === 0 ? invoices.error : undefined;
  const listLoading = invoices.isPending && !invoices.error && data.length === 0;

  const rows = useMemo<InvoiceRow[]>(
    () =>
      data.map((i) => ({
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
      <ResourceTable
        rows={rows}
        columns={columns}
        initialSort={{ key: 'createdAt', dir: 'desc' }}
        searchKeys={['number', 'status']}
        searchPlaceholder="Filter by invoice number…"
        emptyMessage="No invoices yet."
        minWidth="min-w-[760px]"
        loading={listLoading}
        error={listError}
        onRetry={() => void invoices.refetch()}
      />
      {data.length > 0 && Boolean(invoices.error) && (
        <div className="flex flex-wrap items-center justify-center gap-3">
          <InlinePhase phase={queryPhase({ error: invoices.error })} error={invoices.error} />
          <Button
            size="xs"
            variant="ghost"
            onClick={() =>
              void (
                invoices.isFetchNextPageError ? invoices.fetchNextPage() : invoices.refetch()
              ).catch(() => undefined)
            }
          >
            Retry
          </Button>
        </div>
      )}
      {invoices.hasNextPage && (
        <div className="flex justify-center">
          <Button
            size="sm"
            variant="outline"
            busy={invoices.isFetchingNextPage}
            onClick={() => void invoices.fetchNextPage().catch(() => undefined)}
          >
            Load older invoices
          </Button>
        </div>
      )}
    </div>
  );
}
