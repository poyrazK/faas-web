import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Connect } from 'vite';
import { expect, it, vi } from 'vitest';
import { mockApi } from '../../../mock/plugin';

it('persists organization creation, rename, scoped ownership transfer and pending deletion in the mock API', async () => {
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
  const request = (path: string, method = 'GET', body?: unknown) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  try {
    expect((await request('/v1/orgs', 'POST', { slug: 'INVALID', name: 'Invalid' })).status).toBe(
      422
    );
    const response = await request('/v1/orgs', 'POST', {
      slug: 'settings-lifecycle',
      name: 'Lifecycle',
    });
    expect(response.status).toBe(201);
    const created = await response.json();
    expect(created).toMatchObject({
      slug: 'settings-lifecycle',
      name: 'Lifecycle',
      personal: false,
      status: 'active',
    });
    expect(
      (await request('/v1/orgs', 'POST', { slug: 'settings-lifecycle', name: 'Duplicate' })).status
    ).toBe(409);
    expect(await (await request('/v1/orgs/settings-lifecycle')).json()).toMatchObject({
      id: created.id,
      name: 'Lifecycle',
    });
    await request('/v1/orgs/settings-lifecycle', 'PATCH', { name: 'Renamed' });
    const listed = await (await request('/v1/orgs')).json();
    expect(listed.orgs.find((org: { slug: string }) => org.slug === created.slug).name).toBe(
      'Renamed'
    );
    const ownMembers = await (await request('/v1/orgs/settings-lifecycle/members')).json();
    expect(ownMembers.members).toHaveLength(1);
    expect(ownMembers.members[0].role).toBe('owner');
    const existing = await (await request('/v1/orgs/acme-corp/members')).json();
    const next = existing.members.find((member: { role: string }) => member.role !== 'owner');
    expect(
      (
        await request('/v1/orgs/acme-corp/transfer_ownership', 'POST', {
          new_owner_account_id: next.account_id,
        })
      ).status
    ).toBe(200);
    const transferred = await (await request('/v1/orgs/acme-corp/members')).json();
    expect(
      transferred.members.find(
        (member: { account_id: string }) => member.account_id === next.account_id
      ).role
    ).toBe('owner');
    expect(
      transferred.members.find(
        (member: { account_id: string }) =>
          member.account_id ===
          existing.members.find((m: { role: string }) => m.role === 'owner').account_id
      ).role
    ).toBe('admin');
    expect(
      (await (await request('/v1/orgs/settings-lifecycle/members')).json()).members[0].role
    ).toBe('owner');
    expect((await request('/v1/orgs/settings-lifecycle', 'DELETE')).status).toBe(204);
    expect(
      (await (await request('/v1/orgs')).json()).orgs.some(
        (org: { slug: string }) => org.slug === created.slug
      )
    ).toBe(false);
    expect((await request('/v1/orgs/design', 'DELETE')).status).toBe(409);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}, 15000);
