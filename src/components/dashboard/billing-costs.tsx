import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle, Circle, Clock, Lock, WarningTriangle } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { Timestamp } from '@/components/ui/timestamp';
import { useMfa } from '@/components/auth/mfa-provider';
import { ApiError } from '@/lib/api/errors';
import {
  costMonths,
  monthLabel,
  useFinancialCosts,
  type FinancialCosts,
  type FinancialMeterCosts,
} from '@/lib/api/billing-costs';
import { formatMillicentRate, formatMillicents } from '@/lib/money';
import { formatUsageBytes, formatUsageNumber } from '@/lib/usage-format';
import { InlinePhase, Panel, queryPhase } from './primitives';
import { ResourceTable, type Column } from './resource-table';

/**
 * The account's attributable usage costs for one UTC month, from
 * `GET /v1/billing/costs` (faas handlers_financial.go:15-41,
 * pkg/billing/financial_visibility.go:20-81, docs/billing.md:79-140).
 *
 * What the report is and is not, in the console's words as in apid's: a known
 * usage subtotal priced at the rate in force when the usage happened, for the
 * meters its `scope` names; coverage gaps reported per meter rather than filled
 * in; the bill components it leaves out named; and stored provider invoices
 * listed beside it as separate, unreconciled facts that are never added to it.
 */

const METER_NAMES: Record<string, string> = {
  compute: 'Compute',
  egress: 'Interface egress',
  object_storage: 'Object storage',
};

/** The unit each meter is priced in (faas pkg/meter/financial.go:42,47; financial_object_storage.go:62). */
const METER_UNITS: Record<string, string> = {
  compute: 'mb_seconds',
  egress: 'interface_bytes',
  object_storage: 'stored_byte_hours',
};

const SCOPES: Record<string, string> = {
  retained_compute_and_interface_egress: 'compute and interface egress',
  retained_compute_interface_egress_and_object_storage:
    'compute, interface egress and object storage',
};

/** faas financial_visibility.go:53 — everything on a bill the report does not price. */
const MISSING_COMPONENTS: Record<string, string> = {
  subscription_and_addons: 'Subscription and add-ons',
  credits_and_adjustments: 'Credits and adjustments',
  tax: 'Tax',
  external_and_managed_resource_meters: 'External and managed resource meters',
};

const words = (code: string) => code.replace(/_/g, ' ');
const sentence = (code: string) => {
  const text = words(code);
  return text.charAt(0).toUpperCase() + text.slice(1);
};
const meterName = (meter: string) => METER_NAMES[meter] ?? sentence(meter);

function meterUnit(m: FinancialMeterCosts): string {
  return (
    m.accrued.contracts[0]?.price.unit ??
    m.price_contracts[0]?.price.unit ??
    METER_UNITS[m.meter] ??
    ''
  );
}

const plural = (value: number, unit: string) => `${unit}${value === 1 ? '' : 's'}`;

/** A meter quantity in the unit people read it in. Display only; never priced here. */
export function formatQuantity(quantity: number, unit: string): string {
  if (unit === 'mb_seconds') {
    const gbHours = quantity / 1024 / 3600;
    return `${formatUsageNumber(gbHours)} ${plural(gbHours, 'GB-hour')}`;
  }
  if (unit === 'interface_bytes') return formatUsageBytes(quantity);
  if (unit === 'stored_byte_hours') {
    const gibHours = quantity / 2 ** 30;
    return `${formatUsageNumber(gibHours)} ${plural(gibHours, 'GiB-hour')}`;
  }
  return `${quantity.toLocaleString()}${unit ? ` ${words(unit)}` : ''}`;
}

