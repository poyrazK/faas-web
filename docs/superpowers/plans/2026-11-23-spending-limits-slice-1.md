# Spending limits, slice 1: the page, the status strip and Your bill

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/dashboard/limits` "Spending limits" page under Billing. It answers first with a status strip, then has two sections: **Your bill** (spend cap, egress, object storage) and the account budgets moved in from `/dashboard/budgets`. Usage keeps a one-line summary.

**Architecture:**

- The strip and every row's verdict come from one pure module, `src/lib/limits.ts`, fed by the existing queries plus new egress hooks.
- Page pieces live in `src/components/dashboard/limits/`.
- Existing pieces are reused, not rebuilt: `SpendCapEditor`, the forecast and cap-history parts of `SpendControl`, and `BudgetsBody`.

**Tech stack:** React 19, TanStack Router and Query, `openapi-fetch` (`api`, `unwrap`), Vitest and RTL, the Vite mock (`mock/plugin.ts`).

**Spec:** `docs/superpowers/specs/2026-11-23-spending-limits-design.md`, the sections "The page" (status strip, 1. Your bill, 2. Alerts and budgets, account part only) and "Elsewhere in the console". Later slices:

- **2:** organization budgets.
- **3:** agents, behind `featureFlags.agents`.
- **4:** your customers.
- **5:** integrations and AI.

Each gets its own plan.

## Global Constraints

- **Route:** `/dashboard/limits`, with nav label `Spending limits`, `consoleHead('limits')`, and no capability gate on the nav item.
- **Old route:** `/dashboard/budgets` redirects to `/dashboard/limits` with hash `budgets`.
- **Amber** at `used / limit >= 0.8`; **red** at `used >= limit`. A $0 cap counts as reached immediately, as in `capStanding`.
- **Strip precedence:**
  1. data loss (`over_ceiling` present);
  2. stopped (cap reached or $0; egress used ≥ allowance with overage off);
  3. close (any meter ≥ 80%);
  4. fine.
- **Organizations:**
  - no cap meter and no cap verdict;
  - the strip's fine headline is `No other limit is stopped`;
  - personal figures are never shown in a company workspace.
- **Free plan:** no overage exists, so the spend cap row reads `Free stops at its allowance, so there's no overage to cap.`, and egress "pay beyond" is an upsell to `/dashboard/plans`.
- **A failed read is never "fine".** If a bill read fails or is pending and nothing is red or amber, the headline is `Nothing reported stopped`, and the detail names what couldn't be read.
- **Writes:** egress election and cap changes need admin plus a recent step-up. On `ApiError.code` `step_up_required` or `mfa_required`, open the MFA modal once and replay the same write with the same `Idempotency-Key`, as `OrgCapEditor` in `spend-cap.tsx` does.
- **Copy:** plain English per `docs/console-plain-english.md`. No literal hex and no `dark:`.
- **Verify:** `npx tsc --noEmit`, `npm run lint` (2 known warnings), `npm run format:check`, `npx vitest run --maxWorkers=6`, `npm run build`.

## Review Focus

1. **$0 spend cap:** the strip is red ("Your apps are stopped"), even when overage is $0. The test is in Task 1.
2. **Free plan:** no "No cap: nothing stops overage" warning, and egress offers plans instead of a toggle. Tests are in Tasks 1 and 3.
3. **Company workspace:** never shows the personal cap, overage or egress figures, and never calls the cap fine. Tests are in Tasks 1 and 3.
4. **One failed read:** "Nothing is stopped" never appears while egress or storage failed to load. Tests are in Tasks 1 and 3.
5. **Storage over its ceiling while the cap is also reached:** the strip leads with the deletion date. The test is in Task 1.

---

### Task 1: Status logic (`src/lib/limits.ts`)

**Files:**

- Create: `src/lib/limits.ts`, `src/lib/limits.test.ts`

**Interfaces:**

- Produces:

