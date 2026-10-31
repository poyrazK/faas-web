import { describe, expect, it } from 'vitest';
import type { components } from '../src/lib/api/schema';
import {
  createAsyncInvocation,
  replay,
  Refusal,
  seedAsyncInvocations,
  settle,
  type AsyncMock,
} from './async-invocations';

type Invocation = components['schemas']['Invocation'];
const NOW = Date.parse('2026-10-31T12:00:00Z');
const HOOK = 'h'.repeat(32);

function row(id: string, extra: Partial<Invocation> = {}): Invocation {
  return {
    id,
    app_id: 'app1',
    account_id: 'acct',
    source: 'async_invoke',
    state: 'failed',
    created_at: new Date(NOW - 3_600_000).toISOString(),
    ...extra,
  };
}

function fixture(rows: Invocation[]): AsyncMock {
  return {
    invocations: rows,
    policies: new Map([['docs', [{ name: 'document-index', revision: 2 } as never]]]),
    children: new Map(),
    settleAt: new Map(),
  };
}

const refusal = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    if (error instanceof Refusal) return error.code;
    throw error;
  }
  return 'no refusal';
};

describe('seedAsyncInvocations', () => {
  it('gives some failed and dead-lettered work a policy, deadline and destination', () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      row(String(i).padStart(32, '0'), { state: i % 2 ? 'failed' : 'dead_letter' })
    );
    const policies = seedAsyncInvocations(
      rows,
      [{ id: 'app1', slug: 'docs' }],
      new Map([['docs', [{ id: HOOK }]]]),
      NOW
    );
    expect(policies.get('docs')?.map((p) => p.name)).toContain('document-index');
    expect(rows.some((r) => r.state === 'failed' && r.work_policy_name)).toBe(true);
    expect(rows.some((r) => r.state === 'dead_letter' && r.work_policy_name)).toBe(true);
    expect(rows.some((r) => r.on_failure_destination_id === HOOK)).toBe(true);
    expect(rows.every((r) => r.deadline_at)).toBe(true);
  });
});

describe('replay', () => {
  it('admits one keyed replay per failed parent and returns it again', () => {
    const mock = fixture([row('p', { work_policy_name: 'document-index' })]);
    const first = replay(mock, 'p', 'keyed', NOW);
    expect(first.source).toBe('replay');
    expect(first.work_policy_name).toBe('document-index');
    expect(replay(mock, 'p', 'keyed', NOW).id).toBe(first.id);
    expect(mock.invocations.filter((r) => r.source === 'replay')).toHaveLength(1);
  });

  it('keeps each route to its own work', () => {
    const mock = fixture([
      row('keyed', { work_policy_name: 'document-index' }),
      row('plain'),
      row('queued', { queue_name: 'emails' }),
      row('done', { state: 'completed' }),
      row('dlq', { state: 'dead_letter', work_policy_name: 'document-index' }),
    ]);
    expect(refusal(() => replay(mock, 'keyed', 'plain', NOW))).toBe('keyed_replay_requires_policy');
    expect(refusal(() => replay(mock, 'plain', 'keyed', NOW))).toBe('keyed_replay_not_allowed');
    expect(refusal(() => replay(mock, 'queued', 'plain', NOW))).toBe(
      'queue_replay_requires_binding'
    );
    expect(refusal(() => replay(mock, 'done', 'plain', NOW))).toBe('invocation_not_replayable');
    expect(refusal(() => replay(mock, 'dlq', 'keyed', NOW))).toBe('keyed_replay_not_allowed');
    expect(refusal(() => replay(mock, 'missing', 'plain', NOW))).toBe('invocation_not_found');
  });

  it('refuses keyed work whose pending lifetime has passed', () => {
    const mock = fixture([
      row('old', {
        work_policy_name: 'document-index',
        work_expires_at: new Date(NOW - 1000).toISOString(),
      }),
    ]);
    expect(refusal(() => replay(mock, 'old', 'keyed', NOW))).toBe('keyed_replay_expired');
  });
});

describe('createAsyncInvocation', () => {
  const app = { id: 'app1', slug: 'docs' };
  const hooks = [{ id: HOOK }];

  it('records the policy, deadline and destinations', () => {
    const mock = fixture([]);
    const inv = createAsyncInvocation(
      mock,
      app,
      hooks,
      {
        work: { policy: 'document-index', key: 'd1' },
        deadline_at: new Date(NOW + 600_000).toISOString(),
        destinations: { on_failure: HOOK },
      },
      NOW
    );
    expect(inv).toMatchObject({
      state: 'pending',
      source: 'async_invoke',
      work_policy_name: 'document-index',
      work_policy_revision: 2,
      on_failure_destination_id: HOOK,
    });
    expect(mock.invocations[0]).toBe(inv);
  });

  it('refuses an unknown policy, a bad key, a past deadline and a foreign webhook', () => {
    const mock = fixture([]);
    const make = (body: Record<string, unknown>) => () =>
      createAsyncInvocation(mock, app, hooks, body, NOW);
    expect(refusal(make({ work: { policy: 'nope', key: 'd1' } }))).toBe('validation');
    expect(refusal(make({ work: { policy: 'document-index', key: {} } }))).toBe('validation');
    expect(refusal(make({ deadline_at: new Date(NOW - 1).toISOString() }))).toBe('validation');
    expect(refusal(make({ destinations: { on_success: 'x'.repeat(32) } }))).toBe('validation');
  });

  it('clamps a deadline past the plan ceiling, and defaults to it', () => {
    const mock = fixture([]);
    const far = createAsyncInvocation(
      mock,
      app,
      hooks,
      { deadline_at: new Date(NOW + 30 * 86_400_000).toISOString() },
      NOW
    );
    const none = createAsyncInvocation(mock, app, hooks, {}, NOW);
    expect(far.deadline_at).toBe(none.deadline_at);
    expect(Date.parse(none.deadline_at!)).toBeGreaterThan(NOW);
  });
});

describe('settle', () => {
  it('completes work the mock created once it has had a few seconds', () => {
    const mock = fixture([]);
    const inv = createAsyncInvocation(mock, { id: 'app1', slug: 'docs' }, [], {}, NOW);
    settle(mock, inv, NOW + 1000);
    expect(inv.state).toBe('pending');
    settle(mock, inv, NOW + 10_000);
    expect(inv.state).toBe('completed');
    expect(inv.completed_at).toBeTruthy();
  });
});
