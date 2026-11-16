import { useMemo } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { OpenNewWindow } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { InlinePhase, PageHeader, queryPhase } from '@/components/dashboard/primitives';
import { Pill, ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { useToast } from '@/components/ui/toast';
import { useBillingPortal, useInfiniteInvoices } from '@/lib/api/queries';
import { ApiError } from '@/lib/api/errors';
import { consoleHead } from '@/lib/seo';
import { FocusExport } from '@/components/dashboard/focus-export';
import { useWorkspaceTarget } from '@/lib/api/workspace-apps';
import { orgBillingMessage } from '@/components/dashboard/org-billing';
import { InvoiceSource } from '@/components/dashboard/invoice-source';
import { BillingIdentityPanel } from '@/components/dashboard/billing-identity';
import { InvoiceRefreshButton } from '@/components/dashboard/invoice-refresh';
import { useBillingStatus } from '@/lib/api/billing-identity';
import {
  invoiceStatusWord,
  invoicesAnswer,
  type InvoiceTone,
} from '@/components/dashboard/invoice-words';

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
  provider: string;
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

const TONE_COLOR: Record<InvoiceTone, string> = {
  good: 'var(--status-good)',
  warning: 'var(--status-warning)',
  critical: 'var(--status-critical)',
  none: 'var(--muted-foreground)',
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
  // Until the workspace is bound, a chosen company reads as null: wait, so
  // the personal history is never read or shown in a company workspace.
  const { ready } = useWorkspaceTarget();
  if (!ready) return <PageHeader title="Invoices" />;
  return <InvoicesBody />;
}

function InvoicesBody() {
  const { toast } = useToast();
  // A company workspace reads the organization's billing subject (same handler).
  const { org, label } = useWorkspaceTarget();
  const invoices = useInfiniteInvoices();
  const portal = useBillingPortal();
  // Shared with InvoiceSource's read; it decides where per-invoice refresh can
  // be answered. Company invoices are never refreshable (see below).
  const billing = useBillingStatus({ enabled: !org });
  const status = billing.data;
  // apid refreshes only the signed-in account's own invoices (404 otherwise),
  // answers 501 with billing off, and 409 without a provider customer or for
  // another provider's invoice (faas handlers_invoice_refresh.go:44-60,
  // pkg/billing/invoice_refresh.go ValidateInvoiceSource).
  const refreshable = (row: InvoiceRow) =>
    !org &&
    Boolean(status?.enabled && status.customer_configured) &&
    row.provider === status?.provider;
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
        provider: i.provider,
        status: i.status,
        period: `${formatDay(i.period_start)} – ${formatDay(i.period_end)}`,
        total: i.total_cents,
        currency: i.currency,
        createdAt: i.created_at,
      })),
    [data]
  );

  const answer = invoicesAnswer(
    rows.map((r) => ({
      number: r.number,
      status: r.status,
      total: formatMoney(r.total, r.currency),
      createdAt: r.createdAt,
    })),
    Boolean(invoices.hasNextPage)
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
      // A plain word; the provider's status stays in the title.
      render: (i) => (
        <span title={i.status}>
          <Pill label={invoiceStatusWord(i.status)} color={STATUS_COLOR[i.status]} />
        </span>
      ),
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
    {
      key: 'provider',
      label: '',
      sortable: false,
      width: 'w-12',
      render: (i) => (refreshable(i) ? <InvoiceRefreshButton id={i.id} number={i.number} /> : null),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Invoices"
        help="Payment methods and PDFs live in the provider's portal."
        actions={
          org ? (
            // The company portal needs the owner and a fresh step-up (faas
            // server.go:4709, OrgActionChangePlan); it follows plan changes.
            <p className="text-xs text-muted-foreground">
              {label}'s owner opens its billing portal.
            </p>
          ) : (
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
                      error: err,
                    })
                  );
              }}
            >
              <OpenNewWindow className="h-3.5 w-3.5" />
              Billing portal
            </Button>
          )
        }
      />
      {!listLoading && !listError && (
        <p
          role="status"
          aria-label="Invoices status"
          className="flex max-w-[44rem] items-start gap-2.5 text-lg leading-7 font-semibold tracking-[-0.01em] text-balance"
        >
          <span
            aria-hidden
            className="mt-2.5 inline-block size-2 shrink-0 rounded-full"
            style={{ background: TONE_COLOR[answer.tone] }}
          />
          {answer.sentence}
        </p>
      )}
      <InvoiceSource org={org} />
      {org && listError instanceof ApiError && listError.code === 'org_role_forbidden' ? (
        <p role="status" className="text-sm text-muted-foreground">
          {orgBillingMessage(listError, label, 'invoices')}
        </p>
      ) : (
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
      )}
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
      {/* The FOCUS export and the billing identity are the signed-in account's own
          (faas handlers_billing_identity.go:62 writes acct.ID; no org variant). */}
      {!org && <FocusExport />}
      {!org && <BillingIdentityPanel />}
    </div>
  );
}
