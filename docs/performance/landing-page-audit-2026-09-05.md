# Landing-page performance audit — 2026-09-05

## Executive summary

The landing page is visually strong but currently pays for much of the authenticated
console, a nearly 2 MB hero image, and several continuously animated effects before it
becomes comfortably interactive. The highest-value work is not micro-optimizing React:
it is reducing the LCP image, moving console-only providers and queries out of the root
route, and putting a stricter runtime budget around the landing animations.

The production mobile Lighthouse baseline from this audit scored **29**. It measured a
**14.8 s LCP**, **2.86 s total blocking time**, **4.4 s FCP**, and **2.58 MiB** transferred.
CLS was **0**, so layout stability is already good. These are lab results, not field Core
Web Vitals, and should be treated as a starting baseline rather than a permanent score.

The expected highest-impact sequence is:

1. Replace the hero emblem and navigation favicon with responsive, modern image assets.
2. Stop mounting `DataProvider` and other console-only infrastructure on public routes.
3. Reduce the shared bootstrap and eliminate anonymous landing-page API requests.
4. Bound or defer the terminal playback and WebGL/motion work.
5. Make fonts and below-the-fold sections non-blocking, then add performance budgets.

## Scope and method

Audited checkout:

- Repository: `/home/bahadir/GREGALE/faas-web`
- Branch: `fix/palette-escape`
- Commit: `9795e7eec81df79e218b43a828d1bb55d032291e`
- Existing `dist/`: built at 2026-09-05 01:49 +03, one commit before the audited HEAD;
  the intervening commit only changes command-palette Escape handling.

Measurements:

- Lighthouse 13.0.1 against `https://gregale.dev/`, mobile preset, simulated 4x CPU
  slowdown and slow network.
- Lighthouse against the local compiled `dist/` for comparison.
- Static inspection of the route/provider graph, animation loops, asset dimensions,
  generated chunks, font loading, cache headers, and production network requests.
- Temporary WebP conversions were made outside the repository to estimate achievable
  image sizes. No application assets or source files were changed.

Important limitations:

- This was a single production Lighthouse sample. Continuous animation makes lab runs
  especially noisy, so future comparisons should use the median of at least three runs.
- No CrUX/field dataset was available for the origin. There is no evidence here about
  real-user p75 Core Web Vitals yet.
- The local Python static server did not compress text assets. Production results and
  production transfer sizes are therefore the authoritative network baseline.
- Headless Chrome can make GPU-heavy visual effects look worse than hardware-accelerated
  desktop Chrome. The long-task result is still a useful low-end/software-rendering
  stress signal, but individual animation costs should be isolated before changing the
  visual design.

## Baseline

### Production mobile Lighthouse

| Metric                   |    Result | Suggested first target |
| ------------------------ | --------: | ---------------------: |
| Performance score        |        29 |      >= 80, then >= 90 |
| First Contentful Paint   |     4.4 s |               <= 1.8 s |
| Largest Contentful Paint |    14.8 s |               <= 2.5 s |
| Speed Index              |     9.2 s |               <= 3.4 s |
| Total Blocking Time      |  2,860 ms |              <= 200 ms |
| Time to Interactive      |    19.9 s |               <= 3.8 s |
| Cumulative Layout Shift  |         0 |                 <= 0.1 |
| Transfer size            | 2,580 KiB |     <= 500 KiB initial |
| Main-thread work         |    11.7 s |                 <= 2 s |

The LCP element is the decorative hero emblem:

```html
<img src="/gregale-frosted.png" class="h-[300px] w-[300px] sm:h-[520px] sm:w-[520px]" />
```

Lighthouse estimated **2,068 KiB** of image-delivery savings and **1,080 ms** of
render-blocking-resource savings. It also found **20 long tasks**, three non-composited
hero entrance animations, and about **129 KiB compressed / 47%** unused code in the
shared JavaScript bootstrap.

### Largest production transfers

