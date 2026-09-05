# Landing-page performance implementation — 2026-09-05

## Outcome

The first performance pass is implemented. In three post-change mobile Lighthouse runs
against the compiled site, the median score increased from the comparable local baseline
of **26 to 66**. Total blocking time fell from **3,500 ms to 40 ms**, main-thread work
from **11.7 s to 0.9 s**, and transferred bytes from **3,341 KiB to 882 KiB**.

The median post-change LCP is **6.3 s** on the uncompressed local static server. One of
the three final runs reached **2.4 s LCP and a score of 73**. That variance is why this
report uses medians. Text assets are served without gzip or Brotli in this local test;
production delivery should be retested after deployment.

| Mobile Lighthouse metric | Local baseline | Post-change median |     Change |
| ------------------------ | -------------: | -----------------: | ---------: |
| Performance score        |             26 |                 66 | +40 points |
| First Contentful Paint   |          9.7 s |              4.1 s | 58% faster |
| Largest Contentful Paint |         13.8 s |              6.3 s | 54% faster |
| Speed Index              |         13.2 s |              4.8 s | 64% faster |
| Total Blocking Time      |       3,500 ms |              40 ms |  99% lower |
| Time to Interactive      |         23.9 s |              6.5 s | 73% faster |
| Main-thread work         |         11.7 s |              0.9 s |  92% lower |
| Transfer size            |      3,341 KiB |            882 KiB |  74% lower |
| Cumulative Layout Shift  |              0 |                  0 |  unchanged |

These figures are an apples-to-apples local comparison using Lighthouse 13's mobile
preset. The production baseline in the audit was score 29, LCP 14.8 s, and TBT 2,860 ms,
but it includes Cloudflare/Vercel behavior and compressed delivery, so it should not be
mixed directly with the local median.

## Implemented changes

### Critical images

- Replaced the 1.99 MB hero PNG on the rendered route with responsive 600 and 1040 px
  AVIF/WebP variants. The mobile AVIF is 55.3 KiB and the desktop AVIF is 137.9 KiB.
- Added matching `srcset`, `sizes`, dimensions, `fetchPriority="high"`, async decode, and
  a responsive image preload. Lighthouse confirms that the LCP request is discoverable,
  eager, and high-priority.
- Replaced the 177 KiB navigation favicon with a 2.2 KiB, 64 px WebP mark.
- Added dedicated 16/32 px favicons and a 180 px Apple touch icon.
- Added explicit dimensions and lazy loading to the below-the-fold footer logo.

The original large public assets remain in place because their stable URLs may be used
outside this repository. They are no longer referenced by the landing page.

### Landing-only application boundary

- Added a route-aware browser entry. `/` loads a compact landing router; other routes
  load the complete application router.
- Moved React Query, MFA, data-store, and toast providers to the routes that use them.
  The landing route retains only its small authentication provider.
- Moved retry policy and section-label metadata into lightweight modules so importing
  the public shell does not pull in the query corpus or dashboard navigation icons.
- The compiled landing graph is now **199.3 KiB gzip** and contains none of the
  `/v1/apps`, `/v1/deployments`, or `/v1/apps/metrics` endpoint strings. Anonymous landing
  visits therefore no longer boot those dashboard queries.
- Public cross-route actions use document navigation so the small landing router never
  attempts to resolve routes that intentionally are not in its tree.

The prerendered page stays visible while the landing bundle loads, then React replaces it
in one commit. Full-router prerendered routes still hydrate when their path marker matches.
Router head elements are delayed until hydration completes, while the prerenderer writes
metadata and resource hints directly into the document head. This prevents head elements
from causing a hydration mismatch.

### Main-thread and rendering work

- Removed hidden-first-paint behavior and blur from the above-the-fold entrance. The
  server-rendered navigation and hero copy are immediately visible.
- Capped the terminal playback to at most 20 React updates per second and deferred its
  automatic start until it is substantially visible and the browser is idle.
- Deferred below-the-fold WebGL context creation until a canvas approaches the viewport.
- Capped active shader rendering at 30 fps.
- Reduced the hero shader's internal render scale to 0.65.
- Uses a static hero fallback on coarse-pointer devices and preserves reduced-motion
  behavior.
- Added `content-visibility: auto` and intrinsic-size containment to large below-the-fold
  sections.

The final audit found only two long tasks and a median 40 ms TBT, down from 20 long tasks
and 3,500 ms TBT in the local baseline.

### Fonts and delivery

- Self-hosted the exact Familjen Grotesk, Spline Sans Mono, and Satoshi WOFF2 files.
- Removed four third-party preconnects and the Google Fonts/Fontshare stylesheets.
- Preloads only the landing page's primary Familjen face.
- Added immutable one-year cache headers for `/fonts/*` in `vercel.json`.

### Regression guardrails

`npm run perf:check` now reads the Vite manifest and fails when:

- the compiled landing JavaScript graph exceeds 215 KiB gzip;
- critical AVIF/mark assets exceed their size budgets;
- dashboard API endpoint strings leak into the landing graph;
- prerendered LCP preload/high-priority attributes disappear; or
- the obsolete large hero/favicon URLs return to the landing document.

CI runs this check immediately after the production build.

## Validation

- Production build and prerender of 18 routes: passed.
- Landing performance budget: passed at 199.3 KiB gzip.
- Browser console: no application or hydration errors. The local server returns the
  expected 404 for Vercel Analytics' production-only `/_vercel/insights/script.js`.
- Final Lighthouse sample set: three mobile runs, with medians reported above.

## Still external or deferred

- Re-run at least three mobile Lighthouse samples against the deployed production URL.
  This is the authoritative check for Brotli/cache/CDN behavior and edge-injected scripts.
- Inspect Cloudflare configuration for the challenge script, email-obfuscation script,
  outer-cache headers, and duplicate analytics. Those settings are outside this repo and
  were not changed.
- Add field Core Web Vitals monitoring before treating the lab score as user impact.
- A later pass can split more of the landing's shared React/router/motion code. The new
  215 KiB CI budget prevents regression while leaving modest headroom for normal changes.
