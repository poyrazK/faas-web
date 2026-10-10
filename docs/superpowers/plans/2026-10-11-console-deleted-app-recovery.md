# Deleted-app Recovery Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline. Steps use checkboxes for tracking.

**Goal:** Let customers inspect their retained deleted apps and explicitly restore an identified eligible record.

**Architecture:** A narrow account-scoped backend inventory precedes the frontend. Reuse existing restore protection and console components. Review against fresh metadata and use the app ID as a write precondition; reconcile ambiguous responses with reads before another deliberate attempt.

**Tech Stack:** Go, PostgreSQL/sqlc, React, TypeScript, TanStack Query/Router, Vitest and Vite mock API.

**Spec:** Approved `2026-10-08-console-capability-coverage.md`, K; faas-web#154; faas#4423.

## Global constraints

- Backend main and frontend main remain untouched; isolated backend branch and a fresh frontend branch based on J #166.
- Bounded account-owned queries only. Global sweeper tombstones and audit-derived inventory are forbidden.
- No live deletion, production mutation, provider execution, deployment or merge for verification.
- Eligibility is server-evaluated lifecycle evidence. Restore rechecks current quota/capacity; acceptance does not prove execution health.
- Fresh context after delayed reads/confirmation; account change/unmount cannot submit a stale write.
- Preserve existing Apps navigation and all existing source/Jobs workflows.

## Review focus

1. Foreign or malformed cursors cannot expose another account; Task 1 tests.
2. Same deletion timestamp and a concurrent restore cannot duplicate/skip cursor neighbors; Task 1 tests.
3. Reused slug cannot restore a replacement record; Task 2 expected_app_id tests.
4. Expiry, quota and temporary capacity errors remain distinct and recoverable; Tasks 2/4 tests.
5. Lost restore response/reload cannot blindly repeat POST or claim healthy execution; Tasks 3/4 tests.

## Task 1: Account-owned backend inventory

**Files:** backend `pkg/state/deleted_apps.go`, `pkg/state/deleted_apps_test.go`, `pkg/state/pgstore_deleted_apps.go`, `pkg/state/pgstore_deleted_apps_test.go`, `pkg/state/queries.sql` and generated sqlc output.

**Interfaces:** `DeletedAppRecord` holds ID/slug, nullable deletion/deadline, internal sort timestamp and purge claim. `AccountDeletedAppsStore` exposes `ListAccountDeletedApps(ctx, accountID, beforeAt, beforeID, limit)` and `AccountDeletedAppByID(ctx, accountID, id)`.

- [ ] Test account isolation, active exclusion, ties and bounded keyset pages before implementing. Example: `rows, err := store.ListAccountDeletedApps(ctx, account.ID, time.Time{}, "", 2)` returns only two owned tombstones in descending deletion order.
- [ ] Watch `go test ./pkg/state -run AccountDeleted -count=1` fail for the missing interface/behavior.
- [ ] Implement MemStore and SQLC queries with `account_id=$1 AND status='deleted'`, `(coalesce(deleted_at,created_at),id)` order and matching tuple predicate. Validate store bounds 1–51 (handler fetches limit+1).
- [ ] Regenerate with pinned sqlc, rerun focused tests and meaningful PostgreSQL fixtures; commit store/query/tests together.

## Task 2: Backend API and restore fence

**Files:** backend `pkg/api/deleted_apps.go`, `cmd/apid/handlers_deleted_apps.go`, corresponding tests, `server.go`, `handlers_ext.go`, `api/openapi.yaml`, mirrored `pkg/apid/openapi.yaml`, `docs/apps.md` if present.

**Interfaces:** GET `/v1/apps/deleted?limit=25&cursor=...` returns `{apps,next_cursor,evaluated_at}`; GET `/v1/apps/deleted/{id}` returns safe summary. Each summary has `id`, `slug`, `deleted_at`, `delete_grace_until`, `restore_eligible`, `restore_blocker`, `evaluated_at`. Existing POST restore accepts optional `{expected_app_id}`.

- [ ] Write handler RED tests: empty/owned inventory, foreign app 404, default/max limit, malformed/account-mismatched cursor, expiry/purge state, scope/MFA denial and stale identity 409. A replacement must remain deleted after `POST restore` with the old ID.
- [ ] Implement routes behind read scope/MFA; encode a bounded account-bound cursor with timestamp/UUID and reject malformed input. Compute lifecycle blockers from server time and purge claim; document quota/capacity recheck.
- [ ] Decode optional restore request strictly and compare ID before mutation. Preserve existing bodyless API compatibility and deploy-write/MFA/origin middleware.
- [ ] Add OpenAPI types and sync embedded copy. Run focused handler/store tests, relevant existing restore/security tests, sqlc/OpenAPI checks and Go build/vet; commit API/tests/contracts separately. One final reviewer; bounded backend PR based on main, push and attach.

## Task 3: Frontend contract and recovery client

**Files:** `api/openapi.yaml`, `schema.d.ts`, `src/lib/api/deleted-apps.ts` and tests, `queries.ts` restore hook.

- [ ] Behavioral client tests RED: account/cursor-keyed abortable list, exact-ID fresh read, verified account identity before restore, expected_app_id payload, inventory/app/project/deployment invalidation, no automatic POST retry.
- [ ] Pin the new backend slices and regenerate schema. Build whitelisted metadata reads through `api/unwrap`. Extend `useRestoreApp` with explicit ID and complete invalidation while preserving existing slug callers.
- [ ] Keep non-secret pending restore identity before POST in account-scoped session storage. On ambiguity inspect exact app ID and deleted record; accepted intent stays distinct from observed restoration. Definitive denial permits fresh review; no automatic replay.
- [ ] Run focused tests/typecheck; commit contract/client and recovery behavior separately.

## Task 4: Recently deleted journey and verification

**Files:** `src/components/dashboard/deleted-apps.tsx` and tests, `src/routes/dashboard.workflows.index.tsx`, route tests, `mock/plugin.ts` and fixture/tests.

- [ ] UI tests RED: empty/loading/backend-unavailable/permission/quota/collision/transient states, bounded history, fresh review, changed deadline/identity, delayed account switch, lost response and reload reconciliation.
- [ ] Add URL-backed Active / Recently deleted selection within Apps. Show returned deadline and lifecycle blocker; review a fresh identified record before restore, read again at submit, and fence context. Navigation/reload retain view/cursor; account changes reset cursor identity.
- [ ] Implement mock fixtures only; no real deletion. Test restoration response and affected inventories.
- [ ] Run focused tests, full `npm run check`, build and mobile/keyboard mock walkthrough with delayed/long lists, reload/history/context changes and failure recovery.
- [ ] Request one final fresh 6.1 Sol/High reviewer, fix Important/Critical findings RED→GREEN. Push a bounded frontend PR based on #166, dependent on backend API PR; attach and update #134/#154 honestly. Never merge.

## Self-review

All K requirements map to the four tasks. Account-bound pagination and explicit-ID restore remove the two identity risks. Frontend completion depends on an actual backend PR; server eligibility never promises quota reservation or running health. User already authorized inline implementation and scoped pushes; proceed under that authorization.
