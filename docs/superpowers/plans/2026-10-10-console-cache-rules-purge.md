# Console Cache Rules and Targeted Purge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task. Steps use checkbox syntax for tracking.

**Goal:** Let eligible customers configure response cache rules and request all, path, or tag purges while showing durable application evidence accurately.

**Architecture:** Extend the existing edge-rule kind registry and dialog for cache rules; keep unrelated rule kinds usable during a cache capability outage. Extend the existing app Configuration purge control and policy-status receipt instead of creating a new cache dashboard. All writes use the same-origin client, current account and app identity, and the confirmed capability state.

**Tech Stack:** React 19, TypeScript, TanStack Query, openapi-fetch/openapi-typescript, Vitest/Testing Library, Vite mock API.

**Spec:** `docs/superpowers/plans/2026-10-08-console-capability-coverage.md`, scope J; [faas-web #153](https://github.com/poyrazK/faas-web/issues/153). Backend contract pin `dc711e2ad8a13e246aaf5a17c18fed3341b19945`; frontend dependency base `ba786582fc1994492ada7f0703b5d96e2a6ee6ea`.

## Global Constraints

- `declarative-response-caching` is Preview and Hobby+; registry failure or runtime unavailability disables cache writes, not unrelated edge-rule kinds.
- Cache methods are GET and HEAD only; vary headers are `Accept-Language` and `Accept-Encoding` only. Authorization/cookie requests bypass the cache; `Set-Cookie`, `private`, and `no-store` responses must not be described as cacheable.
- Fresh age is 0–3600 seconds, with 0 meaning server default 60. Stale while revalidate is 0–300, with 0 disabled. Stale if error is 0–300, with 0 disabled. Use explicit defaults 60/0/300 in a new rule.
- Purge accepts one `path` or one `tag`, or neither for all. A tag is 1–128 ASCII bytes and matches `[A-Za-z0-9._:/-]+`; the server lowercases it. Do not send path and tag together.
- A 204 means a durable purge was requested, not that every gateway or shared tier applied it. Use E's response-cache component status. No real customer cache writes or provider traffic for verification.
- PR #22 has a partial cache kind implementation but omits method/SWR/capability coverage and treats zero stale-if-error as invalid. Reconcile only the relevant idea; do not merge or copy unrelated changes.

## Review Focus

1. A registry failure with last-good enabled data cannot authorize cache create, edit, toggle, reorder, delete, or purge. Tasks 2–3 test this.
2. A delayed confirmation or policy baseline read after account, app, plan, or capability change cannot submit a cache write. Tasks 2–3 test this.
3. An edited rule created by CLI with empty or unexpected methods/headers must not silently become an unsafe policy. Task 2 tests server-compatible defaults and closed vocabulary.
4. A purge 204 with pending shared Redis invalidation must remain Pending; a failed status read must be Unverified. Task 3 tests both.
5. A path glob and tag must never be sent together, even when the user switches selector after typing. Task 3 tests request shape.

## Task 1: Pin cache and purge contracts

**Files:** Modify `api/openapi.yaml`, regenerate `src/lib/api/schema.d.ts`; create `src/lib/api/cache.contract.test.ts`; create `src/lib/cache-policy.ts` and `src/lib/cache-policy.test.ts` for numeric, method, vary and purge selector validation.

**Interfaces:** Produce `validateCacheAction(action): Record<string,string>` and `cachePurgeSelection(mode, input): {path?: string;tag?: string}`. Consume the generated `EdgeRuleCacheAction` and `purgeAppCache` query type.

- [ ] Add a contract test that asserts the vendored cache action includes `stale_while_revalidate_seconds`, the exact method/vary enums, the tag query parameter, and path/tag exclusion. Run `npm run test -- src/lib/api/cache.contract.test.ts`; expected RED because SWR/tag are absent.
- [ ] Synchronize those narrow backend OpenAPI sections from the immutable pin and run `npm run api:types`. Compare generated diff for unrelated drift; keep only the scoped schema change. Rerun the contract test; expected GREEN.
- [ ] Add pure tests for valid 60/0/300 defaults, bounds and integer rejection, POST/Authorization rejection, and path/tag/all request shape and tag validation. Run the focused test; expected RED because the helper is absent.
- [ ] Implement the helpers against the exact backend limits and rerun focused tests plus typecheck; expected GREEN. Commit contract/generator and helper work separately when both are independently green.

## Task 2: Cache rule editor and guarded CRUD

**Files:** Modify `src/components/dashboard/edge-rules/kinds.tsx`, `dialog.tsx`, `src/routes/dashboard.edge-rules.tsx`; create `src/components/dashboard/edge-rules/cache.test.tsx`; extend `src/lib/api/queries.ts` only if account-scoped rule reads or write context require it.

**Interfaces:** Consume `validateCacheAction`, `useCapability('declarative-response-caching')`, current account ID and the existing create/update/delete mutations. Preserve all other kind editors and routes.

- [ ] Add tests for a fourteenth Cache kind with 60/0/300 defaults, GET/HEAD and two vary controls, persisted edit shape, and explanations for request/response bypass. Run focused tests; expected RED because Cache is absent.
- [ ] Add the Cache action mapping, summary, form and exact validation. Restrict cache match methods to GET/HEAD, including CLI-authored edit values; save must not expand a cache rule to all methods. Rerun focused tests; expected GREEN.
- [ ] Add tests for Free, runtime unavailable, registry error with last-good data, permission/MFA rejection, and delayed account/capability change. Assert zero cache mutations while unrelated rule kind selection remains available. Run focused tests; expected RED.
- [ ] Gate Cache selection and all cache writes in dialog/table with current account/capability identity; fence after asynchronous confirmation. Keep cache metadata readable with an unavailable explanation. Rerun focused tests and typecheck; expected GREEN. Commit editor and route integration.

## Task 3: Exclusive targeted purge and convergence

**Files:** Modify `src/lib/api/queries.ts`, `src/components/dashboard/app-lifecycle.tsx`, `src/components/dashboard/app-lifecycle.test.tsx`; use existing `src/components/dashboard/policy-operation.ts` and `policy-status.tsx` without changing their established semantics.

**Interfaces:** `usePurgeAppCache(slug)` accepts the exclusive selection from Task 1; `PurgeCacheControl` uses current app/account, confirmed cache capability and E's `response_cache` operation receipt.

- [ ] Add tests for all/path/tag request shapes and invalid tag; run focused tests and watch RED.
- [ ] Change the purge client to send exactly one query selector, and add all/path/tag UI choice with per-mode input and reviewed confirmation. Rerun focused tests; expected GREEN.
- [ ] Add tests for Free, runtime-off, registry failure after last-good data, delayed confirmation/account change, accepted 204 with Pending shared tier, and failed status read as Unverified. Run focused tests and watch RED.
- [ ] Gate the purge write with current availability and account/app identity after confirmation and after the policy baseline read. Show accepted status and E's convergence evidence without claiming immediate cache emptiness. Rerun focused tests and typecheck; expected GREEN. Commit purge journey.

## Verification and delivery

- [ ] Run focused tests after each RED/GREEN step; `npm run check` and `npm run build` at the PR boundary. Inspect all output and preserve four known lint warnings.
- [ ] Mock browser: direct app link, reload/Back/Forward, keyboard/mobile, long edge-rule list, delayed reads, account/app switch, cache kind create/edit, tag/path/all purge, and status pending/unverified. Mock evidence does not prove gateway execution.
- [ ] One final fresh 6.1 Sol/High review of the whole J branch. Fix Critical/Important findings with RED→GREEN tests and rerun the full gate.
- [ ] Push one bounded PR based on I-c #165, attach it, update #134 with PR-open status, and do not merge.
