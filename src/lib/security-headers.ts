/**
 * The browser security policy for gregale.dev, in one place.
 *
 * Production reads it from `vercel.json`, which is a literal copy of
 * `securityHeaders('production')`; `src/hosting-contract.test.ts` fails when
 * the two drift. `npm run dev` and `npm run preview` apply it from here
 * directly (see `vite.config.ts`), so a new third-party fetch, font or image
 * breaks on the developer's machine rather than after deploy.
 *
 * Every fetch destination is first-party. The console only ever talks to its
 * own origin: the API is rewritten to `apid` same-origin, logs are SSE on the
 * same origin, Vercel Analytics loads and beacons under `/_vercel/insights`,
 * and the fonts live in `public/fonts`. Adding a host to any directive is a
 * policy change, not a tag in `index.html`.
 *
 * Modes:
 * - `production`: the full policy, including `upgrade-insecure-requests`.
 * - `preview`: production minus `upgrade-insecure-requests`, which would
 *   upgrade `http://localhost` subresources and fail them.
 * - `dev`: preview plus `'unsafe-inline'` on scripts and styles, and `ws:` for
 *   the HMR socket. Vite's dev server injects the React Refresh preamble as an
 *   inline module and serves CSS by injecting `<style>` elements; nothing else
 *   is relaxed.
 */
export type HeaderMode = 'production' | 'preview' | 'dev';

const SELF = "'self'";
const NONE = "'none'";

/** A directive's sources, or `true` for a valueless directive. */
type Directives = Record<string, string[] | true>;

function directives(mode: HeaderMode): Directives {
  const dev = mode === 'dev';
  const policy: Directives = {
    'default-src': [SELF],
    'base-uri': [SELF],
    'object-src': [NONE],
    'frame-ancestors': [NONE],
    'frame-src': [NONE],
    // The GitHub install form posts to `/dashboard/install/connect`, which
    // redirects to github.com; Chromium applies form-action to that redirect.
    'form-action': [SELF, 'https://github.com'],
    'script-src': dev ? [SELF, "'unsafe-inline'"] : [SELF],
    'style-src': dev ? [SELF, "'unsafe-inline'"] : [SELF],
    'font-src': [SELF],
    // `data:` is the MFA enrolment QR code; `blob:` covers object URLs.
    'img-src': [SELF, 'data:', 'blob:'],
    'connect-src': dev ? [SELF, 'ws:'] : [SELF],
    'worker-src': [SELF, 'blob:'],
    'manifest-src': [SELF],
  };
  if (mode === 'production') policy['upgrade-insecure-requests'] = true;
  return policy;
}

export function contentSecurityPolicy(mode: HeaderMode): string {
  return Object.entries(directives(mode))
    .map(([name, sources]) => (sources === true ? name : `${name} ${sources.join(' ')}`))
    .join('; ');
}

export function securityHeaders(mode: HeaderMode): Record<string, string> {
  return {
    'Content-Security-Policy': contentSecurityPolicy(mode),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
    // OAuth and the GitHub install are full-page navigations, never popups, so
    // no page here needs an opener.
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Access-Control-Allow-Origin': 'https://gregale.dev',
  };
}
