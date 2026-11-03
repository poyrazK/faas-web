import { describe, expect, it } from 'vitest';
import type { components } from '../src/lib/api/schema';
import {
  promoteDeployment,
  readRollback,
  releaseDiff,
  releaseReview,
  runtimeFor,
  runtimePreview,
  servingChanged,
  setTrafficWeight,
  startRollback,
} from './deployment-detail';

type Deployment = components['schemas']['DeploymentResponse'];

const dep = (id: string, minutesAgo: number, over: Partial<Deployment> = {}): Deployment => ({
  id,
  app_id: 'app-1',
  image_digest: `sha256:${id}`,
  kind: 'github',
  status: 'superseded',
  traffic_percent: 0,
  created_at: new Date(Date.UTC(2026, 9, 31, 12) - minutesAgo * 60_000).toISOString(),
  ...over,
});

describe('release diff', () => {
  it('compares with the newest older release of the same app and scope', () => {
    const rows = [
      dep('c', 1, { status: 'live', traffic_percent: 100, revision: 3 }),
      dep('b', 10, { revision: 2 }),
      dep('x', 5, { app_id: 'other' }),
      dep('a', 20, { revision: 1 }),
    ];
    const diff = releaseDiff(rows, rows[0]);
    expect(diff.from?.deployment_id).toBe('b');
    expect(diff.to.revision).toBe(3);
    expect(diff.summary).not.toBe('first release');
  });

  it('reports a first release with unknown sections', () => {
    const rows = [dep('a', 20)];
    const diff = releaseDiff(rows, rows[0]);
    expect(diff.from).toBeUndefined();
    expect(diff.summary).toBe('first release');
    expect(diff.config.known).toBe(false);
  });
});

describe('runtime', () => {
  it('pins managed function artifacts and leaves images to their own runtime', () => {
    expect(runtimeFor('function', 'node22', dep('a', 1)).status).toBe('pinned');
    expect(runtimeFor('app', 'node22', dep('a', 1, { kind: 'image' })).status).toBe('unsupported');
  });

  it('previews like the server: same base is no change, another needs review', () => {
    const runtime = runtimeFor('function', 'node22', dep('a', 1));
    const current = runtime.current!;
    expect(runtimePreview(runtime, current).disposition).toBe('no_change');
    const other = runtime.releases.find((r) => r.id !== current.id)!;
    const preview = runtimePreview(runtime, other);
    expect(preview.disposition).toBe('review_required');
    expect(preview.execution_available).toBe(false);
    expect(preview.rebuild_required).toBe(true);
  });
});

describe('promotion', () => {
  it('moves all traffic in the scope to the release', () => {
    const rows = [
      dep('new', 1, { status: 'live', traffic_percent: 0 }),
      dep('old', 10, { status: 'live', traffic_percent: 100 }),
    ];
    const result = promoteDeployment(rows, rows[0]);
    expect(result.from_percent).toBe(0);
    expect(rows[0].traffic_percent).toBe(100);
    expect(rows[1].traffic_percent).toBe(0);
  });
});

describe('serving expectations', () => {
  const rows = () => [
    dep('new', 1, { status: 'live', traffic_percent: 0 }),
    dep('old', 10, { status: 'live', traffic_percent: 100 }),
    dep('other-scope', 5, { status: 'live', traffic_percent: 100, scope: 'canary' }),
  ];

  it('holds while the named release alone serves the scope at 100%', () => {
    const all = rows();
    expect(servingChanged(all, all[0], 'old')).toBe(false);
    expect(servingChanged(all, all[0], 'stale')).toBe(true);
    expect(servingChanged(all, all[0], '')).toBe(true);
  });

  it('fails once traffic is split, and "" holds only when nothing else serves', () => {
    const all = rows();
    all[1].traffic_percent = 90;
    all[0].traffic_percent = 10;
    expect(servingChanged(all, all[0], 'old')).toBe(true);
    const alone = [dep('only', 1, { status: 'live', traffic_percent: 100 })];
    expect(servingChanged(alone, alone[0], '')).toBe(false);
  });
});

describe('traffic weights', () => {
  it('gives the target its weight and shares the rest by prior weight', () => {
    const all = [
      dep('new', 1, { status: 'live', traffic_percent: 0 }),
      dep('a', 10, { status: 'live', traffic_percent: 75 }),
      dep('b', 20, { status: 'live', traffic_percent: 25 }),
    ];
    expect(setTrafficWeight(all, all[0], 10)).toBe(true);
    expect(all.map((d) => d.traffic_percent)).toEqual([10, 68, 22]);
    expect(all.reduce((sum, d) => sum + (d.traffic_percent ?? 0), 0)).toBe(100);
  });

  it('refuses a residual nothing can take', () => {
    const all = [dep('only', 1, { status: 'live', traffic_percent: 100 })];
    expect(setTrafficWeight(all, all[0], 40)).toBe(false);
    expect(all[0].traffic_percent).toBe(100);
  });
});

describe('release review', () => {
  it('pins the configuration, the newest release and what serves the default scope', () => {
    const all = [
      dep('dark', 1, { status: 'live', traffic_percent: 0 }),
      dep('old', 10, { status: 'live', traffic_percent: 100 }),
      dep('canary', 2, { status: 'live', traffic_percent: 100, scope: 'canary' }),
    ];
    const app = { id: 'app-1', runtime: 'node24' as const, ram_mb: 512, min_instances: 0 };
    const review = releaseReview(all, app);
    expect(review).toMatchObject({
      app_id: 'app-1',
      scope: 'default',
      latest_deployment_id: 'dark',
      serving_deployment_ids: ['old'],
    });
    expect(review.configuration_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(releaseReview(all, { ...app, ram_mb: 1024 }).configuration_hash).not.toBe(
      review.configuration_hash
    );
  });
});

describe('rollback operations', () => {
  it('walks preparing → routing → complete and then swaps the releases', () => {
    const rows = [
      dep('cur', 1, { status: 'live', traffic_percent: 100 }),
      dep('tgt', 10, { status: 'superseded' }),
    ];
    const t0 = Date.UTC(2026, 9, 31, 12);
    const op = startRollback('slug', rows[1], rows[0], t0);
    expect(op.status).toBe('preparing');
    expect(readRollback(rows, op.id, t0 + 4_000)?.status).toBe('routing');
    expect(rows[1].status).toBe('superseded');
    const done = readRollback(rows, op.id, t0 + 9_000);
    expect(done?.status).toBe('complete');
    expect(done?.recovery_ms).toBeGreaterThan(0);
    expect(rows[1]).toMatchObject({ status: 'live', traffic_percent: 100 });
    expect(rows[0]).toMatchObject({ status: 'superseded', traffic_percent: 0 });
    expect(readRollback(rows, 'nope', t0)).toBeUndefined();
  });
});
