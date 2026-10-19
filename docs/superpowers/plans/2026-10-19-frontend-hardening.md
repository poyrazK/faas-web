# Frontend Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One browser security policy, defined in code, enforced by `npm run dev`, `npm run preview` and production, tightened to first-party-only, with fonts self-hosted so no third-party origin remains.

**Architecture:** `src/lib/security-headers.ts` builds the header set per mode; `vite.config.ts` applies it to the dev and preview servers; `vercel.json` carries a literal copy that `src/hosting-contract.test.ts` checks for equality. Fonts move from Google Fonts and Fontshare into `public/fonts/` with `@font-face` rules in `src/fonts.css`. The mock API plugin learns to serve `vite preview`, so the built console can be toured under the strict policy; the tour records CSP violations as failures.

**Tech Stack:** Vite 6, Vitest 4, React 19, TanStack Router, Vercel legacy `routes`, Playwright (tour only, not a dependency).

**Spec:** `docs/superpowers/specs/2026-10-19-frontend-hardening-design.md`

## Global Constraints

- `npm run check` must stay green: `tsc`, ESLint at `--max-warnings 8` (currently 4 warnings; add none), Prettier, Vitest.
- Do not reformat files you did not otherwise change (CLAUDE.md).
- No literal hex colours or `dark:` variants in components (not touched here, but `src/fonts.css` is CSS, not a component).
- Never hand-edit `src/routeTree.gen.ts` or `src/lib/api/schema.d.ts`.
- Commit author: `Bahadir Kosapinar <bahadir.kosapinar@gregale.dev>` (`git -c user.name=… -c user.email=…` if the worktree has no identity).
- Nothing is pushed in this plan.
- Worktree: `/home/bahadir/GREGALE/.worktrees/faas-web-hardening`, branch `fix/frontend-hardening`, `node_modules` installed.

## Review Focus

1. A page that loads a font or image from a third-party URL after this change renders with a fallback font or a broken image and no console open. Pinned by Task 1's "no third-party host" test and Task 8's tour under enforced headers.
2. The Vite HMR websocket blocked by `connect-src` in dev, which shows as a dev server that never reloads. Pinned by Task 1's dev-mode diff test (`ws:` allowance) and Task 8's dev tour.
3. An app URL from the API that is not `http(s)` (for example a `javascript:` or `data:` value from a compromised or buggy backend) rendered as an anchor. Pinned by Task 4's tests.
4. `vercel.json` edited by hand to add a host without updating the module, or vice versa. Pinned by Task 2's equality test.
5. `upgrade-insecure-requests` leaking into `http://localhost` modes and upgrading subresources to `https://localhost`, which fails silently. Pinned by Task 1's preview-vs-production test.

---

### Task 1: The policy module

**Files:**
- Create: `src/lib/security-headers.ts`
- Test: `src/lib/security-headers.test.ts`

**Interfaces:**
- Produces: `type HeaderMode = 'production' | 'preview' | 'dev'`, `contentSecurityPolicy(mode: HeaderMode): string`, `securityHeaders(mode: HeaderMode): Record<string, string>`. Tasks 2 and 8 consume both.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/security-headers.test.ts
import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, securityHeaders, type HeaderMode } from './security-headers';

const MODES: HeaderMode[] = ['production', 'preview', 'dev'];

/** The value of one directive, '' for a valueless directive, undefined when absent. */
function directive(csp: string, name: string): string | undefined {
  const entry = csp.split('; ').find((d) => d === name || d.startsWith(`${name} `));
  return entry === undefined ? undefined : entry.slice(name.length).trim();
}

function directives(csp: string): string[] {
  return csp.split('; ');
}

