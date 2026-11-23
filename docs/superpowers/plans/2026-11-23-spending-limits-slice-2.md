# Spending limits, slice 2: organization budgets

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In a company workspace, the Spending limits page's "Alerts and budgets" section reads and writes the organization's own budgets. Today it shows a note saying organizations have none.

**Architecture:**

- The budget API hooks (`src/lib/api/budgets.ts`) take a `BudgetSubject`: the signed-in account, or an organization by slug. The subject picks the routes and the cache keys.
- The budget components pass the subject down instead of `accountId`.
- An organization subject hides what faas doesn't offer organizations: strict caps, the Job scope and alert channels.

**Tech stack:** React 19, TanStack Query, `openapi-fetch`, Vitest and RTL, the Vite mock.

**Spec:** `docs/superpowers/specs/2026-11-23-spending-limits-design.md`, "2. Alerts and budgets" and the "Organizations" note under the status strip.

## Global Constraints

- **Organization routes**, all in the vendored spec:
  - `GET`/`POST /v1/orgs/{slug}/billing/budgets`
  - `POST /v1/orgs/{slug}/billing/budgets/preview`
  - `GET`/`PUT`/`DELETE /v1/orgs/{slug}/billing/budgets/{id}`
  - `GET /v1/orgs/{slug}/billing/budgets/{id}/revisions`
- **Same bodies and responses as the personal routes.** Writes need the owner or billing role, the admin scope, session MFA and an `Idempotency-Key`.
- **Organizations offer:**
  - scopes: account (the organization as a whole), project, environment and app. **No Job scope.**
  - responses: Alert (`monitored` + `notify`) and Stop previews (`monitored` + compute-only `stop_previews`). **No strict cap.**
  - **No alert channels.** There is no organization channels route; alerts go to the organization's billing contact.
- **Scope pickers in a company workspace** list the organization's apps (`useOrgApps(org)`) and projects (`useProjects`, already workspace-aware). Personal apps never appear.
- **Ownership:** an organization that doesn't own its resources gets 422 `financial_budget_activation_unavailable` on save. Show apid's own `detail` as the message. Don't use the personal "strict not released" wording, and don't flip `strictRefused`.
- **Role:** a member without the owner or billing role gets 403 `org_role_forbidden` on a write. Explain it with `orgBillingMessage` (`components/dashboard/org-billing`), naming the organization.
- **Personal behaviour is unchanged:** same routes, cache keys `['account', accountId, 'budgets', …]`, channels and strict.
- **Organization cache keys:** `['orgs', slug, 'budgets', …]`, never under the account's keys.
- **Verify:** `npx tsc --noEmit`, `npm run lint` (2 known warnings), `npm run format:check`, `npx vitest run --maxWorkers=6`, `npm run build`.

## Review Focus

1. **Switching workspace from Personal to a company and back** never shows the other subject's budgets, not even from cache. The test is in Task 1.
2. **An organization that doesn't own its resources** sees faas's ownership message on save, and the form still offers Alert and Stop previews afterwards. The test is in Task 3.
3. **A member without the billing role** opening the section can read budgets, but a save explains the role and names the organization. The test is in Task 3.
4. **An existing organization budget scoped to an app** shows the org app's slug, not "Unknown app". The test is in Task 2.
5. **The create form in a company workspace** never offers Strict cap or Job, even after a personal 422 had set `strictRefused`. The test is in Task 2.

---

### Task 1: Subject-aware budget hooks

**Files:**

- Modify: `src/lib/api/budgets.ts`
- Test: `src/lib/api/budgets-subject.test.tsx`

**Interfaces:**

- Produces:

