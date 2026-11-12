import { describe, expect, it } from 'vitest';
import type { ConfigGuard, ConfigRevision } from '@/lib/config-history';
import {
  dayLabel,
  environmentHeadline,
  groupByDay,
  guardState,
  guardWords,
  revisionGuardState,
  isEmptyDiff,
  revisionDiff,
  revisionWords,
  secretChangeVerb,
  secretChangeWords,
  secretDelivery,
  secretsLead,
  secretsState,
  variablesLead,
  type SecretRow,
} from './environment-words';

const secret = (key: string, delivery_status?: SecretRow['delivery_status']) =>
  ({
    key,
    scope: 'default',
    secret_class: 'persistent',
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-02T00:00:00Z',
    delivery_version: 2,
    delivery_status,
  }) as SecretRow;

describe('secretDelivery', () => {
  it('maps each delivery status to a plain word, keeping the term', () => {
    expect(secretDelivery({ delivery_status: 'delivered' })).toMatchObject({
      word: 'In use',
      tone: 'good',
    });
    expect(secretDelivery({ delivery_status: 'pending' })).toMatchObject({
      word: 'Applies on next start',
      tone: 'warning',
      term: expect.stringContaining('delivery_status: pending'),
    });
    expect(
      secretDelivery({
        delivery_status: 'failed',
        last_delivery_error_code: 'runtime_start_failed',
      })
    ).toMatchObject({
      word: 'Start failed',
      term: expect.stringContaining('runtime_start_failed'),
    });
  });

  it('says nothing when the API does not report delivery', () => {
    expect(secretDelivery({} as never)).toBeNull();
  });
});

describe('secretsState', () => {
  it('sorts secrets into pending, failed and unknown', () => {
    expect(
      secretsState([
        secret('B', 'pending'),
        secret('A', 'pending'),
        secret('C', 'failed'),
        secret('D'),
      ])
    ).toEqual({ total: 4, pending: ['A', 'B'], failed: ['C'], unknown: 1 });
  });
});

describe('environmentHeadline', () => {
  it('counts variables and secrets and says the app is up to date when every secret is delivered', () => {
    expect(
      environmentHeadline({
        app: 'api',
        variables: 4,
        secrets: [secret('A', 'delivered'), secret('B', 'delivered')],
      })
    ).toEqual({
      word: 'Up to date',
      tone: 'good',
      sentence: 'api has 4 variables and 2 secrets.',
      detail: 'The app has started with the current value of every secret.',
    });
  });

  it('names secrets the app has not started with yet', () => {
    const h = environmentHeadline({
      app: 'api',
      variables: 1,
      secrets: [secret('A', 'pending'), secret('B', 'delivered')],
    });
    expect(h?.sentence).toBe('api has 1 variable and 2 secrets.');
    expect(h?.word).toBe('Applies on next start');
    expect(h?.detail).toMatch(/hasn’t started with the new value of A yet/);
  });

  it('puts a failed start before a pending one', () => {
    const h = environmentHeadline({
      app: 'api',
      secrets: [secret('A', 'pending'), secret('B', 'failed'), secret('C', 'failed')],
    });
    expect(h?.tone).toBe('critical');
    expect(h?.detail).toBe('The app failed to start with the new values of B and C.');
  });

  it('says less when a read is missing or delivery is unknown, never zero', () => {
    expect(environmentHeadline({ app: 'api', secrets: [secret('A')] })).toEqual({
      sentence: 'api has 1 secret.',
    });
    expect(environmentHeadline({ app: 'api', variables: 3 })).toEqual({
      sentence: 'api has 3 variables.',
    });
    expect(environmentHeadline({ app: 'api' })).toBeNull();
  });

  it('says plainly when there is nothing yet', () => {
    expect(environmentHeadline({ app: 'api', variables: 0, secrets: [] })?.sentence).toBe(
      'api has no variables or secrets yet.'
    );
  });
});

