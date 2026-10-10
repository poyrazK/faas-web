# Stripe Inbound Webhooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an app owner create and manage Stripe inbound endpoints, bind a published same-app automation, and inspect a known event receipt without losing or exposing one-time credentials.

**Architecture:** Keep the existing Webhooks route and app tab, adding Inbound and Outbound subviews with Outbound as the legacy default. Read metadata through account/app-keyed queries and a narrow typed API module. Perform one-time creation outside TanStack mutations; keep the returned URL only in a context-fenced disclosure dialog and strip it from every cached metadata response.

**Tech Stack:** React 19, TypeScript, TanStack Router/Query, openapi-fetch and generated types, Vitest/Testing Library, Vite mock API.

**Spec:** `docs/superpowers/plans/2026-10-08-console-capability-coverage.md`, section F; issue #149. Backend pin `890f5233e858a5321dedceb7422a2215953d81e3` in the separate `faas` repository.

## Global Constraints

- `enabled` means account/runtime availability, not successful execution or fleet health.
- Preserve existing outbound webhook and other app workflows.
- Never cache one-time credentials in TanStack Query, URLs, local/session storage, logs, analytics, or mock snapshots containing real secrets.
- A client-added Idempotency-Key does not make an endpoint replay-safe: endpoint POST has no backend idempotent wrapper.
- Do not send provider events, invoke handlers, or modify production to test the UI.
- Use the actual app ownership, scopes, MFA and trusted browser origin contracts.
- Account/app change or unmount must prevent delayed responses from disclosing a credential in a new context.

## Review Focus

1. A committed create response lost in transit leaves a same-name endpoint: refresh metadata, disclose uncertainty, never retry or delete automatically; Task 3 tests this.
2. A delayed successful create returns after account/app change: the URL never appears in the new context; Task 3 tests this.
3. A malicious or future GET/list response includes `endpoint_url`: query data still excludes it; Task 2 tests this.
4. A binding update races another operator and returns 409: refresh authoritative version, never overwrite; Task 4 tests this.
5. A known event is accepted but queued or fails later: receipt wording must preserve routing and execution distinction; Task 5 tests this.

## Task 1: Pin the narrow contract

**Files:** Modify `api/openapi.yaml`; regenerate `src/lib/api/schema.d.ts`. Test `src/lib/api/inbound-webhooks.contract.test.ts`.

**Interfaces:** Produce generated `CreateInboundWebhookEndpointRequest`, `InboundWebhookEndpointResponse`, `PutWebhookAutomationBindingRequest`, `WebhookAutomationBindingResponse`, `WebhookAutomationReceiptResponse` and the five endpoint path groups from the pinned backend OpenAPI. The create response's optional `endpoint_url` is the only disclosure field.

- [ ] Write a contract test that reads `api/openapi.yaml` and asserts the Stripe endpoint POST, binding PUT with `expected_version` and `take_over_delivery`, known-event receipt GET, and optional one-time URL are present.
- [ ] Run `npm run test -- src/lib/api/inbound-webhooks.contract.test.ts`; expect failure because the vendored contract lacks these operations.
- [ ] Copy only the pinned backend path groups and schemas, including required response/error shapes, into the vendored contract. Generate types with `npm run api:types`; keep existing admin/console-only declarations.
- [ ] Re-run the focused test and `npm run typecheck`; expect pass. Commit contract, generated types and test together: `console: pin Stripe inbound webhook contract`.

## Task 2: Safe metadata and operation client

**Files:** Create `src/lib/api/inbound-webhooks.ts`, `src/lib/api/inbound-webhooks.test.tsx`.

**Interfaces:** Export `inboundWebhookKey(accountId, slug)`, `stripInboundEndpointSecrets(response)`, `useInboundEndpoints(accountId, slug)`, `createInboundEndpointOnce(slug, body)`, `setInboundEndpointEnabled(slug, id, enabled)`, `deleteInboundEndpoint(slug, id)`, `useWebhookBinding(accountId, slug, id)`, `putWebhookBinding(slug, id, body, key)`, `deleteWebhookBinding(slug, id, version)`, `lookupWebhookReceipt(slug, id, eventId, signal)`. The create function returns a one-time response directly and has no mutation hook.

- [ ] Write tests showing GET/list metadata strips `endpoint_url` even when a server unexpectedly includes it; query key includes account and app and forwards AbortSignal. Assert create is called once with no automatic retry and raw URL never reaches Query mutation state.
- [ ] Run focused tests; expect missing exports/behavior failure.
- [ ] Implement typed operations via `api`/`unwrap`; metadata sanitizer removes `endpoint_url` and unknown token-like fields before caching. Keep direct create outside `useMutation`; send the secret only as a local call argument and clear form state on settlement. Binding PUT uses an explicit key and server version; 409 remains a surfaced error. Do not pass a stage query or add endpoint POST retry.
- [ ] Re-run focused tests and typecheck; expect pass. Commit as `console: add safe inbound webhook client`.

