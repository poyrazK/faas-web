import { afterEach, describe, expect, it, vi } from 'vitest';
import { endServerSession } from './logout';
import { ApiError } from './errors';

/**
 * apid's logout refuses without a double-submitted `auth.logout` token
 * (400 csrf_mismatch) and reads it only from a JSON body sent as
 * application/json, never from a header. The console used to post nothing,
 * so "Sign out" left the server session alive. The minter is injected for
 * the same reason as in password.test.ts: the typed client cannot run under
 * jsdom.
 */

function answer(status: number, problem?: { code: string }) {
  return new Response(problem ? JSON.stringify({ status, title: 'Refused', ...problem }) : null, {
    status,
    headers: problem ? { 'content-type': 'application/problem+json' } : {},
  });
}

function stubFetch(result: Response | Error) {
  const fetchMock =
    result instanceof Error ? vi.fn().mockRejectedValue(result) : vi.fn().mockResolvedValue(result);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const mintCSRF = vi.fn(async () => 'tok-logout');

afterEach(() => {
  vi.unstubAllGlobals();
  mintCSRF.mockClear();
});

describe('endServerSession', () => {
  it('mints an auth.logout token and double-submits it as a JSON body', async () => {
    const fetchMock = stubFetch(answer(204));

    await expect(endServerSession({ mintCSRF })).resolves.toBeUndefined();

    expect(mintCSRF).toHaveBeenCalledWith('auth.logout');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/v1/auth/logout');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(String(init.body))).toEqual({ csrf_token: 'tok-logout' });
  });

  it('treats a session the server already ended as signed out', async () => {
    stubFetch(answer(401, { code: 'session_expired' }));

    await expect(endServerSession({ mintCSRF })).resolves.toBeUndefined();
  });

  it('treats an expired session at mint time as signed out, without posting', async () => {
    const fetchMock = stubFetch(answer(204));
    const expiredMint = vi.fn(async () => {
      throw new ApiError({ status: 401, code: 'session_expired', title: 'Session expired' });
    });

    await expect(endServerSession({ mintCSRF: expiredMint })).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces a CSRF refusal instead of reporting success', async () => {
    stubFetch(answer(400, { code: 'csrf_mismatch' }));

    await expect(endServerSession({ mintCSRF })).rejects.toMatchObject({
      code: 'csrf_mismatch',
    });
  });

  it('propagates a network failure', async () => {
    stubFetch(new TypeError('Failed to fetch'));

    await expect(endServerSession({ mintCSRF })).rejects.toBeInstanceOf(TypeError);
  });
});
