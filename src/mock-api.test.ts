import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Connect } from 'vite';
import { describe, expect, it, vi } from 'vitest';
import { mockApi } from '../mock/plugin';

describe('mock API', () => {
  it('requires the one-time token for invitation revocation and never returns it in lists', async () => {
    const plugin = mockApi();
    let middleware: Connect.NextHandleFunction | undefined;
    if (typeof plugin.configureServer !== 'function') throw new Error('Missing server hook');
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
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const organizations = (await fetch(`${base}/v1/orgs`).then((r) => r.json())) as {
        orgs: Array<{ slug: string; personal: boolean }>;
      };
      const org = organizations.orgs.find((o) => !o.personal)!;
      const created = await fetch(`${base}/v1/orgs/${org.slug}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'token-contract@example.com', role: 'viewer' }),
      });
      expect(created.status).toBe(201);
      const invitation = (await created.json()) as { id: string; token: string };
      const invalid = await fetch(`${base}/v1/orgs/${org.slug}/invitations/${invitation.id}`, {
        method: 'DELETE',
      });
      expect(invalid.status).toBe(410);
      expect(await invalid.json()).toMatchObject({ code: 'org_invitation_invalid' });
      const listed = (await fetch(`${base}/v1/orgs/${org.slug}/invitations`).then((r) =>
        r.json()
      )) as { invitations: Array<{ id: string; status: string; token?: string }> };
      expect(listed.invitations.find((i) => i.id === invitation.id)).toMatchObject({
        status: 'pending',
      });
      expect(JSON.stringify(listed)).not.toContain(invitation.token);
      expect(listed.invitations.every((i) => i.token === undefined)).toBe(true);
      const revoked = await fetch(`${base}/v1/orgs/${org.slug}/invitations/${invitation.token}`, {
        method: 'DELETE',
      });
      expect(revoked.status).toBe(204);
      expect(
        (
          await fetch(`${base}/v1/orgs/${org.slug}/invitations/${invitation.token}`, {
            method: 'DELETE',
          })
        ).status
      ).toBe(410);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
  it('serves the latest-by-app collection instead of treating it as a deployment id', async () => {
    const plugin = mockApi();
    let middleware: Connect.NextHandleFunction | undefined;
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    if (typeof plugin.configureServer !== 'function') {
      throw new Error('mock API plugin has no development-server hook');
    }

    plugin.configureServer({
      config: { logger },
      middlewares: {
        use(handler: Connect.NextHandleFunction) {
          middleware = handler;
        },
      },
    } as never);

    if (!middleware) throw new Error('mock API middleware was not registered');

    const server = createServer((req, res) => {
      middleware!(req, res, () => {
        res.statusCode = 599;
        res.end('request fell through');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    try {
      const { port } = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${port}/v1/deployments/latest-by-app`);
      const body = (await response.json()) as {
        code?: string;
        items?: Array<{ app_id: string }>;
      };

      expect(response.status).toBe(200);
      expect(body.code).toBeUndefined();
      expect(body.items?.length).toBeGreaterThan(0);
      expect(new Set(body.items?.map((deployment) => deployment.app_id)).size).toBe(
        body.items?.length
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });

  it('stages account deletion and restores the account during the recovery window', async () => {
    const plugin = mockApi();
    let middleware: Connect.NextHandleFunction | undefined;
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    if (typeof plugin.configureServer !== 'function') {
      throw new Error('mock API plugin has no development-server hook');
    }
    plugin.configureServer({
      config: { logger },
      middlewares: {
        use(handler: Connect.NextHandleFunction) {
          middleware = handler;
        },
      },
    } as never);
    if (!middleware) throw new Error('mock API middleware was not registered');

    const server = createServer((req, res) => {
      middleware!(req, res, () => {
        res.statusCode = 599;
        res.end('request fell through');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    try {
      const { port } = server.address() as AddressInfo;
      const base = `http://127.0.0.1:${port}`;
      const deleted = await fetch(`${base}/v1/account`, { method: 'DELETE' });
      const staged = (await deleted.json()) as { status?: string; restore_until?: string };
      expect(deleted.status).toBe(200);
      expect(staged.status).toBe('deleted_pending');
      expect(staged.restore_until).toBeTruthy();

      const pending = await fetch(`${base}/v1/account`).then((response) => response.json());
      expect(pending).toEqual(expect.objectContaining({ status: 'deleted_pending' }));

      const restored = await fetch(`${base}/v1/account/restore`, { method: 'POST' });
      expect(restored.status).toBe(200);
      expect(await restored.json()).toEqual(expect.objectContaining({ status: 'active' }));
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
});