| Resource                    |    Transfer | Notes                                               |
| --------------------------- | ----------: | --------------------------------------------------- |
| `gregale-frosted.png`       | 1,989,625 B | LCP image; 1254x1254 displayed at 300 or 520 CSS px |
| shared `index-*.js`         |   286,698 B | 890,528 B decoded; about 47% unused on landing      |
| `favicon.png`               |   177,499 B | 512x512 displayed as a 28x28 navigation mark        |
| Spline Sans Mono            |    36,665 B | Third-party font                                    |
| landing `index-*.js`        |    30,043 B | Landing-specific route code                         |
| `logo.png`                  |    29,037 B | Footer logo is fetched eagerly below the fold       |
| Familjen Grotesk            |    19,426 B | Third-party font                                    |
| global CSS                  |    17,887 B | 101,827 B decoded, render-blocking                  |
| Cloudflare beacon           |    10,338 B | Additional production instrumentation               |
| Cloudflare challenge script |     9,941 B | Edge-injected script                                |
| Vercel Analytics            |     1,966 B | A second analytics stack                            |

The initial local route graph was about 3.20 MiB raw and 2.40 MiB with estimated gzip.
Images account for most of the compressed total.

## Prioritized findings

### P0 — Optimize the LCP emblem and navigation mark

**Evidence**

