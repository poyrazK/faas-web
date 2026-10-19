# Frontend hardening: one header policy, enforced everywhere it runs

**Date:** 2026-10-19 · **Repo:** faas-web · **Branch:** `fix/frontend-hardening`
**Findings:** `/home/bahadir/GREGALE/faas-web-hardening-findings-2026-10-13.md`

## Problem

The browser security policy for gregale.dev lives only in `vercel.json`, so it is
enforced in production and nowhere else. It is also looser than the site needs:
`connect-src` and `img-src` allow any HTTPS host, `script-src` carries a hash that
matches no inline script, styles allow `unsafe-inline`, and fonts load from two
third-party origins whose CSS cannot be integrity-pinned. A script injection on the
console today can exfiltrate to any HTTPS host.

Since the findings were written, faas-web#142 (logout CSRF) has merged, so the session
revocation gap is closed and out of scope here.

## Goals

1. One source of truth for the header set, applied to `npm run dev`, `npm run preview`,
   and production, with a test that fails when `vercel.json` drifts from it.
2. A CSP where every fetch destination is first-party: no third-party hosts in any
   directive, no dead allowances.
3. Fonts served from this origin.
4. Dependabot configured; current audit advisories (all dev tooling) resolved.
5. The one external link that bypasses `publicAppUrl` goes through it.

## Non-goals

- Anything in `faas` or `faas-frontend`.
- Repo settings that need admin (branch protection, Dependabot alerts, Vercel preview
  protection). These go to Poyraz as questions in the PR.
- The `invite` route's lost `next=`; `Access-Control-Allow-Origin` on static responses
  (harmless, pinned by the existing test, left alone).

## Design

### 1. `src/lib/security-headers.ts`

A dependency-free module that owns the policy.

```ts
export type HeaderMode = 'production' | 'preview' | 'dev';
export function securityHeaders(mode: HeaderMode): Record<string, string>;
export function contentSecurityPolicy(mode: HeaderMode): string;
```

Production directives:

| directive                   | value                       | why                                                                                                                                                                                                                                                                      |
| --------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `default-src`               | `'self'`                    | floor                                                                                                                                                                                                                                                                    |
| `base-uri`                  | `'self'`                    | unchanged                                                                                                                                                                                                                                                                |
| `object-src`                | `'none'`                    | unchanged                                                                                                                                                                                                                                                                |
| `frame-ancestors`           | `'none'`                    | unchanged (plus `X-Frame-Options: DENY`)                                                                                                                                                                                                                                 |
| `frame-src`                 | `'none'`                    | unchanged                                                                                                                                                                                                                                                                |
| `form-action`               | `'self' https://github.com` | GitHub install form posts to `/dashboard/install/connect`, which redirects to GitHub; Chromium applies `form-action` to that redirect                                                                                                                                    |
| `script-src`                | `'self'`                    | drops the dead sha256 hash; Vercel Analytics loads from `/_vercel/insights`, same origin                                                                                                                                                                                 |
| `style-src`                 | `'self'`                    | Tailwind is compiled; React inline styles go through CSSOM, which CSP does not govern; `motion`'s only `<style>` injection is its unused view-transition helper. **Verified at runtime in step 6; falls back to `'self' 'unsafe-inline'` if the tour shows a violation** |
| `font-src`                  | `'self'`                    | fonts self-hosted (step 3)                                                                                                                                                                                                                                               |
| `img-src`                   | `'self' data: blob:`        | the only non-self image is the MFA QR `data:` URI; vendored docs embed no images                                                                                                                                                                                         |
| `connect-src`               | `'self'`                    | the console talks only to its own origin (API rewrites, SSE, analytics beacon)                                                                                                                                                                                           |
| `worker-src`                | `'self' blob:`              | unchanged                                                                                                                                                                                                                                                                |
| `manifest-src`              | `'self'`                    | unchanged                                                                                                                                                                                                                                                                |
| `upgrade-insecure-requests` | present                     | production only                                                                                                                                                                                                                                                          |

Static headers, unchanged values plus one addition:
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`,
`Permissions-Policy: camera=(), geolocation=(), microphone=(), payment=(), usb=()`,
`Access-Control-Allow-Origin: https://gregale.dev` (kept as is),
**new** `Cross-Origin-Opener-Policy: same-origin` (OAuth and GitHub install are
full-page navigations, never popups, so nothing depends on an opener).

Modes:

- **production**: the table above. This is what `vercel.json` must contain.
- **preview** (`vite preview`, built output on `http://localhost`): production minus
  `upgrade-insecure-requests`, which would upgrade localhost subresources.
- **dev** (`vite`): preview, plus `'unsafe-inline'` on `script-src` and `style-src`.
  Vite's dev server injects the React Refresh preamble as an inline module script and
  serves CSS by injecting `<style>` elements, so a dev build cannot satisfy the strict
  script/style directives. Every other directive is enforced in dev exactly as in
  production, which is where the value is: a new third-party fetch, font, or image
  breaks on the developer's machine, not after deploy.

### 2. Wiring

