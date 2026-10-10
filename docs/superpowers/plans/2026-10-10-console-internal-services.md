# Private Apps and Internal Services Console Plan

**Goal:** Let customers create and inspect internal-only apps, review public reachability changes, and manage standalone service caller/binding policies with truthful inventory and verification states.

**Spec:** `2026-10-08-console-capability-coverage.md`, scope H; issue #151. Frontend base G PR #160 at `411935a`. Backend immutable pin `c7618900617ac9b0698def59cbe311aee546c396`.

## Contract and boundaries

- Sync only app creation/read/PATCH visibility and service policy fields plus GET `/v1/apps/{slug}/bindings` from the backend OpenAPI; regenerate types. Test the wire union, especially omitted/null/empty caller policy and the different null semantics for targets, scopes, binding policy and transport.
- Use the account/app keyed, abortable binding inventory. Treat `complete=false` and structured section issues as partial. Show declared state, runtime status and canary verification independently. Never probe a workload while rendering.
- Project-managed/preview policies are source-owned. Derive preview ownership from `preview_of_slug` and project ownership from authoritative project detail workloads. If project inventory is incomplete or unavailable, do not offer a standalone policy PATCH. Visibility remains an app setting but must be reviewed separately.
- Do not claim a private network fabric or HTTPS transport is qualified merely because a setting is accepted. Retain the returned transport and verification status; use only stable returned addresses and no clickable browser link for internal addresses.

## Task 1: API contract and tests

- [x] Write failing contract tests for the app fields, binding inventory path, policy null distinctions and response evidence fields.
- [x] Sync backend OpenAPI subsections into `api/openapi.yaml`; regenerate `schema.d.ts`; make contract/typecheck GREEN. Commit the narrow contract.

## Task 2: Inventory and ownership

- [x] Test account/app query identity, cancellation, partial inventory, unknown/stale/failed verification, and returned addresses.
- [x] Build `src/lib/api/bindings.ts` and `service-bindings.tsx` in App Connect → Services. Keep service rows separate from other inventory sections while stating when the whole inventory is partial. Show declared bindings, target-side caller policy, configured access, runtime/verification evidence and safe copy of returned internal URLs.
- [x] Test project/preview/source-managed ownership and inventory failure; offer manifest/CLI handoff with no production PATCH from a selected environment. Commit read journey.

## Task 3: Reviewed policy edits and visibility

- [x] Test exact standalone PATCH payloads for caller inheritance (`null`), deny-all (`[]`), scoped grants (`null` versus `{}`), target list (`[]`), and binding policy/transport. Validate caller/target slugs against account-owned app choices; preserve deliberate forward references only with explicit review. Recheck account/app/capability/ownership and latest app policy immediately before submit; stale review returns to draft.
- [x] Build service policy editor with explicit replacement review and 409/error recovery. Invalidate app, app list and binding inventories after accepted PATCH; no optimistic policy claim.
- [x] Test and build `app-visibility.tsx` in Configuration. Review public-to-internal loss of edge/custom-domain reachability before PATCH; show returned visibility separately from routing verification. Prevent browser-clickable internal address links in app overview/configuration/creation completion.
- [x] Add internal visibility to app creation Configure/Review and POST. Recheck capability before create; preserve the existing non-idempotent app creation recovery path. Commit creation and policy behavior in focused changes.

## Task 4: Qualification and PR

- [x] Extend mock capability/app/bindings contracts, then test Free availability, partial reads, denied callers, stale target list, private transport unavailable, context changes and source-managed policy blocks.
- [x] Run focused RED/GREEN tests, `npm run check`, production build and Windows Chromium mock walkthrough: creation review, public/internal transitions, null/empty edit, mobile/keyboard, direct reload, app switch, delayed long reads and partial inventory. Cover account/environment context and failure recovery in focused tests; mock browser work does not qualify private fabric or staging.
- [ ] Request one fresh 6.1 Sol/High final review; fix Critical/Important defects RED/GREEN. Open one bounded PR based on G #160, attach it, update parent #134 as PR-open only. Do not merge or send provider/customer traffic.
