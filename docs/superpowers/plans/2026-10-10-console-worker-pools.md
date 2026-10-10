# Long-lived workers and queue consumers console plan

**Goal:** Create OCI worker apps without HTTP assumptions, manage production queue bindings, show binding-scoped state and liveness, and stage desired queue settings truthfully.

**Spec:** `2026-10-08-console-capability-coverage.md`, scope I; issue #152. Frontend base H PR #162 at `7c387185e8018f81086ed453a39b43e992bc91bd`. Backend immutable pin `f870f9905321c5aae2a933a3ff87be990fac6df6`.

## Contract and decisions

- `worker-pools` is Preview, Hobby+. Create with `execution_mode: worker`; lifecycle fields use backend plan caps, with zero inheriting plan defaults. A created app may lack a characterized `workload_class` until deployment; do not claim it is a verified worker merely from accepted creation.
- `/queue-workload` is a convergent production PUT that reconciles the **default push** binding, consumer and queue-depth scaling policy. Its route is not wrapped by `s.idempotent`, so an ambiguous response must be inspected before another attempt. It is not a generic pull setup. Read the existing default binding and current app/scaling policy before offering a replacement; use `force` only after explicit review of a conflicting queue.
- Production `/queue-bindings` routes reject stage/scope selectors. Binding POST is idempotently wrapped; PATCH/DELETE are explicit writes. Bindings are durable configuration. Status provides independent `consumer_state`, `consumer_liveness` and timestamps; active plus stale/not_observed is not healthy. Pull reports external liveness.
- Stage desired bindings use `/v1/projects/{slug}/environments/{environment}/workloads/{workload}/queue-bindings` with `expected_revision` equal to the complete workload revision. `activation_state: unavailable` means no stage delivery or promotion qualification. Protected stages are read-only. Never route stage edits through a production URL or imply active consumers.
- Jobs are finite executions, App Queues currently shows messages through peek, and sidebar Instances means physical compute. Keep those meanings.

**Delivery boundaries:** I-a contains the contract/client and production Consumers journey for already existing worker apps. I-b adds new OCI worker creation and lifecycle review. I-c adds stage desired bindings. Open dependent PRs after each bounded branch is independently verified; the final I scope is complete only after all three journeys qualify.

## Task 1: Contract and safe client

- [x] Add failing OpenAPI contract tests for production profile, queue-binding CRUD/status and stage desired-binding GET/PUT. Sync exact pinned API slices into `api/openapi.yaml`, regenerate types, and make typecheck GREEN.
- [x] Add account/app-scoped abortable read queries for bindings/status and project/environment/workload-scoped stage reads. Add explicit production mutations with no stage query selector. Test keys, cancellation and exact wire shapes RED→GREEN; commit contract and client separately.

## Task 2: Production consumer journey

- [x] Add App Automate → Queues → Consumers and an entry from global Queues. Show durable binding mode/class/enabled, consumer state, liveness, poll age, lag, queue depth/in-flight/dead-letter separately. Test active+stale, active+not_observed, paused, external pull and read failure before UI.
- [x] Add reviewed production create/edit/pause/delete. Explicitly select pull versus push. Re-read app, capability, account, bindings and the affected binding before writes; keep operation identity for idempotent create and reconcile ambiguous responses via read before a new attempt. Do not claim queue delivery from accepted configuration. Test Free denial, conflicts, context changes, 409, ambiguous creation and status recovery.
- [x] Offer the simple profile only when a characterized worker/job supports it and the user explicitly selects platform push; review the current default binding, queue, scaling target and `force` replacement. Test conflicting default, no force by default and replacement consent. Commit bounded consumer behavior.

## Task 3: OCI worker creation and lifecycle

- [ ] Add a New app worker path using digest-pinned OCI image admission, reviewed `execution_mode: worker`, restart policy, startup deadline and retry cap. Use a distinct durable non-secret operation key/identity and the established image create/deploy recovery rules. No HTTP port, path healthcheck, public endpoint or request readiness copy in the worker flow.
- [ ] Recheck account, plan, capability and frozen worker choices before each write and after delayed reads. Show accepted app, accepted deployment and observed execution/consumer state separately. Test Free denial, no listener, lost create/deploy responses, conflicting app identity, restart limits and context changes. Commit worker setup independently.

## Task 4: Stage desired bindings

- [ ] Show stage desired queue definitions only from selected project/environment/workload context. Distinguish revision/hash and `activation_state: unavailable` from production consumer status.
- [ ] For unprotected registered stages, review complete replacement with current workload revision and all existing definitions preserved; stale 409 requires a new read/review. Protected stage stays read-only. Test project/environment switch, stale revision, empty replacement and production isolation. Commit stage journey independently.

## Task 5: Qualification and bounded PRs

- [ ] Extend mock API/capabilities and cover conflicts, stale push polls, external pull, paused consumer, delayed status, Free plan, existing default replacement, worker without HTTP listener, and stage activation unavailable. I-a covers production behavior; I-b/I-c retain their fixture cases.
- [ ] Run focused RED→GREEN, full `npm run check`, production build and Windows Edge mock walkthroughs: direct/reload/history, keyboard/mobile, long lists, app/account/environment changes, ambiguous recovery and failure retry. Do not invoke real handlers or modify production to test.
- [ ] Request one fresh 6.1 Sol/High final review for each bounded branch, fix Critical/Important findings RED→GREEN, open dependent PRs, attach each, update #134 accurately. Do not merge or claim stage/provider health.