/** Every reason apid gives (financial_visibility.go:147-214, financial_object_storage.go:51). */
function reasonSentence(reason: string, m: FinancialMeterCosts, retainedFrom: string) {
  switch (reason) {
    case 'retention_started_during_or_after_period':
      return (
        <>
          Usage history starts <Timestamp value={retainedFrom} mode="absolute" />, so usage before
          then is not in this report.
        </>
      );
    case 'missing_sampling_windows':
      return `${m.coverage.complete_minutes.toLocaleString()} of ${m.coverage.expected_minutes.toLocaleString()} sampling minutes are recorded. Missing minutes are not counted as zero usage; what they cost is unknown.`;
    case 'stale_evidence':
      return 'The newest evidence is not fresh, so the most recent usage may be missing.';
    case 'missing_historical_prices':
      return "Some usage has no price recorded for when it happened. It is left unpriced, not priced at today's rate.";
    case 'legacy_currency_prices':
      return 'Some usage was priced before the switch to US dollars. It is left unpriced rather than converted.';
    default:
      return `Reported gap: ${words(reason)}.`;
  }
}

/** A meter whose figure is not the whole story for the month. */
function hasGap(m: FinancialMeterCosts): boolean {
  const c = m.coverage;
  return !c.complete || !c.fresh || c.reasons.length > 0 || c.unpriced_quantity > 0;
}

function CoverageBadge({ gap }: { gap: boolean }) {
  const Icon = gap ? WarningTriangle : CheckCircle;
  const color = gap ? 'var(--status-warning)' : 'var(--status-good)';
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs"
      style={{ borderColor: `color-mix(in oklab, ${color} 35%, transparent)`, color }}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {gap ? 'Coverage gap' : 'Complete'}
    </span>
  );
}

const INVOICE_STATUS: Record<string, { color: string; icon: typeof CheckCircle }> = {
  paid: { color: 'var(--status-good)', icon: CheckCircle },
  open: { color: 'var(--status-warning)', icon: Clock },
  draft: { color: 'var(--chart-muted)', icon: Circle },
  void: { color: 'var(--chart-muted)', icon: Circle },
  uncollectible: { color: 'var(--status-critical)', icon: WarningTriangle },
};

function InvoiceStatus({ status }: { status: string }) {
  const { color, icon: Icon } = INVOICE_STATUS[status] ?? INVOICE_STATUS.draft;
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs"
      style={{ borderColor: `color-mix(in oklab, ${color} 35%, transparent)`, color }}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {sentence(status)}
    </span>
  );
}

type StepUpCode = 'mfa_required' | 'step_up_required';

function stepUpCode(error: unknown): StepUpCode | null {
  if (!(error instanceof ApiError)) return null;
  return error.code === 'mfa_required' || error.code === 'step_up_required' ? error.code : null;
}

/**
 * The route sits behind the session MFA gate (faas server.go:4783,
 * auth/middleware/middleware.go:1324-1339), which answers `mfa_required`.
 * Like the spend cap's write, the panel asks once and retries the read when
 * the person verifies; a refusal after that stays a notice with a button, so a
 * session that cannot pass is never trapped in a prompt loop.
 */
function useStepUpOnce(error: unknown, retry: () => void) {
  const { openMfa } = useMfa();
  const code = stepUpCode(error);
  const asked = useRef(false);
  const prompt = useCallback(() => {
    if (!code) return;
    openMfa(code === 'mfa_required' ? 'choose' : 'verify', {
      reason: 'Costs are shown only to a session verified with your second factor.',
      // A recovery code clears a pending session but never stamps a step-up.
      allowRecovery: code === 'mfa_required',
      onVerified: retry,
    });
  }, [code, openMfa, retry]);
  useEffect(() => {
    if (!code || asked.current) return;
    asked.current = true;
    prompt();
  }, [code, prompt]);
  return { code, prompt };
}

