# OpenAPI Route and Policy Preview Implementation Plan

Execute inline with superpowers:executing-plans. Child issue: faas-web#157.

## Scope and immutable contract

Add the existing read-only GET `/v1/apps/{slug}/openapi/preview` to the app's
OpenAPI journey, preserving import, dry-run and deployment document discovery.
Backend pin `705298f5ec8b1933f94d4e16a0a0df5c578914a3`; frontend base J
`26e6234aa3d3d40281529684fc8cba86421d208c`. No write or browser probe is part
of this scope. The endpoint has no plan capability gate; retain scope/MFA errors.

## Task 1 — Contract and safe reads

- [ ] RED behavioral tests for account/app query identity, abort propagation,
      secret/action stripping, and healthy/partial/unavailable/capped evidence.
- [ ] Copy only the pinned preview route and three referenced schema slices;
      regenerate types. Implement a whitelisted client projection that excludes
      opaque policy action objects and suggestions from query caches.
- [ ] Preserve observed source, inventory availability, collector counts and
      cap evidence. An unavailable collector plus retained inventory remains
      unavailable live telemetry; an empty healthy snapshot means no observed
      traffic in this snapshot, not complete coverage.
- [ ] GREEN focused tests/typecheck; atomic contract/client commit.

## Task 2 — App journey

- [ ] RED tests for classified routes, enabled/disabled policy matches, no
      declaration, incomplete collectors, failed reads, context change, and long lists.
- [ ] Add a Route and policy preview panel with bounded client paging/search,
      route classifications, returned match criteria and explicit coverage limits.
      Matching policy presence does not establish correctness or execution health.
- [ ] Account/app identity mismatch must fail closed. Account changes get fresh
      query identity; no stale rows during pending/error refresh. No POST/PATCH/DELETE.
- [ ] Add mock endpoint/fixtures and preserve existing import workflow tests.
- [ ] GREEN focused tests; atomic behavior/UI commit.

## Release gates

- [ ] Full check/build; mock mobile/keyboard/direct reload/Back/Forward,
      delayed reads, app/account changes, empty and failed observations. Mocks do
      not prove runtime collector health.
- [ ] One fresh final 6.1 Sol/High reviewer; fix important findings RED→GREEN.
- [ ] Push bounded PR based on J #166, attach, link `Closes #157`; no merge.
      Record commits, exact gate output and issue status in the durable ledger.

## Self-review and ruling

All L3 requirements map to Tasks 1–2. Existing explicit implementation
authorization covers this bounded plan. L3 is independent of K's new backend
inventory, so execute it while the isolated K store rebuild runs. L1 and L2
retain separate branches and PRs; M qualification is not expanded.
