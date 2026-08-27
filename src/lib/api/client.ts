import createClient, { type Middleware } from 'openapi-fetch';
import type { paths } from './schema';
import { ApiError, toApiError } from './errors';

/**
 * The one HTTP client. Typed end to end against `api/openapi.yaml`, so a
 * renamed field or a dropped endpoint upstream fails `tsc` rather than
 * production.
 *
 * **Base URL is empty on purpose.** `apid` is served from the same origin as
 * this app (gregale.dev answers both `/` and `/v1/*`), so every request is
 * relative. That is what makes the session cookie work at all: `faas_sid` is
 * `HttpOnly; SameSite=Lax`, and the API sends no CORS headers — a cross-origin
 * console could not authenticate against it even with `credentials`. In dev the
 * Vite proxy reproduces that same-origin shape (see `vite.config.ts`).
 *
 * `VITE_API_URL` exists only for pointing a local console at some other box; it
 * requires that box to send CORS headers, which the production one does not.
 */
const BASE_URL = import.meta.env.VITE_API_URL ?? '';

/**
 * Called when the API rejects the session. Set by `AuthProvider` so a cookie
 * that expired mid-session drops the user to the sign-in screen instead of
 * leaving every panel showing an unexplained error.
 *
 * A module-level slot rather than context: middleware runs outside React, and
 * there is exactly one session per document.
 */
let onUnauthorized: (() => void) | null = null;
let onMfaRequired: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

/** Called when an authenticated request is blocked by the session MFA gate. */
export function setMfaRequiredHandler(handler: (() => void) | null) {
  onMfaRequired = handler;
}

/** Paths where a 401 is the answer to the question, not an expired session. */
const AUTH_ROUTES = ['/login', '/signup', '/v1/auth/'];

const sessionMiddleware: Middleware = {
  async onRequest({ request }) {
    // Successful POSTs are replay-safe for 24h if they carry a key, and the
    // server echoes `Idempotent-Replayed: true`. Costs nothing to always send
    // one, and turns a double-click or a retry into a no-op rather than a
    // second deployment.
    if (request.method === 'POST' && !request.headers.has('Idempotency-Key')) {
      request.headers.set('Idempotency-Key', crypto.randomUUID());
    }
    return request;
  },

  async onResponse({ request, response }) {
    if (
      response.status === 401 &&
      !AUTH_ROUTES.some((p) => new URL(request.url).pathname.startsWith(p))
    ) {
      onUnauthorized?.();
    }
    return response;
  },
};

export const api = createClient<paths>({
  baseUrl: BASE_URL,
  // Sends and accepts `faas_sid`. Same-origin, so this is a formality in
  // production and load-bearing behind the dev proxy.
  credentials: 'include',
  headers: { Accept: 'application/json' },
});

api.use(sessionMiddleware);

export type CSRFAction =
  | 'auth.logout'
  | 'auth.session.revoke'
  | 'auth.sessions.revoke_all'
  | 'mfa_confirm'
  | 'mfa_recover'
  | 'mfa_disable';

/**
 * Narrows an `openapi-fetch` result to its data, throwing `ApiError` otherwise.
 *
 * The raw result is a `{ data?, error?, response }` union, which is honest but
 * unusable inside TanStack Query — Query decides success by whether the promise
 * rejects. Everything in `lib/queries.ts` goes through here.
 */
export async function unwrap<T>(
  result: Promise<{ data?: T; error?: unknown; response: Response }>
): Promise<T> {
  const { data, error, response } = await result;
  if (error !== undefined || !response.ok) {
    const apiError = await toApiError(response, error);
    if (apiError.code === 'mfa_required') onMfaRequired?.();
    throw apiError;
  }
  // A 204 has no body, and its callers want the absence, not a fabricated value.
  return data as T;
}

/**
 * Ask the API for a token bound to one mutation. The server keeps the matching
 * cookie HttpOnly; the returned JSON value is the double-submit copy.
 */
export async function issueCSRF(action: CSRFAction): Promise<string> {
  const result = await unwrap(api.GET('/v1/auth/csrf', { params: { query: { action } } }));
  return result.csrf_token;
}

export { ApiError };
