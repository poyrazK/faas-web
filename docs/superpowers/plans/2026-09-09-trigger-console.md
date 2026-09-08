# Trigger Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn PR #57 into a plan-aware Trigger console with a progressive creation flow, URL-addressable operations detail, safe credential editing, and complete create/update/delete recovery behavior.

**Architecture:** Treat the backend account snapshot and generated OpenAPI types as the capability contract. Keep request shaping and validation in a pure discriminated form model, source/delivery inputs in focused components, and route components responsible only for loading states and navigation. The list, create, and detail URLs become separate file routes; the development mock consumes the same plan fixture and redacts write-only values.

**Tech Stack:** React 19, TypeScript, Vite 6, TanStack Router and Query, `openapi-fetch`, Vitest, React Testing Library, `@testing-library/user-event`, Tailwind design tokens.

**Spec:** [`docs/superpowers/specs/2026-09-09-trigger-console-contract-design.md`](../specs/2026-09-09-trigger-console-contract-design.md)

**Backend prerequisite:** Complete [`docs/superpowers/plans/2026-09-09-trigger-backend-contract.md`](./2026-09-09-trigger-backend-contract.md), then copy its final `api/openapi.yaml` into this repository before Task 1.

## Global Constraints

- Execute frontend commands in `/home/bahadir/GREGALE/.worktrees/faas-web-trigger-fix`, branch `feat/trigger-create`; do not modify `/home/bahadir/GREGALE/faas-web`.
- Start from PR #57 plus approved design commit `2d9ff9a`; preserve the PR's working record/DLQ components unless a test proves a change is necessary.
- Never hand-edit `src/lib/api/schema.d.ts` or `src/routeTree.gen.ts`.
- Branch on `ApiError.code`, including `plan_triggers_not_allowed`, `trigger_kind_not_allowed`, `plan_trigger_quota`, `trigger_batch_window_too_large`, `trigger_tls_skip_verify_not_allowed`, `trigger_invalid_config`, and `secret_store_unavailable`.
- Read allowed kinds and numerical ceilings from `account.limits`; do not derive them from `account.plan` in production UI code.
- Emit Kafka SASL values only as `PLAIN`, `SCRAM-SHA-256`, or `SCRAM-SHA-512`.
- Secret inputs are write-only, use password controls, clear after successful writes, and never render returned ciphertext.
- The UI says configuration shape was validated; it does not claim that broker connectivity was tested.
- Use design tokens only; do not add literal hex colors or `dark:` variants.
- Loading, unreachable, error, Free-plan, no-app, and empty-trigger states remain distinct.
- Tests live beside implementation as `*.test.ts(x)` and every task is test-first.
- Run `npm run build` before the final `npm run check` because `src/prerender.test.ts` reads `dist/index.html`.
- Use conventional commits without attribution lines.

## File Map

