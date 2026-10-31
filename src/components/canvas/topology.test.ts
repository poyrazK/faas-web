import { describe, expect, it } from 'vitest';
import { appPhase, buildTopology, nodeId, summarizeIssues, type TopologyInput } from './topology';
import type { App } from '@/lib/api/queries';

const app = (slug: string, extra: Partial<App> = {}) =>
  ({
    id: `id-${slug}`,
    slug,
    status: 'active',
    url: `https://${slug}.gregale.app`,
    ...extra,
  }) as App;

function input(over: Partial<TopologyInput> = {}): TopologyInput {
  return {
    apps: [app('acme-api'), app('billing')],
    domains: [],
    crons: [],
    metrics: { status: 'ready', data: { range: '24h', source: 'prom', as_of: '', apps: {} } },
    buckets: {},
    postgres: { status: 'ready', data: { databases: [], bindings: [], failedBindings: [] } },
    ...over,
  };
}

const metricsFor = (rows: Record<string, number>) =>
  ({
    status: 'ready',
    data: {
      range: '24h',
      source: 'prom',
      as_of: '',
      apps: Object.fromEntries(
        Object.entries(rows).map(([slug, n]) => [slug, { request_count: n, latency_p95_ms: 80 }])
      ),
    },
  }) as TopologyInput['metrics'];

describe('appPhase', () => {
  it.each([
    ['active', 'running'],
    ['evicted_cold', 'parked'],
    ['parked', 'parked'],
    ['undeployed', 'undeployed'],
    ['failed', 'error'],
    ['deploying', 'deploying'],
    [undefined, 'idle'],
  ] as const)('%s → %s', (status, phase) => expect(appPhase(status)).toBe(phase));
});

