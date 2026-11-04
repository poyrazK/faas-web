import { describe, expect, it } from 'vitest';
import type { App } from '@/lib/api/queries';
import {
  pausedNow,
  warmApplies,
  warmChanges,
  warmDraft,
  warmErrors,
  warmPoolAllowed,
  warmSnapshotAllowed,
} from './warm-starts';

const app = (fields: object) =>
  ({
    slug: 'a',
    max_concurrency: 4,
    warm_pool_size: 0,
    warm_snapshot_enabled: true,
    warm_snapshot_min_ms: 2000,
    warm_snapshot_min_requests: 5,
    manifest: { entrypoint: ['x'] },
    ...fields,
  }) as unknown as App;

describe('warm starts', () => {
  it('gates the pool on Hobby and up, and warm snapshots on Pro and up (limits.go)', () => {
    expect(['free', 'hobby', 'pro', 'scale'].map((p) => warmPoolAllowed(p as never))).toEqual([
      false,
      true,
      true,
      true,
    ]);
    expect(['free', 'hobby', 'pro', 'scale'].map((p) => warmSnapshotAllowed(p as never))).toEqual([
      false,
      false,
      true,
      true,
    ]);
    expect(warmPoolAllowed(undefined)).toBe(false);
  });

  it('reads the stored values as the form edits them', () => {
    expect(warmDraft(app({ warm_pool_size: 2 }))).toEqual({
      warm_pool_size: '2',
      warm_snapshot_enabled: true,
      warm_snapshot_min_ms: '2000',
      warm_snapshot_min_requests: '5',
    });
    expect(
      warmDraft(
        app({
          warm_pool_size: undefined,
          warm_snapshot_enabled: undefined,
          warm_snapshot_min_ms: undefined,
          warm_snapshot_min_requests: undefined,
        })
      )
    ).toEqual({
      warm_pool_size: '0',
      warm_snapshot_enabled: false,
      warm_snapshot_min_ms: '',
      warm_snapshot_min_requests: '',
    });
  });

  it('refuses what apid refuses: a pool beyond max_concurrency, thresholds out of range', () => {
    const a = app({});
    const ok = warmDraft(a);
    expect(warmErrors(ok, a)).toEqual({});
    expect(warmErrors({ ...ok, warm_pool_size: '5' }, a).warm_pool_size).toMatch(
      /at most 4, the app.s max concurrency/i
    );
    expect(warmErrors({ ...ok, warm_pool_size: '-1' }, a).warm_pool_size).toBeDefined();
    expect(warmErrors({ ...ok, warm_pool_size: '1.5' }, a).warm_pool_size).toBeDefined();
    expect(warmErrors({ ...ok, warm_pool_size: '' }, a).warm_pool_size).toBeDefined();
    expect(warmErrors({ ...ok, warm_snapshot_min_ms: '99' }, a).warm_snapshot_min_ms).toMatch(
      /100 to 60,000/
    );
    expect(
      warmErrors({ ...ok, warm_snapshot_min_requests: '101' }, a).warm_snapshot_min_requests
    ).toMatch(/1 to 100/);
    // Thresholds are only checked while warm snapshots are on.
    expect(
      warmErrors({ ...ok, warm_snapshot_enabled: false, warm_snapshot_min_ms: '1' }, a)
    ).toEqual({});
  });

  it('sends only what changed', () => {
    const a = app({});
    const base = warmDraft(a);
    expect(warmChanges(a, base)).toEqual({});
    expect(warmChanges(a, { ...base, warm_pool_size: '2' })).toEqual({ warm_pool_size: 2 });
    expect(
      warmChanges(a, { ...base, warm_snapshot_enabled: false, warm_snapshot_min_ms: '500' })
    ).toEqual({ warm_snapshot_enabled: false });
    expect(warmChanges(a, { ...base, warm_snapshot_min_requests: '10' })).toEqual({
      warm_snapshot_min_requests: 10,
    });
  });

  it('applies to request and service apps, which are snapshotted', () => {
    expect(warmApplies(app({}))).toBe(true);
    expect(warmApplies(app({ manifest: { entrypoint: ['x'], execution_mode: 'service' } }))).toBe(
      true
    );
    expect(warmApplies(app({ manifest: { entrypoint: ['x'], execution_mode: 'worker' } }))).toBe(
      false
    );
    expect(warmApplies(app({ manifest: { entrypoint: ['x'], execution_mode: 'job' } }))).toBe(
      false
    );
  });

  it('counts the paused warm instances the instance list reports', () => {
    expect(
      pausedNow([
        { state: 'warm' },
        { state: 'running' },
        { state: 'warm' },
        { state: 'parked' },
      ] as never)
    ).toBe(2);
    expect(pausedNow([])).toBe(0);
  });
});