| File | Responsibility |
| --- | --- |
| `api/openapi.yaml` | Vendored backend contract consumed by type generation. |
| `src/lib/api/schema.d.ts` | Generated API types. |
| `src/lib/api/queries.ts` | Trigger query keys plus create/update/delete/pause/resume hooks and invalidation. |
| `src/lib/api/queries.test.tsx` | New mutation request and trigger-family invalidation behavior. |
| `src/components/dashboard/trigger-form-model.ts` | Pure plan defaults, discriminated source state, validation, create/update request shaping, and redacted-config normalization. |
| `src/components/dashboard/trigger-form-model.test.ts` | Plan, SASL, TLS, filter, secret, and request-shape boundary tests. |
| `src/components/dashboard/trigger-source-fields.tsx` | Kind-specific broker and Kafka TLS/SASL inputs. |
| `src/components/dashboard/trigger-source-fields.test.tsx` | Source-switching, advanced security, and accessibility tests. |
| `src/components/dashboard/trigger-delivery-fields.tsx` | Batch, retry, payload, poison, enabled, and filter inputs constrained by plan caps. |
| `src/components/dashboard/trigger-delivery-fields.test.tsx` | Cap labels, input bounds, filter errors, and Kafka-only poison behavior. |
| `src/components/dashboard/trigger-create.tsx` | Three-step orchestration, typed error recovery, submit, secret clearing, and success navigation. |
| `src/components/dashboard/trigger-create.test.tsx` | Free/no-app states, step behavior, payload, error mappings, and navigation. |
| `src/components/dashboard/trigger-detail.tsx` | Operational detail, handler contract, redacted config, edit/rotate, pause/resume, and delete. |
| `src/components/dashboard/trigger-detail.test.tsx` | Detail projection, update, redaction, confirmation, invalidation, and navigation. |
| `src/routes/dashboard.triggers.index.tsx` | Account-wide trigger list, filters, CTA, row status, and URL links. |
| `src/routes/dashboard.triggers.index.test.tsx` | List states, filters, row actions, and route links. |
| `src/routes/dashboard.triggers.new.tsx` | Account/limits/apps loading boundary around the create flow. |
| `src/routes/dashboard.triggers.$triggerId.tsx` | URL parameter composition around trigger detail. |
| `src/routes/dashboard.triggers.tsx` | Removed after its list responsibility moves to the `.index` route. |
| `src/test/router.tsx` | Test router leaves for trigger, plan, cron, and app-creation links. |
| `mock/trigger-contract.ts` | Dev-server plan capability matrix and trigger defaults. |
| `mock/trigger-contract.test.ts` | Fixture checks against the vendored OpenAPI vocabulary. |
| `mock/data.ts` | Account fixture with complete trigger capabilities. |
| `mock/plugin.ts` | Plan-aware/redacted GET/POST/PATCH/DELETE trigger behavior. |
| `src/lib/mock-spec-drift.test.ts` | Confirms the new mock PATCH route still exists in OpenAPI. |

---

### Task 1: Consume the corrected backend contract

**Files:**

- Modify: `api/openapi.yaml`
- Generate: `src/lib/api/schema.d.ts`
- Modify: `mock/data.ts`
- Modify: `src/components/dashboard/plan-gated.tsx`
- Modify: `src/components/dashboard/plan-gated.test.tsx`

**Interfaces:**

- Consumes: `AccountResponse.limits.trigger_kinds` and the eight trigger capability scalars from the backend plan.
- Consumes: response config markers `password_set` and `client_key_set` as opaque config properties.
- Fixes the existing plan gate code to `plan_triggers_not_allowed`.

- [ ] **Step 1: Add the failing plan-gate regression**

In `plan-gated.test.tsx`, construct `new ApiError({status: 402, code: 'plan_triggers_not_allowed', title: 'Upgrade'})` and assert `isPlanGate` returns true. Assert the obsolete `triggers_not_allowed` code returns false so mock/spec drift cannot hide the production code again.

- [ ] **Step 2: Run the focused test and confirm the existing code misses the production error**

```bash
npm test -- src/components/dashboard/plan-gated.test.tsx
```

Expected: FAIL for `plan_triggers_not_allowed`.

- [ ] **Step 3: Copy and generate the API contract**

```bash
cp /home/bahadir/GREGALE/.worktrees/faas-trigger-contract/api/openapi.yaml api/openapi.yaml
npm run api:types
```

Do not modify the generated declaration manually.

- [ ] **Step 4: Update the account fixture and plan gate**

Populate the mock Pro account with `triggers_allowed: true`, all five kinds, limits `10/50/500/300000/10/6291456`, and `trigger_tls_skip_verify_allowed: true`. Replace only the obsolete trigger code in `PLAN_GATE_CODES`.

- [ ] **Step 5: Verify and commit the contract sync**

```bash
npx prettier --write mock/data.ts src/components/dashboard/plan-gated.tsx src/components/dashboard/plan-gated.test.tsx
npm test -- src/components/dashboard/plan-gated.test.tsx src/lib/mock-spec-drift.test.ts
npm run typecheck
git add api/openapi.yaml src/lib/api/schema.d.ts mock/data.ts src/components/dashboard/plan-gated.tsx src/components/dashboard/plan-gated.test.tsx
git commit -m "fix(console): consume trigger capability contract"
```

Expected: focused tests and typecheck PASS.

---

### Task 2: Create the pure plan-aware trigger form model

**Files:**