```ts
export type LimitTone = 'good' | 'warning' | 'critical';
export function meterTone(used: number, limit: number): LimitTone;
type Read<T> = ({ state: 'ready' } & T) | { state: 'unknown' } | { state: 'hidden' };
export interface BillFacts {
  workspace: 'personal' | 'org';
  plan?: 'free' | 'hobby' | 'pro' | 'scale';
  cap: Read<{ capCents: number | null; overageCents?: number }>; // org: overageCents always undefined
  egress: Read<{ enabled: boolean; electable: boolean; usedGb?: number; includedGb?: number }>;
  storage: Read<{
    usedBytes: number;
    ceilingBytes: number;
    overCeiling?: { excessBytes: number; deletionAt: string };
  }>;
}
export interface BillStatus {
  tone: LimitTone;
  headline: string;
  detail: string;
  action?: 'cap' | 'egress' | 'plans' | 'storage';
}
export function billStatus(facts: BillFacts): BillStatus;
export function capSentence(facts: BillFacts): string; // the spend cap row's plain sentence
export function egressSentence(e: {
  enabled: boolean;
  includedGb?: number;
  priceMillicentsPerGib?: number;
}): string;
```

- `formatGib(bytes)` is a local helper rounding to whole GiB, or one decimal below 10.
- Money comes from `formatCents` (`@/lib/money`): `formatCents(5000)` is `$50.00`. The egress price comes from `formatMillicentRate`: 3000 millicents is `$0.03`. Dates use `en-US` `{ month: 'short', day: 'numeric' }`.

- [ ] **Step 1: Write failing tests in `src/lib/limits.test.ts`**

```ts
const ready = <T>(t: T) => ({ state: 'ready' as const, ...t });
const base: BillFacts = {
  workspace: 'personal',
  plan: 'pro',
  cap: ready({ capCents: 5000, overageCents: 1240 }),
  egress: ready({ enabled: false, electable: true, usedGb: 205, includedGb: 500 }),
  storage: ready({ usedBytes: 19 * 2 ** 30, ceilingBytes: 250 * 2 ** 30 }),
};
it('meterTone: amber from 80%, red at the limit', () => {
  expect(meterTone(79, 100)).toBe('good');
  expect(meterTone(80, 100)).toBe('warning');
  expect(meterTone(100, 100)).toBe('critical');
});
it('fine: names the cap use and the closest other limit', () => {
  expect(billStatus(base)).toEqual({
    tone: 'good',
    headline: 'Nothing is stopped',
    detail: '$12.40 of your $50.00 overage cap used. Egress is at 41% of 500 GiB.',
  });
});
it('a $0 cap is a pause switch', () => {
  expect(billStatus({ ...base, cap: ready({ capCents: 0, overageCents: 0 }) })).toMatchObject({
    tone: 'critical',
    headline: 'Your apps are stopped',
    detail: 'Your spend cap is $0, which pauses every workload.',
    action: 'cap',
  });
});
it('cap reached', () => {
  expect(billStatus({ ...base, cap: ready({ capCents: 5000, overageCents: 5000 }) })).toMatchObject(
    {
      tone: 'critical',
      detail: 'Overage reached your $50.00 cap.',
      action: 'cap',
    }
  );
});
it('egress allowance reached with overage off stops apps; Free gets plans', () => {
  const full = ready({ enabled: false, electable: true, usedGb: 500, includedGb: 500 });
  expect(billStatus({ ...base, egress: full })).toMatchObject({
    tone: 'critical',
    detail: 'Egress reached 500 GiB.',
    action: 'egress',
  });
  expect(
    billStatus({
      ...base,
      plan: 'free',
      cap: ready({ capCents: null }),
      egress: { ...full, electable: false },
    }).action
  ).toBe('plans');
});
it('egress with overage on is never stopped by its allowance', () => {
  expect(
    billStatus({
      ...base,
      egress: ready({ enabled: true, electable: true, usedGb: 600, includedGb: 500 }),
    }).tone
  ).toBe('good');
});
it('data loss outranks a reached cap', () => {
  const s = billStatus({
    ...base,
    cap: ready({ capCents: 5000, overageCents: 6000 }),
    storage: ready({
      usedBytes: 262 * 2 ** 30,
      ceilingBytes: 250 * 2 ** 30,
      overCeiling: { excessBytes: 12 * 2 ** 30, deletionAt: '2026-12-02T00:00:00Z' },
    }),
  });
  expect(s).toEqual({
    tone: 'critical',
    headline: 'Files will be deleted on Dec 2',
    action: 'storage',
    detail:
      'Storage is 12 GiB over its 250 GiB ceiling. Delete files to get back under it, or ask support to raise the ceiling.',
  });
});
it('close: names the limit', () => {
  expect(
    billStatus({
      ...base,
      egress: ready({ enabled: false, electable: true, usedGb: 410, includedGb: 500 }),
    })
  ).toMatchObject({
    tone: 'warning',
    headline: 'Close to a limit',
    detail: 'Egress is at 82% of 500 GiB.',
  });
});
it('an organization never gets a cap verdict', () => {
  const s = billStatus({
    ...base,
    workspace: 'org',
    cap: ready({ capCents: 5000 }),
    egress: ready({ enabled: false, electable: true }),
  });
  expect(s).toEqual({
    tone: 'good',
    headline: 'No other limit is stopped',
    detail:
      'Gregale doesn’t report this organization’s overage here, so the spend cap’s use isn’t shown.',
  });
});
it('a failed read is never "Nothing is stopped"', () => {
  expect(billStatus({ ...base, egress: { state: 'unknown' } })).toMatchObject({
    tone: 'good',
    headline: 'Nothing reported stopped',
  });
  expect(billStatus({ ...base, egress: { state: 'unknown' } }).detail).toMatch(
    /Egress couldn’t be read\.$/
  );
});
it('Free has no overage to cap', () => {
  expect(capSentence({ ...base, plan: 'free', cap: ready({ capCents: null }) })).toBe(
    'Free stops at its allowance, so there’s no overage to cap.'
  );
  expect(billStatus({ ...base, plan: 'free', cap: ready({ capCents: null }) }).tone).toBe('good');
});
it('row sentences', () => {
  expect(capSentence(base)).toBe('Apps, jobs and databases stop at $50.00 of overage.');
  expect(capSentence({ ...base, cap: ready({ capCents: null, overageCents: 0 }) })).toBe(
    'No cap is set, so nothing stops overage.'
  );
  expect(egressSentence({ enabled: false, includedGb: 500 })).toBe(
    'Apps stop at 500 GiB. Or pay for egress beyond it.'
  );
  expect(egressSentence({ enabled: true, includedGb: 500, priceMillicentsPerGib: 3000 })).toBe(
    'Pays $0.03 per GiB beyond 500 GiB, counted toward your spend cap.'
  );
});
```

