# Frontend issue review — 14 September 2026

Prepared locally on `fix/frontend-open-issues-20260914`, based on `origin/main`
commit `7716f98`. No PRs were merged, issues closed, or deployments made.
The existing checkout and other worktrees were preserved.

| Issue                                                                        | Local result                                                                                                                                                                                                                                                                                                    | Remaining work                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#94 — Free overview metrics](https://github.com/poyrazK/faas-web/issues/94) | Gate both the overview and shared provider before fetching paid metrics. Disable the range control, show the existing Hobby plan gate and comparison link, and keep compute usage and resident instances available. Refresh skips paid reads. Hide error percentages when the account lacks access.             | None identified for the frontend fix.                                                                                                                                                                                                                                                                                                                                                                                         |
| [#95 — restore latency claim](https://github.com/poyrazK/faas-web/issues/95) | Centralize the SSD platform-only snapshot-restore p95 target and qualification. Correct auth, docs metadata, app creation, and the park confirmation. Link auth and app creation to the published measurement explanation. Current main had already removed the numeric claim from SEO and landing-footer copy. | None identified for the remaining frontend copy.                                                                                                                                                                                                                                                                                                                                                                              |
| [#96 — pricing parity](https://github.com/poyrazK/faas-web/issues/96)        | Replace the blurred dollar-price draft with the API-generated euro catalog and its seven quota fields. Explicitly state that paid billing and checkout are disabled during beta. Signup uses the same Free allowance. Remove the Enterprise draft and unsupported public invocation allowances.                 | Paid checkout remains disabled as intended; enabling it is outside this fix.                                                                                                                                                                                                                                                                                                                                                  |
| [#93 — missing CLI/API docs](https://github.com/poyrazK/faas-web/issues/93)  | Publish `/docs/plans`, include it in navigation, prerendering, and the sitemap. Resolve relative links in vendored docs to published slugs or their upstream source, preserving anchors.                                                                                                                        | Command-level URL coverage remains open. PR #22 already contains the generated CLI reference, so that work was not duplicated. Its integration still needs command-topic mappings, cross-repository URL validation, and release CLI smoke checks. The generated plans document also lacks the API's detailed anchors such as `#apps`, `#ram`, and `#per-app-metrics`; those need matching upstream content/generator changes. |
| [#97 — legal pages](https://github.com/poyrazK/faas-web/issues/97)           | Replace the global SPA fallback with registered client routes plus real host-level 404 handling. Preserve dashboard, onboarding, and invitation deep links. Missing assets cannot inherit immutable caching. Extend the deployment smoke to reject soft 404s.                                                   | Reviewed Privacy Policy and Terms content, effective dates, archival policy, signup/footer links, and legal-content production checks are still required. No legal claims or placeholder agreements were invented. The separate DPA API availability issue remains upstream.                                                                                                                                                  |

## Existing work considered

[PR #90](https://github.com/poyrazK/faas-web/pull/90) already handles workload
creation, detail modals, storage capacity, usage compaction, and spend caps.
Those changes were excluded. Open PRs #22, #28, #32, and #40 were also inspected;
PR #22's generated CLI reference is the relevant overlap for issue #93.

The pricing source is `content/docs/plans.md`, vendored verbatim from
`poyrazK/faas/docs/plans.md`, which is generated from `pkg/api/limits.go`.
Its local and current upstream Git blob hashes both equal
`0bf83a87d414dfa762551d04fa2c095fc288f451`.
The parser fails the build on unrecognized columns, currencies, quotas, or plan
sets instead of publishing guessed values. Public pricing and signup derive
from that one document.

## Validation

- `npm run build`: passed; 29 routes prerendered and 25 URLs in the sitemap.
- `npm run check`: passed; 1,099 tests in 142 files, typecheck and formatting passed, no lint errors and six existing warnings.
- Regression tests reproduced the Free requests, missing plan gate, incorrect auth claim, missing public catalog, relative documentation links, and soft-404 behavior before their fixes.
- Chromium with the local mock API: desktop and 390px pricing, signup allowance, methodology navigation, plan links, and Free/paid/degraded overview states passed. Free made zero paid metrics requests even after refresh. Paid range changes updated the URL. No uncaught application errors were observed.
- Mobile pricing had no horizontal document overflow; screenshots were inspected.
- Hosting configuration tests cover registered app deep links and missing public, dashboard, documentation, and asset URLs. These are local configuration checks; the production host has not been changed. Run `npm run smoke:hosting` after deploying to verify actual edge responses.

For alternate static hosts, the scoped `_redirects` rules leave unmatched URLs
to the generated `404.html`; see the documented
[Cloudflare Pages behavior](https://developers.cloudflare.com/pages/configuration/serving-pages/)
and [Netlify routing behavior](https://docs.netlify.com/manage/routing/redirects/redirect-options/).
