import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAccountPassword } from './password';
import { ApiError } from './errors';

/**
 * The route is a form post that apid answers with a redirect, and it sits
 * under `/dashboard/…` — the same prefix the SPA fallback owns. A host that
 * forgets to route the POST hands it to `index.html`, which is a 200. The old
 * panel treated that as success and told the customer their password was set.
 *
 * It is also a same-site form POST, so apid demands a purpose-bound
 * `csrf_token` (ADR-140); the helper must mint one first and send it back.
 * The minter is injected: the typed client cannot run under jsdom (it builds
 * a `Request` from a relative URL), and what matters here is that the token
 * it returns reaches the form.
 */

function answer(init: { status: number; redirected?: boolean; type?: string; body?: string }) {
  const res = new Response(init.body ?? '', {
    status: init.status,
    headers: { 'content-type': init.type ?? 'text/plain' },
  });
  Object.defineProperty(res, 'redirected', { value: init.redirected ?? false });
  return res;
}

function stubFetch(res: Response) {
  const fetchMock = vi.fn().mockResolvedValue(res);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const mintCSRF = vi.fn(async () => 'tok-1');

afterEach(() => {
  vi.unstubAllGlobals();
  mintCSRF.mockClear();
});

describe('setAccountPassword', () => {
  it('mints a set_password token, posts it with the password, and treats the followed redirect as success', async () => {
    const fetchMock = stubFetch(answer({ status: 200, redirected: true }));

    await expect(
      setAccountPassword('correct-horse-battery', { mintCSRF })
    ).resolves.toBeUndefined();

    expect(mintCSRF).toHaveBeenCalledWith('set_password');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/dashboard/account/set-password');
    expect(init.method).toBe('POST');
    expect(String(init.body)).toBe('password=correct-horse-battery&csrf_token=tok-1');
  });

  it('refuses a 200 that is the SPA fallback rather than apid', async () => {
    stubFetch(answer({ status: 200, type: 'text/html', body: '<!doctype html>' }));

    await expect(setAccountPassword('correct-horse-battery', { mintCSRF })).rejects.toBeInstanceOf(
      ApiError
    );
  });

  it('surfaces a problem+json refusal as an ApiError with its code', async () => {
    stubFetch(
      answer({
        status: 400,
        type: 'application/problem+json',
        body: JSON.stringify({ status: 400, code: 'password_too_weak', title: 'Weak' }),
      })
    );

    await expect(setAccountPassword('short', { mintCSRF })).rejects.toMatchObject({
      status: 400,
      code: 'password_too_weak',
    });
  });
});