- [ ] **Step 2: Run `npx vitest run src/lib/limits.test.ts`.** Expected: FAIL (module missing).
- [ ] **Step 3: Implement `src/lib/limits.ts`** with the interfaces above, and verdicts in the precedence from Global Constraints.
  - Personal `null` cap on a paid plan: amber, headline `Close to a limit`, detail `No cap is set, so nothing stops overage.`
  - Pick the "closest other limit" for the fine detail by highest percentage among egress (when not `enabled`) and storage. Omit it when there's none.
  - Detail for unreadable sections: append `Egress couldn’t be read.`, `Storage couldn’t be read.` or `The spend cap couldn’t be read.` in that order.
- [ ] **Step 4: Run the test.** Expected: PASS.
- [ ] **Step 5: Commit** with `feat(console): spending limits status logic`.

### Task 2: Egress election hooks and mock

**Files:**

- Create: `src/lib/api/limits.ts`, `src/lib/api/limits.test.tsx`
- Modify: `mock/plugin.ts`. Add `GET`/`PUT /v1/account/egress-overage` and `GET`/`PUT /v1/orgs/{slug}/egress-overage`, held in module state: `{ enabled: false, electable: true, included_gib: 500, billing: 'live', price_millicents_per_gib: 3000, currency: 'USD' }`. Add `/v1/orgs/{organization}/object-storage-usage` if `mock-spec-drift` or the tour needs it.

**Interfaces:**

- Produces:
  - `useEgressOverage(options?: { enabled?: boolean })`, the personal `GET`, key `[...keys.account, 'egress-overage']`;
  - `useOrgEgressOverage(org: string, options?)`, key `['orgs', org, 'egress-overage']`;
  - `useSetEgressOverage(org: string | null)`, a mutation taking `{ enabled: boolean; key: string }`. It sends `PUT` with body `{ enabled }` and header `Idempotency-Key: key`, then invalidates that subject's egress key and `keys.usage`.
  - `useOrgObjectStorageUsage(org: string, options?)` reads `GET /v1/orgs/{organization}/object-storage-usage`.

- [ ] **Step 1: Failing test** in `limits.test.tsx`, with `spyApi` as in `app-values-scope.test.tsx`:
  - personal reads `/v1/account/egress-overage`;
  - org reads `/v1/orgs/{slug}/egress-overage` with `path: { slug: 'acme' }`;
  - the set mutation sends `body: { enabled: true }` and the `Idempotency-Key` header to the subject's path.
