import { describe, expect, it } from 'vitest';
import type { Budget } from '@/lib/budgets';
import { budgetsAnswer } from './budget-words';

function budget(
  name: string,
  overrides: {
    status?: Budget['status'];
    known?: number;
    projected?: number;
    limit?: number;
    held?: boolean;
    stops?: number;
  } = {}
): Budget {
  const evaluation =
    overrides.known === undefined
      ? undefined
      : { known_millicents: overrides.known, projected_millicents: overrides.projected };
  return {
    id: name,
    status: overrides.status ?? 'active',
    spec: { name, limit_millicents: overrides.limit ?? 2_500_000 },
    runtime: {
      evaluation,
      compute: overrides.held ? { held: true } : undefined,
      stops: Array.from({ length: overrides.stops ?? 0 }, () => ({})),
    },
  } as unknown as Budget;
}

describe('budgetsAnswer', () => {
  it('invites a first budget when there are none', () => {
    expect(budgetsAnswer([]).tone).toBe('none');
    expect(budgetsAnswer([budget('gone', { status: 'deleted' })]).sentence).toMatch(
      /^You have no budgets yet\./
    );
  });

  it('puts a hold first, then a preview stop', () => {
    const answer = budgetsAnswer([
      budget('stopper', { known: 1, stops: 1 }),
      budget('strict', { known: 1, held: true }),
    ]);
    expect(answer).toEqual({
      tone: 'critical',
      sentence: '“strict” is holding workloads at its limit.',
    });
    expect(budgetsAnswer([budget('a', { stops: 1 }), budget('b', { stops: 2 })]).sentence).toBe(
      '2 budgets are stopping previews. Production keeps running.'
    );
  });

  it('names a passed limit, then one on pace to pass', () => {
    expect(budgetsAnswer([budget('monthly', { known: 3_000_000 })]).sentence).toBe(
      '“monthly” has passed its $25.00 limit this month.'
    );
    expect(
      budgetsAnswer([budget('monthly', { known: 1_000_000, projected: 2_600_000 })]).sentence
    ).toBe('“monthly” is on pace to pass its $25.00 limit by month end.');
  });

  it('never counts an unevaluated budget as within its limit', () => {
    expect(budgetsAnswer([budget('a', { known: 100 }), budget('b')]).sentence).toBe(
      '1 of 2 active budgets are within their limits; the rest haven’t been evaluated yet.'
    );
    expect(budgetsAnswer([budget('a', { status: 'unavailable' })]).sentence).toBe(
      '“a” can’t be evaluated right now, so its spending is unknown.'
    );
  });

  it('says drafts do nothing, and all-clear when every active budget is within', () => {
    expect(budgetsAnswer([budget('d', { status: 'draft' })]).sentence).toBe(
      'Your only budget is a draft, so it neither alerts nor stops anything.'
    );
    expect(
      budgetsAnswer([
        budget('a', { known: 1 }),
        budget('b', { known: 2 }),
        budget('d', { status: 'draft' }),
      ])
    ).toEqual({
      tone: 'good',
      sentence: 'All 2 active budgets are within their limits. Nothing needs your attention.',
    });
  });
});