- Create: `src/components/dashboard/trigger-form-model.ts`
- Create: `src/components/dashboard/trigger-form-model.test.ts`
- Modify: `src/components/dashboard/trigger-create.tsx`

**Interfaces:**

- Produces: `BrokerKind = 'kafka' | 'nats' | 'redis_streams' | 'sqs_compat' | 'queue'`.
- Produces: `TriggerLimits = Account['limits']` and `allowedBrokerKinds(limits): BrokerKind[]`.
- Produces: discriminated `TriggerSourceDraft` variants with exact source fields.
- Produces: `TriggerDeliveryDraft` and `TriggerDraft`.
- Produces: `newTriggerDraft(limits, appId): TriggerDraft`.
- Produces: `validateTriggerDraft(draft): Record<string, string>`.
- Produces: `buildCreateTriggerRequest(draft): components['schemas']['CreateTriggerRequest']`.
- Produces: `buildUpdateTriggerRequest(draft, original): components['schemas']['UpdateTriggerRequest']`.
- Produces: `draftFromTrigger(trigger, limits): TriggerDraft` with blank secret values and preserved `passwordSet`/`clientKeySet` markers.
- Produces: `clearTriggerSecrets(draft): TriggerDraft`.

- [ ] **Step 1: Write failing model tests for plan defaults and source vocabulary**

Create tests using typed Hobby and Pro limits:

```ts
it('uses the account snapshot for Hobby kinds and defaults', () => {
  const hobbyLimits = {
    triggers_allowed: true,
    trigger_kinds: ['sqs_compat', 'queue'],
    trigger_batch_size_max: 50,
    trigger_batch_window_max_ms: 30_000,
    trigger_max_attempts_max: 3,
    trigger_payload_max_bytes: 1_048_576,
    trigger_tls_skip_verify_allowed: false,
  } as TriggerLimits;
  const draft = newTriggerDraft(hobbyLimits, 'app-1');
  expect(allowedBrokerKinds(hobbyLimits)).toEqual(['sqs_compat', 'queue']);
  expect(draft.source.kind).toBe('sqs_compat');
  expect(draft.delivery).toMatchObject({
    batchSizeMax: 50,
    batchWindowMs: 1000,
    maxAttempts: 3,
    payloadMaxBytes: 1048576,
    enabled: true,
  });
});

it('emits the exact Kafka SASL vocabulary', () => {
  const proLimits = {
    triggers_allowed: true,
    trigger_kinds: ['kafka', 'nats', 'redis_streams', 'sqs_compat', 'queue'],
    trigger_batch_size_max: 500,
    trigger_batch_window_max_ms: 300_000,
    trigger_max_attempts_max: 10,
    trigger_payload_max_bytes: 6_291_456,
    trigger_tls_skip_verify_allowed: true,
  } as TriggerLimits;
  const draft = newTriggerDraft(proLimits, 'app-1');
  draft.source = {
    kind: 'kafka', brokers: 'b:9092', topic: 'orders', group: 'gregale',
    tlsEnabled: false, caCert: '', clientCert: '', clientKey: '', clientKeySet: false,
    skipVerify: false, saslEnabled: true, mechanism: 'SCRAM-SHA-256',
    username: 'svc', password: 'pw', passwordSet: false,
  };
  expect(buildCreateTriggerRequest(draft).config).toMatchObject({
    sasl: { mechanism: 'SCRAM-SHA-256', username: 'svc', password: 'pw' },
  });
});
```

Add tests for Free returning no kinds, Pro returning all five, TLS fields, mTLS half-pair validation, JSON filter parse errors, numeric caps, SQS number conversion, queue mode, secret-preserving update requests, credential rotation, and whole SASL/TLS block removal.

- [ ] **Step 2: Run the new test and verify the missing-module failure**

```bash
npm test -- src/components/dashboard/trigger-form-model.test.ts
```

Expected: FAIL because the model does not exist.

- [ ] **Step 3: Implement the discriminated model and plan-derived defaults**

Define source variants:

