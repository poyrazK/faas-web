import type { Budget } from '@/lib/budgets';
import { formatMillicents } from '@/lib/money';

/**
 * The Budgets page's answer in one plain sentence (docs/console-plain-english.md):
 * what the account's budgets are doing now, the most urgent first. Built only
 * from each budget's status and its latest evaluation; a budget apid has not
 * evaluated is never counted as within its limit.
 */

export type BudgetsTone = 'good' | 'warning' | 'critical' | 'none';

export interface BudgetsAnswer {
  tone: BudgetsTone;
  sentence: string;
}

const quoted = (budget: Budget) => `“${budget.spec.name}”`;

/** One budget by name, or a count of them. */
function name(list: Budget[], one: string, many: string): string {
  return list.length === 1 ? `${quoted(list[0])} ${one}` : `${list.length} budgets ${many}`;
}

export function budgetsAnswer(budgets: readonly Budget[]): BudgetsAnswer {
  const live = budgets.filter((b) => b.status !== 'deleted');
  if (live.length === 0)
    return {
      tone: 'none',
      sentence:
        'You have no budgets yet. A budget emails you, or stops previews, when this month’s usage passes a limit you set.',
    };

  const active = live.filter((b) => b.status !== 'draft' && b.status !== 'unavailable');
  const held = active.filter((b) => b.runtime?.compute?.held);
  if (held.length)
    return {
      tone: 'critical',
      sentence: `${name(held, 'is holding workloads at its limit.', 'are holding workloads at their limits.')}`,
    };
  const stopping = active.filter((b) => b.runtime?.stops?.length);
  if (stopping.length)
    return {
      tone: 'critical',
      sentence: `${name(stopping, 'is stopping previews.', 'are stopping previews.')} Production keeps running.`,
    };

  const known = (b: Budget) => b.runtime?.evaluation?.known_millicents;
  const projected = (b: Budget) => b.runtime?.evaluation?.projected_millicents;
  const over = active.filter((b) => (known(b) ?? -1) >= b.spec.limit_millicents);
  if (over.length)
    return {
      tone: 'warning',
      sentence:
        over.length === 1
          ? `${quoted(over[0])} has passed its ${formatMillicents(over[0].spec.limit_millicents)} limit this month.`
          : `${over.length} budgets have passed their limits this month.`,
    };
  const pacing = active.filter((b) => (projected(b) ?? -1) >= b.spec.limit_millicents);
  if (pacing.length)
    return {
      tone: 'warning',
      sentence:
        pacing.length === 1
          ? `${quoted(pacing[0])} is on pace to pass its ${formatMillicents(pacing[0].spec.limit_millicents)} limit by month end.`
          : `${pacing.length} budgets are on pace to pass their limits by month end.`,
    };

  const unavailable = live.filter((b) => b.status === 'unavailable');
  if (unavailable.length)
    return {
      tone: 'warning',
      sentence:
        unavailable.length === 1
          ? `${quoted(unavailable[0])} can’t be evaluated right now, so its spending is unknown.`
          : `${unavailable.length} budgets can’t be evaluated right now, so their spending is unknown.`,
    };

  if (active.length === 0)
    return {
      tone: 'none',
      sentence:
        live.length === 1
          ? 'Your only budget is a draft, so it neither alerts nor stops anything.'
          : 'Your budgets are drafts, so none of them alerts or stops anything.',
    };

  const evaluated = active.filter((b) => known(b) !== undefined);
  if (evaluated.length === active.length)
    return {
      tone: 'good',
      sentence:
        active.length === 1
          ? 'Your active budget is within its limit. Nothing needs your attention.'
          : `All ${active.length} active budgets are within their limits. Nothing needs your attention.`,
    };
  return {
    tone: 'good',
    sentence: `${evaluated.length} of ${active.length} active budgets are within their limits; the rest haven’t been evaluated yet.`,
  };
}
