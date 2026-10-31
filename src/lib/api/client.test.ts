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

describe('a 401 that is not about the session', () => {
  const answer = (status: number, body: unknown) =>
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/problem+json' },
        })
    ) as unknown as typeof globalThis.fetch;

  it('does not sign out when the credential being acted on has expired', async () => {
    // Rotating an expired deploy token answers 401 api_key_expired
    // (faas handlers_deploy_tokens.go, errors.go:5385); the session is fine.
    const { api } = await clientWith(
      answer(401, { code: 'api_key_expired', status: 401, title: 'x' })
    );
    const { setUnauthorizedHandler } = await import('./client');
    const signOut = vi.fn();
    setUnauthorizedHandler(signOut);
    await api.POST(
      '/v1/apps/{slug}/deploy-tokens/{id}/rotate' as never,
      {
        params: { path: { slug: 'a', id: 't' } },
      } as never
    );
    expect(signOut).not.toHaveBeenCalled();
  });

  it('still signs out on a 401 about the session', async () => {
    const { api } = await clientWith(
      answer(401, { code: 'unauthorized', status: 401, title: 'x' })
    );
    const { setUnauthorizedHandler } = await import('./client');
    const signOut = vi.fn();
    setUnauthorizedHandler(signOut);
    await api.GET('/v1/account');
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