```ts
export type TriggerSourceDraft =
  | { kind: 'kafka'; brokers: string; topic: string; group: string; tlsEnabled: boolean; caCert: string; clientCert: string; clientKey: string; clientKeySet: boolean; skipVerify: boolean; saslEnabled: boolean; mechanism: 'PLAIN' | 'SCRAM-SHA-256' | 'SCRAM-SHA-512'; username: string; password: string; passwordSet: boolean }
  | { kind: 'nats'; url: string; stream: string; subject: string; durable: string }
  | { kind: 'redis_streams'; addr: string; stream: string; group: string }
  | { kind: 'sqs_compat'; queueUrl: string; longPollSecs: string }
  | { kind: 'queue'; mode: 'queue' | 'delayed_task' };
```

Clamp only initial values with `Math.min(platformDefault, limit)`. Validation must reject out-of-range edits rather than silently clamping. Parse `filterCriteriaText` to an object or omit it when blank.

- [ ] **Step 4: Move the old inline `validateConfig`/`buildConfig` logic behind the model**

Remove the lowercase SASL default and the per-kind form constants from `trigger-create.tsx`; leave the component compiling temporarily by importing model functions. Preserve the current tests until the new create-wizard task replaces them.

- [ ] **Step 5: Verify and commit the form model**

```bash
npx prettier --write src/components/dashboard/trigger-form-model.ts src/components/dashboard/trigger-form-model.test.ts src/components/dashboard/trigger-create.tsx
npm test -- src/components/dashboard/trigger-form-model.test.ts src/components/dashboard/trigger-create.test.tsx
npm run typecheck
git add src/components/dashboard/trigger-form-model.ts src/components/dashboard/trigger-form-model.test.ts src/components/dashboard/trigger-create.tsx
git commit -m "fix(console): model plan-safe trigger requests"
```

Expected: model and legacy create tests PASS; no lowercase SASL value remains under `src/`.

---

### Task 3: Build focused source and delivery field groups

**Files:**

- Create: `src/components/dashboard/trigger-source-fields.tsx`
- Create: `src/components/dashboard/trigger-source-fields.test.tsx`
- Create: `src/components/dashboard/trigger-delivery-fields.tsx`
- Create: `src/components/dashboard/trigger-delivery-fields.test.tsx`

**Interfaces:**

- Produces: `<TriggerSourceFields source errors limits onChange />`.
- Produces: `<TriggerDeliveryFields sourceKind delivery filterCriteriaText errors limits onDeliveryChange onFilterChange />`.
- Consumes: form model types and generated account-limit type.

- [ ] **Step 1: Write failing source-field interaction tests**

Render a controlled harness. Assert Kafka shows broker/topic/group and a collapsed “TLS and SASL” section; enabling TLS shows CA/cert/key and shows skip-verify only when `trigger_tls_skip_verify_allowed` is true; enabling SASL shows mechanism/username/password with password input type. Assert NATS, Redis, SQS, and Queue render only their own fields.

- [ ] **Step 2: Write failing delivery-field boundary tests**

Assert `max` attributes equal the account caps, `min` values are `1/10/1/1024`, poison strategy appears only for Kafka, enabled is labeled “Start consuming immediately,” and malformed filter JSON renders the supplied field error next to the editor.

- [ ] **Step 3: Run both tests and confirm missing components**

```bash
npm test -- src/components/dashboard/trigger-source-fields.test.tsx src/components/dashboard/trigger-delivery-fields.test.tsx
```

Expected: FAIL because both modules are absent.

- [ ] **Step 4: Implement accessible controlled field groups**

Use existing `FIELD`, `Select`, `Switch`, `FieldError`, `Button`, and `Panel` primitives. Every input gets a visible label, `aria-invalid` when its keyed error exists, and no secret default value. Advanced sections use native buttons with `aria-expanded`; no animation is required for correctness.

- [ ] **Step 5: Verify and commit the field components**

```bash
npx prettier --write src/components/dashboard/trigger-source-fields.tsx src/components/dashboard/trigger-source-fields.test.tsx src/components/dashboard/trigger-delivery-fields.tsx src/components/dashboard/trigger-delivery-fields.test.tsx
npm test -- src/components/dashboard/trigger-source-fields.test.tsx src/components/dashboard/trigger-delivery-fields.test.tsx
npm run typecheck
git add src/components/dashboard/trigger-source-fields.tsx src/components/dashboard/trigger-source-fields.test.tsx src/components/dashboard/trigger-delivery-fields.tsx src/components/dashboard/trigger-delivery-fields.test.tsx
git commit -m "feat(console): add trigger source and delivery fields"
```