- `vite.config.ts`: `server.headers = securityHeaders('dev')`,
  `preview.headers = securityHeaders('preview')`. The config already imports TypeScript
  from the project (`./mock/plugin`), and `scripts/prerender.mjs` already imports
  `src/lib/docs-manifest.ts`, so importing `src/lib/security-headers.ts` follows an
  existing pattern.
- `vercel.json`: the boundary route's `headers` object is replaced with the production
  set. It stays a committed literal because Vercel reads JSON, not code.
- `src/hosting-contract.test.ts`: the existing header assertions are replaced by one
  deep-equality check, `boundary.headers` equals `securityHeaders('production')`. The
  message on failure says to copy the module's output into `vercel.json`.
- `src/lib/security-headers.test.ts`: pins the invariants rather than the literal:
  production `script-src`, `style-src`, `connect-src`, `font-src` contain no
  `https://` host and no `'unsafe-*'`; `frame-ancestors 'none'` and `object-src 'none'`
  are present in every mode; dev differs from production only in the documented
  directives.

### 3. Self-hosted fonts

- `public/fonts/` receives the WOFF2 files currently served by Google Fonts and
  Fontshare: Familjen Grotesk (variable 400–700, three unicode-range subsets),
  Spline Sans Mono (variable 400–700, two subsets), Satoshi (static 400/500/600/700).
  Files are named by family, weight and subset, and a `public/fonts/README.md` records
  the source URL, version and license of each (SIL OFL 1.1 for the Google families,
  Fontshare's ITF Free Font License for Satoshi, both of which permit self-hosting).
- `@font-face` rules go in `src/fonts.css`, imported first from `src/index.css`, with
  the same `unicode-range` subsetting Google serves and `font-display: swap`.
- `index.html` loses the seven preconnect and stylesheet tags. The comment that names
  the families moves with the `@font-face` rules.
- ~~`vercel.json` already has the immutable cache rule for `/fonts/*`; it now applies.~~
  **Revised 2026-10-20:** that rule existed only in a stale checkout. The files live in
  `src/fonts/` and `src/fonts.css` references them relatively, so Vite content-hashes
  them into `/assets/`, which the existing immutable rule covers.
- `scripts/og-image.mjs` fetches TTFs from Google Fonts at `npm run og` time, a build
  tool with no browser involved. Unchanged.

### 4. Dependencies

- `.github/dependabot.yml`: npm weekly, minor and patch updates grouped into one PR,
  majors separate; GitHub Actions monthly.
- `npm audit fix` without `--force`; any advisory that needs a major bump is listed in
  the PR rather than forced. The lockfile diff is reviewed for prod-dependency changes
  (none expected: every advisory is in vitest, undici, brace-expansion, js-yaml,
  seroval, source-map-js).

### 5. Code

`src/routes/dashboard.workflows.$workflowId.tsx`: the `fn.url` anchor renders only when
`publicAppUrl(fn.url)` returns a value, and uses that value, with
`target="_blank" rel="noopener noreferrer"` to match every other external app link.

### 6. Verification

1. `npm run check` and `npm run build` green.
2. `npm run preview` with the preview headers, then `npm run tour` against it with a
   console listener that records `securitypolicyviolation` events and CSP console
   errors; zero violations across every page the tour visits, including `/docs/*` and
   the landing shaders.
3. `npm run dev:mock` with the dev headers, same tour, zero violations outside the two
   documented dev allowances.
4. Fonts: the preview's network log shows every font from `/fonts/` and nothing from
   `fonts.gstatic.com`, `fonts.googleapis.com`, `api.fontshare.com`, `cdn.fontshare.com`.
5. `curl -I` against the Vercel preview deployment after push shows the new policy.

### 7. Docs

- README § Deployment: a paragraph on the single source of truth and the parity test.
- CLAUDE.md gotcha: "Headers live in `src/lib/security-headers.ts`; `vercel.json` is a
  copy and a test keeps it honest. A new third-party origin is a policy change, not a
  tag in `index.html`."

## Questions for Poyraz (in the PR description)

1. Branch protection or a ruleset on `main` requiring the `check` job; confirm
   Dependabot alerts and security updates are enabled (needs admin to read).
2. Vercel preview deployments: enable Vercel Authentication? Previews are unauthenticated
   copies of the console whose rewrites point at production `api.gregale.dev`.
3. `apid` sends no `Cache-Control` on most `/v1` JSON; Vercel then stamps
   `public, max-age=0, must-revalidate`. Authenticated responses should say `no-store`.
4. Does `POST /login` check `Origin` / `Sec-Fetch-Site`? SameSite=Lax does not prevent
   login CSRF.
5. Apex HSTS is Vercel's default without `includeSubDomains`; `apid` sends it on its
   own host. Should the apex match? (It would cover customer `*.apps.gregale.dev`.)
6. `postAccountLogout` in the faas OpenAPI still documents an `X-CSRF-Token` header
   and no request body; #142 showed the body is what apid verifies.

## Risks

- A CSP directive tightened too far breaks a page silently for users with no console
  open. Mitigation: the tour under enforced headers (step 6) and the dev-mode
  enforcement that keeps it from regressing.
- Font metrics: the self-hosted files are byte-identical to what the CDNs serve today,
  so rendering does not change.
- Vercel's preview toolbar (`vercel.live`) is already blocked by the current
  `script-src 'self'`; no change.
