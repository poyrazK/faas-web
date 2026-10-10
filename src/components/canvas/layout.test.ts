import { describe, expect, it } from 'vitest';
import { draftPosition, layout, NODE_SIZE } from './layout';
import { buildTopology, nodeId, type TopologyInput } from './topology';
import type { App } from '@/lib/api/queries';

const app = (slug: string) => ({ id: `id-${slug}`, slug, status: 'active', url: 'u' }) as App;
const ready = <T>(data: T) => ({ status: 'ready' as const, data });
const bucketList = (names: string[]) =>
  ready({
    items: names.map((name) => ({
      id: name,
      name,
      scope: 'default',
      region: 'eu',
      state: 'ready' as const,
      created_at: '',
    })),
    enabled: true,
    regions: [],
    default_region: 'eu',
    max_upload_bytes: 1,
    max_buckets_per_app: 10,
  });

const topo = () =>
  buildTopology({
    apps: [app('acme-api'), app('billing'), app('worker')],
    domains: [
      { domain: 'api.acme.dev', app_id: 'id-acme-api', verified: true },
      { domain: 'www.acme.dev', app_id: 'id-acme-api', verified: true },
    ],
    crons: [
      {
        id: 'c1',
        app_id: 'id-billing',
        schedule: '0 2 * * *',
        path: '/',
        enabled: true,
        timezone: 'UTC',
        skip_if_running: false,
        created_at: '',
      },
    ],
    metrics: { status: 'loading' },
    buckets: {
      'acme-api': bucketList(['a', 'b', 'c']),
      billing: bucketList([]),
      worker: bucketList(['x']),
    },
    postgres: ready({ databases: [], bindings: [] }),
  } satisfies TopologyInput);

const rect = (t: ReturnType<typeof topo>, pos: ReturnType<typeof layout>, id: string) => {
  const kind = t.nodes.find((n) => n.id === id)!.data.kind;
  const p = pos.get(id)!;
  return { ...p, w: NODE_SIZE[kind].w, h: NODE_SIZE[kind].h };
};

describe('layout', () => {
  it('places every node, deterministically', () => {
    const t = topo();
    const a = layout(t);
    expect([...a.keys()].sort()).toEqual(t.nodes.map((n) => n.id).sort());
    expect([...layout(topo()).entries()]).toEqual([...a.entries()]);
  });

  it('never overlaps two nodes', () => {
    const t = topo();
    const pos = layout(t);
    const rects = t.nodes.map((n) => rect(t, pos, n.id));
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const [r, s] = [rects[i], rects[j]];
        const overlap = r.x < s.x + s.w && s.x < r.x + r.w && r.y < s.y + s.h && s.y < r.y + r.h;
        expect(overlap, `${t.nodes[i].id} × ${t.nodes[j].id}`).toBe(false);
      }
  });

  it('reads left to right: Internet, domains, apps, resources, with crons above their app', () => {
    const t = topo();
    const pos = layout(t);
    const x = (id: string) => pos.get(id)!.x;
    expect(x(nodeId.internet)).toBeLessThan(x(nodeId.domain('api.acme.dev')));
    expect(x(nodeId.domain('api.acme.dev'))).toBeLessThan(x(nodeId.app('acme-api')));
    expect(x(nodeId.app('acme-api'))).toBeLessThan(x(nodeId.bucket('acme-api', 'a')));
    expect(pos.get(nodeId.cron('c1'))!.y).toBeLessThan(pos.get(nodeId.app('billing'))!.y);
    expect(pos.get(nodeId.app('acme-api'))!.y).toBeLessThan(pos.get(nodeId.app('billing'))!.y);
  });
});

describe('draftPosition', () => {
  it('opens inbound drafts to the left of the app and outbound ones to the right', () => {
    const app = { x: 420, y: 100 };
    expect(draftPosition(app, 'in').x).toBeLessThan(app.x);
    expect(draftPosition(app, 'out').x).toBeGreaterThan(app.x);
  });
});
