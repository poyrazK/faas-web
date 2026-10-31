import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Connect } from 'vite';
import { expect, it, vi } from 'vitest';
import { mockApi } from '../../../mock/plugin';

it('serves persisted mock inventory and app-filtered activity with older pages and actor/kind filters', async () => {
  const plugin = mockApi();
  let middleware: Connect.NextHandleFunction | undefined;
  if (typeof plugin.configureServer !== 'function') throw new Error('No mock server hook');
  plugin.configureServer({
    config: { logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
    middlewares: {
      use(handler: Connect.NextHandleFunction) {
        middleware = handler;
      },
    },
  } as never);
  const server = createServer((req, res) =>
    middleware!(req, res, () => {
      res.statusCode = 599;
      res.end();
    })
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const get = (path: string) => fetch(`http://127.0.0.1:${port}${path}`);
  try {
    const inventory = await (await get('/v1/orgs/acme-corp/apps')).json();
    expect(inventory.apps.map((app: { slug: string }) => app.slug)).toEqual(['search-indexer']);
    const appId = inventory.apps[0].id;
    const personal = await (await get('/v1/orgs/design/apps')).json();
    expect(personal.apps.some((app: { id: string }) => app.id === appId)).toBe(false);
    const first = await (await get(`/v1/orgs/acme-corp/activity?app_id=${appId}&limit=50`)).json();
    expect(first.items).toHaveLength(50);
    expect(first.next_before).toBeTruthy();
    expect(first.items.every((row: { app_id: string }) => row.app_id === appId)).toBe(true);
    const second = await (
      await get(
        `/v1/orgs/acme-corp/activity?app_id=${appId}&limit=50&before=${encodeURIComponent(first.next_before)}`
      )
    ).json();
    expect(second.items).toHaveLength(13);
    expect(second.next_before).toBeUndefined();
    expect(new Set([...first.items, ...second.items].map((row) => row.id)).size).toBe(63);
    const filtered = await (
      await get(`/v1/orgs/acme-corp/activity?app_id=${appId}&kind_prefix=domain.&actor_type=system`)
    ).json();
    expect(filtered.items.length).toBeGreaterThan(0);
    expect(
      filtered.items.every(
        (row: { kind: string; actor: { type: string } }) =>
          row.kind.startsWith('domain.') && row.actor.type === 'system'
      )
    ).toBe(true);
    expect((await get('/v1/orgs/acme-corp/activity?before=invalid')).status).toBe(400);
    expect((await get('/v1/orgs/acme-corp/activity?app_id=not-an-id')).status).toBe(400);
    expect((await get('/v1/orgs/missing/activity')).status).toBe(404);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});