## Task 3: Create, disclose and recover Stripe endpoints

**Files:** Create `src/components/dashboard/inbound-webhooks.tsx`, `src/components/dashboard/inbound-webhooks.test.tsx`; modify `src/routes/dashboard.webhooks.tsx` and its tests.

**Interfaces:** `InboundWebhooks({accountId, slug}: {accountId:string; slug:string})` consumes the Task 2 client and `useCapability('durable-inbound-webhooks')`. Route subview search parameter `direction` is `inbound|outbound`, defaulting to outbound so old URLs remain valid.

- [ ] Write interaction tests for available/Hobby, Free denial, runtime unavailable, failed registry, empty/list/error states; validate name `^[a-z][a-z0-9-]{0,62}$`, secret 1–256 bytes and path `/` without `?`/`#`. A successful create must show the URL in an active dialog with copy, manual selection fallback and explicit acknowledgment; closing without acknowledgment is blocked.
- [ ] Write response-loss test: create promise rejects after a possible commit, refresh metadata and show same-name inspection; no second POST occurs on another click. A simultaneous same-name 409 does not prove the resource is this submission. Delayed success after account/app change or unmount must not disclose the URL. A reload shows metadata only and clear replacement guidance.
- [ ] Run focused tests; expect failure for absent component/route behavior.
- [ ] Implement the form, context-fenced one-time disclosure and unresolved outcome. Keep `signing_secret` in a password field only. After ambiguous failure, clear the secret, freeze the attempted name/path, refresh same-app metadata, and require an explicit inspected endpoint selection plus reviewed disable/delete and new provider URL before replacement. Never auto-delete or auto-create. Recheck capability/account/app after any asynchronous confirmation.
- [ ] Re-run focused tests and typecheck; expect pass. Commit as `console: manage Stripe ingress safely`.

## Task 4: Endpoint management and automation binding

**Files:** Create `src/components/dashboard/webhook-automation-binding.tsx` and focused tests; extend `inbound-webhooks.tsx` tests and route integration.

**Interfaces:** `WebhookAutomationBinding({accountId,slug,endpointId})` reads `useAutomations(accountId,slug)` and Task 2 binding operations. Only published same-app automations are selectable; workflows capability must be available. Current `binding.version` is submitted as `expected_version`; 0 is only for a confirmed absent binding.

- [ ] Write tests for enable/disable with accepted queued work copy, delete confirmation, secret rotation not recovering URL, published same-app selection, workflows unavailable, explicit delivery takeover review, stale binding 409 refresh, and versioned removal.
- [ ] Run focused tests; expect failure.
- [ ] Implement endpoint management and binding panel with existing buttons, panels, modals and confirmations. Use an explicit `take_over_delivery: true` review and stable idempotency key for one logical binding save. Recheck account/app/capabilities after any awaited confirmation. On 409 invalidate binding query and require fresh review; no silent re-submit. Distinguish ingress enabled from delivery/run health.
- [ ] Re-run focused tests and typecheck; expect pass. Commit as `console: bind Stripe ingress to published automations`.

## Task 5: Known-event receipt lookup and PR gate

**Files:** Create `src/components/dashboard/webhook-receipt.tsx` and tests; extend `inbound-webhooks.tsx`, `mock/data.ts`, `mock/plugin.ts`, `src/mock-api.test.ts` as needed.

**Interfaces:** `WebhookReceipt({slug,endpointId})` only queries after a user enters a known provider event ID; no receipt-list endpoint is implied. Link a returned `run_id` to the existing app automation run route using its verified URL convention.

- [ ] Write tests for known-event lookup, 404/not-retained, duplicate, pending/queued/failed/ignored routing states, run link and account/app switch. Assert no lookup occurs before user submission and no receipt inbox appears.
- [ ] Run focused tests; expect failure.
- [ ] Implement the lookup, mock fixtures/handlers and route integration. Use receipt status, routing status and run evidence separately. Add no provider-send/test button.
- [ ] Re-run focused tests and typecheck; expect pass. Commit as `console: inspect known Stripe event receipts`.
- [ ] Run `npm run check` and `npm run build` through Windows `cmd.exe` in this worktree. Perform Chromium mock walkthrough for direct URL reload, Back/Forward, keyboard/mobile, long lists, delayed reads, context switch, one-time capture and failure recovery. Record logs/screenshots in the ignored ledger workspace. Request one fresh final review using 6.1 Sol/High; fix Critical/Important findings RED→GREEN, then open a bounded PR based on the verified A–E dependency. Attach the PR and update #134 with PR-open status only.

## Self-review

The five tasks cover contract, safe client, create/recovery, management/binding and receipt lookup. The unsupported generic provider and nonexistent receipt inbox are excluded. Every Review Focus condition has a named test in its owning task. Generated schema stays with its contract change. The only cross-task stateful interface is the sanitized endpoint metadata plus a one-time direct create response; no mutation cache owns the secret input or URL.
