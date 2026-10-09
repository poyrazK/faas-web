import { issueCSRF } from './client';
import { ApiError, toApiError } from './errors';

/** A session the server no longer holds is already signed out. */
const ALREADY_SIGNED_OUT = new Set(['session_expired', 'session_invalid']);

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
 * Resolves when the session is gone, including when it was already gone.
 * Rejects on anything else, so a regression is observable to whoever calls it.
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
    if (err instanceof ApiError && ALREADY_SIGNED_OUT.has(err.code)) return;
    throw err;
  }
}