Expected: interaction tests and typecheck PASS.

---

### Task 4: Replace inline creation with a three-step route

**Files:**

- Modify: `src/components/dashboard/trigger-create.tsx`
- Modify: `src/components/dashboard/trigger-create.test.tsx`
- Create: `src/routes/dashboard.triggers.new.tsx`
- Modify: `src/test/router.tsx`

**Interfaces:**

- `CreateTrigger` accepts `{ account: Account; apps: App[] }` and owns the three-step draft.
- Consumes: `newTriggerDraft`, `validateTriggerDraft`, `buildCreateTriggerRequest`, both field groups, `useCreateTrigger`, and router navigation.
- On success navigates to `/dashboard/triggers/$triggerId` with the returned ID.

- [ ] **Step 1: Replace create tests with the approved behavior**

Add tests that:

- Free renders the plan upgrade state and never calls `mutateAsync`;
- an empty app list renders “Create an app first” linking to `/dashboard/workflows/new`;
- Hobby offers only SQS-compatible and Platform queue;
- Next cannot leave a step with invalid fields and focuses/shows the first error;
- Review displays `POST /_triggers/{kind}/{slug}` and the `batchItemFailures` response;
- submit includes explicit plan-safe delivery numbers and `enabled`;
- Kafka SASL/TLS uses exact uppercase values;
- success clears secret controls and navigates to the returned trigger ID;
- every stable error code maps to the recovery copy from the approved spec while preserving entered values.

- [ ] **Step 2: Run the create tests and verify the one-panel flow fails them**

```bash
npm test -- src/components/dashboard/trigger-create.test.tsx
```

Expected: FAIL on steps, plan/no-app states, explicit delivery values, and navigation.

- [ ] **Step 3: Implement the three-step orchestrator**

Use a `step: 0 | 1 | 2` state. Step 0 contains app/kind/slug, step 1 composes source and delivery fields, and step 2 is read-only review. On mutation failure store a component error summary selected by `ApiError.code`; toasts may supplement but not replace the visible error. Disable navigation and submit while the mutation is pending.

Use this success boundary:

```ts
const trigger = await create.mutateAsync(buildCreateTriggerRequest(draft));
setDraft((current) => clearTriggerSecrets(current));
await navigate({ to: '/dashboard/triggers/$triggerId', params: { triggerId: trigger.id } });
```

- [ ] **Step 4: Add the route loading boundary**

`dashboard.triggers.new.tsx` reads `useAuth()` and `useApps()`. Render `LoadingState` while auth/apps are pending, `UnreachableState` when the API is unavailable, `ErrorState` for an app-list error, and `CreateTrigger` only with resolved account/apps. Add trigger/plan/cron/app-creation leaves to `src/test/router.tsx` so links resolve in component tests.

- [ ] **Step 5: Verify and commit the creation route**

```bash
npx prettier --write src/components/dashboard/trigger-create.tsx src/components/dashboard/trigger-create.test.tsx src/routes/dashboard.triggers.new.tsx src/test/router.tsx
npm test -- src/components/dashboard/trigger-create.test.tsx
npm run typecheck
git add src/components/dashboard/trigger-create.tsx src/components/dashboard/trigger-create.test.tsx src/routes/dashboard.triggers.new.tsx src/test/router.tsx
git commit -m "feat(console): add guided trigger creation"
```

Expected: all create-flow tests PASS.

---

### Task 5: Make the Trigger list an operational index

**Files:**

- Move: `src/routes/dashboard.triggers.tsx` to `src/routes/dashboard.triggers.index.tsx`
- Create: `src/routes/dashboard.triggers.index.test.tsx`
- Generate: `src/routeTree.gen.ts`

**Interfaces:**

