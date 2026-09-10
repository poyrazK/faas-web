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
});
