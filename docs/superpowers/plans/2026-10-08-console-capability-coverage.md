# Console Capability Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement approved tasks sequentially. Steps use checkboxes for tracking. This document is a delivery plan, not authorization to implement or create GitHub issues.

**Goal:** Make supported Gregale capabilities discoverable and usable from the console, with accurate availability, permissions, execution state, and recovery behavior.

**Architecture:** Keep the existing app-centered console and add project-level reads above it. Use the canonical capability registry for availability, typed API modules per workstream, and existing tables, panels, forms, modals, and URL-backed navigation. Do not build a second dashboard or turn every backend endpoint into a sidebar item.

**Tech Stack:** React 19, TypeScript, TanStack Router and Query, openapi-fetch/openapi-typescript, existing Tailwind/UI primitives, Vitest and Testing Library, Vite mock API.

**Spec:** [faas-web issue #134](https://github.com/poyrazK/faas-web/issues/134). Investigation baselines: frontend `3a48e31e3bff16da27933fe724a58d4255c44b57`; backend `cbcdcbbb7adf0d7644c010a70da7f98cca4878d8`. Recheck both baselines before execution; API existence is not production qualification.

## Global Constraints

- Split workstreams into scoped implementation issues before coding; this task only prepares those scopes locally.
- `enabled` means account/runtime availability, not successful execution or fleet health.
- Keep unavailable actions disabled with customer-facing explanations. Do not make an operator environment-variable name the primary next action.
- Preserve existing app, Git deployment, import, Jobs, queue-message, and outbound-webhook workflows.
- Project/environment discovery is read-only initially. Do not expose clone, promotion, rollback, GitOps enforcement, or deployment-attached manual-task execution without separate qualification.
- Do not advertise complete clones or complete GitOps enforcement. ADR-590 is proposed; GitOps documents incomplete activation/enforcement.
- Internal/unlaunched Commit, Customer Operations, customer-aware flags, and exclusive operations are outside this backlog.
- Do not test discovery by deleting real apps, sending provider events, invoking customer handlers, or changing production configuration.
- Use the API's actual ownership/scopes, session MFA, origin checks, and action-specific CSRF contracts. Never store an account API key in the browser to bypass a missing integration.
- Never cache one-time credentials in TanStack Query, URLs, local/session storage, logs, analytics, or mock snapshots containing real secrets.
- Keep this work separate from cost forecasting (#111), documentation coverage (#93), and installation onboarding (#120); link/update those scopes rather than duplicating them.

## Review Focus

1. Scale account + unavailable runtime, failed registry, or missing capability: never show enabled controls or an upgrade as a guaranteed fix. Owned by A.
2. Account/project/environment change during a pending read: never display another context's data or submit a production mutation from a staging view. Owned by A, C, D, H.
3. App creation succeeds but image deployment fails or its response is lost: keep the app and recover without duplicate app/deployment creation. Owned by B.
4. One-time webhook URL/token and nullable allowlists: no later credential reveal; distinguish omitted, null, and empty lists. Owned by F, G, H.
5. Accepted configuration versus observed runtime state: no false ready/healthy/applied result for old PR heads, stale consumers, absent telemetry, or pending purge. Owned by D, E, I, J, L.

## Analysis: what is actually missing

The root problem is **contract and journey coverage**, not merely styling or missing buttons. The console has several pieces already, but does not connect them into complete journeys. Its vendored API contract also predates many public operations.

| Area               | Existing frontend                                                                    | Verified backend contract                                                  | Practical consequence                                                            |
| ------------------ | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Availability       | `src/lib/plan.ts` paid-plan helpers                                                  | `GET /v1/capabilities`, `CapabilitiesResponse`, stable unavailable reasons | Plan checks alone cannot explain runtime-off features or preview maturity.       |
| Projects           | `useProjectScan` / `useProjectApply`, archive import                                 | Account project inventory/detail, environment registry/state/diff          | Importing a project is not managing an existing project.                         |
| OCI app deployment | Wizard sources `git`, `empty`, `template`, `import`; app-scoped registry credentials | JSON `POST /v1/apps/{slug}/deployments` with digest-pinned `image`         | The “App — Your own container image” label does not offer image deployment.      |
| Inbound webhooks   | App Webhooks sends outbound Gregale notifications                                    | Provider endpoint CRUD, automation binding, receipt lookup                 | Existing Webhooks is the opposite direction of integration.                      |
| Issues             | `errors-body.tsx` HTTP fingerprint groups                                            | Instrumented Issues, reporting tokens, lifecycle/ownership/evidence        | Existing error groups cannot substitute for durable Issues.                      |
| Private services   | URL authentication, upstreams, egress                                                | Visibility, service targets/policies/caller grants, binding inventory      | Public URL authentication is not private visibility or service authorization.    |
| Workers            | Queue-message controls, OCI batch/recurring Jobs, physical Instances                 | Worker lifecycle, queue bindings/status, queue-depth scaling               | Three different meanings of “worker” need distinct journeys.                     |
| Cache              | Purge hook; `EdgeRuleCacheAction` schema                                             | Cache edge rules and durable purge convergence                             | A purge action is not a cache policy editor.                                     |
| Operations         | Unused `useRestoreApp`; blanket “next wake” copy                                     | Restore, component policy status, specialized docs/contracts               | Saved settings and unavailable evidence are currently described too confidently. |

### Important findings beyond the issue summary

- Direct JSON OCI deployments require `repository@sha256:<64 lowercase hex characters>`; backend `createDeployment` rejects tags. Do not present `:latest` as accepted input or invent a browser image-resolution API.
- Registry credentials are app-scoped. A new app has no existing credential inventory. The new-app journey must create the app before saving credentials; existing-app deployment can reuse that app's configured registry metadata. The server seals submitted credentials.
- `DeploymentProgress` currently requires Git `repo`/`sourceRef` and displays builder-specific submission text/logs. OCI deployments need source-neutral progress; they may have a deployment ID without a build ID.
- Projects are not a key in the capability registry. Do not invent a `projects` capability or gate project reads using unrelated paid-plan checks. Use their own permission/error contracts.
- Named environment state/diff can contain non-secret runtime variable values and safe secret metadata. They are MFA-gated; do not route them through a public overview or export secret material.
- The preview set endpoint is `GET /v1/preview/{rootSlug}/environment`. A legacy/developer preview can return 404 because no set was recorded; this is not equivalent to a failed current-head set.
- Inbound docs describe Stripe first, while the pinned OpenAPI also lists generic signed HMAC ingress. Start with the documented Stripe journey; qualify generic-provider behavior in its own scope before offering it.
- Automation receipts have a lookup by known provider event ID. The reviewed contract does not establish a browsable inbound receipt-list endpoint. Start with lookup and existing invocation links; file a backend scope if a full inbox is required.
- Issue REST mutations have deploy-write/MFA and trusted-origin protections. The server-rendered dashboard uses `issue_action` CSRF, but `/v1/auth/csrf` does **not** currently expose that action. Do not add an invented `issue_action` client call; verify REST-cookie integration or add a reviewed browser adapter if needed.
- `PgStore.ListApps` excludes deleted apps. The existing restore hook is not enough for an account-wide trash inventory; that inventory needs a backend contract.
- Open PR [#22](https://github.com/poyrazK/faas-web/pull/22) already contains cache-kind UI, API synchronization, import changes, preview teardown, and other overlapping controls. It is not merged at the investigation baseline. Reconcile it before implementing overlaps; do not merge or assume its historic verification remains current as part of this plan.

## Proposed console placement

| Capability                | Entry point                                                                              | Boundary                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Capability discovery      | Settings → Platform capabilities; contextual labels in New app, Data, and feature panels | A compact searchable list, not a dashboard full of feature cards.                      |
| Projects                  | Build → Projects; project detail with URL-backed environment selector                    | Selection is real project/environment identity, not the console-only workspace label.  |
| OCI HTTP app              | New app → Container image; app Delivery → Deploy image                                   | Same app/release journey as Git, without fake build steps.                             |
| PR workload set           | Project environment view and a preview app Overview link                                 | Current-head aggregate status plus member links.                                       |
| Inbound/outbound webhooks | App Automate → Webhooks, with Inbound / Outbound subviews                                | Preserve old URLs; existing links default to Outbound.                                 |
| Issues                    | App Observe → Issues, beside Errors                                                      | Errors remains automatic HTTP grouping; Issues is instrumented triage.                 |
| Internal services         | App Connect → Services; visibility in Configuration and creation review                  | Do not conflate internal services with external Upstreams or account private networks. |
| Queue workers             | New app → worker setup after HTTP-image work; app Automate → Queues → Consumers          | Jobs remain finite executions; sidebar Instances remains physical compute.             |
| Cache                     | App Connect → Edge rules → Cache; existing lifecycle purge control                       | Reuse the kind/action editor, not a new sidebar hub.                                   |
| Recovery                  | Apps → Recently deleted, when API is available                                           | Deadline and restore action, not guessed deleted inventory.                            |
| Policy application        | Configuration save result/status panel; cache purge result                               | Per-component state, not a universal “next wake” banner.                               |
| Companions/MCP/OpenAPI    | Existing Configure/Delivery/Connect contexts and explicit CLI/docs handoffs              | No fake diagnostic endpoint or implicit code execution.                                |

Use existing design tokens and components. This is a feature-coverage project, not a visual redesign. New detail views must support direct links, keyboard navigation, retained filters, and bounded tables/history.

## Delivery order and independently reviewable scopes

The letters below are proposed child-issue scopes, not GitHub issue numbers. Record each brief's API, entry point, maturity, permissions, availability, empty/error states, and blockers when creating the implementation issues.

| Scope | Deliverable                                                    | Depends on                   | Readiness                                                                     |
| ----- | -------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------- |
| A     | Capability-aware discovery + safe contract synchronization     | None; reconcile #22          | Public registry available; frontend integration missing.                      |
| B     | Digest-pinned OCI HTTP app creation/deployment                 | A                            | Public create/deploy/credentials APIs exist.                                  |
| C     | Project inventory, detail, workload membership                 | A contract sync              | Public account-scoped reads exist.                                            |
| D     | Named environment state/diff and recorded PR-set view          | C                            | Reads exist; no environment writes included.                                  |
| E     | Correct configuration convergence/status copy                  | A contract sync              | Public status endpoint exists; useful early correctness fix.                  |
| F     | Stripe inbound endpoints + automation binding + receipt lookup | A                            | APIs exist; inbox listing remains a possible backend addition.                |
| G     | Instrumented Issues setup, list/detail, triage                 | A                            | APIs exist; confirm browser authorization/protection behavior.                |
| H     | Private visibility and internal service bindings               | A, C/D for ownership context | Standalone mutations exist; project-owned fields are read-only.               |
| I     | Long-lived worker setup, binding status, scaling               | B, E                         | Lifecycle/binding APIs exist; distinguish pull workers from push handlers.    |
| J     | Cache policy and truthful purge result                         | A, E; reconcile #22          | Existing action type and backend API; UI overlap with #22.                    |
| K     | Deleted-app discovery and restore journey                      | A; backend inventory scope   | Restore exists; ordinary inventory excludes deleted apps.                     |
| L     | Companions, MCP and OpenAPI discovery/read views               | A, E                         | Mixed support; OpenAPI preview endpoint exists, MCP CLI is not a console API. |
| M     | Reviewed environment mutations and recovery                    | D plus backend qualification | Separate gated phase, not first-release scope.                                |

**Recommended first release: A → B + C → D, with E as a small separate correctness PR.** B and C are independent once A is merged; sequential execution is fine. Do not make the entire backlog one PR or block these useful journeys on complete environment cloning.

## First-release task plans

### A. Canonical availability and discovery

**Files:**

- Modify `api/openapi.yaml` and regenerate `src/lib/api/schema.d.ts` from a reviewed pinned backend contract; preserve existing admin/observability operations.
- Create `src/lib/api/capabilities.ts` for typed account-scoped reads.
- Create `src/lib/capability-state.ts` for presentation-state resolution; `src/lib/capability-entrypoints.ts` for verified console/docs targets.
- Create `src/components/dashboard/capability-notice.tsx` and `platform-capabilities.tsx`.
- Modify `src/routes/dashboard.settings.tsx`, `src/components/dashboard/settings-search.ts`, `src/components/dashboard/new-app-wizard.tsx`, `src/components/dashboard/object-storage.tsx`, and `src/routes/dashboard.storage.tsx` at their feature entry points.
- Tests: `src/lib/capability-state.test.ts`, `src/lib/api/capabilities.test.tsx`, `src/components/dashboard/platform-capabilities.test.tsx`, relevant existing storage/wizard tests.
- Mock support: `mock/data.ts`, `mock/plugin.ts`; verify routes in `src/mock-api.test.ts`.

**Interfaces:** Consume generated `CapabilitiesResponse` / `CapabilityStatus`, shared `api`/`unwrap`, authenticated account identity, and existing `retryPolicy`. Proposed exports:

```ts
export type Capability = components['schemas']['CapabilityStatus'];
export type CapabilityRegistry = components['schemas']['CapabilitiesResponse'];
export type CapabilityViewState =
  | 'loading'
  | 'registry-error'
  | 'unknown'
  | 'available'
  | 'plan-not-entitled'
  | 'runtime-unavailable';
export function useCapabilities(accountId: string);
export function capabilityViewState(
  capability: Capability | undefined,
  phase: 'loading' | 'error' | 'ready',
  plan: CapabilityRegistry['plan']
): CapabilityViewState;
```

Pin the resolution boundary with focused tests (imports use the modules above):

```ts
const capability: Capability = {
  key: 'object-storage',
  name: 'Private object storage',
  category: 'data',
  description: 'Private managed object buckets.',
  maturity: 'preview',
  plans: ['hobby', 'pro', 'scale'],
  docs_url: '/docs/object-storage',
  acceptance: 'provider-qualification',
  enabled: false,
};

it('does not offer an upgrade for a Scale runtime outage', () => {
  expect(
    capabilityViewState(
      {
        ...capability,
        unavailable_reason: 'runtime_unavailable',
      },
      'ready',
      'scale'
    )
  ).toBe('runtime-unavailable');
});
it('does not authorize from last-good data after a registry error', () => {
  expect(capabilityViewState({ ...capability, enabled: true }, 'error', 'scale')).toBe(
    'registry-error'
  );
});
it('does not invent availability when an entitled legacy server omits the reason', () => {
  expect(capabilityViewState(capability, 'ready', 'scale')).toBe('unknown');
});
it('can explain legacy plan denial without assuming a runtime is ready', () => {
  expect(capabilityViewState(capability, 'ready', 'free')).toBe('plan-not-entitled');
});
```

- [ ] Compare pinned upstream operations/schemas against the vendored contract and PR #22. Synchronize without deleting console-only/admin declarations; let regeneration expose request/fixture drift rather than adding broad type casts.
- [ ] Add the registry read with query key `['account', accountId, 'capabilities']`, disabled without account identity; use shared retry policy. Invalidate/refetch after plan/account changes and prevent stale data authorizing new gated operations during refetch failure.
- [ ] Implement the state resolver in this order: loading/error → missing key/internal capability unknown → enabled available → explicit unavailable reason → older-server fallback. Infer plan denial only if the registry's plan is absent from `plans`; otherwise an unexplained disabled state is unknown, never enabled.
- [ ] Keep maturity separate from availability. Available preview is “Preview · Available,” not “Healthy.” Runtime-unavailable is “Unavailable on this installation”; plan denial links to plans; unknown/registry-error offers Retry and docs, not a fabricated upgrade.
- [ ] Map returned known keys to verified console targets or explicit CLI/docs instructions. Permit only safe relative docs paths or approved HTTPS documentation origins; verify the local docs route exists against `src/lib/docs-manifest.ts`. Link documentation coverage gaps to #93. Unknown future keys can show safe documentation but must not invent navigation or writes.
- [ ] Add contextual gating to object storage, disposable-run discovery, and the new OCI source. Keep the existing Git/empty/template/import console usable during registry outages; do not replace every unrelated numeric quota/permission check with registry state.
- [ ] Exercise Free denial, Scale runtime-off, preview enabled, omitted reason, absent key, 401, 429/503, refetch error with last-good data, and account change while the first response is delayed. Assert no unavailable operation is submitted.
- [ ] Commit contract synchronization separately from state/client and UI integration, then ship one bounded PR.

**Acceptance:** An unavailable Scale feature is explained without an upgrade promise; a registry outage is not “no features”; enabled features have a working destination or honest handoff; internal features stay out of customer discovery.

### B. Complete OCI HTTP app journey

**Files:**

- Modify `src/components/dashboard/new-app-source.ts`, `new-app-validation.ts`, `new-app-wizard.tsx`, and `deployment-progress.tsx`.
- Create `src/lib/api/image-deployments.ts`, `src/lib/oci-image.ts`, and `src/components/dashboard/image-deploy-form.tsx`.
- Modify `src/components/dashboard/app-core-panels.tsx` to extract/reuse credential-entry behavior without changing saved credential handling.
- Modify `src/routes/dashboard.workflows.$workflowId.tsx` to offer Deploy image in Delivery.
- Tests: existing source/validation/wizard tests; new `src/lib/oci-image.test.ts`, `src/lib/api/image-deployments.test.tsx`, `src/components/dashboard/image-deploy-form.test.tsx`; extend progress tests in the existing suite or add `deployment-progress.test.tsx`.

**Interfaces:** Add `container` to `AppSource` and search validation. Use generated `CreateAppRequest`, `CreateDeploymentRequest`, `DeploymentResponse`, and registry-credential metadata. Proposed progress source contract:

```ts
export type DeploymentSource =
  { kind: 'git'; repo: string; ref: string } | { kind: 'image'; reference: string };
export function isDigestPinnedImage(reference: string): boolean;
export function useDeployImage(slug: string);
// Mutation input:
// { request: CreateDeploymentRequest; idempotencyKey: string }
```

- [ ] Add Container image as a source; explain Linux/amd64, stateless ephemeral disk, `0.0.0.0:$PORT`, unsupported host mounts/privileged behavior, and digest pinning. Do not require GitHub connection.
- [ ] Validate obvious reference errors using the backend's digest grammar; accept registry ports, reject tags, uppercase/short digests, whitespace/control characters, and malformed separators. Server validation remains authoritative.
- [ ] Default to image process/port/readiness metadata. Expose optional port and health path under advanced settings; do not invent `/healthz`. For Free self-contained images explain the explicit `full_rootfs_allow_auto` opt-in instead of claiming every image works by default.
- [ ] For a new app: review source/configuration → create `type: app` → optionally save that app's registry credential → submit JSON image deployment. For an existing app: read that app's registry metadata and reuse its credentials, or add/replace a matching registry credential explicitly. Do not show another app's credentials as selectable account credentials.
- [ ] Allocate separate explicit Idempotency-Keys for app creation and image submission. Before app creation, persist an account-scoped pending-operation record containing the creation key, submitted slug, non-secret creation settings, and stage; freeze that request identity until its result is resolved. The current client middleware generates a new key for every new POST request, so its default is insufficient for recovery. Never persist registry credentials or secret overrides in this record.
- [ ] If app creation commits but its response is lost, offer retry of the unchanged request with the original creation key; within the backend replay window this returns the original app rather than a slug conflict. Save the returned app identity before advancing to credentials/deployment. If the receipt is unavailable or the retry returns a conflict, show an unresolved outcome and explicit inspection/resume options; never silently adopt an unrelated same-slug app or create a renamed replacement. Changing the requested configuration must not silently abandon an unresolved creation.
- [ ] For an ambiguous image-submission response, distinguish outcome reconciliation from starting another attempt. Preserve an accepted deployment ID immediately and read its status before any new submission. The backend's `idempotentDeploy` can execute again with the same key once the original deployment failed, was cancelled, or was superseded; a stable key is not an unconditional exactly-once guarantee. If no accepted ID was received, reconcile account-owned app release history using available request/artifact evidence; if identity remains ambiguous, require inspection and an explicit new-attempt confirmation instead of automatic POST retry. A deliberate changed payload or execution retry starts a separately reviewed attempt.
- [ ] Preserve the created app ID/slug and accepted deployment ID through failures; never auto-delete the app. Retry credential/deployment stages without re-creating it. On reload, resume from the account-scoped pending record and non-secret app/deployment identifiers, checking the current account before fetching or resuming. Never save credentials or secret overrides; clear completed recovery records and enforce the backend receipt window.
- [ ] Refactor progress around `DeploymentSource`. OCI copy says image preparation, not source build; start build-log streaming only when supported evidence exists. A 202, successful image pull, or registry `enabled` state does not mean Live. Link to the exact accepted release; show runtime/server failures and unavailable status separately.
- [ ] Test public/private image, credential-save failure, create-success/deploy-failure, creation commit followed by a dropped response and original-key replay, reload before an app ID is received, expired creation receipt/slug conflict, account switching, and an unresolved request followed by attempted name/configuration change. Also test ambiguous image submission while in progress versus failed/cancelled/superseded, no-ID ambiguous history, accepted ID recovery, no GitHub installation, Free fallback opt-in, quota/403/422/429, and no-build-ID OCI progress. Assert no automatic new attempt after a terminal deployment and verify existing Git/Empty/Template/Import paths remain intact.
- [ ] Commit source validation, typed deployment mutation, wizard integration, and source-neutral progress as separate logical commits; open a bounded PR.

**Acceptance:** A developer can deploy a compatible digest-pinned HTTP image without using Jobs or leaving the console, and recover a failed submission without duplicate resources.

### C. Project inventory and detail

**Files:**

- Create `src/lib/api/projects.ts`, `src/routes/dashboard.projects.tsx`, `dashboard.projects.index.tsx`, and `dashboard.projects.$projectSlug.tsx` using TanStack nested route conventions.
- Create `src/components/dashboard/projects/project-workloads.tsx`.
- Modify `src/components/dashboard/nav-config.ts`, `command-palette.tsx` only where required by its navigation/resource model, and `project-import.tsx` for a successful-import detail link.
- Modify existing import query invalidation in `src/lib/api/queries.ts`; regenerate `src/routeTree.gen.ts` with the router plugin, never hand-edit it.
- Tests: `src/lib/api/projects.test.tsx`, `src/routes/-dashboard.projects.test.tsx`, existing navigation/palette/import suites.

**Interfaces:** Generated `ProjectSummaryResponse[]` and `ProjectResponse`. Proposed hooks `useProjects(accountId: string)` and `useProject(accountId: string, slug: string)`; cache identities include account and project slug. Existing import stays a separate mutation interface.

- [ ] Add GET `/v1/projects` and GET `/v1/projects/{slug}` through the shared typed client, using the existing settled-4xx retry policy.
- [ ] Add Build → Projects without moving/removing Apps or Jobs. Show bounded inventory with repository, production branch, workload count and updated time; empty state links to the existing import journey, not an unsupported empty-project create call.
- [ ] Show workload membership and actual latest build/deployment/rollout states, with links to existing app/release views. Missing status is Unknown, not Ready. Use a compact dependency list when evidence exists; do not invent graph edges from names or visual proximity.
- [ ] Link completed import to the returned project and invalidate its inventory. Check the existing multipart serializer delivers the actual FormData: PR #22 reports a `body: undefined` issue. Adopt a focused verified fix if still present, rather than blindly restoring that old implementation.
- [ ] Test two projects, empty inventory, no GitHub binding, project with zero workloads, partial status fields, account-scoped 404/403, import-to-detail navigation, palette/breadcrumb/active-sidebar behavior, and direct detail reload.
- [ ] Commit query/model, routes, and navigation/import integration separately.

**Acceptance:** Users can browse multiple durable projects and their existing workloads without re-importing, changing repository bindings, or deploying anything.

### D. Named environments and PR workload sets

**Files:**

- Extend `src/lib/api/projects.ts`; create `src/lib/api/preview-environments.ts`.
- Extend `src/routes/dashboard.projects.$projectSlug.tsx` with validated `environment` and comparison search parameters.
- Create `src/components/dashboard/projects/environment-selector.tsx`, `environment-state.tsx`, `environment-diff.tsx`, `preview-workload-set.tsx`.
- Modify `src/routes/dashboard.workflows.$workflowId.tsx` for preview discovery links backed by actual preview metadata.
- Tests: extend project API/route tests; add `src/components/dashboard/projects/environment-diff.test.tsx`, `preview-workload-set.test.tsx`.

**Interfaces:** GET project environments and environment detail; GET `.../{environment}/state`; GET `.../{target}/diff?from={source}`; GET `/v1/preview/{rootSlug}/environment`. Use generated response types, not reconstructed client comparisons. Keys include account, project, target environment, and comparison source.

- [ ] Populate the selector from durable environment inventory. Select the registered production environment where available; show “No environments” if empty. Do not silently map invalid/deleted environment URLs to production or equate reserved legacy scope `default` with a named environment.
- [ ] Render effective state with `generated_at`, selected live artifacts, active release graph versus per-workload live deployment, runtime variables, safe secret metadata, binding ownership and explicitly shared resources. No write actions in this context.
- [ ] Render backend diff by category. Preserve `unknown`, `version_drift`, credential generation/ownership and shared-scope distinctions. Equality requires evidence; no plaintext/ciphertext or sealing-key display/export.
- [ ] Discover PR previews from returned `preview_of_slug`, `preview_pr_number`, state and expiry, not a `pr-` slug guess. On an explicitly selected preview, use the recorded-set endpoint and its authoritative root identity. Deduplicate sets; avoid polling every app on each dashboard render.
- [ ] Display current commit, aggregate ready/phase, expected members, missing/failed members, expiry, parent/PR identity, returned links and non-secret production changes. Older-commit Live is not current-head readiness; preview-safe production dependencies are not an isolated clone.
- [ ] A 404 for an unrecorded preview shows app-level information with “Workload set unavailable,” not fabricated whole-environment readiness. If root discovery is insufficient for a complete project PR-set inventory, define a narrow backend index addition rather than parsing slugs.
- [ ] Test quick environment switching with delayed responses, invalid URL target, missing fingerprint, shared policy, no release graph, two PRs with the same SHA, missing sibling, older head, closed set, unknown legacy preview, and backend-provided links. Stop polling terminal/closed sets and refetch appropriately on page visibility.
- [ ] Commit named-environment reads, state/diff UI, and PR-set UI separately.

**Acceptance:** The console explains what each environment actually contains and whether the whole recorded PR workload set is ready, without implying clone completeness or mutating production.

### E. Truthful configuration and purge convergence

**Files:** Create `src/lib/api/runtime-policy.ts` and `src/components/dashboard/policy-status.tsx`; modify `app-configuration.tsx`, `app-lifecycle.tsx`; tests in `src/lib/api/runtime-policy.test.tsx`, `policy-status.test.tsx`, existing configuration/lifecycle suites.

**Interfaces:** GET `/v1/apps/{slug}/policy/status`, generated `RuntimePolicyStatusResponse`; optional bounded `wait` at most 10s. Consumers must read named components, not interpret the top-level gateway projection as universal state.

- [ ] Replace blanket next-wake copy with field/component-specific effects. Request policy, edge rules/CORS, egress, CPU allowance and scaling can converge live; environment/entrypoint, memory and topology can require replacement/wake.
- [ ] After relevant saves, read the component status and show Saved with Active/Pending/Unverified evidence. A missing/stale observation is not applied; scheduler scaling acknowledgment does not mean replica target attainment.
- [ ] After cache DELETE 204, say “Purge requested.” Report “Applied” only from the relevant response-cache convergence evidence. Cover local and optional shared Redis caches; do not claim unrelated external/CDN caches were purged.
- [ ] Preserve desired revision and observed timestamps. Avoid associating an older response with a newer save; use bounded polling and retain an explicit pending state after timeout.
- [ ] Test mixed component states, stale fleet, no fleet, rapid successive saves, a purge still pending after 204, and scaling active while actual replicas remain below target. Commit status integration separately from copy changes.

## Subsequent implementation-issue briefs

These scopes require their own bounded implementation plans before execution; they are not hidden steps inside the first-release PRs.

### F. Stripe inbound webhook management

**API:** GET/POST `/v1/apps/{slug}/inbound-webhooks`; GET/PATCH/DELETE `.../{id}`; GET/PUT/DELETE `.../{id}/automation-binding`; GET `.../{id}/automation-receipts/{event_id}`. Ordinary deliveries link to existing invocation evidence.

**Files:** New `src/lib/api/inbound-webhooks.ts`, `src/components/dashboard/inbound-webhooks.tsx`, `webhook-automation-binding.tsx`, `webhook-receipt.tsx`; extend `dashboard.webhooks.tsx`, app-tab/search routing, mocks; focused API/component tests.

**Maturity/availability:** `durable-inbound-webhooks`, Preview, Hobby+. Binding also requires workflows availability and a published same-app automation.

**Permissions/states:** Use app-owned resource scopes and completed session MFA/origin protections; verify backend route wiring. Empty endpoint list starts setup; unavailable signing/sealing runtime is not invalid customer input; 404 receipt means not retained/found, not delivery success.

- [ ] Provide Stripe setup, password-style signing-secret entry, one-time URL copy and explicit acknowledgment before dismissing. Clear sensitive mutation state after completion; never promise URL retrieval or re-show a cached URL.
- [ ] Separate ingress Enabled from accepted delivery/run success. Explain disabling/deleting stops future ingress but does not cancel accepted queued deliveries.
- [ ] Review explicit `take_over_delivery: true` before binding; use `expected_version` for updates and removal; show 409 conflict and refresh without overwriting another user's binding.
- [ ] Offer known-event receipt lookup with run/invocation links. A full receipt inbox needs a backend list endpoint with filters/cursors and account ownership; do not fake one from local session history.
- [ ] Test one-time disclosure, reload/list without URL, redaction, disabled endpoint, unpublished/wrong-app automation, conflict, duplicate accepted event and queued/failed delivery. Keep generic HMAC provider out of the first Stripe PR until qualified.

### G. Instrumented Issues setup and triage

**API:** GET app `/issues` and `/issues/{issue_id}`; POST detail `/actions`; reporting token GET/POST and DELETE `/issue-ingest-tokens/{token_id}`; ownership-rule and impact-alert policy GET/PUT as separate follow-ups.

**Files:** New `src/lib/api/issues.ts`, `src/components/dashboard/issues-body.tsx`, `issue-detail.tsx`, `issue-reporting-setup.tsx`; modify app tab/search routing; scoped API/component tests and mocks.

**Maturity/availability:** `issues`, Preview, Hobby+. Reads use read-surface scopes; actions/token management require deploy-write and MFA. Confirm trusted-origin cookie integration; HTML CSRF actions cannot be assumed available through `issueCSRF`.

- [ ] Add Issues beside Errors, explain instrumentation, provide deployment-bound one-time reporting-token setup and verified SDK/OTLP guidance. Do not imply all exceptions are automatically collected.
- [ ] Implement bounded filterable inbox and independently paginated occurrences/releases/activity. Keep ordering/window/filter identity stable when passing opaque cursors; reset cursors on filter changes.
- [ ] Add assign/resolve-against-deployment/reopen/ignore with server-owned member/deployment options and authoritative audit result. Show recurrence, retained verified customer evidence and unattributed counts without inferring causation or complete coverage.
- [ ] Test permission/MFA denial, expired/revoked token, one-time disclosure, stale action/conflict, older-release event versus recurrence, missing retained evidence and independent detail cursors. Ownership-rule replacement and customer-impact alert editing are separate PRs, not first inbox scope.

### H. Private apps and internal services

**API:** App GET/PATCH/creation fields `visibility`, `allowed_service_callers`, `allowed_service_call_scopes`, `service_binding_targets`, `service_binding_policy`, `service_binding_transport`; GET `/v1/apps/{slug}/bindings` and returned service metadata.

**Files:** New `src/lib/api/bindings.ts`, `src/components/dashboard/service-bindings.tsx`, `app-visibility.tsx`; modify `app-configuration.tsx`, app-tab routing, creation review; contract/interaction tests.

**Maturity/availability:** `private-apps` and `internal-services`, Preview, all plans. Account private network fabric/peering and private transport rollout are independent availability/qualification boundaries.

- [ ] Show returned stable addresses and declared dependency/caller policies. Distinguish configured binding from observed verification; partial inventory is not complete health.
- [ ] Make standalone policy edits explicit and type-safe: omitted unchanged, target caller `null` restores account access, `[]` denies all; fields have different null semantics. Never use one generic null-to-empty adapter.
- [ ] Project-managed/preview dependency policies remain read-only with manifest handoff because standalone PATCH rejects those edits. Do not send production app PATCH from a selected environment's state view.
- [ ] Review loss of public reachability before public→internal; explain authenticated service routing, not a public-auth toggle. Return-address links must not imply a browser can open an internal endpoint.
- [ ] Test account isolation, missing targets, deny-all/reset distinctions, mixed project ownership, stale target list, denied callers and private transport unavailable. CLI verification can invoke probes; do not run it automatically while rendering inventory.

### I. Long-lived queue workers

**API:** App lifecycle creation/PATCH; OCI deployment; production PUT `/queue-workload`; queue-binding CRUD and GET `.../{id}/status`; existing scaling-policy API. Stage desired queue bindings use the project environment workload endpoint, not production `/queue-bindings` with a stage query.

**Files:** New `src/lib/api/queue-bindings.ts`, `src/components/dashboard/worker-setup.tsx`, `queue-consumers.tsx`; extend image/source wizard and `dashboard.queues.tsx`; lifecycle/binding/scaling tests.

**Maturity/availability:** `worker-pools`, Preview, Hobby+. Do not alter the physical Instances page's meaning or treat finite Jobs as long-lived worker apps.

- [ ] Create a non-HTTP OCI worker using `execution_mode: worker`, reviewed restart policy, startup deadline/retries and queue-depth scaling. Do not apply the HTTP image listener/readiness form to it.
- [ ] Select pull versus platform push semantics explicitly. The simple `/queue-workload` profile reconciles a default push consumer; it is not automatically the right configuration for every non-HTTP pull worker.
- [ ] Read binding-scoped consumer state and liveness separately. A saved active binding with stale/absent polling is not a healthy worker; pull bindings have external liveness.
- [ ] Explain lifetime/compute behavior and replay effects. Stage desired settings and stage execution qualification must remain distinct.
- [ ] Test Free denial, no HTTP port, conflicting existing default binding, explicit replacement consent, stale push poll, external pull state, paused consumer, restart limits, and production/stage separation.

### J. Cache rules and durable purge

**API:** Existing edge-rule create/update/delete with `EdgeRuleCacheAction`; DELETE app `/cache` with mutually exclusive `path`/`tag`; GET `/policy/status` response-cache component.

**Files:** Modify `src/components/dashboard/edge-rules/kinds.tsx`, `dialog.tsx`, `src/routes/dashboard.edge-rules.tsx`, `app-lifecycle.tsx`, purge hook; extend kind/form/lifecycle/API tests. Reconcile #22's cache implementation before changing these files.

**Maturity/availability:** `declarative-response-caching`, Preview, Hobby+. Existing edge-rule write scopes and session protections; gate cache specifically, not unrelated rule kinds.

- [ ] Add Cache to kind/action mapping and request unions after contract sync. Expose GET/HEAD matching, freshness, SWR, SIE, and only supported vary headers `Accept-Language`/`Accept-Encoding`.
- [ ] Explain Authorization/cookie request bypass and Set-Cookie/private/no-store response safety. Do not claim the rule caches authenticated customer data.
- [ ] Reuse E's purge status, support path/tag exclusive selection if included, and distinguish durably recorded from fully applied. Test unsupported method/header, numeric bounds, gate denial, persistence and pending shared-tier invalidation.

### K. Recovery inventory and restore

**API:** Existing POST `/v1/apps/{slug}/restore`; backend child scope for an account-owned deleted-app inventory with slug, deletion timestamp, authoritative restore deadline and eligibility/reason. Current GET `/v1/apps` excludes deleted rows.

**Files:** New `src/components/dashboard/deleted-apps.tsx`; extend Apps inventory/navigation and typed API module only after backend contract exists; reuse `useRestoreApp` and extend its invalidation as required.

- [ ] Define a bounded inventory contract that preserves IDOR-safe account access and distinguishes grace expiry from temporary capacity/quota failure. Do not guess deadlines solely from a browser clock or fabricate inventory from audit messages.
- [ ] Add Recently deleted with reviewed restore, quota/collision/server-error behavior and seven-day-grace explanation grounded in the returned deadline. On restore invalidate app/project/deployment inventories that actually changed.
- [ ] Test fixture deleted apps only: within grace, expired, account mismatch, quota reached, slug conflict, and recoverable server failure. Until inventory exists, an explicit slug-based restore form may ship as a clearly limited separate scope.

### L. Specialized discovery: companions, MCP, OpenAPI

**API:** Companion declarations in deployment/manifest metadata and only supported returned health evidence; MCP ordinary HTTP/streaming apps plus CLI diagnostics; GET app `/openapi/preview` for declared/observed route-policy comparison.

**Files:** New `src/components/dashboard/companions-summary.tsx`, `mcp-guidance.tsx`; new `src/lib/api/openapi-preview.ts`; extend `dashboard.openapi.tsx`, app configuration/delivery views, docs manifest only for published content; focused evidence-state tests.

- [ ] Companions: show configured resources separately from observed health. Support accurate manifest/CLI handoff; unavailable preset is a qualification problem, not proof every custom helper fails.
- [ ] MCP: provide client configuration/auth/catalog guidance and explicit CLI commands. `mcp doctor`, verified catalog and guarded zero-traffic deployment checks are not existing control-plane endpoints. A browser-safe diagnostic API requires bounded execution, credentials handling, origin/SSRF protections and qualification before an interactive console diagnostic.
- [ ] OpenAPI: use the existing read-only preview endpoint for matched/declared-only/observed-only routes and enabled matching edge policies. Show degraded partial scrape and unavailable observation distinctly from healthy zero-traffic empty observations; policy coverage does not prove correctness.
- [ ] Test missing companion health/preset, streaming-unavailable MCP account, no published docs target, partial/unavailable route collectors, absent declaration and enabled/disabled rule matching. Split these three capabilities into independent implementation issues/PRs.

### M. Qualified environment mutations

**API:** Existing environment/config/qualification/approval/promotion-preview/promote/status/rollback contracts, plus resource preparation/clone operations only where qualified.

**Entry point:** Project environment details; disabled/explicitly limited until qualification is recorded. No first-release Create clone/Promote/Enforce GitOps buttons.

- [ ] Read the current backend contracts and qualification evidence afresh; preserve exact source revision, target generation, hashes, qualification receipt, approval identity and logical-operation idempotency. Rejected stale plans must require a new preview/review, not automatic silent resubmission.
- [ ] Explain shared resources, isolated versus shared managed data, unsupported fields, target-specific credentials and ownership before any operation. Partial release-only behavior is labeled partial, never “complete clone.”
- [ ] Add resumable progress and recovery from durable operation receipts before exposing destructive controls. A timeout/disconnect is not permission to restart an operation or roll back blindly.
- [ ] Test concurrent target edits, expired approval, changed source after qualification, lost response, provider preparation failure, partial application and fenced rollback in isolated staging. Serving-state receipts, not accepted intent, determine success.

## Verification and release gates

- [ ] Before each implementation scope: re-read its child issue, pinned API/docs, current main and open overlapping PRs. Resolve contract/type drift before building UI.
- [ ] Use focused behavioral tests from the owning scope, not snapshots that merely mirror markup. Cover enabled, plan-denied, runtime-unavailable, permission/MFA-denied, empty and failed-read states for every gated journey.
- [ ] Run `npm run typecheck`, focused `npm run test -- <test paths>`, `npm run lint`, and formatting checks. At each PR boundary run `npm run check` and `npm run build`; inspect unrelated failures rather than suppressing them. In this WSL workspace with Windows Node, invoke npm through `cmd.exe /d /s /c` from the matching worktree when required.
- [ ] Mock walkthrough: direct-link and browser Back/Forward, small screen and keyboard, long lists, delayed reads, account/environment switch, one-time disclosure, and failure recovery. Assert that read-only pages submit no POST/PATCH/PUT/DELETE.
- [ ] With separate authorization, run bounded staging workflows using disposable test resources; UI mocks and a Scale registry are not evidence of runtime qualification. Never mutate production to check a plan.
- [ ] Keep commits scoped: contract/client, behavior, and route/UI integration where independently meaningful. Do not split generated schema artifacts away from their contract or leave deliberately broken intermediate commits.
- [ ] Update #134's checklist with delivered child-issue/PR links only after each scope passes its gate. Close #134 only when every gap is delivered or explicitly deferred with a linked blocker and honest discovery handoff.

## Definition of done for the first release

1. Registry-backed availability is visible, with truthful reasons and verified destinations.
2. Compatible digest-pinned HTTP images can be deployed and recovered through the console.
3. Existing projects and named environments can be browsed and compared without mutation.
4. Recorded PR sets show readiness for the current head, not just one app's deployment.
5. Configuration/purge feedback separates accepted changes from observed application.
6. Existing app, Git/import, Jobs and sidebar workflows pass regression checks.

This document plans future product work. Its documentation PR does not implement console features, create child issues, or mutate deployed workloads; those actions remain separate approved work.
