import { issueCSRF } from './client';
import { ApiError, toApiError } from './errors';

/**
 * `POST /dashboard/account/set-password` is apid's own form-encoded route, not
 * part of the `/v1` JSON surface: it answers a 302 to the account page on
 * success and problem+json on refusal. Sent outside the `openapi-fetch` client
 * for that reason — the client expects JSON both ways.
 *
 * The route is a same-site form POST, so apid (ADR-140, poyrazK/faas#1281)
 * demands a `csrf_token` bound to the `set_password` action; it is minted
 * from `/v1/auth/csrf` and double-submitted with the form.
 *
 * The path sits under `/dashboard/…`, which the SPA fallback also owns, so a
 * host that has not routed the POST answers it with `index.html` — a 200 that
 * means nothing was set. Success here is the followed redirect; a non-HTML 2xx
 * is accepted for a server that stops redirecting; an HTML 200 is a
 * misroute and is reported as one rather than as a set password.
 */
export async function setAccountPassword(
  password: string,
  {
    currentPassword,
    mintCSRF = issueCSRF,
  }: {
    /** Sent only when non-empty: the server treats a present-but-wrong value
     *  and an absent one identically (401), so an empty string buys nothing. */
    currentPassword?: string;
    mintCSRF?: (action: 'set_password') => Promise<string>;
  } = {}
): Promise<void> {
  const csrf_token = await mintCSRF('set_password');
  const form = new URLSearchParams({ password, csrf_token });
  if (currentPassword) form.set('current_password', currentPassword);
  const res = await fetch('/dashboard/account/set-password', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
    redirect: 'follow',
  });
  if (res.redirected) return;
  const html = (res.headers.get('content-type') ?? '').includes('text/html');
  if (res.ok && !html) return;
  if (res.ok) {
    throw new ApiError({
      status: res.status,
      code: 'misrouted',
      title: 'Not routed to the API',
      detail: 'The request never reached the API. Nothing was changed.',
    });
  }
  throw await toApiError(res);
}
