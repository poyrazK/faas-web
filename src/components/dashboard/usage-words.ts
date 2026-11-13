import { formatCents, formatMillicents } from '@/lib/money';
import { dayLabel } from '@/lib/usage-daily';
import { formatUsageNumber } from '@/lib/usage-format';

/**
 * The Usage page's answer in plain words (docs/console-plain-english.md): one
 * sentence that says where this month's compute stands and whether anything
 * needs doing, and the one action that fits. Every figure comes from the API:
 *
 * - used / included / overage from `GET /v1/usage/summary`;
 * - the cap from `GET /v1/account/overage-cap` (`undefined` while unread,
 *   `null` for no cap). apid parks once overage >= cap, so $0 is a pause
 *   switch (faas pkg/sched/overage.go:207, docs/billing.md:33);
 * - the money from `GET /v1/billing/forecast`, compute meter only, and only
 *   when apid says the forecast is available. Without it the sentence leaves
 *   the money out rather than multiplying a price the page does not have.
 *
 * The month-end GB-hours are a straight line over the month so far — the same
 * arithmetic the allowance bar draws — and only from day 2 of the current
 * month; a projection from an hour of data is noise wearing a number.
 */

export type UsageTone = 'good' | 'warning' | 'critical';
export type UsageAction = 'raise_cap' | 'upgrade' | null;

export interface UsageSummaryFacts {
  month: string | undefined;
  used: number;
  included: number;
  overageGbHours: number | undefined;
  overageCents: number | undefined;
}

export interface UsageProjection {
  /** True when there is enough of the current month to draw a line. */
  projecting: boolean;
  /** GB-hours by month end if the pace holds; `used` when not projecting. */
  projected: number;
  /** The last day of the month, e.g. "Nov 30", when projecting. */
  monthEnd?: string;
}

/** The straight-line month-end figure. Pure; `now` is injected for tests. */
export function projectUsage(
  used: number,
  month: string | undefined,
  now: number = Date.now()
): UsageProjection {
  const today = new Date(now);
  const [y, m] = (month ?? '').split('-').map(Number);
  const dayOfMonth = today.getUTCDate();
  const projecting =
    y === today.getUTCFullYear() && m === today.getUTCMonth() + 1 && used > 0 && dayOfMonth >= 2;
  if (!projecting) return { projecting: false, projected: used };
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;
  return {
    projecting: true,
    projected: (used / dayOfMonth) * daysInMonth,
    monthEnd: dayLabel(last),
  };
}

type ForecastMeter = {
  meter: string;
  forecast: { available: boolean; projected_net_millicents?: number };
};

/**
 * The compute meter's projected charge for the month, in millicents, when apid
 * has one. apid names the meter `compute` (faas pkg/meter/financial.go:42);
 * `gb_hours` is accepted too, as older readers named it.
 */
export function computeForecastMillicents(
  meters: readonly ForecastMeter[] | undefined
): number | undefined {
  const compute = meters?.find((m) => m.meter === 'compute' || m.meter === 'gb_hours');
  if (!compute?.forecast.available) return undefined;
  const value = compute.forecast.projected_net_millicents;
  return typeof value === 'number' ? value : undefined;
}

const PLAN_ORDER = ['free', 'hobby', 'pro', 'scale'];

/** A higher plan exists to move to. Unknown plans offer nothing. */
export function canUpgrade(plan: string | undefined): boolean {
  const at = PLAN_ORDER.indexOf(plan ?? '');
  return at >= 0 && at < PLAN_ORDER.length - 1;
}

/** A projected amount in a sentence: "about 1,581", not "about 1,581.25". */
function about(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: value >= 10 ? 0 : 1 });
}

function share(used: number, included: number): string {
  const pct = (used / included) * 100;
  if (used > 0 && pct < 1) return 'less than 1%';
  return `${Math.round(pct)}%`;
}

export interface UsageAnswer {
  tone: UsageTone;
  sentence: string;
  action: UsageAction;
}

export interface UsageAnswerInput extends UsageSummaryFacts {
  /** `undefined` while unread, `null` for no cap. */
  capCents: number | null | undefined;
  forecastMillicents: number | undefined;
  plan: string | undefined;
  now?: number;
}

/** One plain sentence for the month, and the action that fits it. */
export function usageAnswer(input: UsageAnswerInput): UsageAnswer {
  const { used, included, overageCents, capCents, forecastMillicents, plan } = input;
  const overage = overageCents ?? 0;
  const upgrade: UsageAction = canUpgrade(plan) ? 'upgrade' : null;

  if (capCents === 0)
    return {
      tone: 'critical',
      sentence:
        'Your apps are paused. The spend cap is $0, so new wakes are refused and running apps park, even within the included compute, until you raise or clear it.',
      action: 'raise_cap',
    };
  if (typeof capCents === 'number' && overageCents !== undefined && overage >= capCents)
    return {
      tone: 'critical',
      sentence: `You've reached your ${formatCents(capCents)} spend cap. New wakes beyond the included compute are refused, and running apps park, until you raise it or the month ends.`,
      action: 'raise_cap',
    };

  const { projecting, projected, monthEnd } = projectUsage(used, input.month, input.now);
  const money =
    forecastMillicents !== undefined && forecastMillicents > 0
      ? `, around ${formatMillicents(forecastMillicents)}`
      : '';

  if (typeof capCents === 'number' && overage > 0 && overage >= capCents * 0.8)
    return {
      tone: 'warning',
      sentence: `You've used ${formatCents(overage)} of your ${formatCents(capCents)} spend cap. When it's reached, new wakes beyond the included compute are refused.`,
      action: 'raise_cap',
    };

  if (!(included > 0))
    return {
      tone: 'good',
      sentence: `You've used ${formatUsageNumber(used)} GB-hours of compute this month.`,
      action: null,
    };

  if (used > included) {
    const past = `You're ${formatUsageNumber(used - included)} GB-hours past this month's included compute${overageCents !== undefined ? `, ${formatCents(overage)} of overage so far` : ''}.`;
    const pace =
      projecting && projected > used
        ? ` At this pace you'll be about ${about(projected - included)} GB-hours over by ${monthEnd}${money}.`
        : '';
    return { tone: 'warning', sentence: past + pace, action: upgrade };
  }

  const usedShare = `You've used ${share(used, included)} of this month's included compute.`;
  if (projecting && projected > included)
    return {
      tone: 'warning',
      sentence: `${usedShare} At this pace you'll be about ${about(projected - included)} GB-hours over by ${monthEnd}${money}.`,
      action: upgrade,
    };
  if (projecting)
    return {
      tone: 'good',
      sentence: `${usedShare} At this pace you'll stay within it. Nothing needs your attention.`,
      action: null,
    };
  return { tone: 'good', sentence: `${usedShare} Nothing needs your attention.`, action: null };
}
