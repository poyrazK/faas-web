import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Connect } from 'vite';
import { describe, expect, it, vi } from 'vitest';
import { mockApi } from '../mock/plugin';

describe('mock API', () => {
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