- Produces `/dashboard/triggers` as an index route.
- Links every non-cron row to `/dashboard/triggers/$triggerId`.
- Links the primary CTA to `/dashboard/triggers/new` when allowed and `/dashboard/plans` when Free.
- Consumes `account.limits.triggers_allowed`, `useTriggers`, `useApps`, and `useSetTriggerEnabled`.

- [ ] **Step 1: Write failing list-state and action tests**

Mock auth/query hooks and assert loading, unreachable, ordinary error with retry, no-app, no-trigger, and populated states separately. Assert the create form is absent, the CTA target is correct for Free versus paid, app/kind/status search works, row trigger names are links, and a pending pause/resume mutation disables only its row control.

- [ ] **Step 2: Run the route test and confirm the current embedded-form/detail behavior fails**

```bash
npm test -- src/routes/dashboard.triggers.index.test.tsx
```

Expected: FAIL because the index file/URL links do not exist and creation/detail are inline.

- [ ] **Step 3: Move and simplify the route**

Move list responsibility to `.index.tsx`, remove `CreateTrigger`, inline selection, inline metrics, and inline `TriggerConfiguration`. Add the primary CTA to `PageHeader`, include updated time and enabled state in row data, preserve search across `slug`, app, kind, and status, and disable the row switch when `setEnabled.isPending && setEnabled.variables?.id === row.id`.

- [ ] **Step 4: Regenerate the route tree through the normal toolchain**

```bash
npm run build
```

Expected: Vite/TanStack generates routes for `/dashboard/triggers`, `/new`, and `/$triggerId`; do not hand-edit `src/routeTree.gen.ts`.

- [ ] **Step 5: Verify and commit the list route**

```bash
npx prettier --write src/routes/dashboard.triggers.index.tsx src/routes/dashboard.triggers.index.test.tsx
npm test -- src/routes/dashboard.triggers.index.test.tsx
npm run typecheck
git add src/routes/dashboard.triggers.tsx src/routes/dashboard.triggers.index.tsx src/routes/dashboard.triggers.index.test.tsx src/routeTree.gen.ts
git commit -m "feat(console): make triggers a routed index"
```

Expected: route test and typecheck PASS.

---

### Task 6: Add typed update invalidation before detail editing

**Files:**

- Modify: `src/lib/api/queries.ts`
- Create: `src/lib/api/queries.test.tsx`

**Interfaces:**

- Adds: `keys.trigger(id: string)`.
- Adds: `useUpdateTrigger()` accepting `{ id, body: UpdateTriggerRequest }`.
- Adds private `invalidateTrigger(qc: QueryClient, id: string): Promise<void>` for list/detail family invalidation.
- Create/update/delete/pause/resume invalidate both `keys.triggers` and the affected `keys.trigger(id)` family.

- [ ] **Step 1: Create failing query-hook tests**

Mock the API client and QueryClient. Assert update calls `PATCH /v1/triggers/{id}` with the typed body and invalidates `['triggers']` plus `['triggers', id]`. Assert delete and pause/resume use the same affected-ID invalidation.

- [ ] **Step 2: Run the focused hook test and verify update is missing**

```bash
npm test -- src/lib/api/queries.test.tsx -t 'trigger mutation'
```

Expected: FAIL because `useUpdateTrigger` and `keys.trigger` do not exist.

- [ ] **Step 3: Implement typed mutations and consistent keys**

Use:

```ts
trigger: (id: string) => ['triggers', id] as const,
```

and:

```ts
export function useUpdateTrigger() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: components['schemas']['UpdateTriggerRequest'] }) =>
      unwrap(api.PATCH('/v1/triggers/{id}', { params: { path: { id } }, body })),
    onSettled: (_data, _error, vars) => invalidateTrigger(qc, vars.id),
  });
}
```

Make `useTrigger`, metrics, records, and DLQ build their keys from `keys.trigger(id)`.

- [ ] **Step 4: Verify and commit query behavior**

```bash
npx prettier --write src/lib/api/queries.ts src/lib/api/queries.test.tsx
npm test -- src/lib/api/queries.test.tsx -t 'trigger mutation'
npm run typecheck
git add src/lib/api/queries.ts src/lib/api/queries.test.tsx
git commit -m "feat(console): add trigger update queries"
```