describe('leads', () => {
  it('states slots used only when the API gives both numbers', () => {
    expect(variablesLead(4, 128)).toMatch(/4 of 128 slots used/);
    expect(variablesLead(4, undefined)).not.toMatch(/slots/);
    expect(variablesLead(0, 128)).toMatch(/^No variables yet/);
    expect(secretsLead(2, 64)).toBe('Sealed when saved and never shown again. 2 of 64 slots used.');
    expect(secretsLead(0, 64)).toMatch(/^No secrets yet/);
  });
});

describe('secretChangeVerb', () => {
  it('reads Added for an untouched secret and Changed otherwise', () => {
    expect(secretChangeVerb('2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z')).toBe('Added');
    expect(secretChangeVerb('2026-10-01T00:00:00Z', '2026-10-03T00:00:00Z')).toBe('Changed');
    expect(secretChangeVerb(undefined, '2026-10-03T00:00:00Z')).toBe('Changed');
  });
});

const revision = (over: Partial<ConfigRevision>): ConfigRevision => ({
  revision: 1,
  scope: 'default',
  source: 'env.set',
  actor: 'ada@example.com',
  created_at: '2026-10-31T09:00:00Z',
  variable_count: 1,
  secret_count: 0,
  ...over,
});

describe('revisionWords', () => {
  it('puts the key apart from the verb and keeps the source as the term', () => {
    expect(revisionWords(revision({ source: 'secret.rotate', key: 'DB', revision: 4 }))).toEqual({
      lead: 'Rotated secret',
      key: 'DB',
      term: 'secret.rotate · revision 4',
    });
    expect(revisionWords(revision({ source: 'env.delete', key: 'X' })).lead).toBe('Removed');
    expect(
      revisionWords(revision({ source: 'config.guard_restore', restored_revision: 2 })).lead
    ).toBe('Undone automatically, back to revision 2');
    expect(revisionWords(revision({ source: 'baseline' })).lead).toBe('Starting point recorded');
  });
});

const guard = (over: Partial<ConfigGuard>): ConfigGuard => ({
  id: 'g',
  scope: 'default',
  status: 'watching',
  base_revision: 4,
  head_revision: 5,
  restorable: true,
  opened_at: '2026-10-31T09:00:00Z',
  last_change_at: '2026-10-31T09:00:00Z',
  ...over,
});

describe('guardWords', () => {
  // Five minutes after the change; the window closes at 09:10.
  const now = Date.parse('2026-10-31T09:05:00Z');
  const open = { window_ends_at: '2026-10-31T09:10:00Z' };
  const closed = { window_ends_at: '2026-10-31T08:57:00Z' };

  it('open window: watching, and says it can undo the change unless a secret went', () => {
    const w = guardWords(guard(open), true, now);
    expect(w).toMatchObject({ word: 'Watching', tone: 'active' });
    expect(w.sentence).toBe(
      'Gregale is watching the latest change. If the app starts failing, the previous values come back automatically.'
    );
    expect(guardWords(guard({ ...open, restorable: false }), true, now).sentence).toMatch(
      /can’t be undone automatically/
    );
  });

  it('closed window without a verdict: not confirmed, never watching', () => {
    const w = guardWords(guard(closed), true, now);
    expect(w.word).toBe('Not confirmed');
    expect(w.sentence).toBe(
      'The latest change wasn’t confirmed: its watch window ended 8m ago without a result. It stays in place.'
    );
    expect(w.sentence).not.toMatch(/watching/i);
  });

  it('passed', () => {
    expect(guardWords(guard({ status: 'clean' }), true, now)).toMatchObject({
      word: 'Passed',
      tone: 'good',
      sentence: 'The latest change passed: the app served traffic without more errors than before.',
    });
  });

  it('undone', () => {
    expect(guardWords(guard({ status: 'restored' }), true, now)).toMatchObject({
      word: 'Undone',
      tone: 'critical',
      sentence: 'The latest change made the app fail, so Gregale put the previous values back.',
    });
  });

  it('names the revision when the guarded change is no longer the newest', () => {
    expect(guardWords(guard({ status: 'clean' }), false, now).sentence).toBe(
      'The change in revision 5 passed: the app served traffic without more errors than before.'
    );
  });

  it('tells the person what to do when the guard could not undo a failure', () => {
    const w = guardWords(guard({ status: 'regressed' }), true, now);
    expect(w).toMatchObject({ word: 'Failed, kept', tone: 'critical' });
    expect(w.next).toMatch(/roll the variables back/);
  });
});

