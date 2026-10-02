import { useId, useState } from 'react';
import { InlinePhase, Panel, StatTile, queryPhase } from './primitives';
import { Button } from '@/components/ui/button';
import { financialMoney, useFinancialCosts } from '@/lib/api/financial';
import { formatUsageBytes, formatUsageNumber } from '@/lib/usage-format';

const reasons: Record<string, string> = {
  retention_started_during_or_after_period: 'History does not cover the whole month.',
  missing_sampling_windows: 'Some usage reports are missing.',
  stale_evidence: 'The latest usage report is delayed.',
  missing_historical_prices: 'Some historical prices are unavailable.',
  incomplete_coverage: 'A complete usage history is needed.',
  insufficient_history: 'Available after one full day of usage history.',
  price_contract_changed: 'Pricing changed during this month.',
  period_closed: 'This usage month is closed.',
  meter_not_billed: 'This meter is not billed.',
};

function quantity(value: number, unit: string) {
  return unit === 'mb_seconds'
    ? `${formatUsageNumber(value / 1024 / 3600)} GB-hours`
    : formatUsageBytes(value);
}

export function FinancialCostsPanel() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [expanded, setExpanded] = useState(false);
  const inputId = useId();
  const tableId = useId();
  const query = useFinancialCosts(month);
  const data = query.data;
  const phase = queryPhase({
    error: query.error,
    loading: !!month && query.isPending,
    isEmpty: !month,
  });
  const allocations = (data?.meters ?? [])
    .flatMap((meter) =>
      meter.accrued.contracts.flatMap((contract) =>
        contract.allocations.map((allocation) => ({
          ...allocation,
          meter: meter.meter,
          unit: contract.price.unit,
          version: contract.price.version,
        }))
      )
    )
    .sort((a, b) => b.net_millicents - a.net_millicents);

  return (
    <Panel
      title="Costs and forecasts"
      description="Recorded usage costs, with shared allowances and historical pricing."
      actions={
        <label htmlFor={inputId} className="flex items-center gap-2 text-xs text-muted-foreground">
          Usage month (UTC)
          <input
            id={inputId}
            type="month"
            value={month}
            max={new Date().toISOString().slice(0, 7)}
            className="rounded border border-border bg-background px-2 py-1 text-foreground"
            onChange={(event) => {
              setMonth(event.target.value);
              setExpanded(false);
            }}
          />
        </label>
      }
    >
      {phase !== 'ready' || !data ? (
        <InlinePhase
          phase={phase}
          error={query.error}
          loadingMessage="Reading recorded costs…"
          emptyMessage="Choose a usage month."
        />
      ) : (
        <div className="flex flex-col gap-4">
          <StatTile
            label="Known priced usage"
            value={financialMoney(data.known_usage_millicents)}
            note="Compute and interface egress; other bill components remain separate."
          />
          <p className="text-xs text-muted-foreground">
            Reported through {new Date(data.as_of).toLocaleString()}. Retained history starts{' '}
            {new Date(data.retained_from).toLocaleString()}.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {data.meters.map((meter) => (
              <div key={meter.meter} className="rounded border border-border p-3">
                <p className="text-sm font-medium capitalize">{meter.meter}</p>
                <p className="mt-1 text-sm">
                  {financialMoney(meter.accrued.net_millicents)} recorded cost
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {meter.coverage.complete ? 'Complete usage coverage.' : 'Partial usage coverage.'}{' '}
                  {meter.coverage.reasons
                    .map((reason) => reasons[reason] ?? 'Source coverage is incomplete.')
                    .join(' ')}
                </p>
                <p className="mt-2 text-xs">
                  {meter.forecast.available && meter.forecast.projected_net_millicents != null
                    ? `Month-end projection: ${financialMoney(meter.forecast.projected_net_millicents)}. Based on elapsed usage time.`
                    : `Forecast unavailable: ${reasons[meter.forecast.reason ?? ''] ?? 'A complete, fresh usage history is needed.'}`}
                </p>
              </div>
            ))}
          </div>
          {allocations.length ? (
            <>
              <div className="overflow-x-auto">
                <table id={tableId} aria-label="Attributed usage costs" className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th scope="col" className="py-2">
                        Application / job
                      </th>
                      <th scope="col">Activity</th>
                      <th scope="col">Quantity</th>
                      <th scope="col">Allowance value</th>
                      <th scope="col">Net cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(expanded ? allocations : allocations.slice(0, 5)).map((row) => (
                      <tr
                        key={[row.meter, row.version, ...Object.values(row.attribution)].join(':')}
                        className="border-b border-border"
                      >
                        <td className="py-2">
                          {row.attribution.name ??
                            row.attribution.app_id ??
                            row.attribution.job_id ??
                            'Unallocated'}
                        </td>
                        <td className="capitalize">{row.meter}</td>
                        <td>{quantity(row.quantity, row.unit)}</td>
                        <td>{financialMoney(row.allowance_millicents)}</td>
                        <td>{financialMoney(row.net_millicents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {allocations.length > 5 && (
                <Button
                  size="xs"
                  variant="ghost"
                  aria-expanded={expanded}
                  aria-controls={tableId}
                  onClick={() => setExpanded(!expanded)}
                >
                  {expanded ? 'Show fewer costs' : `Show all ${allocations.length} costs`}
                </Button>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              No priced usage has been recorded for this month.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            A full bill estimate is unavailable while subscription, add-ons, credits, tax, and other
            resource charges have incomplete coverage. Provider invoices are reported separately and
            have not been reconciled to these usage costs.
          </p>
        </div>
      )}
    </Panel>
  );
}