describe('buildTopology', () => {
  it('draws nothing, not even the Internet, for an account without apps', () => {
    expect(buildTopology(input({ apps: [] })).nodes).toEqual([]);
  });

  it('orders apps by slug and connects an undomained app straight to the Internet', () => {
    const t = buildTopology(input({ apps: [app('zeta'), app('alpha')] }));
    expect(t.nodes.filter((n) => n.data.kind === 'app').map((n) => n.id)).toEqual([
      nodeId.app('alpha'),
      nodeId.app('zeta'),
    ]);
    expect(t.edges).toContainEqual(
      expect.objectContaining({
        source: nodeId.internet,
        target: nodeId.app('alpha'),
        kind: 'ingress',
      })
    );
  });

  it('routes a custom domain between the Internet and its app, by app_id', () => {
    const t = buildTopology(
      input({
        apps: [app('acme-api', { url: '' })],
        domains: [{ domain: 'api.acme.dev', app_id: 'id-acme-api', verified: true }],
        metrics: metricsFor({ 'acme-api': 1200 }),
      })
    );
    const d = nodeId.domain('api.acme.dev');
    expect(t.edges).toContainEqual(
      expect.objectContaining({ source: nodeId.internet, target: d, requests24h: 1200 })
    );
    expect(t.edges).toContainEqual(
      expect.objectContaining({
        source: d,
        target: nodeId.app('acme-api'),
        requests24h: 1200,
        pending: false,
      })
    );
  });

  it('keeps the default URL as an ingress path, so one domain does not claim all traffic', () => {
    const t = buildTopology(
      input({
        domains: [{ domain: 'api.acme.dev', app_id: 'id-acme-api', verified: true }],
        metrics: metricsFor({ 'acme-api': 1200 }),
      })
    );
    const direct = t.edges.find(
      (e) => e.source === nodeId.internet && e.target === nodeId.app('acme-api')
    );
    expect(direct).toBeDefined();
    const ingress = t.edges.filter((e) => e.kind === 'ingress' && e.id.includes('acme'));
    expect(ingress.every((e) => e.requests24h === undefined)).toBe(true);
  });

  it('marks an unverified domain as pending', () => {
    const t = buildTopology(
      input({
        domains: [
          { domain: 'new.acme.dev', app_id: 'id-acme-api', verified: false, txt_record: 'TXT x' },
        ],
      })
    );
    expect(t.nodes.find((n) => n.id === nodeId.domain('new.acme.dev'))?.data).toMatchObject({
      verified: false,
      txtRecord: 'TXT x',
    });
    expect(
      t.edges
        .filter(
          (e) =>
            e.target === nodeId.domain('new.acme.dev') || e.source === nodeId.domain('new.acme.dev')
        )
        .every((e) => e.pending)
    ).toBe(true);
  });

  it('does not split or duplicate traffic across several domains', () => {
    const t = buildTopology(
      input({
        domains: [
          { domain: 'a.acme.dev', app_id: 'id-acme-api', verified: true },
          { domain: 'b.acme.dev', app_id: 'id-acme-api', verified: true },
        ],
        metrics: metricsFor({ 'acme-api': 900 }),
      })
    );
    const ingress = t.edges.filter((e) => e.kind === 'ingress' && e.id.includes('acme'));
    expect(ingress.length).toBe(5);
    expect(ingress.every((e) => e.requests24h === undefined)).toBe(true);
    expect(t.nodes.find((n) => n.id === nodeId.app('acme-api'))?.data).toMatchObject({
      requests24h: 900,
    });
  });

  it('drops and reports orphans instead of drawing a dangling edge', () => {
    const t = buildTopology(
      input({
        domains: [{ domain: 'old.acme.dev', app_id: 'id-deleted', verified: true }],
        crons: [
          {
            id: 'c1',
            app_id: 'id-deleted',
            kind: 'http',
            schedule: '0 2 * * *',
            path: '/',
            enabled: true,
            timezone: 'UTC',
            skip_if_running: false,
            created_at: '',
          },
        ],
      })
    );
    expect(t.nodes.some((n) => n.id === nodeId.domain('old.acme.dev'))).toBe(false);
    expect(t.nodes.some((n) => n.id === nodeId.cron('c1'))).toBe(false);
    expect(t.issues.map((i) => [i.kind, i.ref])).toEqual([
      ['orphan', nodeId.domain('old.acme.dev')],
      ['orphan', nodeId.cron('c1')],
    ]);
  });

  it('connects crons into their app', () => {
    const t = buildTopology(
      input({
        crons: [
          {
            id: 'c1',
            app_id: 'id-billing',
            kind: 'http',
            schedule: '*/15 * * * *',
            path: '/run',
            enabled: true,
            timezone: 'UTC',
            skip_if_running: false,
            created_at: '',
            last_fired_at: null,
          },
        ],
      })
    );
    expect(t.edges).toContainEqual(
      expect.objectContaining({
        source: nodeId.cron('c1'),
        target: nodeId.app('billing'),
        kind: 'schedule',
      })
    );
  });

  it('keeps unknown metrics unknown rather than zero', () => {
    const failed = buildTopology(input({ metrics: { status: 'error', error: new Error('402') } }));
    const data = failed.nodes.find((n) => n.id === nodeId.app('acme-api'))?.data;
    expect(data).toMatchObject({ metrics: 'unavailable' });
    expect(data && 'requests24h' in data ? data.requests24h : 'absent').toBeUndefined();
    const degraded = buildTopology(input({ metrics: metricsFor({}) }));
    expect(degraded.nodes.find((n) => n.id === nodeId.app('acme-api'))?.data).toMatchObject({
      metrics: 'unavailable',
    });
  });

  it('distinguishes a failed bucket read from an app with no buckets', () => {
    const t = buildTopology(
      input({
        buckets: {
          'acme-api': { status: 'error', error: new Error('boom') },
          billing: {
            status: 'ready',
            data: {
              items: [],
              enabled: true,
              regions: [],
              default_region: 'eu',
              max_upload_bytes: 1,
              max_buckets_per_app: 1,
            },
          },
        },
      })
    );
    expect(t.nodes.find((n) => n.id === nodeId.app('acme-api'))?.data).toMatchObject({
      connections: 'error',
    });
    expect(t.nodes.find((n) => n.id === nodeId.app('billing'))?.data).toMatchObject({
      connections: 'ready',
      buckets: { enabled: true, atLimit: false, defaultRegion: 'eu' },
    });
    expect(t.issues).toContainEqual(
      expect.objectContaining({ kind: 'read_failed', ref: nodeId.app('acme-api') })
    );
  });

  it('reports a database whose bindings could not be read, and still draws it', () => {
    const t = buildTopology(
      input({
        postgres: {
          status: 'ready',
          data: {
            databases: [{ id: 'db1', name: 'main', state: 'ready' } as never],
            bindings: [],
            failedBindings: ['db1'],
          },
        },
      })
    );
    expect(t.nodes.some((n) => n.id === nodeId.postgres('db1'))).toBe(true);
    expect(t.issues).toContainEqual(
      expect.objectContaining({ kind: 'read_failed', ref: nodeId.postgres('db1') })
    );
  });

  it('draws buckets and live Postgres bindings, and shares one database node', () => {
    const t = buildTopology(
      input({
        buckets: {
          'acme-api': {
            status: 'ready',
            data: {
              items: [
                {
                  id: 'b1',
                  name: 'orders',
                  scope: 'default',
                  region: 'eu',
                  state: 'ready',
                  public: false,
                  created_at: '',
                },
              ],
              enabled: true,
              regions: [],
              default_region: 'eu',
              max_upload_bytes: 1,
              max_buckets_per_app: 1,
            },
          },
        },
        postgres: {
          status: 'ready',
          data: {
            databases: [{ id: 'db1', name: 'main', state: 'ready' } as never],
            bindings: [
              {
                id: 'x',
                database_id: 'db1',
                app_id: 'id-acme-api',
                state: 'ready',
                access: 'read_write',
              } as never,
              {
                id: 'y',
                database_id: 'db1',
                app_id: 'id-billing',
                state: 'ready',
                access: 'read_only',
              } as never,
              {
                id: 'z',
                database_id: 'db1',
                app_id: 'id-billing',
                state: 'deleted',
                access: 'read_only',
              } as never,
            ],
            failedBindings: [],
          },
        },
      })
    );
    expect(t.nodes.find((n) => n.id === nodeId.app('acme-api'))?.data).toMatchObject({
      buckets: { atLimit: true },
    });
    expect(t.edges).toContainEqual(
      expect.objectContaining({
        source: nodeId.app('acme-api'),
        target: nodeId.bucket('acme-api', 'orders'),
        kind: 'storage',
      })
    );
    expect(t.nodes.filter((n) => n.id === nodeId.postgres('db1'))).toHaveLength(1);
    expect(t.edges.filter((e) => e.kind === 'database')).toHaveLength(2);
  });
});