describe('guardState and revisionGuardState', () => {
  const now = Date.parse('2026-10-31T09:05:00Z');

  it('reads watching past its window as unconfirmed, and leaves verdicts alone', () => {
    expect(guardState({ status: 'watching', window_ends_at: '2026-10-31T09:10:00Z' }, now)).toBe(
      'watching'
    );
    expect(guardState({ status: 'watching', window_ends_at: '2026-10-31T09:00:00Z' }, now)).toBe(
      'unconfirmed'
    );
    // No window yet: waiting for the first request, still watching.
    expect(guardState({ status: 'watching' }, now)).toBe('watching');
    expect(guardState({ status: 'clean', window_ends_at: '2026-10-31T09:00:00Z' }, now)).toBe(
      'clean'
    );
  });

  it('gives the row of the guarded change the same word as the summary', () => {
    const g = guard({ id: 'g-2', window_ends_at: '2026-10-31T09:00:00Z' });
    expect(
      revisionGuardState({ revision: 5, guard_id: 'g-2', guard_status: 'watching' }, g, now)
    ).toBe('unconfirmed');
    expect(revisionGuardState({ revision: 5, guard_status: 'watching' }, g, now)).toBe(
      'unconfirmed'
    );
    expect(
      revisionGuardState({ revision: 3, guard_id: 'g-1', guard_status: 'watching' }, g, now)
    ).toBe('watching');
    expect(revisionGuardState({ revision: 2, guard_status: 'clean' }, g, now)).toBe('clean');
    expect(revisionGuardState({ revision: 1 }, g, now)).toBeUndefined();
  });
});

describe('day grouping', () => {
  const now = new Date(2026, 9, 31, 15, 0).getTime();

  it('labels today and yesterday by name', () => {
    expect(dayLabel(new Date(2026, 9, 31, 1, 0).getTime(), now)).toBe('Today');
    expect(dayLabel(new Date(2026, 9, 30, 23, 0).getTime(), now)).toBe('Yesterday');
  });

  it('keeps order and starts a new group on each day', () => {
    const at = (d: number, h: number) => ({ created_at: new Date(2026, 9, d, h).toISOString() });
    const groups = groupByDay([at(31, 14), at(31, 9), at(30, 20), at(28, 8)], now);
    expect(groups.map((g) => [g.label, g.items.length]).slice(0, 2)).toEqual([
      ['Today', 2],
      ['Yesterday', 1],
    ]);
    expect(groups).toHaveLength(3);
  });
});

describe('revisionDiff', () => {
  it('compares variables by value and returns keys only', () => {
    const diff = revisionDiff(
      { variables: { A: '1', B: '2', C: '3' }, secret_versions: { S: 1, T: 1 } },
      { variables: { A: '1', B: 'two', D: '4' }, secret_versions: { S: 2, U: 1 } }
    );
    expect(diff).toEqual({
      added: ['D'],
      changed: ['B'],
      removed: ['C'],
      secrets: [
        { key: 'S', from: 1, to: 2 },
        { key: 'T', from: 1, to: undefined },
        { key: 'U', from: undefined, to: 1 },
      ],
    });
    expect(JSON.stringify(diff)).not.toMatch(/two|"4"/);
    expect(diff.secrets.map(secretChangeWords)).toEqual([
      'new value (version 1 → 2)',
      'removed',
      'added',
    ]);
  });

  it('knows an empty diff', () => {
    expect(
      isEmptyDiff(
        revisionDiff({ variables: {}, secret_versions: {} }, { variables: {}, secret_versions: {} })
      )
    ).toBe(true);
  });
});