- [ ] **Step 2: Run** `npx vitest run src/lib/api/limits.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the hooks and the mock routes.
- [ ] **Step 4: Run** the test and `npx vitest run src/lib/mock-spec-drift.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(console): egress overage election hooks`.

### Task 3: Your bill and the strip

**Files:**

- Create in `src/components/dashboard/limits/`:
  - `limit-row.tsx`;
  - `status-strip.tsx`;
  - `your-bill.tsx`;
  - `egress-choice.tsx`;
  - `use-bill-facts.ts`;
  - `your-bill.test.tsx`.
- Modify: `src/components/dashboard/spend-control.tsx`. Export `ForecastLine` and `CapHistory` as they are.

**Interfaces:**

- Consumes:
  - Task 1's `billStatus`, `capSentence`, `egressSentence`, `meterTone` and `BillFacts`;
  - Task 2's hooks;
  - `useOverageCap`, `useOrgOverageCap`, `useUsageSummary`, `useAccountUsage` (personal storage is `data.object_storage`), `useWorkspaceTarget`, `useAuth`, `useCapability`, `useOrgs` (org plan);
  - `SpendCapEditor`, `ForecastLine`, `CapHistory`.
- Produces:
  - `useBillFacts(): { facts: BillFacts; retry: () => void; egress?: EgressOverageResponse }`;
  - `LimitRow({ name, sentence, meter?: { used: number; limit: number; label: string }, tone?: LimitTone, action?: ReactNode, children?: ReactNode })`. It renders a `role="meter"` bar with `aria-valuenow` as a whole percent, and `children` inside a `<details>` "More";
  - `StatusStrip({ status }: { status: BillStatus; onAction?: (a: BillStatus['action']) => void })`, a `role="status"` region tinted by tone with one action button: `Change cap`, `Pay beyond`, `View plans`, or `See buckets` linking to `/dashboard/storage`;
  - `YourBill({ facts, egress, onEditCap })`.

- [ ] **Step 1: Failing tests** in `your-bill.test.tsx`. Mock the query modules as in `metric-detail.test.tsx` and render through `withRouter`.
  - Personal Pro, cap $50 and overage $12.40: rows `Spend cap`, `Egress`, `Object storage`. The spend cap meter reads `aria-valuenow="25"`, and its sentence is from `capSentence`.
  - Clicking `Change` on the spend cap opens a dialog named `Spend cap` containing `SpendCapEditor`.
  - `Pay beyond` opens a confirm dialog saying `Egress above 500 GiB is billed at $0.03 per GiB and counts toward your spend cap.`. Confirming calls the set mutation with `{ enabled: true }`. A `step_up_required` rejection opens the MFA modal (mock `useMfa`) and replays with the same `key`.
  - Free plan: no `Pay beyond` button; a `View plans` link to `/dashboard/plans` instead.
  - Company workspace (`useWorkspaceTarget` → `{ org: 'acme', label: 'Acme', ready: true }`):
    - the personal cap hook is not enabled and no personal figure appears;
    - the spend cap row has no meter;
    - the strip reads `No other limit is stopped`.
  - Storage row hidden when `useCapability('object-storage')` is off; Postgres note `Managed Postgres overage counts toward this cap, and databases stop at it.` shown only when `managed-postgres` is on.
  - Egress read failing: the strip reads `Nothing reported stopped`, and the egress row shows `InlinePhase` with Retry.
- [ ] **Step 2: Run** `npx vitest run src/components/dashboard/limits`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `useBillFacts` maps each query through `queryPhase()`: `ready` → `{ state: 'ready', … }`, a disabled or hidden capability → `hidden`, anything else → `unknown`.
  - Egress `usedGb` and `includedGb` come from the personal usage summary's `used_egress_gb` and `included_egress_gb`, and are undefined for orgs.
  - Storage comes from `usage.observed_bytes`, `policy.max_account_bytes` and `over_ceiling`.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(console): Your bill and the spending limits strip`.

### Task 4: The page, nav and budgets move

**Files:**