```ts
export type BudgetSubject =
  | { kind: 'account'; accountId: string }
  | { kind: 'org'; slug: string; accountId: string };
export const budgetKeys: {
  all(subject: BudgetSubject): readonly unknown[];
  detail(subject: BudgetSubject, id: string): readonly unknown[];
  channels(subject: BudgetSubject, id: string): readonly unknown[];
  revisions(subject: BudgetSubject, id: string, limit: number): readonly unknown[];
};
useBudgets(subject: BudgetSubject, enabled: boolean)
useBudget(subject, id)
useBudgetChannels(subject, id)     // disabled for an org subject
useBudgetRevisions(subject, id, limit?)
usePreviewBudget(subject)
useCreateBudget(subject), useUpdateBudget(subject), useDeleteBudget(subject)
useSetBudgetChannels(subject)      // throws for an org subject; the UI never offers it
export const subjectReady: (s: BudgetSubject) => boolean // accountId, plus slug for org
```

- [ ] **Step 1: Failing tests**, with `spyApi` as in `src/lib/api/app-values-scope.test.tsx`:
  - `'an organization reads, previews and writes its own budget routes'`. Org subject `{ kind: 'org', slug: 'acme', accountId: 'a1' }`. List hits `/v1/orgs/{slug}/billing/budgets` with `params: { path: { slug: 'acme' } }`. Create, update, delete and preview hit the `/v1/orgs/{slug}/…` paths with the `Idempotency-Key` header and the same bodies as the personal routes. Revisions hit `/v1/orgs/{slug}/billing/budgets/{id}/revisions` with `query: { after_revision: 0, limit: 20 }`.
  - `'the personal account keeps its routes and keys'`. Asserts the `/v1/billing/budgets` paths and that `budgetKeys.all(account)` equals `['account', 'a1', 'budgets']`.
  - `'subjects never share a cache'`. With one `QueryClient`, the personal list resolves `[p]` and the org list resolves `[o]`. Each hook's data stays its own; `budgetKeys.all(org)` equals `['orgs', 'acme', 'budgets']`.
  - `'an organization has no channel reads'`. `useBudgetChannels(org, 'b1')` never calls `GET`.
