import { afterEach, describe, expect, it } from 'vitest';
import * as budgets from './budgets';
import { channels as allChannels } from './notification-channels';

const world: budgets.World = {
  apps: [
    { id: 'app-1', slug: 'api', project_id: 'proj-1' },
    { id: 'app-2', slug: 'pr-42-api', project_id: 'proj-1', preview_of_slug: 'api' },
    { id: 'app-3', slug: 'indexer', workload_class: 'worker' },
  ],
  jobs: [{ id: 'job-1', name: 'nightly-export' }],
  projects: [{ id: 'proj-1', slug: 'shop' }],
  environments: () => [{ id: 'env-1', project_id: 'proj-1', slug: 'staging' }],
};

const spec = (over: Record<string, unknown> = {}) => ({
  name: 'Budget',
  scope: { kind: 'account' },
  currency: 'USD',
  meters: ['compute'],
  basis: 'net_usage',
  limit_millicents: 1_000_000,
  notify_millicents: [],
  mode: 'monitored',
  action: 'notify',
  drain_seconds: 0,
  resume_rule: 'next_period',
  enabled: true,
  ...over,
});
const strict = (over: Record<string, unknown> = {}) =>
  spec({
    mode: 'strict',
    action: 'suspend_workloads',
    scope: { kind: 'app', id: 'app-1' },
    basis: 'gross_usage',
    ...over,
  });

let n = 0;
const key = () => `key-${++n}`;

afterEach(() => {
  delete process.env.MOCK_STRICT_BUDGETS;
});

describe('budget mock', () => {
  it('creates, replays a creation key, updates at a revision and tombstones', () => {
    const k = key();
    const created = budgets.create(world, { spec: spec() }, k);
    expect(created).toMatchObject({ revision: 1, status: 'active', notification_ready: true });
    expect(budgets.create(world, { spec: spec() }, k).id).toBe(created.id);
    expect(() => budgets.create(world, { spec: spec({ name: 'Other' }) }, k)).toThrow(
      expect.objectContaining({ status: 409, code: 'conflict' })
    );
    expect(() =>
      budgets.update(world, created.id, { expected_revision: 2, spec: spec() }, key())
    ).toThrow(expect.objectContaining({ code: 'conflict' }));
    const updated = budgets.update(
      world,
      created.id,
      { expected_revision: 1, spec: spec({ enabled: false }) },
      key()
    );
    expect(updated).toMatchObject({ revision: 2, status: 'draft' });
    const gone = budgets.remove(world, created.id, { expected_revision: 2 }, key());
    expect(gone.status).toBe('deleted');
    expect(budgets.list(world).budgets.some((b) => b.id === created.id)).toBe(false);
    expect(budgets.get(world, created.id).status).toBe('deleted');
    expect(
      budgets.revisions(created.id, new URLSearchParams()).revisions.map((r) => r.mutation)
    ).toEqual(['created', 'updated', 'deleted']);
    expect(() => budgets.channels(created.id)).toThrow(expect.objectContaining({ status: 404 }));
  });

  it('refuses an enabled strict cap until strict budgets are released', () => {
    expect(() => budgets.create(world, { spec: strict() }, key())).toThrow(
      expect.objectContaining({ status: 422, code: 'financial_budget_activation_unavailable' })
    );
    const draft = budgets.create(world, { spec: strict({ enabled: false }) }, key());
    expect(draft.status).toBe('draft');
    process.env.MOCK_STRICT_BUDGETS = '1';
    const on = budgets.update(world, draft.id, { expected_revision: 1, spec: strict() }, key());
    expect(on).toMatchObject({ status: 'active', enforcement_ready: true });
    expect(on.runtime?.compute?.committed_millicents).toBeGreaterThan(0);
  });

  it('keeps other responses as drafts only', () => {
    expect(() =>
      budgets.create(world, { spec: spec({ action: 'reject_traffic' }) }, key())
    ).toThrow(expect.objectContaining({ code: 'financial_budget_activation_unavailable' }));
    expect(() =>
      budgets.create(
        world,
        { spec: spec({ action: 'stop_previews', scope: { kind: 'job', id: 'job-1' } }) },
        key()
      )
    ).toThrow(expect.objectContaining({ status: 400 }));
    expect(() =>
      budgets.create(world, { spec: spec({ scope: { kind: 'app', id: 'nope' } }) }, key())
    ).toThrow(expect.objectContaining({ status: 404 }));
  });

  it('previews what a preview stop selects and what keeps running', () => {
    const out = budgets.preview(world, spec({ action: 'stop_previews', drain_seconds: 30 }));
    expect(out.targets.map((t) => t.name)).toEqual(['pr-42-api']);
    expect(out.continuing_targets.map((t) => t.name)).toEqual(['api', 'indexer', 'nightly-export']);
    expect(out.enforcement_ready).toBe(true);
    const env = budgets.preview(world, spec({ scope: { kind: 'environment', id: 'env-1' } }));
    expect(env.coverage_complete).toBe(false);
    const held = budgets.preview(world, strict());
    expect(held.targets.map((t) => t.name)).toEqual(['api']);
    expect(held.enforcement_ready).toBe(false);
  });

  it('records a stop on a preview budget past its limit', () => {
    const b = budgets.create(
      world,
      {
        spec: spec({
          action: 'stop_previews',
          basis: 'gross_usage',
          limit_millicents: 1,
          drain_seconds: 30,
        }),
      },
      key()
    );
    expect(b.runtime?.stops?.[0]?.targets.map((t) => t.app_id)).toEqual(['app-2']);
  });

  it('binds up to five of the account channels', () => {
    const b = budgets.create(world, { spec: spec() }, key());
    const ids = allChannels.slice(0, 1).map((c) => c.id);
    expect(budgets.setChannels(b.id, { channel_ids: ids }, key()).channels).toHaveLength(
      ids.length
    );
    expect(() => budgets.setChannels(b.id, { channel_ids: ['x'] }, key())).toThrow(
      expect.objectContaining({ status: 400 })
    );
    expect(() => budgets.setChannels(b.id, { channel_ids: [] }, '')).toThrow(
      expect.objectContaining({ status: 400 })
    );
  });
});
