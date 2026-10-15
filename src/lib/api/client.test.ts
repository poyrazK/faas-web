import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindWorkspaceAccount, setActiveOrg } from '../workspace';

/** Import the client after stubbing fetch: openapi-fetch keeps the fetch it was created with. */
async function clientWith(fetch: typeof globalThis.fetch) {
  vi.resetModules();
  vi.stubGlobal('fetch', fetch);
  // Node's Request cannot resolve the client's same-origin relative URLs.
  vi.stubEnv('VITE_API_URL', 'http://localhost');
  const workspace = await import('../workspace');
  const { api } = await import('./client');
  return { api, workspace };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  window.localStorage.clear();
  bindWorkspaceAccount('');
  setActiveOrg(null);
});

function recorder() {
  const requests: Request[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(input instanceof Request ? input : new Request(String(input), init));
    return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
  });
  return { requests, fetch: fetch as unknown as typeof globalThis.fetch };
}

describe('API client', () => {
  it('sends no X-Active-Org until a workspace is chosen', async () => {
    const { requests, fetch } = recorder();
    const { api, workspace } = await clientWith(fetch);
    workspace.bindWorkspaceAccount('acct-1');
    await api.GET('/v1/account');
    expect(requests[0].headers.get('X-Active-Org')).toBeNull();
  });

  it('sends the chosen workspace as X-Active-Org on every request', async () => {
    const { requests, fetch } = recorder();
    const { api, workspace } = await clientWith(fetch);
    workspace.bindWorkspaceAccount('acct-1');
    workspace.setActiveOrg('acme-corp');
    await api.GET('/v1/account');
    await api.GET('/v1/apps');
    expect(requests.map((request) => request.headers.get('X-Active-Org'))).toEqual([
      'acme-corp',
      'acme-corp',
    ]);
  });
});
