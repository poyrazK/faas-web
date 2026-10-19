/**
 * The browser security policy for gregale.dev, in one place.
 *
 * Production reads it from `vercel.json`, which is a literal copy of
 * `securityHeaders('production')`; `src/hosting-contract.test.ts` fails when
 * the two drift. `npm run dev` and `npm run preview` apply it from here
 * directly (see `vite.config.ts`), so a new third-party fetch, font or image
 * breaks on the developer's machine rather than after deploy.
 *
 * Every fetch destination is first-party, with one named exception. The API
 * is rewritten to `apid` same-origin, logs are SSE on the same origin, Vercel
 * Analytics loads and beacons under `/_vercel/insights`, and the fonts live in
 * `public/fonts`. The exception is the branded S3 gateway: object uploads PUT
 * the file straight to a signed URL there (`lib/api/object-storage.ts`), so
 * `connect-src` names it. Adding a host to any directive is a policy change,
 * not a tag in `index.html`; say why in a comment, as below.
 *
 * Modes:
 * - `production`: the full policy, including `upgrade-insecure-requests`.
 * - `preview`: production minus `upgrade-insecure-requests`, which would
 *   upgrade `http://localhost` subresources and fail them.
 * - `dev`: preview plus `'unsafe-inline'` on scripts and `ws:` for the HMR
 *   socket. Vite's dev server injects the React Refresh preamble as an inline
 *   module; nothing else is relaxed.
 */
export type HeaderMode = 'production' | 'preview' | 'dev';

const SELF = "'self'";
const NONE = "'none'";
/** Where `POST …/signed-url` sends uploads; see `ObjectSignedRequest` in the spec. */
const S3_GATEWAY = 'https://s3.gregale.dev';

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
    // Styles keep 'unsafe-inline' for now: the prerendered public pages carry
    // React's `style=""` attributes in their markup, and the overview's
    // border-beam package renders a `<style>` element. Both would need
    // build-time hashes to remove. Scripts are strict, which is where the
    // injection risk lives.
    'style-src': [SELF, "'unsafe-inline'"],
    'font-src': [SELF],
    // `data:` is the MFA enrolment QR code; `blob:` covers object URLs.
    'img-src': [SELF, 'data:', 'blob:'],
    // The S3 gateway receives signed object uploads directly from the browser.
    // `ws:` is the dev server's HMR socket.
    'connect-src': [SELF, S3_GATEWAY, ...(dev ? ['ws:'] : [])],
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