- [ ] **Step 2:** Run `npx vitest run src/lib/api/budgets-subject.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** Keep `useOperationKey` as is. Switch the paths on `subject.kind`.
- [ ] **Step 4:** Run the test. Expected: PASS. Run `npx tsc --noEmit`. Expected: errors only at the call sites Task 2 updates.
- [ ] **Step 5:** Commit with `feat(console): budget hooks take an account or organization subject` (together with Task 2 if `tsc` must stay green between commits).

### Task 2: Thread the subject through the budget components

**Files:**

- Modify, replacing the `accountId` prop with `subject: BudgetSubject`:
  - `src/components/dashboard/budgets/budgets-page.tsx` (`BudgetsBody`)
  - `budget-form.tsx`
  - `budget-detail.tsx`
  - `budget-bits.tsx` (`useScopeLabel`)
  - `use-budget-save.ts`
  - `budget-preview.tsx` (if it reads hooks)
- Modify `src/lib/budgets.ts`. Add:
  - `scopeKindsFor(subject: BudgetSubject['kind']): typeof SCOPE_KINDS` (an org drops `job`);
  - `levelsFor(subject: BudgetSubject['kind']): BudgetLevel[]` (an org is `['alert', 'stop-previews']`).
- Test: `src/components/dashboard/budgets/budgets-org.test.tsx`, plus updated existing budget tests (prop rename only).

**Interfaces:**

- Consumes: Task 1's `BudgetSubject` and hooks.
- Produces: `BudgetsBody({ subject }: { subject: BudgetSubject })`.
  - The form's scope picker and `useScopeLabel` use `useOrgApps(subject.slug)` for apps when `subject.kind === 'org'`, and `useApps` otherwise.
  - Jobs are only read for an account subject.
  - `BudgetDetail` renders no "Alert channels" section for an org subject.

- [ ] **Step 1: Failing tests** in `budgets-org.test.tsx`. Mock the budget hooks and `useOrgApps` as `budgets-page.test.tsx` does.
  - `'an organization form offers Alert and Stop previews only'`. Open "New budget" with an org subject. The response options are exactly Alert and Stop previews, and the scope options don't include Job. This holds even when `strictRefused` is true.
  - `'an organization app scope reads the organization’s apps'`. Choose scope App: the picker lists `useOrgApps` slugs (`'billing'`), not the personal `useApps` ones. An existing org budget scoped to that app's id lists as `billing`.
  - `'an organization budget has no alert channels'`. Open an org budget's detail: no "Alert channels" heading, and `useBudgetChannels` isn't called with a ready subject.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3: Implement.** Rename the props and thread `subject`. Gate jobs, strict and channels on `subject.kind === 'account'`.
- [ ] **Step 4:** Run `npx vitest run src/components/dashboard/budgets src/lib/budgets.test.ts`. Expected: PASS, with existing tests updated only for the prop rename.
- [ ] **Step 5:** Commit with `feat(console): budgets work for an organization subject`.

### Task 3: The section uses the organization's budgets

**Files:**

- Modify:
  - `src/components/dashboard/budgets/budgets-page.tsx` (`BudgetsSection`)
  - `src/lib/budgets.ts` (`budgetRefusal`)
  - `src/components/dashboard/org-billing.tsx` (`'budgets'` wording)
  - `mock/plugin.ts`
- Test: `budgets-org.test.tsx`, `src/lib/budgets.test.ts`

**Interfaces:**

- Consumes: Task 2's `BudgetsBody({ subject })`.
- Produces:
  - `BudgetsSection`: in a company workspace it renders `<BudgetsBody subject={{ kind: 'org', slug: workspace.org, accountId }} />` instead of the "Budgets belong to your personal account" note. Personal is unchanged.
  - `budgetRefusal(error, spec, subject?: BudgetSubject['kind'])`: when `subject === 'org'`, `financial_budget_activation_unavailable` returns `{ strictNotReleased: false, message: error.detail ?? errorMessage(error) }`. A 403 `org_role_forbidden` returns `orgBillingMessage(error, label, 'budgets')` text (the caller passes the label). Add `'budgets'` to `orgBillingMessage`'s `what` union, with the wording "Only {label}’s owner or billing role can change its budgets."
  - **Mock:** organization budget routes over an in-memory list per org, with the same shapes as the personal mock. `MOCK_ORG_UNOWNED=1` makes an org budget create return 422 `financial_budget_activation_unavailable` with faas's detail: "This organization does not own its resources yet, so its usage is billed to the members who created it. Budgets follow the subject that pays."

- [ ] **Step 1: Failing tests:**
  - `'a company workspace lists the organization’s budgets'`. The section in a company workspace renders the org list from the org hook, and no longer shows "Budgets belong to your personal account".
  - `'an organization that doesn’t own its resources sees apid’s reason'`. Create rejects with 422 `financial_budget_activation_unavailable` and that detail. The form shows the detail, the strict option stays absent, and Alert stays offered.
  - `'a member without the billing role is told who can change budgets'`. Create rejects 403 `org_role_forbidden`, and the message names the organization.
  - In `budgets.test.ts`: `budgetRefusal` with `'org'` returns the detail, and with `'account'` keeps the existing text.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement the section switch, the `budgetRefusal` subject branch (callers pass `subject.kind`) and the mock routes.
- [ ] **Step 4:** Run `npx vitest run src/components/dashboard/budgets src/lib/budgets.test.ts src/lib/mock-spec-drift.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit with `feat(console): organization budgets on Spending limits`.

### Task 4: Gate, mock check, review, PR

- [ ] Run the full gate from Global Constraints. Expected: all pass.
- [ ] **Mock check:** in a company workspace, create an Alert budget for an org app; open it (no Alert channels); then restart with `MOCK_ORG_UNOWNED=1` and see faas's ownership message on save.
- [ ] Get a whole-branch review by a fresh reviewer, then do one fix pass.
- [ ] **Parity ledger:** the budgets row gap no longer lists organization budgets as missing.
- [ ] **Spec:** the "Organizations" note says org budgets shipped.
- [ ] Open the PR.