- [`hero.tsx`](../../src/components/landing/hero.tsx#L60) loads
  `gregale-frosted.png` eagerly with one source for all viewports.
- The source is 1254x1254 and 1,986,952 B. It is displayed at 300x300 on mobile and
  520x520 above the small breakpoint.
- Lighthouse identifies it as LCP, estimates roughly 1.94 MB wasted for this resource,
  and reports that it lacks `fetchpriority="high"`.
- [`nav.tsx`](../../src/components/landing/nav.tsx#L178) displays the 512x512,
  176,870 B favicon at 28x28. Lighthouse estimates essentially the whole transfer is
  avoidable.
- A temporary conversion of the emblem produced approximately 76 KiB at 600x600 WebP
  and 207 KiB at 1040x1040 WebP at quality 72. A 64x64 navigation mark was about 2 KiB
  WebP or 5 KiB optimized PNG. These are estimates and require visual review.

**Recommendation**

- Export visually approved 600 px and 1040 px AVIF/WebP variants, retaining PNG only as
  fallback if required.
- Use `<picture>`, `srcset`, and `sizes` so a mobile device does not receive the desktop
  asset.
- Add `fetchPriority="high"` and `decoding="async"` to the selected LCP image. Do not
  lazy-load it.
- Give the navigation mark its own 32/64 px asset rather than reusing the 512 px favicon.
- Generate conventional 16/32/48 px favicon files and a separate 180 px Apple touch icon.
- Verify that blend mode and transparency survive conversion before merging.

**Expected impact:** about 1.8–2.0 MB less initial transfer and a materially earlier LCP.
This is the safest and highest-confidence improvement.

### P0 — Do not boot the authenticated console on the landing page

**Evidence**

- [`__root.tsx`](../../src/routes/__root.tsx#L78) wraps every route in
  `QueryClientProvider`, `MfaProvider`, `AuthProvider`, `DataProvider`, `GlimmProvider`,
  and `ToastProvider`.
- [`store.tsx`](../../src/lib/store.tsx#L62) unconditionally starts app, deployment, and
  metrics queries when `DataProvider` mounts.
- An anonymous production visit made three unnecessary requests, all returning 401:
  `/v1/apps`, `/v1/deployments?limit=50`, and `/v1/apps/metrics?range=24h`.
- The shared bootstrap is about 890 KB decoded / 287 KB transferred in production.
  Lighthouse found about 132 KB compressed unused on the landing page.
- The public route only directly needs the lightweight authentication state for the OAuth
  callback and signed-in navigation behavior.

**Recommendation**

- Move `DataProvider` into the `/dashboard` route layout. It should never mount for `/`,
  `/docs`, `/login`, or `/signup`.
- Move `MfaProvider` and console mutation/toast infrastructure to the narrowest route
  layout that needs them.
- Keep a minimal public auth/session layer at root only if the OAuth landing callback
  requires it. Avoid importing the 1,800-line query module merely to configure retry
  behavior at the root.
- Consider separate `PublicLayout`, `AuthLayout`, and `DashboardLayout` provider graphs.
- Add a test asserting that rendering `/` does not request `/v1/apps`, deployments, or
  metrics.

**Expected impact:** removes three requests, reduces server noise, and should cut a large
part of the 129 KiB compressed unused-JS opportunity. It also reduces parse/evaluation
work on every public documentation and authentication page.

### P0 — Put a hard budget around automatic animation work

**Evidence**

- Production Lighthouse measured 11.7 s main-thread work, 2.86 s TBT, and 20 long tasks.
  The long tasks were attributed to the shared and landing chunks.
- [`deploy-terminal.tsx`](../../src/components/landing/deploy-terminal.tsx#L93) performs
  a React state update for every typed character at a 22 ms cadence, plus per-line
  updates. Each update renders the terminal session again.
- [`liquid-field.tsx`](../../src/components/landing/liquid-field.tsx#L178) runs a
  full-viewport WebGL2 animation with a two-pass float texture pipeline on every
  `requestAnimationFrame` while visible.
- [`use-shader-canvas.ts`](../../src/components/landing/shaders/use-shader-canvas.ts#L65)
  correctly pauses offscreen/hidden animations and supports reduced motion, but shader
  contexts are still created and programs compiled at mount before intersection is
  known. The page mounts two additional below-the-fold WebGL canvases.
- The hero entrance animates `filter: blur(...)`; Lighthouse identifies three such
  elements as non-composited animations.

The no-WebGL audit did not materially improve the mobile score by itself, so the evidence
does **not** justify deleting the shaders. The cost is likely shared across the terminal,
motion scheduler, visual effects, and headless software rendering. Isolate each effect
behind temporary build flags before choosing the final trade-off.

**Recommendation**

- First benchmark four variants independently: terminal static, hero WebGL static,
  below-fold shaders disabled, and entrance blur removed. Use three-run medians.
- Replace per-character React updates with one of:
  - a CSS `steps()` animation over static/pre-rendered text;
  - imperative `textContent` updates in an isolated node;
  - chunked updates at no more than 20–30 fps.
- Do not start terminal playback during the critical loading window. Start on explicit
  replay, after idle, or only after the terminal is substantially visible and LCP has
  completed.
- Cap shader animation to 30 fps on mobile/low-power devices, or show the existing static
  fallback unless `(hover: hover) and (pointer: fine)` matches.
- Initialize and compile below-the-fold shader contexts only when they approach the
  viewport, rather than compiling all contexts at route mount.
- Try a lower hero internal render scale. Halving both canvas dimensions quarters fragment
  work; validate the visual result on high-DPI phones.
- Prefer opacity/transform-only entrance animation. Remove animated blur from the three
  hero elements, or apply it only above a device-performance threshold.

**Expected impact:** potentially the largest TBT/interaction improvement, but exact gains
need the proposed isolation measurements. Preserve the current reduced-motion behavior.

### P1 — Make font loading route-aware and non-blocking

**Evidence**

- [`index.html`](../../index.html#L19) loads Google Fonts and Fontshare stylesheets for
  every route.
- The page preconnects to four font origins and loads two render-blocking external CSS
  responses.
- Lighthouse attributed roughly 1.08 s of production render-blocking opportunity to the
  global CSS and font stylesheets.
- Satoshi is principally the console typeface. Its Fontshare stylesheet is loaded on the
  marketing route even when its font file is not requested in the audit.

**Recommendation**

- Self-host the exact WOFF2 subsets and weights needed for the landing page.
- Preload only the hero's primary font file; keep `font-display: swap` or `optional`.
- Load Satoshi with the dashboard layout. If the example terminal genuinely requires it,
  load it when that section approaches the viewport or use the existing mono face there.
- Avoid four speculative preconnections. Keep only origins on the actual critical path.

**Expected impact:** shorter render-blocking chain, fewer third-party DNS/TLS dependencies,
and more deterministic typography during incidents or privacy filtering.

### P1 — Stop throwing away the prerendered public DOM

**Evidence**

- [`main.tsx`](../../src/main.tsx#L51) deliberately uses `createRoot` rather than
  `hydrateRoot` because an earlier router/Suspense attempt did not reconcile.
- The production landing document contains about 73.7 KB raw / 12.9 KB transferred of
  useful prerendered HTML, then client React replaces it.
- This preserves no-JS/SEO output but duplicates browser work: parse the complete page,
  discard it, and create the same React tree again.

**Recommendation**

- Revisit TanStack Router's supported SSR dehydration/hydration path instead of treating
  the earlier mismatch as permanent.
- If full hydration remains awkward, consider a static public shell with small interactive
  islands for navigation, copy buttons, the terminal, and shaders. Keep the dashboard as
  the existing SPA.
- Add a hydration parity test so a future route or Suspense change cannot reintroduce a
  silent mismatch.

**Expected impact:** lower startup DOM/style work and less risk of an LCP render delay.
This is architecturally larger than the image/provider work and should be a separate PR.

### P1 — Defer below-the-fold JavaScript and rendering

**Evidence**

- [`index.tsx`](../../src/routes/index.tsx#L31) imports and mounts the complete landing
  page synchronously: How It Works, Process, Why, Pricing, and Footer.
- The landing-specific chunk is only about 30 KB transferred, so code splitting alone is
  not a dramatic win. The more important cost is initializing observers, motion values,
  shader programs, large card trees, and below-the-fold layout during startup.
- No landing section uses `content-visibility: auto` or `contain-intrinsic-size`.
- The footer logo is fetched eagerly even though it is far below the fold.

**Recommendation**

- Apply `content-visibility: auto` with measured intrinsic-size placeholders to large
  below-the-fold sections.
- Lazy-initialize interactive sections near the viewport. Preserve their prerendered text
  for SEO rather than replacing the whole section with an empty client placeholder.
- Add `loading="lazy"` and `decoding="async"` to the footer logo.
- Keep the first hero and the first visible edge of the terminal eager.

**Expected impact:** moderate startup and memory reduction, especially on long mobile
pages; low network impact unless paired with deferred code chunks.

### P1 — Rationalize production instrumentation and edge scripts

**Evidence**

- The production page loads Vercel Analytics, Cloudflare analytics, a Cloudflare challenge
  script, and Cloudflare email-decode code.
- These added roughly 25 KB transferred in the audit, plus execution and additional
  connections.
- [`__root.tsx`](../../src/routes/__root.tsx#L104) explicitly mounts Vercel Analytics;
  the Cloudflare scripts are injected outside this repository.

**Recommendation**

- Decide whether both Vercel and Cloudflare analytics are required. Keep one primary RUM
  source unless they answer materially different questions.
- Disable Cloudflare email obfuscation if the landing HTML does not contain addresses
  requiring it.
- Review whether a JavaScript challenge is necessary for anonymous static landing assets,
  and exclude static/public routes where security policy permits.
- Add actual Web Vitals reporting before optimizing solely against lab scores.

**Expected impact:** modest payload/TBT reduction and cleaner real-user measurement. Edge
security policy takes precedence over the performance gain.

### P2 — Split or reduce global render-blocking CSS

**Evidence**

- The single generated stylesheet is 101,827 B decoded / about 18 KB transferred.
- It contains tokens and utilities for both the public site and the console.
- Lighthouse treats it as render-blocking and includes it in the 1.08 s opportunity.
- Lighthouse did not report a reliable unused-CSS byte count, so a large deletion claim
  would be speculation.

**Recommendation**

- Separate base tokens from route-specific marketing and console styles where Vite can
  emit route chunks.
- Consider inlining only the small above-the-fold token/reset subset and loading the rest
  normally.
- Measure before/after; at about 18 KB transferred, CSS is less urgent than images and
  JavaScript boundaries.

### P2 — Fix cache policy at the outer CDN

**Evidence**

- [`vercel.json`](../../vercel.json#L65) requests one-year immutable caching for hashed
  `/assets/*`.
- Production responses observed through Cloudflare returned
  `cache-control: public, max-age=14400, must-revalidate` for the hashed JavaScript and the
  hero image.
- The root HTML correctly remains revalidated, but content-hashed assets are safe to cache
  for a year.

**Recommendation**

- Configure Cloudflare not to replace the immutable Vercel policy for `/assets/*`.
- Fingerprint optimized hero assets through the module/build graph, or give versioned
  filenames, before applying a long immutable TTL to them.
- Keep HTML short-lived/revalidated.

**Expected impact:** little change for first visits, much faster repeat navigation and
deploy-to-deploy cache reuse.

### P2 — Remove or validate oversized unused public assets

**Evidence**

- `public/gregale-logo.png` is 1,170,451 B and has no application reference found by the
  repository-wide search. Vite still copies it into every deployment.
- `public/gr.jpeg` also had no source reference in the inspected application.
- These files were not transferred by the landing page, so they do not affect its first
  load today.

**Recommendation**

- Confirm they are not externally linked stable assets, then delete or archive them.
- Add a small asset-audit script that reports unreferenced public files and flags images
  above a size threshold.

**Expected impact:** smaller deploy artifacts and less accidental future payload growth;
no current LCP improvement.

## Suggested implementation plan

### PR 1 — Image fast path

- Responsive AVIF/WebP hero emblem with reviewed transparency/blend behavior.
- Dedicated small navigation mark and conventional favicon sizes.
- `fetchPriority="high"` on the LCP image; lazy footer image.
- Target: LCP image transfer below 220 KiB desktop and 90 KiB mobile.

### PR 2 — Public/dashboard provider boundary

- Move `DataProvider` and console-only providers under `/dashboard`.
- Ensure `/` produces no apps/deployments/metrics requests.
- Record shared and route chunk sizes in the PR.
- Target: initial JavaScript below 170 KiB compressed, then tighten further.

### PR 3 — Animation budget

- Add temporary effect flags and collect three-run medians for terminal, WebGL, and blur.
- Replace per-character React playback and lazy-compile below-fold shaders.
- Establish mobile/static or 30 fps policy based on the measurements.
- Target: mobile TBT below 300 ms in the first pass, then below 200 ms.

### PR 4 — Font and rendering path

- Self-host/subset critical fonts and route-load Satoshi.
- Add below-fold containment/lazy initialization.
- Investigate supported hydration or public-page islands separately.

### PR 5 — Guardrails

- Run Lighthouse CI against a production-like compressed server.
- Compare the median of three mobile runs.
- Fail CI or warn on regressions beyond agreed budgets:
  - LCP <= 2.5 s
  - TBT <= 200 ms
  - CLS <= 0.1
  - initial transfer <= 500 KiB
  - LCP image <= 220 KiB desktop / 90 KiB mobile
  - no customer-data API calls from anonymous public routes
- Add RUM for LCP, INP and CLS so lab improvements can be checked against real users.

## What is already good

- CLS is zero in the measured run.
- The terminal reserves its final height, avoiding line-by-line layout shifts.
- Shader loops stop when offscreen or when the document is hidden.
- Reduced-motion users receive static visual states.
- Canvas rendering already disables antialiasing and uses reduced internal resolution for
  the smaller shader components.
- Routes are code-split, hashed assets are configured for immutable caching at Vercel,
  and public content is prerendered for crawlers/no-JS readers.
- The landing-specific JavaScript chunk is relatively small; the dominant JavaScript
  problem is the shared root/provider graph.

These strengths should be preserved while implementing the recommendations above.
