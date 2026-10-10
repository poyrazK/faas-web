# Instrumented Issues Console Implementation Plan

**Goal:** Add an app Issues journey for deployment-bound reporting setup, bounded triage, retained evidence, and authorized lifecycle actions without conflating instrumented Issues with automatic HTTP Errors.

**Spec:** `docs/superpowers/plans/2026-10-08-console-capability-coverage.md`, section G; issue #150. Backend immutable pin `8bc758106a3803c8981274ed0905d05b258bde7f`. Frontend dependency: F PR #159 at `4941e18`; this G branch starts there.

**Design:** Add Issues beside Errors in the app Observe tabs. Account/app keyed queries read bounded pages and independent detail histories. One-time token creation is a direct call outside TanStack mutation retention; metadata is whitelisted. Use the existing same-origin cookie client for issue actions, retaining backend MFA, deploy-write and origin checks. Treat accepted, retained, attributable failures as a bounded observation rather than complete coverage.

## Task 1: Pin and test the API contract

- [ ] Write a failing contract test for the five Issues REST path groups, list filters/cursor, three independent detail cursors, action choices, and one-time token field.
- [ ] Copy only those path groups and required schemas from the backend pin into `api/openapi.yaml`; regenerate `src/lib/api/schema.d.ts`.
- [ ] Run focused contract test and typecheck RED then GREEN. Commit contract/schema/test.

## Task 2: Scoped reads and token client

- [ ] Test account/app/filters/order/window query identities, AbortSignal propagation, opaque cursor reset on filter change, and independent detail cursors.
- [ ] Implement `src/lib/api/issues.ts` with list/detail/token metadata hooks. Whitelist token metadata so an unexpected bearer field from GET/list never enters cache.
- [ ] Test direct create outside `useMutation`, one POST per submit, no automatic retry on ambiguous loss, and versioned/identified token revocation. Implement direct create/revoke and issue actions with explicit logical operation keys where backend idempotency is confirmed.
- [ ] Focused tests RED then GREEN; typecheck; commit read and operation clients separately if coherent.

## Task 3: Issues inbox and detail

- [ ] Test Preview/Hobby+ availability, registry and permission failure, empty/error states, app switch, filter/order/window cursor resets, Mine/Unassigned, and bounded list continuation.
- [ ] Build `issues-body.tsx` beside Errors with a separate instrumentation explanation. Add app tab routing/search so deep links, reload and Back/Forward retain app/issue/filter selection.
- [ ] Test independent events/releases/activity pagination, recurrence/fix release, verified impact and missing evidence. Build `issue-detail.tsx` with three separate cursors and explicit observed/retained bounds.
- [ ] Focused tests RED then GREEN; commit inbox and detail in small changes.

## Task 4: Reporting setup and lifecycle actions

- [ ] Test authoritative deployment/environment selection, name/expiry limits, one-time password-style token disclosure, copy failure/manual copy, acknowledgment, account/app change, reload, expiry/revocation and quota/concurrency/lost-response recovery.
- [ ] Build `issue-reporting-setup.tsx` with a direct create call. After ambiguous create, clear sensitive state and refresh metadata for the exact token ID/deployment/environment/name/expiry; never auto-mint, same-name revoke, or bulk revoke. Identified unusable credentials may be explicitly revoked then recreated after review.
- [ ] Test assignment only from owner/active member identities, resolve only against a real app deployment, reopen/ignore, MFA/permission errors, stale action conflict, and no automatic POST resubmission. Build action controls in detail.
- [ ] Show verified Node/Python/Go SDK and OTLP JSON guidance from the pinned `docs/issues.md`; link local docs only if `src/lib/docs-manifest.ts` confirms a published Issues route.
- [ ] Focused tests RED then GREEN; commit setup and actions separately.

## Task 5: Mock and PR gate

- [ ] Add bounded mock fixtures/handlers for list, detail, tokens and actions; include duplicate/token quota, expired/revoked, recurrence, independent cursors and permission failures. Never send a real ingest event for UI verification.
- [ ] Run `npm run check` and `npm run build`. Perform Windows Chromium mobile mock walkthrough for direct reload, Back/Forward, keyboard, long lists, delayed reads, account/app/environment change, one-time capture, and failure recovery.
- [ ] Request one fresh 6.1 Sol/High final review. Fix Critical/Important findings with failing-then-passing tests. Open a bounded PR based on F #159, attach it, and update parent #134 as PR-open only. Do not merge.

## Exclusions and gates

- Existing HTTP Errors remains separate. Ownership-rule replacement and impact-alert editing are follow-up scopes.
- No dashboard HTML action CSRF names are reused through `issueCSRF()` for REST routes; follow the current REST action/auth wrapper.
- No instrumentation, provider, real customer app, production token or staging traffic is created to verify this UI. Mock/browser success does not prove reporting delivery or issue coverage.