Expected: mutation/invalidation tests PASS.

---

### Task 7: Build the URL-addressable operational detail

**Files:**

- Modify: `src/components/dashboard/trigger-detail.tsx`
- Modify: `src/components/dashboard/trigger-detail.test.tsx`
- Create: `src/routes/dashboard.triggers.$triggerId.tsx`
- Generate: `src/routeTree.gen.ts`

**Interfaces:**

- `TriggerDetail` accepts `{ triggerId: string; account: Account; apps: App[] }`.
- Consumes trigger/metrics/records/DLQ hooks, form normalization/update helpers, update/delete/pause/resume mutations, `useConfirm`, and router navigation.
- Delete success navigates to `/dashboard/triggers`.

- [ ] **Step 1: Write failing operational-detail tests**

Assert distinct loading/not-found/error states; status, destination app, metrics, record/DLQ sections, delivery/filter config, `POST /_triggers/{kind}/{slug}`, and the `batchItemFailures` example. Seed response config with `password_set: true`, `client_key_set: true`, and malicious `password_sealed`; assert only “Password configured”/“Client key configured” appear and no secret/ciphertext key or value renders.

Add edit tests asserting immutable app/kind/slug, plan input caps, blank secret fields preserving markers, credential rotation payload, remove-SASL behavior, visible typed errors, and success invalidation. Add delete tests that require `useConfirm`, call delete only after confirmation, and navigate to the list.

- [ ] **Step 2: Run detail tests and verify actions/contract/route are missing**

```bash
npm test -- src/components/dashboard/trigger-detail.test.tsx
```

Expected: FAIL on operational sections, edit/delete actions, and redaction defense.

- [ ] **Step 3: Implement the detail projection and handler contract**

Compose the existing `TriggerRecords` and `TriggerDeadLetter` components beneath metrics. Render source config through a whitelist derived from `draftFromTrigger`, never by dumping raw `JSON.stringify(data.config)`. Add a compact code block with the handler path and partial-failure response.

- [ ] **Step 4: Implement edit, credential rotation, pause/resume, and delete**

Open a controlled edit panel initialized with `draftFromTrigger`. Disable identity inputs. Submit `buildUpdateTriggerRequest`, clear secret controls on success, and leave state populated on error. Delete confirmation must use:

```ts
if (!(await confirm({
  title: `Delete ${trigger.slug}?`,
  description: 'Polling stops and this trigger cannot be recovered.',
  confirmLabel: 'Delete trigger',
  destructive: true,
  typeToConfirm: trigger.slug,
}))) return;
```

- [ ] **Step 5: Add the detail route and regenerate route types**

Read `triggerId` with `useParams`, resolve auth/apps states, and pass them into `TriggerDetail`. Run `npm run build` to regenerate `src/routeTree.gen.ts`.

- [ ] **Step 6: Verify and commit operational detail**

```bash
npx prettier --write src/components/dashboard/trigger-detail.tsx src/components/dashboard/trigger-detail.test.tsx src/routes/dashboard.triggers.\$triggerId.tsx
npm test -- src/components/dashboard/trigger-detail.test.tsx src/components/dashboard/trigger-records.test.tsx src/components/dashboard/trigger-dlq.test.tsx src/components/dashboard/trigger-record-actions.test.tsx
npm run typecheck
git add src/components/dashboard/trigger-detail.tsx src/components/dashboard/trigger-detail.test.tsx src/routes/dashboard.triggers.\$triggerId.tsx src/routeTree.gen.ts
git commit -m "feat(console): add trigger operations detail"
```

Expected: detail and existing record/DLQ tests PASS.

---

### Task 8: Make the development mock obey the production contract

**Files:**

- Create: `mock/trigger-contract.ts`
- Create: `mock/trigger-contract.test.ts`
- Modify: `mock/data.ts`
- Modify: `mock/plugin.ts`
- Modify: `src/lib/mock-spec-drift.test.ts`

**Interfaces:**

- Produces `TRIGGER_CAPABILITIES_BY_PLAN`, `TRIGGER_PLATFORM_DEFAULTS`, and `KAFKA_SASL_MECHANISMS` for the dev server only.
- Mock POST/PATCH applies plan kind/cap checks and response redaction; it never stores request plaintext credentials.

