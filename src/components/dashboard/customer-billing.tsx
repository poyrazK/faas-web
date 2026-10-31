import { useMemo, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api/errors';
import {
  useFinalizeTenantStatement,
  useSetTenantRateCard,
  useSnapshotTenantStatement,
  useTenantRateCards,
  useTenantStatementHandoff,
  useTenantStatements,
  useTenantUsage,
  type PlatformTenantDetail,
  type TenantStatement,
} from '@/lib/api/monetization';
import { InlinePhase, StatTile, queryPhase } from './primitives';
import { Pill, ResourceTable, type Column } from './resource-table';
import { SegmentedControl } from './tabs';
import { finalizeCopy } from './api-consumer-statements';
import {
  Facts,
  STATUS_COLOR,
  explainWrite,
  formatCount,
  formatMillicents,
  formatPeriod,
  formatUtc,
  monthWindow,
  parsePriceToMillicents,
  previousMonthValue,
  trailingDays,
  useAppNames,
  utcMinuteFromInput,
} from './monetization-shared';

/**
 * A customer's commercial side: its immutable tenant-wide prices, raw
 * cross-app usage, and cross-app statements.
 *
 * Prices are append-only versions; the form sets the next one and never edits
 * a published card. Graduated tiers are shown when present but not authored
 * here — the ladder's semantics (per tenant per UTC month, replacing the flat
 * price and allowance) are easy to get wrong in a small form, so the page
 * leaves them to the API.
 */

// --- Rate cards ------------------------------------------------------------------

export function TenantRateCards({ tenantId }: { tenantId: string }) {
  const cards = useTenantRateCards(tenantId);
  const setCard = useSetTenantRateCard(tenantId);
  const confirm = useConfirm();
  const { toast } = useToast();
  const lockedCurrency = cards.data?.[0]?.currency;
  const [currency, setCurrency] = useState('');
  const [price, setPrice] = useState('');
  const [included, setIncluded] = useState('0');
  const [timing, setTiming] = useState<'next' | 'at'>('next');
  const [at, setAt] = useState('');
  const [attempted, setAttempted] = useState(false);
  const effectiveCurrency = lockedCurrency ?? (currency.trim().toUpperCase() || 'EUR');
  const millicents = parsePriceToMillicents(price);
  const includedUnits = /^\d+$/.test(included.trim()) ? Number(included.trim()) : undefined;
  const effectiveFrom = timing === 'at' ? utcMinuteFromInput(at) : undefined;
  const errors = {
    price:
      millicents === undefined
        ? 'Use a price per request such as 0.012 (at most five decimals).'
        : undefined,
    included: includedUnits === undefined ? 'Use a whole number (0 for none).' : undefined,
    currency: /^[A-Z]{3}$/.test(effectiveCurrency) ? undefined : 'Use a three-letter ISO code.',
    at: timing === 'at' && !effectiveFrom ? 'Choose a UTC date and time.' : undefined,
  };
  const phase = queryPhase({
    error: cards.error,
    loading: cards.isPending,
    isEmpty: cards.data?.length === 0,
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    if (Object.values(errors).some(Boolean) || millicents === undefined || setCard.isPending)
      return;
    const when = effectiveFrom ? formatUtc(effectiveFrom) : 'the next UTC minute';
    if (
      !(await confirm({
        title: `Publish ${formatMillicents(millicents, effectiveCurrency)} per request?`,
        description: `Rate cards are immutable. This appends a new version that overrides app-level prices for this customer from ${when}. Published versions and finalized statements are never rewritten.`,
        confirmLabel: 'Publish rate card',
      }))
    )
      return;
    try {
      await setCard.mutateAsync({
        currency: effectiveCurrency,
        price_millicents_per_unit: millicents,
        included_units_per_month: includedUnits ?? 0,
        ...(effectiveFrom ? { effective_from: effectiveFrom } : {}),
      });
      toast({ kind: 'success', title: 'Rate card published' });
      setPrice('');
      setAttempted(false);
    } catch (err) {
      toast(
        explainWrite(
          err,
          'publish the rate card',
          'Could not publish: it conflicts with this customer’s existing prices'
        )
      );
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <InlinePhase
        phase={phase}
        error={cards.error}
        loadingMessage="Loading rate cards…"
        emptyMessage="No customer-wide price yet; each app’s own rate cards apply."
        onRetry={() => void cards.refetch()}
      />
      {phase === 'ready' && (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {cards.data?.map((c) => (
            <li key={c.id} className="flex flex-col gap-1 px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="text-sm font-medium">
                  {c.tiers?.length
                    ? `${c.tiers.length}-step ladder`
                    : `${formatMillicents(c.price_millicents_per_unit, c.currency)} per request`}
                </span>
                {c.included_units_per_month > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {formatCount(c.included_units_per_month)} included per month
                  </span>
                )}
                <span className="ml-auto text-xs text-muted-foreground">
                  from {formatUtc(c.effective_from)}
                </span>
              </div>
              {c.tiers && c.tiers.length > 0 && (
                <ul className="text-xs text-muted-foreground">
                  {c.tiers.map((t, i) => (
                    <li key={i}>
                      {t.up_to === null || t.up_to === undefined
                        ? 'Beyond'
                        : `Up to ${formatCount(t.up_to)}`}
                      : {formatMillicents(t.price_millicents_per_unit, c.currency)} per request
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-col gap-3 rounded-lg border border-border p-4"
        onSubmit={(e) => void submit(e)}
        noValidate
      >
        <p className="text-sm font-medium">Set the next price</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField
            id="tenant-price"
            label={`Price per request (${effectiveCurrency})`}
            error={errors.price}
            showError={attempted}
          >
            {(props) => (
              <Input
                {...props}
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.012"
              />
            )}
          </FormField>
          <FormField
            id="tenant-included"
            label="Included requests / month"
            error={errors.included}
            showError={attempted}
          >
            {(props) => (
              <Input
                {...props}
                inputMode="numeric"
                value={included}
                onChange={(e) => setIncluded(e.target.value)}
              />
            )}
          </FormField>
          <FormField
            id="tenant-currency"
            label="Currency"
            hint={lockedCurrency ? 'A customer is priced in one currency.' : 'Defaults to EUR.'}
            error={errors.currency}
            showError={attempted}
          >
            {(props) => (
              <Input
                {...props}
                value={lockedCurrency ?? currency}
                onChange={(e) => setCurrency(e.target.value)}
                disabled={Boolean(lockedCurrency)}
                placeholder="EUR"
                maxLength={3}
              />
            )}
          </FormField>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <SegmentedControl
            label="When the price takes effect"
            value={timing}
            options={[
              { key: 'next', label: 'Next minute' },
              { key: 'at', label: 'At a UTC minute' },
            ]}
            onChange={setTiming}
          />
          {timing === 'at' && (
            <Input
              type="datetime-local"
              value={at}
              onChange={(e) => setAt(e.target.value)}
              aria-label="Effective from (UTC)"
              className="w-auto"
            />
          )}
          <Button type="submit" size="sm" busy={setCard.isPending}>
            Publish rate card
          </Button>
        </div>
        {attempted && errors.at && (
          <p role="alert" className="text-[13px] text-destructive">
            {errors.at}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Free requests are counted per customer per UTC month across every linked app; statements
          for periods such a card prices must cover one calendar month. Graduated tiers are
          published through the API.
        </p>
      </form>
    </div>
  );
}

// --- Usage -----------------------------------------------------------------------

export function TenantUsage({ tenant }: { tenant: PlatformTenantDetail }) {
  const [days, setDays] = useState<'7' | '30'>('30');
  const window = useMemo(() => trailingDays(Number(days)), [days]);
  const usage = useTenantUsage(tenant.id, window);
  const appNames = useAppNames();
  const state = usage.isPending ? 'loading' : usage.error ? 'unavailable' : 'ready';
  const byApp = useMemo(() => {
    const totals = new Map<string, { requests: number; errors: number; units: number }>();
    for (const b of usage.data?.buckets ?? []) {
      const t = totals.get(b.app_id) ?? { requests: 0, errors: 0, units: 0 };
      t.requests += b.request_count;
      t.errors += b.error_count;
      t.units += b.billable_units;
      totals.set(b.app_id, t);
    }
    return [...totals.entries()];
  }, [usage.data]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          label="Usage window"
          value={days}
          options={[
            { key: '7', label: '7 days' },
            { key: '30', label: '30 days' },
          ]}
          onChange={setDays}
        />
        <span className="text-xs text-muted-foreground">
          {formatPeriod(window.since, window.until)}
          {usage.data && ` · as of ${formatUtc(usage.data.as_of)}`}
        </span>
      </div>
      {Boolean(usage.error) && (
        <InlinePhase
          phase={queryPhase({ error: usage.error })}
          error={usage.error}
          onRetry={() => void usage.refetch()}
        />
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Requests"
          state={state}
          value={usage.data?.request_count}
          format={formatCount}
        />
        <StatTile
          label="Errors"
          state={state}
          value={usage.data?.error_count}
          format={formatCount}
        />
        <StatTile
          label="Billable units"
          state={state}
          value={usage.data?.billable_units}
          format={formatCount}
        />
      </div>
      {byApp.length > 0 && (
        <table className="w-full text-sm">
          <caption className="sr-only">Usage by app</caption>
          <thead>
            <tr className="border-b border-border text-left">
              <th scope="col" className="label-mono py-2 text-muted-foreground">
                App
              </th>
              <th scope="col" className="label-mono py-2 text-right text-muted-foreground">
                Requests
              </th>
              <th scope="col" className="label-mono py-2 text-right text-muted-foreground">
                Errors
              </th>
              <th scope="col" className="label-mono py-2 text-right text-muted-foreground">
                Units
              </th>
            </tr>
          </thead>
          <tbody className="[font-variant-numeric:tabular-nums]">
            {byApp.map(([appId, t]) => (
              <tr key={appId} className="border-b border-border last:border-0">
                <td className="py-2">{appNames.get(appId) ?? appId}</td>
                <td className="py-2 text-right">{formatCount(t.requests)}</td>
                <td className="py-2 text-right">{formatCount(t.errors)}</td>
                <td className="py-2 text-right">{formatCount(t.units)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-xs text-muted-foreground">
        Raw usage of linked consumers and surfaces, by UTC day. App prices and invoices are not
        aggregated here; statements price it.
      </p>
    </div>
  );
}

// --- Statements --------------------------------------------------------------------

type StatementRow = {
  id: string;
  revision: number;
  status: TenantStatement['status'];
  billable_units: number;
  amount: string;
  created_at: string;
  statement: TenantStatement;
};

export function TenantStatements({ tenantId }: { tenantId: string }) {
  const [month, setMonth] = useState(previousMonthValue);
  const fallback = useMemo(() => monthWindow(previousMonthValue())!, []);
  const period = monthWindow(month);
  const statements = useTenantStatements(tenantId, period ?? fallback);
  const snapshot = useSnapshotTenantStatement(tenantId);
  const finalize = useFinalizeTenantStatement(tenantId);
  const confirm = useConfirm();
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState('');
  const rows: StatementRow[] = (statements.data ?? []).map((s) => ({
    id: s.id,
    revision: s.revision,
    status: s.status,
    billable_units: s.billable_units,
    amount:
      s.unpriced_units > 0 ? 'Not fully priced' : formatMillicents(s.amount_millicents, s.currency),
    created_at: s.created_at,
    statement: s,
  }));
  const selected = statements.data?.find((s) => s.id === selectedId);

  const onSnapshot = async () => {
    if (!period || snapshot.isPending) return;
    try {
      const result = await snapshot.mutateAsync({
        period_start: period.since,
        period_end: period.until,
      });
      setSelectedId(result.id);
      toast({ kind: 'success', title: `Revision ${result.revision} is ${result.status}` });
    } catch (err) {
      toast(
        explainWrite(
          err,
          'snapshot the statement',
          'Could not snapshot: the period mixes currencies or conflicts with app statements'
        )
      );
    }
  };

  const onFinalize = async (s: TenantStatement) => {
    if (!(await confirm({ ...finalizeCopy(s.revision), destructive: true }))) return;
    try {
      await finalize.mutateAsync(s.id);
      toast({ kind: 'success', title: `Revision ${s.revision} finalized` });
    } catch (err) {
      toast(
        explainWrite(
          err,
          'finalize the statement',
          'Could not finalize: only a fully priced, single-currency draft can be finalized'
        )
      );
    }
  };

  const columns: Column<StatementRow>[] = [
    { key: 'revision', label: 'Revision', numeric: true },
    {
      key: 'status',
      label: 'Status',
      render: (r) => <Pill label={r.status} color={STATUS_COLOR[r.status]} />,
    },
    {
      key: 'billable_units',
      label: 'Units',
      numeric: true,
      render: (r) => formatCount(r.billable_units),
    },
    { key: 'amount', label: 'Amount', numeric: true },
    {
      key: 'created_at',
      label: 'Created',
      priority: 'secondary',
      render: (r) => formatUtc(r.created_at),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Period (UTC calendar month)</span>
          <Input
            type="month"
            value={month}
            onChange={(e) => {
              setMonth(e.target.value);
              setSelectedId('');
            }}
            aria-label="Statement period"
            className="w-auto"
          />
        </label>
        <Button
          size="sm"
          variant="outline"
          disabled={!period}
          busy={snapshot.isPending}
          onClick={() => void onSnapshot()}
        >
          Snapshot statement
        </Button>
      </div>
      {!period ? (
        <p className="text-sm text-muted-foreground">Choose a month to list its statements.</p>
      ) : (
        <ResourceTable
          rows={rows}
          columns={columns}
          onRowClick={(r) => setSelectedId(r.id)}
          loading={statements.isPending}
          error={statements.error}
          onRetry={() => void statements.refetch()}
          emptyMessage="No statement for this period yet. Snapshot it to create the first revision."
          minWidth="min-w-[520px]"
          rowActions={(r) =>
            r.status === 'draft' && r.statement.unpriced_units === 0 ? (
              <Button
                size="xs"
                variant="outline"
                onClick={() => void onFinalize(r.statement)}
                disabled={finalize.isPending}
                aria-label={`Finalize revision ${r.revision}`}
              >
                Finalize
              </Button>
            ) : null
          }
        />
      )}
      {selected && <TenantStatementDetail tenantId={tenantId} statement={selected} />}
    </div>
  );
}

function TenantStatementDetail({
  tenantId,
  statement,
}: {
  tenantId: string;
  statement: TenantStatement;
}) {
  const finalized = statement.status === 'finalized';
  const handoff = useTenantStatementHandoff(tenantId, statement.id, finalized);
  const appNames = useAppNames();
  const notRecorded = handoff.error instanceof ApiError && handoff.error.code === 'not_found';
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <p className="text-sm font-medium">
        Revision {statement.revision} · {formatPeriod(statement.period_start, statement.period_end)}
      </p>
      <Facts
        items={[
          ['Amount', formatMillicents(statement.amount_millicents, statement.currency)],
          ['Billable units', formatCount(statement.billable_units)],
          ['Unpriced units', formatCount(statement.unpriced_units)],
          ['Usage as of', formatUtc(statement.as_of)],
          ['Finalized', formatUtc(statement.finalized_at)],
        ]}
      />
      {statement.lines.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs">
          {statement.lines.map((l, i) => (
            <li key={i} className="flex flex-wrap gap-x-3">
              <span>{appNames.get(l.app_id) ?? l.app_id}</span>
              <span className="text-muted-foreground">
                {formatCount(l.billable_units)} ×{' '}
                {formatMillicents(l.price_millicents_per_unit ?? 0, l.currency)}
              </span>
              <span className="ml-auto">{formatMillicents(l.amount_millicents, l.currency)}</span>
              <span className="text-muted-foreground">
                {l.platform_tenant_rate_card_id ? 'customer price' : 'app price'}
              </span>
            </li>
          ))}
        </ul>
      )}
      {finalized && (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium">Billing handoff</p>
          {notRecorded ? (
            <p className="text-sm text-muted-foreground">
              No handoff recorded. Your billing system records one through the API when it invoices
              this statement.
            </p>
          ) : (
            <>
              <InlinePhase
                phase={queryPhase({ error: handoff.error, loading: handoff.isPending })}
                error={handoff.error}
                loadingMessage="Reading the handoff receipt…"
                onRetry={() => void handoff.refetch()}
              />
              {handoff.data && (
                <Facts
                  items={[
                    ['External invoice', handoff.data.external_invoice_id],
                    [
                      'Amount',
                      formatMillicents(handoff.data.amount_millicents, handoff.data.currency),
                    ],
                    ['Recorded', formatUtc(handoff.data.created_at)],
                  ]}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
