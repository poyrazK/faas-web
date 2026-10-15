import { afterEach, expect, it, vi } from 'vitest';
import { api } from './client';
import { readMcpApp } from './mcp-app';

afterEach(() => vi.restoreAllMocks());
function wire(accountAfter = 'account-a', url = 'https://app.example.test') {
  let accounts = 0;
  return vi.spyOn(api, 'GET').mockImplementation(
    async (path) =>
      ({
        data:
          path === '/v1/account'
            ? { id: ++accounts === 1 ? 'account-a' : accountAfter }
            : {
                id: 'app-a',
                slug: 'api-gateway',
                streaming_enabled: true,
                visibility: 'public',
                manifest: { execution_mode: 'request', env: { TOKEN: 'never-retain' } },
                url,
                signing_secret: 'never-retain',
                env: { TOKEN: 'never-retain' },
              },
        response: new Response(),
      }) as never
  );
}
it('projects only app metadata after account verification before and after the read', async () => {
  const get = wire();
  const result = await readMcpApp('account-a', 'api-gateway');
  expect(result).toEqual({
    accountId: 'account-a',
    appId: 'app-a',
    slug: 'api-gateway',
    streamingEnabled: true,
    visibility: 'public',
    executionMode: 'request',
    publicUrl: 'https://app.example.test/',
  });
  expect(JSON.stringify(result)).not.toContain('never-retain');
  expect((get.mock.calls as unknown as [string][]).map(([path]) => path)).toEqual([
    '/v1/account',
    '/v1/apps/{slug}',
    '/v1/account',
  ]);
});
it('rejects a switched account and an aborted context', async () => {
  wire('account-b');
  await expect(readMcpApp('account-a', 'api-gateway')).rejects.toThrow(/account.*changed/i);
  const controller = new AbortController();
  controller.abort();
  await expect(readMcpApp('account-a', 'api-gateway', controller.signal)).rejects.toThrow();
});
it.each([
  'https://user:secret@app.example.test',
  'https://app.example.test?token=secret',
  'http://app.example.test',
  'not-a-url',
])('omits unsafe returned URL %s', async (url) => {
  wire('account-a', url);
  expect((await readMcpApp('account-a', 'api-gateway')).publicUrl).toBeUndefined();
});
it('fails closed when the returned app identity differs', async () => {
  vi.spyOn(api, 'GET').mockImplementation(
    async (path) =>
      ({
        data: path === '/v1/account' ? { id: 'account-a' } : { id: 'app-a', slug: 'another-app' },
        response: new Response(),
      }) as never
  );
  await expect(readMcpApp('account-a', 'api-gateway')).rejects.toThrow(/identity/i);
});