describe('summarizeIssues', () => {
  it('says what could not be shown, in plain words, once per kind', () => {
    expect(
      summarizeIssues([
        { kind: 'read_failed', ref: 'postgres', detail: '' },
        { kind: 'read_failed', ref: 'postgres:db1', detail: '' },
        { kind: 'read_failed', ref: 'app:a', detail: '' },
        { kind: 'read_failed', ref: 'app:b', detail: '' },
        { kind: 'orphan', ref: 'domain:x', detail: '' },
      ])
    ).toEqual([
      'Couldn’t load Postgres.',
      'Couldn’t load bindings for 1 database.',
      'Couldn’t load connections for 2 apps.',
      '1 item points at an app that no longer exists.',
    ]);
    expect(summarizeIssues([])).toEqual([]);
  });
});

import { ApiError } from '@/lib/api/errors';
import { nodeTitle } from './topology';

describe('v2 app fields', () => {
  it('says metrics are plan-gated on a plan-gate code and unavailable otherwise', () => {
    const plan = buildTopology(
      input({
        metrics: {
          status: 'error',
          error: new ApiError({
            status: 402,
            code: 'plan_app_usage_summary_not_allowed',
            title: 'x',
          }),
        },
      })
    );
    expect(plan.nodes.find((n) => n.id === nodeId.app('acme-api'))?.data).toMatchObject({
      metricsWhy: 'plan',
    });
    const other = buildTopology(input({ metrics: { status: 'error', error: new Error('boom') } }));
    expect(other.nodes.find((n) => n.id === nodeId.app('acme-api'))?.data).toMatchObject({
      metricsWhy: 'unavailable',
    });
  });

  it('carries error rate, runtime and url when known', () => {
    const t = buildTopology(
      input({
        apps: [app('acme-api', { runtime: 'node24', url: 'https://acme-api.gregale.app' })],
        metrics: {
          status: 'ready',
          data: {
            range: '24h',
            source: 'p',
            as_of: '',
            apps: { 'acme-api': { request_count: 5, error_rate_pct: 3.2 } as never },
          },
        },
      })
    );
    expect(t.nodes.find((n) => n.id === nodeId.app('acme-api'))?.data).toMatchObject({
      errorRatePct: 3.2,
      runtime: 'node24',
      url: 'https://acme-api.gregale.app',
    });
  });

  it('keys Postgres edges by binding, so two bindings never collide', () => {
    const t = buildTopology(
      input({
        postgres: {
          status: 'ready',
          data: {
            databases: [{ id: 'db1', name: 'main', state: 'ready' } as never],
            bindings: [
              { id: 'b1', database_id: 'db1', app_id: 'id-acme-api', state: 'ready' } as never,
              { id: 'b2', database_id: 'db1', app_id: 'id-acme-api', state: 'ready' } as never,
            ],
            failedBindings: [],
          },
        },
      })
    );
    const ids = t.edges.filter((e) => e.kind === 'database').map((e) => e.id);
    expect(ids).toEqual(['database:b1', 'database:b2']);
  });

  it('titles every kind the way a person names it', () => {
    expect(nodeTitle({ kind: 'internet' })).toBe('Internet');
    expect(
      nodeTitle({
        kind: 'cron',
        id: 'c',
        schedule: '',
        path: '',
        timezone: 'UTC',
        enabled: true,
        lastFiredAt: null,
        appSlug: 'a',
      })
    ).toBe('/');
    expect(nodeTitle({ kind: 'bucket', appSlug: 'a', name: 'orders', state: 'ready' })).toBe(
      'orders'
    );
  });
});