describe('production policy', () => {
  const csp = contentSecurityPolicy('production');

  it.each(['default-src', 'script-src', 'style-src', 'connect-src', 'font-src', 'img-src'])(
    '%s names no third-party host, no unsafe keyword, no hash or nonce',
    (name) => {
      const value = directive(csp, name);
      expect(value).toBeDefined();
      expect(value).not.toMatch(/https?:\/\//);
      expect(value).not.toMatch(/unsafe-/);
      expect(value).not.toMatch(/sha(256|384|512)-|nonce-/);
    }
  );

  it('locks framing, plugins, base and forms', () => {
    expect(directive(csp, 'frame-ancestors')).toBe("'none'");
    expect(directive(csp, 'frame-src')).toBe("'none'");
    expect(directive(csp, 'object-src')).toBe("'none'");
    expect(directive(csp, 'base-uri')).toBe("'self'");
    expect(directive(csp, 'form-action')).toBe("'self' https://github.com");
    expect(directive(csp, 'upgrade-insecure-requests')).toBe('');
  });

  it('allows the data: QR code and blob: workers, nothing wider', () => {
    expect(directive(csp, 'img-src')).toBe("'self' data: blob:");
    expect(directive(csp, 'worker-src')).toBe("'self' blob:");
    expect(directive(csp, 'connect-src')).toBe("'self'");
    expect(directive(csp, 'font-src')).toBe("'self'");
  });
});

describe('modes', () => {
  it('preview is production without upgrade-insecure-requests', () => {
    const production = directives(contentSecurityPolicy('production'));
    const preview = directives(contentSecurityPolicy('preview'));
    expect(production.filter((d) => d !== 'upgrade-insecure-requests')).toEqual(preview);
    expect(preview).not.toContain('upgrade-insecure-requests');
  });

  it('dev relaxes only inline script and style plus the HMR socket', () => {
    const dev = directives(contentSecurityPolicy('dev'));
    const preview = directives(contentSecurityPolicy('preview'));
    expect(dev.filter((d) => !preview.includes(d))).toEqual([
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self' ws:",
    ]);
    expect(preview.filter((d) => !dev.includes(d))).toEqual([
      "script-src 'self'",
      "style-src 'self'",
      "connect-src 'self'",
    ]);
  });

  it.each(MODES)('%s carries the same static headers', (mode) => {
    const { 'Content-Security-Policy': csp, ...rest } = securityHeaders(mode);
    expect(csp).toBe(contentSecurityPolicy(mode));
    expect(rest).toEqual({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Access-Control-Allow-Origin': 'https://gregale.dev',
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/security-headers.test.ts`
Expected: FAIL, cannot resolve `./security-headers`.

- [ ] **Step 3: Write the module**

```ts
// src/lib/security-headers.ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/security-headers.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/security-headers.ts src/lib/security-headers.test.ts
git commit -m "feat(security): define the browser header policy in one module"
```

---

### Task 2: Apply the policy in dev, preview and production

**Files:**
- Modify: `vite.config.ts` (imports; `server` block; add `preview` block)
- Modify: `vercel.json` (the `^/(.*)$` boundary route's `headers`)
- Modify: `src/hosting-contract.test.ts:30-48` (the "browser security boundary" test)

**Interfaces:**
- Consumes: `securityHeaders` from Task 1.

- [ ] **Step 1: Replace the header assertions with an equality check**

In `src/hosting-contract.test.ts`, add the import at the top:

```ts
import { securityHeaders } from '@/lib/security-headers';
```

Replace the body of `it('applies the browser security boundary to every route', …)` with:

```ts
  it('applies the browser security boundary to every route', () => {
    const apiEnd = config.routes.findIndex((route) => route.src === '^/logout$');
    const filesystem = config.routes.findIndex((route) => 'handle' in route);
    const boundary = config.routes.findIndex(
      (route) => route.src === '^/(.*)$' && route.continue === true
    );

    expect(boundary).toBeGreaterThan(apiEnd);
    expect(boundary).toBeLessThan(filesystem);
  });

  it('serves exactly the policy src/lib/security-headers.ts defines', () => {
    const boundary = config.routes.find(
      (route) => route.src === '^/(.*)$' && route.continue === true
    );
    // On failure: copy `securityHeaders('production')` into vercel.json —
    // Vercel reads JSON, so the literal is a copy and this test keeps it honest.
    expect(boundary?.headers).toEqual(securityHeaders('production'));
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/hosting-contract.test.ts`
Expected: FAIL on the equality test (old CSP, no COOP).

- [ ] **Step 3: Update `vercel.json`**

Replace the `headers` object of the route with `"src": "^/(.*)$"` and `"continue": true` by the output of this command, keeping the keys in this order:

```bash
node --input-type=module -e "
import { securityHeaders } from './src/lib/security-headers.ts';
console.log(JSON.stringify(securityHeaders('production'), null, 2));
" 2>/dev/null || npx tsx -e "import { securityHeaders } from './src/lib/security-headers.ts'; console.log(JSON.stringify(securityHeaders('production'), null, 2))"
```

If neither runner can load TypeScript, write the object by hand; it is:

```json
"headers": {
  "Content-Security-Policy": "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; frame-src 'none'; form-action 'self' https://github.com; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; manifest-src 'self'; upgrade-insecure-requests",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Access-Control-Allow-Origin": "https://gregale.dev"
},
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/hosting-contract.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire Vite**

In `vite.config.ts` add the import after the `mockApi` import:

```ts
import { securityHeaders } from './src/lib/security-headers';
```

Change the `server` block and add `preview`:

```ts
  server: {
    // The production policy, minus what a dev server cannot satisfy. See the
    // module: a third-party font, image or fetch fails here before it fails
    // in production.
    headers: securityHeaders('dev'),
    proxy: MOCK
      ? undefined
      : Object.fromEntries([
          ...API_PATHS.map((path) => [path, proxyEntry()]),
          // `bypass` returning a path makes Vite serve it locally instead of
          // proxying; returning undefined proxies as normal.
          ...SHARED_PATHS.map((path) => [
            path,
            proxyEntry((req) => (req.method === 'GET' ? '/index.html' : undefined)),
          ]),
        ]),
  },
  preview: {
    // The built output under the production policy (less the https upgrade),
    // which is what `npm run tour` checks against.
    headers: securityHeaders('preview'),
  },
```

- [ ] **Step 6: Confirm the dev server sends the headers**

Run (in one shell): `npm run dev:mock`
Run (in another): `curl -sI http://localhost:3000/ | grep -i -E 'content-security|cross-origin-opener'`
Expected: a CSP line containing `script-src 'self' 'unsafe-inline'` and `connect-src 'self' ws:`, plus `cross-origin-opener-policy: same-origin`. Stop the dev server.

- [ ] **Step 7: Typecheck and commit**

Run: `npm run typecheck`
Expected: clean.

```bash
git add vite.config.ts vercel.json src/hosting-contract.test.ts
git commit -m "feat(security): enforce the header policy in dev and preview; vercel.json is a checked copy"
```

---

### Task 3: Self-host the fonts

**Files:**
- Create: `public/fonts/*.woff2` (8 files), `public/fonts/README.md`
- Create: `src/fonts.css`
- Modify: `src/index.css:1-3`, `src/index.css:173`
- Modify: `index.html:21-37` (remove the font tags)

- [ ] **Step 1: Download the files currently served by the CDNs**

```bash
cd public && mkdir -p fonts && cd fonts
G=https://fonts.gstatic.com/s
curl -fsSL -o familjen-grotesk-vietnamese.woff2 $G/familjengrotesk/v11/Qw3GZR9ZHiDnImG6-NEMQ41wby8WbHUEj6M7.woff2
curl -fsSL -o familjen-grotesk-latin-ext.woff2  $G/familjengrotesk/v11/Qw3GZR9ZHiDnImG6-NEMQ41wby8WbHQEj6M7.woff2
curl -fsSL -o familjen-grotesk-latin.woff2      $G/familjengrotesk/v11/Qw3GZR9ZHiDnImG6-NEMQ41wby8WbHoEjw.woff2
curl -fsSL -o spline-sans-mono-latin-ext.woff2  $G/splinesansmono/v13/R70BjzAei_CDNLfgZxrW6wrZOF2WX5yZmF2a.woff2
curl -fsSL -o spline-sans-mono-latin.woff2      $G/splinesansmono/v13/R70BjzAei_CDNLfgZxrW6wrZOF2WX5KZmA.woff2
F=https://cdn.fontshare.com/wf
curl -fsSL -o satoshi-400.woff2 $F/TTX2Z3BF3P6Y5BQT3IV2VNOK6FL22KUT/7QYRJOI3JIMYHGY6CH7SOIFRQLZOLNJ6/KFIAZD4RUMEZIYV6FQ3T3GP5PDBDB6JY.woff2
curl -fsSL -o satoshi-500.woff2 $F/P2LQKHE6KA6ZP4AAGN72KDWMHH6ZH3TA/ZC32TK2P7FPS5GFTL46EU6KQJA24ZYDB/7AHDUZ4A7LFLVFUIFSARGIWCRQJHISQP.woff2
curl -fsSL -o satoshi-700.woff2 $F/LAFFD4SDUCDVQEXFPDC7C53EQ4ZELWQI/PXCT3G6LO6ICM5I3NTYENYPWJAECAWDD/GHM6WVH6MILNYOOCXHXB5GTSGNTMGXZR.woff2
ls -la && file *.woff2
```

Expected: 8 files, each reported as `Web Open Font Format (Version 2)`. (Satoshi has no 600 weight; Fontshare's CSS for `satoshi@400,500,600,700` serves 400, 500 and 700, so the console's 600 falls back to 700 exactly as today.) If a URL 404s, re-fetch the CSS with a Chrome user agent and take the current URL:
`curl -sA 'Mozilla/5.0 Chrome/130' 'https://fonts.googleapis.com/css2?family=Familjen+Grotesk:wght@400..700&family=Spline+Sans+Mono:wght@400..700&display=swap'`.

- [ ] **Step 2: Record provenance and licenses**

```markdown
<!-- public/fonts/README.md -->
# Self-hosted fonts

Byte-identical copies of the files the CDNs served on 2026-10-19, so rendering
does not change. They live here so the Content-Security-Policy can be
first-party only (`font-src 'self'`); see `src/lib/security-headers.ts`.
Rules are in `src/fonts.css`.

| File | Family | Weight | Subset | Source | License |
| --- | --- | --- | --- | --- | --- |
| familjen-grotesk-{latin,latin-ext,vietnamese}.woff2 | Familjen Grotesk | 400–700 (variable) | by unicode-range | Google Fonts v11 | SIL OFL 1.1 |
| spline-sans-mono-{latin,latin-ext}.woff2 | Spline Sans Mono | 400–700 (variable) | by unicode-range | Google Fonts v13 | SIL OFL 1.1 |
| satoshi-{400,500,700}.woff2 | Satoshi | 400, 500, 700 | all | Fontshare (Indian Type Foundry) | ITF Free Font License |

SIL OFL 1.1: https://openfontlicense.org — redistribution permitted with the
license notice; the fonts are not sold and not renamed.
ITF Free Font License (Fontshare): https://www.fontshare.com/licenses/itf-ffl —
free for personal and commercial use including self-hosted web embedding.
```

- [ ] **Step 3: Write the `@font-face` rules**

```css
/* src/fonts.css
   Familjen Grotesk + Spline Sans Mono (SIL OFL): the grotesque carries display
   and text on the marketing site, the mono carries code plus the eyebrow and
   label voice. Satoshi (Fontshare / ITF free license) is the console's own
   voice. All served from /fonts so the CSP stays first-party; the subsets and
   unicode ranges are the ones Google Fonts serves, kept so a Latin page never
   downloads the Vietnamese file. Provenance in public/fonts/README.md. */

/* Familjen Grotesk, variable 400–700 */
@font-face {
  font-family: 'Familjen Grotesk';
  font-style: normal;
  font-weight: 400 700;
  font-display: swap;
  src: url('/fonts/familjen-grotesk-vietnamese.woff2') format('woff2');
  unicode-range:
    U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0,
    U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB;
}
@font-face {
  font-family: 'Familjen Grotesk';
  font-style: normal;
  font-weight: 400 700;
  font-display: swap;
  src: url('/fonts/familjen-grotesk-latin-ext.woff2') format('woff2');
  unicode-range:
    U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308,
    U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4,
    U+2113, U+2C60-2C7F, U+A720-A7FF;
}
@font-face {
  font-family: 'Familjen Grotesk';
  font-style: normal;
  font-weight: 400 700;
  font-display: swap;
  src: url('/fonts/familjen-grotesk-latin.woff2') format('woff2');
  unicode-range:
    U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304,
    U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215,
    U+FEFF, U+FFFD;
}

/* Spline Sans Mono, variable 400–700 */
@font-face {
  font-family: 'Spline Sans Mono';
  font-style: normal;
  font-weight: 400 700;
  font-display: swap;
  src: url('/fonts/spline-sans-mono-latin-ext.woff2') format('woff2');
  unicode-range:
    U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308,
    U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4,
    U+2113, U+2C60-2C7F, U+A720-A7FF;
}
@font-face {
  font-family: 'Spline Sans Mono';
  font-style: normal;
  font-weight: 400 700;
  font-display: swap;
  src: url('/fonts/spline-sans-mono-latin.woff2') format('woff2');
  unicode-range:
    U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304,
    U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215,
    U+FEFF, U+FFFD;
}

/* Satoshi, static weights. There is no 600; the console's 600 resolves to 700,
   as it did from Fontshare. */
@font-face {
  font-family: 'Satoshi';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('/fonts/satoshi-400.woff2') format('woff2');
}
@font-face {
  font-family: 'Satoshi';
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  src: url('/fonts/satoshi-500.woff2') format('woff2');
}
@font-face {
  font-family: 'Satoshi';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url('/fonts/satoshi-700.woff2') format('woff2');
}
```

- [ ] **Step 4: Import it and fix the two comments in `src/index.css`**

Line 1 becomes:

```css
/* Familjen Grotesk type system — the font files are self-hosted; see fonts.css. */
@import './fonts.css';
@import 'tailwindcss';
```

Line 173 (`/* The console speaks Satoshi (loaded in index.html); …`) becomes
`/* The console speaks Satoshi (self-hosted, see fonts.css); the marketing site`.

- [ ] **Step 5: Remove the CDN tags from `index.html`**

Delete lines 21–37 (the two comments, four `<link rel="preconnect">` and two `<link rel="stylesheet">`). The `<head>` ends with the `twitter:card` meta.

- [ ] **Step 6: Build and check the output**

Run: `npm run build 2>&1 | tail -5 && ls dist/fonts && grep -c -E 'googleapis|fontshare' dist/index.html`
Expected: build succeeds, 8 files in `dist/fonts`, grep count `0`.

- [ ] **Step 7: Run the suite and commit**

Run: `npm run test 2>&1 | tail -5`
Expected: all green (the prerender tests read `dist/`).

```bash
git add public/fonts src/fonts.css src/index.css index.html
git commit -m "feat(fonts): self-host Familjen Grotesk, Spline Sans Mono and Satoshi"
```

---

### Task 4: Route the last two API-supplied links through `publicAppUrl`

**Files:**
- Modify: `src/components/dashboard/deployment-progress.tsx:236-243`
- Modify: `src/components/dashboard/deployment-insights.tsx:171-182`
- Test: `src/components/dashboard/deployment-progress.test.tsx`, `src/components/dashboard/deployment-insights.test.tsx`

**Interfaces:**
- Consumes: `publicAppUrl(value: string | null | undefined): string | undefined` from `src/lib/app-url.ts`.

- [ ] **Step 1: Write the failing tests**

Append inside `describe('live deployment', …)` in `deployment-progress.test.tsx`:

```ts
  it('offers Open app only for an http(s) endpoint', () => {
    api.status = 'live';
    render(<DeploymentProgress {...props} endpoint="javascript:alert(1)" appSlug="hello-app" />);
    expect(screen.queryByRole('link', { name: /Open app/ })).not.toBeInTheDocument();
  });

  it('opens an http(s) endpoint in a new tab', () => {
    api.status = 'live';
    render(<DeploymentProgress {...props} appSlug="hello-app" />);
    const link = screen.getByRole('link', { name: /Open app/ });
    expect(link).toHaveAttribute('href', 'https://hello.example/');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
```

Append inside `describe('DeploymentPreviewUrl', …)` in `deployment-insights.test.tsx`:

```ts
  it('shows a non-http(s) preview URL as text, never as a link', () => {
    useDeploymentPreviewUrl.mockReturnValue(
      ready({
        deployment_id: 'd1',
        app_id: 'a1',
        host: 'deploy-4.api.gregale.dev',
        url: 'javascript:alert(1)',
        alive: true,
      })
    );
    render(<DeploymentPreviewUrl deploymentId="d1" />);
    expect(screen.getByText('deploy-4.api.gregale.dev')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/components/dashboard/deployment-progress.test.tsx src/components/dashboard/deployment-insights.test.tsx`
Expected: the two "javascript:" tests FAIL (a link is rendered); note that the `href` assertion also fails until the value goes through `new URL(...).href`, which normalises `https://hello.example` to `https://hello.example/`.

- [ ] **Step 3: Implement in `deployment-progress.tsx`**

Add the import:

```ts
import { publicAppUrl } from '@/lib/app-url';
```

Before the `return (` of the component body (after the hooks), add:

```ts
  // Only an API-assigned http(s) destination becomes a link; the raw value is
  // still shown and copyable above so nothing is hidden.
  const openHref = live ? publicAppUrl(endpoint) : undefined;
```

(`live` is already defined in the component; place this line after it.) Replace the `{live && (` block that wraps the `Open app` button with:

```tsx
            {openHref && (
              <Button asChild variant="cta">
                <a href={openHref} target="_blank" rel="noopener noreferrer">
                  Open app
                  <OpenNewWindow aria-hidden />
                </a>
              </Button>
            )}
```

- [ ] **Step 4: Implement in `deployment-insights.tsx`**

Add the import:

```ts
import { publicAppUrl } from '@/lib/app-url';
```

Replace the tail of `DeploymentPreviewUrl` from `const data = preview.data;` with:

```tsx
  const data = preview.data;
  if (!data?.alive || !data.url) {
    return <Pill label="preview closed" color="var(--status-idle)" />;
  }
  const href = publicAppUrl(data.url);
  const label = data.host ?? data.url;
  if (!href) {
    return <span className="font-mono text-xs text-muted-foreground">{label}</span>;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 font-mono text-xs text-brand hover:underline"
    >
      {label}
      <OpenNewWindow aria-hidden className="h-3 w-3" />
    </a>
  );
```

Keep whatever the existing anchor's children were if they differ from `{label}` plus the icon; only the guard and `href` change.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/components/dashboard/deployment-progress.test.tsx src/components/dashboard/deployment-insights.test.tsx`
Expected: PASS. If the existing "links the live preview host" test now expects `https://deploy-4.api.gregale.dev/` (trailing slash from URL normalisation), update that expectation.

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard/deployment-progress.tsx src/components/dashboard/deployment-insights.tsx src/components/dashboard/deployment-progress.test.tsx src/components/dashboard/deployment-insights.test.tsx
git commit -m "fix(console): only http(s) app URLs become links on deployment surfaces"
```

---

### Task 5: Tour the built console under the strict policy

**Files:**
- Modify: `mock/plugin.ts` (the `mockApi()` plugin: share the middleware with `configurePreviewServer`)
- Modify: `package.json` scripts (`build:mock`, `preview:mock`)
- Modify: `scripts/tour.mjs:85-92` (record CSP violations)

**Interfaces:**
- Produces: `npm run build:mock` (a development-mode bundle in `dist-mock/` with the dev bypass compiled in), `npm run preview:mock` (serves it on port 4173 with the mock API and `securityHeaders('preview')`).

- [ ] **Step 1: Let the mock plugin serve `vite preview`**

In `mock/plugin.ts`, inside `mockApi()`, move the body of `configureServer(server)` into a local function and call it from both hooks:

```ts
export function mockApi(): Plugin {
  const install = (server: {
    config: { logger: { info: (msg: string) => void; warn: (msg: string) => void } };
    middlewares: { use: (fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void };
  }) => {
    server.config.logger.info(
      `  ➜  mock api: serving /v1/* from mock/ — no backend needed${db.EMPTY ? ' (empty workspace)' : ''}`
    );
    server.middlewares.use((req, res, next) => {
      /* the existing middleware body, unchanged */
    });
  };
  return {
    name: 'gregale-mock-api',
    apply: 'serve',
    configureServer: install,
    // `vite preview` serves the built bundle; with the mock installed here too,
    // `npm run preview:mock` tours a real build under the production headers.
    configurePreviewServer: install,
  };
}
```

Use the `IncomingMessage` / `ServerResponse` types the file already imports (check the top of `mock/plugin.ts`; add `import type { IncomingMessage, ServerResponse } from 'node:http';` if absent). Everything inside the middleware stays byte-identical.

- [ ] **Step 2: Add the scripts**

In `package.json` `scripts`, after `"dev:mock"`:

```json
    "build:mock": "MOCK_API=1 vite build --mode development --outDir dist-mock",
    "preview:mock": "MOCK_API=1 vite preview --outDir dist-mock --port 4173",
```

`--mode development` keeps `import.meta.env.DEV` true so the tour's dev-bypass works, while still producing a real bundle: no inline refresh preamble, CSS as files, so the strict `script-src`/`style-src` are exercised. Add `dist-mock` to `.gitignore` under `dist-ssr`.

- [ ] **Step 3: Make the tour fail on CSP violations**

In `scripts/tour.mjs`, after `page.on('pageerror', …)` add:

```js
// A blocked font, fetch, style or script is invisible to the DOM checks below
// and to a user with no console open. Chromium reports each one as a console
// error naming the directive; the dev server and `vite preview` both send the
// policy (see src/lib/security-headers.ts), so this is checked on every tour.
const cspViolations = [];
page.on('console', (msg) => {
  const text = msg.text();
  if (msg.type() === 'error' && /Content Security Policy/.test(text)) {
    cspViolations.push(text.replace(/\s+/g, ' ').slice(0, 200));
  }
});
```

and include them in `problems`:

```js
const problems = [
  ...failures,
  ...[...unmocked].map((p) => `unmocked path: ${p}`),
  ...pageErrors.map((e) => `page error: ${e}`),
  ...[...new Set(cspViolations)].map((v) => `csp violation: ${v}`),
];
```

- [ ] **Step 4: Run the tour against the built console**

```bash
npm run build:mock 2>&1 | tail -3
npm run preview:mock &          # leave running
sleep 2 && curl -sI http://localhost:4173/ | grep -i content-security-policy
BASE_URL=http://localhost:4173 npm run tour
```

Expected: the CSP line shows `script-src 'self'; style-src 'self'` and no `upgrade-insecure-requests`; the tour prints `tour: ok — … no errors`. If Playwright is missing, the script prints the install line; run it.

If the only failures are `csp violation: … style-src …` on every page, the inline-style assumption in the spec is wrong: change `'style-src'` in `src/lib/security-headers.ts` to `[SELF, "'unsafe-inline'"]` in every mode, drop `"style-src 'self' 'unsafe-inline'"` / `"style-src 'self'"` from the dev-diff expectations in `security-headers.test.ts`, allow `unsafe-` in the `style-src` case of the "no third-party host" test, re-run `npx vitest run src/lib src/hosting-contract.test.ts`, regenerate the `vercel.json` literal (Task 2 step 3), and record the violating page and directive in the commit message. Any other violation is a real regression to fix at its source, not in the policy.

- [ ] **Step 5: Run the tour against the dev server**

```bash
kill %1
npm run dev:mock &
sleep 3 && BASE_URL=http://localhost:3000 npm run tour
kill %1
```

Expected: `tour: ok`.

- [ ] **Step 6: Commit**

```bash
git add mock/plugin.ts package.json .gitignore scripts/tour.mjs
git commit -m "test(tour): tour the built console under the production headers and fail on CSP violations"
```

---

### Task 6: Dependabot and the audit advisories

**Files:**
- Create: `.github/dependabot.yml`
- Modify: `package.json`, `package-lock.json` (dev tooling only)

- [ ] **Step 1: Add Dependabot**

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
      day: monday
    open-pull-requests-limit: 5
    groups:
      # One PR a week for everything semver-compatible; majors stay separate
      # because they are the ones that need a human to read a changelog.
      minor-and-patch:
        update-types: ['minor', 'patch']
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: monthly
```

- [ ] **Step 2: Resolve the advisories**

```bash
npm audit --omit=dev 2>&1 | tail -3        # expect: found 0 vulnerabilities
npm update brace-expansion js-yaml seroval source-map-js undici @redocly/openapi-core
npm install -D vitest@latest @vitest/mocker@latest 2>&1 | tail -2
npm audit 2>&1 | tail -8
git diff --stat package.json package-lock.json
```

Expected: the prod-only audit is clean before and after; the full audit drops to 0 or lists only advisories whose fix needs a major bump (record those in the PR). `package.json` changes only under `devDependencies`.

- [ ] **Step 3: Verify nothing moved under the app**

Run: `npm run check 2>&1 | tail -6`
Expected: typecheck, lint (≤ 4 warnings), format and tests all pass. If Vitest 4.x changed any behaviour, fix the test, not the dependency pin.

- [ ] **Step 4: Commit**

```bash
git add .github/dependabot.yml package.json package-lock.json
git commit -m "chore(deps): add Dependabot; take the dev-tooling security updates"
```

---

### Task 7: Document the boundary

**Files:**
- Modify: `README.md:499` (Deployment section, after "Config for the common hosts is committed:" list)
- Modify: `CLAUDE.md` (append one gotcha)

- [ ] **Step 1: README**

After the two-bullet list that follows "Config for the common hosts is committed:", add:

```markdown
**Browser security headers have one source of truth:** `src/lib/security-headers.ts`.
`npm run dev` and `npm run preview` apply it from the module, and `vercel.json`
carries a literal copy of the production set that `src/hosting-contract.test.ts`
checks for equality — on a mismatch, regenerate the literal from the module.
The policy is first-party only (`connect-src 'self'`, `font-src 'self'`, no
third-party hosts anywhere); fonts are self-hosted under `public/fonts/` for
that reason. A new external origin is a policy change, not a tag in
`index.html`, and the dev server will block it until the module allows it.
`npm run build:mock` + `npm run preview:mock` serve a built console with the
mock API under the production headers, which is what `npm run tour` should be
pointed at before changing the policy.
```

- [ ] **Step 2: CLAUDE.md**

Append to the Gotchas list:

```markdown
- **Headers live in `src/lib/security-headers.ts`; `vercel.json` is a copy.**
  `src/hosting-contract.test.ts` fails when they differ. The dev server sends
  the same policy, so a font, image, script, or fetch from a third-party host
  is blocked locally — that is the point. Do not add an origin to a directive
  to make something load; ask whether it should be first-party instead (the
  fonts are, under `public/fonts/`).
```

- [ ] **Step 3: Format check and commit**

Run: `npm run format:check 2>&1 | tail -3`
Expected: clean (Prettier formats Markdown; run `npx prettier --write README.md CLAUDE.md` if not).

```bash
git add README.md CLAUDE.md
git commit -m "docs: where the browser security policy lives and how it is enforced"
```

---

### Task 8: Final verification

**Files:** none.

- [ ] **Step 1: The real gate**

```bash
npm run build 2>&1 | tail -4
npm run check 2>&1 | tail -6
```

Expected: both green; lint warnings ≤ 4.

- [ ] **Step 2: Public pages under the production build**

```bash
npm run preview -- --port 4174 &
sleep 2
for p in / /login /signup /docs /status /will-it-run; do
  echo "== $p"; curl -s -D - -o /dev/null http://localhost:4174$p | grep -i -E 'HTTP|content-security|cross-origin-opener';
done
kill %1
```

Expected: every page 200 with the preview policy. Then, with the preview still running, open `http://localhost:4174/` and `/docs/api-hosting` in a browser with DevTools open: no CSP errors, every font request under `/fonts/`, nothing from `gstatic`, `googleapis`, or `fontshare`.

- [ ] **Step 3: Branch review**

Run: `git log --oneline origin/main..HEAD` and `git diff --stat origin/main..HEAD`.
Expected: 8 commits (spec + 7 tasks), no changes outside the files this plan names. Hand the branch to a fresh reviewer.
