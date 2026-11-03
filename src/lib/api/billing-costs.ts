import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import { toApiError } from './errors';
import { keys, retryPolicy } from './queries';
import type { components } from './schema';

export type FinancialCosts = components['schemas']['FinancialCostsResponse'];
export type FinancialMeterCosts = components['schemas']['FinancialMeterCosts'];

/**
 * The signed-in account's attributable usage costs for one UTC month
 * (`GET /v1/billing/costs`, faas handlers_financial.go:15-41). Personal only:
 * the handler reads `acct.ID` and there is no organization route, so a company
 * workspace must not call this. `month` null is the current month, which the
 * server decides, so a client clock running ahead cannot ask for a month apid
 * refuses (handlers_financial.go:76).
 *
 * The route is behind the session MFA gate (server.go:4783). The read does not
 * go through `unwrap`, whose global gate opens a prompt on every
 * `mfa_required`: the cost panel asks once itself and then retries, and two
 * owners of one prompt would race for its callbacks.
 */
export function useFinancialCosts(month: string | null) {
  return useQuery({
    queryKey: [...keys.account, 'billing-costs', month ?? 'current'],
    queryFn: async ({ signal }) => {
      const { data, error, response } = await api.GET('/v1/billing/costs', {
        params: { query: month ? { month } : {} },
        signal,
      });
      if (error !== undefined || !response.ok || !data) throw await toApiError(response, error);
      return data;
    },
    retry: retryPolicy,
    staleTime: 60_000,
  });
}

/** YYYY-MM of a UTC instant, or null when it does not parse. */
function utcMonth(iso: string): { year: number; month: number } | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Ten years: retention cannot reach further back, and a select longer than this is a bug. */
const MAX_MONTHS = 120;

/**
 * The months a cost report can be read for: the report's own month back to the
 * one `retained_from` falls in, newest first. Evidence before retention began
 * does not exist, so earlier months would only ever report a coverage gap.
 */
export function costMonths(periodStart: string, retainedFrom: string): string[] {
  const top = utcMonth(periodStart);
  if (!top) return [];
  const floor = utcMonth(retainedFrom);
  const out: string[] = [];
  let { year, month } = top;
  while (out.length < MAX_MONTHS) {
    out.push(`${year}-${pad(month + 1)}`);
    if (!floor || year < floor.year || (year === floor.year && month <= floor.month)) break;
    month -= 1;
    if (month < 0) {
      month = 11;
      year -= 1;
    }
  }
  return out;
}

/** "November 2026" for "2026-11", read as a UTC calendar month. */
export function monthLabel(month: string): string {
  const [year, m] = month.split('-').map(Number);
  return new Date(Date.UTC(year, m - 1, 1)).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
