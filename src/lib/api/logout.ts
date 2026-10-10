import { issueCSRF } from './client';
import { ApiError, toApiError } from './errors';

/**
 * Ends the server-side session behind the `faas_sid` cookie.
 *
 * apid revokes the session only when the request double-submits a token bound
 * to `auth.logout`; without one it answers 400 `csrf_mismatch` and the cookie
 * stays valid. The token must travel as a JSON body with an
 * `application/json` Content-Type, because that and a form field are the only
 * places apid reads it. The OpenAPI spec mentions an `X-CSRF-Token` header,
 * but apid ignores it. The spec also declares no request body for this
 * operation, so the typed client cannot send one; this goes out through
 * `fetch`, as `setAccountPassword` does.
 *
 * Resolves when the session is gone, including when it was already gone: any
 * 401 means there is no live session to revoke, whether the cookie is missing
 * (`unauthorized`, e.g. another tab already signed out) or revoked
 * (`session_expired`). Rejects on anything else.
 */
export async function endServerSession({
  mintCSRF = issueCSRF,
}: {
  mintCSRF?: (action: 'auth.logout') => Promise<string>;
} = {}): Promise<void> {
  try {
    const csrf_token = await mintCSRF('auth.logout');
    const res = await fetch('/v1/auth/logout', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ csrf_token }),
    });
    if (res.ok) return;
    throw await toApiError(res);
  } catch (err) {
    if (err instanceof ApiError && err.isAuth) return;
    throw err;
  }
}

/**
 * Sign-out's server half: never rejects, because refusing to sign someone out
 * locally over a server answer is the worse failure. It still reports a
 * refusal: the original bug survived because a 400 here was swallowed
 * silently. A network failure stays quiet; the cookie expires on its own.
 */
export async function endServerSessionBestEffort(
  end: () => Promise<void> = endServerSession
): Promise<void> {
  try {
    await end();
  } catch (err) {
    if (err instanceof TypeError) return;
    console.warn('Sign-out did not end the server session', err);
  }
}