- Create: `src/routes/dashboard.limits.tsx`, `src/components/dashboard/limits/limits-page.tsx`, `src/components/dashboard/limits/limits-page.test.tsx`
- Modify:
  - `src/components/dashboard/budgets/budgets-page.tsx`: add `export function BudgetsSection()`. It is the existing `BudgetsPage` body (org note or `BudgetsBody`) without the `PageHeader`, with `id="budgets"` on its wrapper and the `budgets` capability gate. The org note's link points at this page's spend cap (`#your-bill`). `BudgetsPage` is deleted.
  - `src/routes/dashboard.budgets.tsx`: `beforeLoad` redirects to `/dashboard/limits` with `hash: 'budgets'` and `replace: true`. The component is removed.
  - `src/components/dashboard/nav-config.ts`: the Billing section `{ to: '/dashboard/budgets', label: 'Budgets', icon: PiggyBank, capability: 'budgets' }` becomes `{ to: '/dashboard/limits', label: 'Spending limits', icon: PiggyBank }`.
  - `src/lib/project-scope.ts`: add `limits` to the account-path regex.
  - `vercel.json` route regex: add `limits`.
  - `public/_redirects`: `/dashboard/limits    /index.html   200`.
  - `src/components/dashboard/navigation.test.tsx` `RAIL`: `'Budgets'` → `'Spending limits'`.
  - `src/routes/-dashboard.gated-pages.test.tsx`, plus any budgets route test that asserted the old page.

**Interfaces:**

- Consumes: Task 3's `useBillFacts`, `StatusStrip`, `YourBill`; `BudgetsSection`.
- Produces: `LimitsPage()`. It renders a `PageHeader` titled `Spending limits` with help `Every limit on what you can be billed, and what happens when one is reached.`, then `StatusStrip`, `YourBill` (wrapper `id="your-bill"`) and `BudgetsSection`. The strip's `cap` action opens the same cap dialog as the row.

- [ ] **Step 1: Failing tests** in `limits-page.test.tsx`:
  - the page renders the strip, then `Your bill`, then the budgets section, in that order;
  - in `-dashboard.budgets-redirect.test.tsx`, the `/dashboard/budgets` route's `beforeLoad` throws a redirect to `/dashboard/limits` with hash `budgets`;
  - `navigation.test.tsx` `RAIL` has `Spending limits` and no `Budgets`.
- [ ] **Step 2: Run** these. Expected: FAIL.
- [ ] **Step 3: Implement** the route, the page, the redirect and the nav and hosting changes.
- [ ] **Step 4: Run** `npx vitest run src/components/dashboard/limits src/components/dashboard/budgets src/components/dashboard/navigation.test.tsx src/routes src/hosting-contract.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(console): Spending limits page replaces Budgets`.

### Task 5: Usage keeps a summary

**Files:**

- Modify: `src/routes/dashboard.usage.tsx`, `src/components/dashboard/spend-control.tsx`, and their tests (`dashboard.usage.test.tsx`; the spend control test is moved or deleted with the component).

**Interfaces:**

- Consumes: Task 3's `useBillFacts` and `billStatus`.
- Produces: `LimitsSummary()` in `src/components/dashboard/limits/limits-summary.tsx`. It renders one `role="status"` line with the strip's headline and detail, and a link `Open spending limits` to `/dashboard/limits`.

- [ ] **Step 1: Failing test** in `dashboard.usage.test.tsx`:
  - Usage shows `Open spending limits` with `href="/dashboard/limits"` and no `Spend control` panel;
  - the headline's `Raise cap` still opens the `Spend cap` dialog. The old "shows the cap standing on Usage and edits the cap in a modal" test is replaced by this.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - In `PersonalUsage`, replace `<SpendControl …/>` with `<LimitsSummary />`.
  - Keep `editingCap` driving a `Modal` titled `Spend cap` with `SpendCapEditor`.
  - Remove `SpendControl` (keep `capStanding`, `describeCapEvent`, `ForecastLine` and `CapHistory` exported), and drop its now-dead tests.
- [ ] **Step 4: Run** `npx vitest run src/routes/dashboard.usage.test.tsx src/components/dashboard/spend-control*`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(console): Usage links to spending limits`.

### Task 6: Gate, mock check, review, PR

- [ ] Run the full gate from Global Constraints. Expected:
  - tsc clean;
  - lint at 2 warnings;
  - prettier clean;
  - all tests pass;
  - the build is OK.
- [ ] **Mock check:** use `MOCK_API=1 npx vite --port 3017` and the Playwright helpers in `.superpowers/logs/`. Screenshot `/dashboard/limits` personal, after turning on "Pay beyond", in a company workspace, and Usage's summary line.
- [ ] Get a whole-branch review by a fresh reviewer, then do one fix pass.
- [ ] Update the parity ledger row for egress overage, the account spend cap and budgets, if their status changes.
- [ ] Open the PR.