- [ ] **Step 1: Write failing fixture/spec alignment tests**

Read `api/openapi.yaml` and assert the mock SASL mechanisms occur in the `KafkaSASLMechanism` enum, every mock allowed kind occurs in `TriggerKind`, Hobby defaults equal `50/1000/3/1048576`, and the Free error code equals `plan_triggers_not_allowed`.

- [ ] **Step 2: Run the contract test and verify the current hard-coded mock diverges**

```bash
npm test -- mock/trigger-contract.test.ts src/lib/mock-spec-drift.test.ts
```

Expected: FAIL because the fixture and PATCH route do not exist and the mock uses the obsolete error/larger defaults.

- [ ] **Step 3: Implement the dev-only capability fixture**

Define exact Free/Hobby/Pro/Scale capabilities matching the backend account response. Export a `triggerDefaultsFor(plan)` helper that takes `Math.min` against the platform defaults.

- [ ] **Step 4: Update mock account plan changes and trigger routes**

When mock plan changes, replace every trigger limit field, not only `limits.plan`. POST checks `db.account.limits.triggers_allowed`, allowed kind, per-account quota, all numerical caps, TLS skip-verify, and exact uppercase SASL vocabulary. Before storing or returning config, replace plaintext password/key with only `password_set`/`client_key_set` markers. Add PATCH with the backend preservation/removal semantics and redacted response. Keep GET list/detail always readable.

- [ ] **Step 5: Verify and commit the mock contract**

```bash
npx prettier --write mock/trigger-contract.ts mock/trigger-contract.test.ts mock/data.ts mock/plugin.ts src/lib/mock-spec-drift.test.ts
npm test -- mock/trigger-contract.test.ts src/lib/mock-spec-drift.test.ts
npm run typecheck
git add mock/trigger-contract.ts mock/trigger-contract.test.ts mock/data.ts mock/plugin.ts src/lib/mock-spec-drift.test.ts
git commit -m "fix(mock): mirror the secure trigger contract"
```

Expected: mock contract and typecheck PASS.

---

### Task 9: Run console completion gates

**Files:**

- Verify only; modify a source or test file only if a gate reveals a real regression.

**Interfaces:**

- Produces a clean PR #57 branch whose complete diff is ready for review after the backend prerequisite.

- [ ] **Step 1: Scan for stale contract and secret leaks**

```bash
rg -n -P "scram-sha|(?<!plan_)triggers_not_allowed|password_sealed|client_key_sealed|JSON.stringify\(data\.config" src mock api/openapi.yaml
git diff origin/feat/trigger-create...HEAD --check
```

Expected: no lowercase SASL, obsolete Free code, ciphertext field rendering, or raw config dump under `src/`; internal mock redaction code may mention sealed keys only as denylisted input.

- [ ] **Step 2: Run focused Trigger suites**

```bash
npm test -- src/components/dashboard/trigger-form-model.test.ts src/components/dashboard/trigger-source-fields.test.tsx src/components/dashboard/trigger-delivery-fields.test.tsx src/components/dashboard/trigger-create.test.tsx src/components/dashboard/trigger-detail.test.tsx src/components/dashboard/trigger-records.test.tsx src/components/dashboard/trigger-dlq.test.tsx src/components/dashboard/trigger-record-actions.test.tsx src/routes/dashboard.triggers.index.test.tsx mock/trigger-contract.test.ts
```

Expected: all focused tests PASS.

- [ ] **Step 3: Build before the repository-wide check**

```bash
npm run build
```

Expected: TypeScript, Vite build, route generation, and prerender all PASS.

- [ ] **Step 4: Run the full quality gate**

```bash
npm run check
```

Expected: typecheck, lint, format check, and all Vitest suites PASS, including the prerender test against the fresh `dist/index.html`.

- [ ] **Step 5: Confirm worktree scope and record the frontend head**

```bash
git status --short
git log --oneline --decorate -12
```

Expected: clean worktree, focused commits after `2d9ff9a`, and no changes in `/home/bahadir/GREGALE/faas-web`.
