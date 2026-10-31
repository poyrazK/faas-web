/**
 * `POST /dashboard/install/connect` without GitHub.
 *
 * Against apid this native form post redirects to GitHub's consent screen, and
 * GitHub's callback lands the browser back on the console with
 * `?github=connected&default_branch=…` (the "fixed callback" the Integrations
 * page reads). The mock skips the round trip: it records the installation on
 * the account and redirects straight to where that callback would have
 * returned the user.
 */

/** The installation id the populated mock seeds and a mock connect grants. */
export const MOCK_INSTALL_ID = '48213377';

/** Where a connect with no usable return target lands: the Git deploy wizard. */
export const CONNECT_FALLBACK = '/dashboard/apps/new?source=git';

/** Where apid sends a connect whose CSRF token did not verify. */
export const CONNECT_FORBIDDEN = '/dashboard/account?github=connect-forbidden';

/** A same-origin path, never `//host` or `/\host`, which browsers treat as another origin. */
function localPath(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/')) return null;
  if (value.startsWith('//') || value.startsWith('/\\')) return null;
  try {
    const url = new URL(value, 'http://mock.invalid');
    return url.origin === 'http://mock.invalid' ? `${url.pathname}${url.search}` : null;
  } catch {
    return null;
  }
}

/**
 * The callback URL: the form's `return_to` when it is a local path, else the
 * page the form was posted from (same host only), else the Git wizard — with
 * the query the real callback appends.
 */
export function connectReturnTarget(
  returnTo: unknown,
  referer: string | undefined,
  host: string | undefined
): string {
  let target = localPath(returnTo);
  if (!target && referer) {
    try {
      const url = new URL(referer);
      if (host && url.host === host) target = localPath(`${url.pathname}${url.search}`);
    } catch {
      // An unparseable Referer is no target at all.
    }
  }
  const url = new URL(target ?? CONNECT_FALLBACK, 'http://mock.invalid');
  url.searchParams.set('github', 'connected');
  url.searchParams.set('default_branch', 'main');
  return `${url.pathname}${url.search}`;
}