/** The signed-in account's cost breakdown, for the personal Usage page. */
export function CostBreakdown() {
  // null is the current month, decided by the server.
  const [month, setMonth] = useState<string | null>(null);
  // The current report anchors the selector: its month and retention start.
  const anchor = useFinancialCosts(null);
  const costs = useFinancialCosts(month);
  const months = anchor.data ? costMonths(anchor.data.period_start, anchor.data.retained_from) : [];
  const { refetch } = costs;
  const retry = useCallback(() => void refetch(), [refetch]);
  const stepUp = useStepUpOnce(costs.error, retry);
  const phase = queryPhase({ error: costs.error, loading: costs.isPending });

  return (
    <Panel
      title="Cost breakdown"
      help="Usage costs for one UTC month, priced at the rate in force when the usage happened. Not an invoice."
      actions={
        months.length > 0 && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Month
            <Select
              aria-label="Month"
              value={month ?? ''}
              onChange={(event) => setMonth(event.target.value || null)}
              className="h-8 text-xs"
            >
              {months.map((m, i) => (
                <option key={m} value={i === 0 ? '' : m}>
                  {monthLabel(m)}
                  {i === 0 ? ' (current)' : ''}
                </option>
              ))}
            </Select>
          </label>
        )
      }
    >
      {stepUp.code ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground"
        >
          <Lock className="h-4 w-4 shrink-0" aria-hidden />
          <span>
            {stepUp.code === 'mfa_required'
              ? 'Costs are shown only to a session verified with your second factor. Verify, or set one up, to see them.'
              : 'Costs need a recent code from your authenticator app.'}
          </span>
          <Button size="xs" variant="outline" onClick={stepUp.prompt}>
            Verify
          </Button>
        </div>
      ) : phase !== 'ready' ? (
        <InlinePhase
          phase={phase}
          error={costs.error}
          loadingMessage="Reading the cost breakdown…"
          onRetry={retry}
        />
      ) : (
        <CostReport report={costs.data!} />
      )}
    </Panel>
  );
}

interface MeterRow {
  id: string;
  name: string;
  unit: string;
  quantity: number;
  included: number;
  gross: number;
  allowance: number;
  net: number;
  gap: boolean;
  unpriced: number;
  nonBillable: number;
}

function meterRow(m: FinancialMeterCosts): MeterRow {
  // Each contract carries its own integer amounts; the meter has only the net.
  const sum = (pick: (c: FinancialMeterCosts['accrued']['contracts'][number]) => number) =>
    m.accrued.contracts.reduce((total, c) => total + pick(c), 0);
  return {
    id: m.meter,
    name: meterName(m.meter),
    unit: meterUnit(m),
    quantity: m.accrued.quantity,
    included: m.accrued.included_quantity,
    gross: sum((c) => c.gross_millicents),
    allowance: sum((c) => c.allowance_millicents),
    net: m.accrued.net_millicents,
    gap: hasGap(m),
    unpriced: m.coverage.unpriced_quantity,
    nonBillable: m.coverage.non_billable_quantity,
  };
}

const money = (millicents: number) => (
  <span className="whitespace-nowrap [font-variant-numeric:tabular-nums]">
    {formatMillicents(millicents)}
  </span>
);

// A phone keeps the meter, its known cost and its coverage in view; the
// quantities and the allowance fold into each row's details.
const METER_COLUMNS: Column<MeterRow>[] = [
  { key: 'name', label: 'Meter', render: (r) => <span className="font-medium">{r.name}</span> },
  {
    key: 'quantity',
    label: 'Usage',
    numeric: true,
    priority: 'secondary',
    render: (r) => (
      <>
        {/* Priced usage is zero when none of it has a live price; then the
            unpriced or unbilled quantity is the fact, not a "0". */}
        {(r.quantity > 0 || (r.unpriced === 0 && r.nonBillable === 0)) && (
          <span className="block">{formatQuantity(r.quantity, r.unit)}</span>
        )}
        {r.unpriced > 0 && (
          <span className="block text-xs" style={{ color: 'var(--status-warning)' }}>
            {formatQuantity(r.unpriced, r.unit)} unpriced
          </span>
        )}
        {r.nonBillable > 0 && (
          <span className="block text-xs text-muted-foreground">
            {formatQuantity(r.nonBillable, r.unit)} not billed
          </span>
        )}
      </>
    ),
  },
  {
    key: 'included',
    label: 'In allowance',
    numeric: true,
    priority: 'secondary',
    render: (r) => formatQuantity(r.included, r.unit),
  },
  {
    key: 'gross',
    label: 'Before allowance',
    numeric: true,
    priority: 'secondary',
    render: (r) => money(r.gross),
  },
  {
    key: 'allowance',
    label: 'Allowance value',
    numeric: true,
    priority: 'secondary',
    render: (r) => money(r.allowance),
  },
  { key: 'net', label: 'Known cost', numeric: true, render: (r) => money(r.net) },
  {
    key: 'gap',
    label: 'Coverage',
    sortable: false,
    render: (r) => <CoverageBadge gap={r.gap} />,
  },
];

interface InvoiceRow {
  id: string;
  number: string;
  status: string;
  period: string;
  periodEnd: string;
  total: number;
  currency: string;
}

const day = (iso: string) => {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? '—' : new Date(ms).toLocaleDateString(undefined, { timeZone: 'UTC' });
};

/** Invoice money is integer cents in the invoice's own currency (the Invoice schema). */
const invoiceTotal = (cents: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase() }).format(
    cents / 100
  );

const INVOICE_COLUMNS: Column<InvoiceRow>[] = [
  {
    key: 'number',
    label: 'Invoice',
    render: (r) => <span className="font-mono text-xs">{r.number}</span>,
  },
  { key: 'status', label: 'Status', render: (r) => <InvoiceStatus status={r.status} /> },
  { key: 'periodEnd', label: 'Period', priority: 'secondary', render: (r) => r.period },
  {
    key: 'total',
    label: 'Total',
    numeric: true,
    render: (r) => (
      <span className="[font-variant-numeric:tabular-nums]">
        {invoiceTotal(r.total, r.currency)}
      </span>
    ),
  },
];

const DELIVERY: Record<string, string> = {
  live: 'Billed',
  shadow: 'Shadow, not billed',
  off: 'Off, not billed',
};

function CostReport({ report }: { report: FinancialCosts }) {
  const month = monthLabel(report.period_start.slice(0, 7));
  const scope = SCOPES[report.scope] ?? words(report.scope);
  const rows = report.meters.map(meterRow);
  const gaps = report.meters.filter(hasGap);
  const contracts = report.meters.flatMap((m) =>
    m.price_contracts.map((c) => ({ meter: m.meter, ...c }))
  );
  const invoices: InvoiceRow[] = report.invoices.map((i) => ({
    id: i.id,
    number: i.number ?? i.provider_invoice_id,
    status: i.status,
    period: `${day(i.period_start)} – ${day(i.period_end)}`,
    periodEnd: i.period_end,
    total: i.total_cents,
    currency: i.currency,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="label-mono text-muted-foreground">Known usage cost</p>
        <p
          data-testid="known-usage"
          className="mt-2 text-3xl leading-none font-semibold tracking-tight [font-variant-numeric:tabular-nums]"
        >
          {formatMillicents(report.known_usage_millicents)}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Priced usage of {scope} for {month} (UTC), as of{' '}
          <Timestamp value={report.as_of} mode="absolute" />. Not an invoice total.
          {gaps.length > 0 &&
            ` ${gaps.length} ${gaps.length === 1 ? 'meter has a coverage gap' : 'meters have coverage gaps'}, so this covers only what is known.`}
        </p>
      </div>

      <section aria-label="Cost by meter">
        <ResourceTable
          rows={rows}
          columns={METER_COLUMNS}
          emptyMessage="No meters were reported for this month."
          desktopMinWidth="md:min-w-[760px]"
        />
      </section>

      <div className="flex flex-col gap-2">
        <h3 className="label-mono text-foreground">Coverage</h3>
        {gaps.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle
              className="h-3.5 w-3.5 shrink-0"
              style={{ color: 'var(--status-good)' }}
              aria-hidden
            />
            Every meter is fully sampled, fresh and priced for this month.
          </p>
        ) : (
          <ul aria-label="Coverage gaps" className="flex flex-col gap-3 text-sm">
            {gaps.map((m) => {
              const unit = meterUnit(m);
              const lines = m.coverage.reasons.map((r) =>
                reasonSentence(r, m, report.retained_from)
              );
              if (m.coverage.unpriced_quantity > 0)
                lines.push(
                  `${formatQuantity(m.coverage.unpriced_quantity, unit)} is unpriced and not in the known cost.`
                );
              if (lines.length === 0) lines.push('Coverage is incomplete.');
              return (
                <li key={m.meter} className="flex items-start gap-2">
                  <WarningTriangle
                    className="mt-0.5 h-3.5 w-3.5 shrink-0"
                    style={{ color: 'var(--status-warning)' }}
                    aria-hidden
                  />
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="font-medium">{meterName(m.meter)}</span>
                    {lines.map((line, i) => (
                      <span key={i} className="text-muted-foreground">
                        {line}
                      </span>
                    ))}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {report.missing_bill_components.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="label-mono text-foreground">Not in this report</h3>
          <p className="text-sm text-muted-foreground">
            This report covers {scope} only. These parts of a bill are left out, so the known usage
            cost is not a bill estimate:
          </p>
          <ul aria-label="Not in this report" className="list-disc pl-5 text-sm">
            {report.missing_bill_components.map((c) => (
              <li key={c}>{MISSING_COMPONENTS[c] ?? sentence(c)}</li>
            ))}
          </ul>
        </div>
      )}

      {contracts.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs text-muted-foreground underline underline-offset-4">
            Prices in force this month
          </summary>
          <ul className="mt-3 flex flex-col gap-2">
            {contracts.map((c) => {
              const per = formatQuantity(c.price.unit_quantity, c.price.unit).replace(/^1 /, '');
              return (
                <li key={`${c.meter}:${c.price.version}:${c.effective_from}`}>
                  <span className="font-medium">{meterName(c.meter)}</span>{' '}
                  <span className="text-muted-foreground">
                    · {formatMillicentRate(c.price.millicents_per_unit)} per {per}
                    {c.price.included_quantity > 0 &&
                      ` after ${formatQuantity(c.price.included_quantity, c.price.unit)} included`}{' '}
                    · {sentence(c.plan)} plan · {DELIVERY[c.delivery_mode] ?? c.delivery_mode} ·
                    from <Timestamp value={c.effective_from} mode="absolute" />
                  </span>
                </li>
              );
            })}
          </ul>
        </details>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="label-mono text-foreground">Invoices with a period ending in {month}</h3>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border px-2 py-0.5 text-xs text-foreground"
            title="invoice_reconciliation: not_reconciled"
          >
            <Circle className="h-3 w-3" aria-hidden />
            Not reconciled
          </span>
          Provider invoices are separate records. They are not reconciled to the usage costs above,
          their periods can differ from the UTC usage month, and they are not added to the known
          usage cost.
        </p>
        {invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No provider invoice has a period ending in this month.
          </p>
        ) : (
          <section aria-label="Invoices">
            <ResourceTable
              rows={invoices}
              columns={INVOICE_COLUMNS}
              initialSort={{ key: 'periodEnd', dir: 'desc' }}
              desktopMinWidth="md:min-w-[560px]"
            />
          </section>
        )}
      </div>
    </div>
  );
}

/**
 * A company workspace's stand-in. apid serves the cost report for the signed-in
 * account only (handlers_financial.go:22 reads `acct.ID`, and server.go:4808-4815
 * gives organizations status, usage, invoices, portal, plan and spend cap, but
 * no costs), so the company Usage page says so instead of showing personal
 * figures under a company's name.
 */
export function CostBreakdownPersonalOnly({ label }: { label: string }) {
  return (
    <Panel title="Cost breakdown">
      <p role="status" className="text-sm text-muted-foreground">
        The cost breakdown covers personal accounts only. There is no cost breakdown for an
        organization, so none is shown for {label}. Your personal costs are not shown in its place;
        switch to your personal workspace to see them.
      </p>
    </Panel>
  );
}
