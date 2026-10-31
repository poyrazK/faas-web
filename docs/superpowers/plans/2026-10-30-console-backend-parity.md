# Console–backend parity: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land Wave 0 of the parity spec, then work Waves 1–3 from the ledger it creates. Wave 0 covers the backlog, the contract refresh, one capability gate, workspace correctness and the parity ledger.

**Architecture:**

- Each numbered PR below is a separate branch off `origin/main`, opened after the backlog in Task 1 has landed.
- The capability gate extends the existing `src/lib/api/capabilities.ts` with one pure rule, `capabilityAccess`, which reads `hidden_capabilities`. Nav, app tabs and pages all consult that rule.
- The ledger vendors faas's capability inventory and maps each GA, beta and preview row to a console surface. A Vitest test fails on any drift.

**Tech stack:** React 19, Vite, TanStack Router and Query, openapi-fetch (`api`, `unwrap`), Vitest with React Testing Library, Tailwind v4 tokens, Node scripts in `scripts/`. The dev mock lives in `mock/plugin.ts`.

**Spec:** `docs/superpowers/specs/2026-10-30-console-backend-parity-design.md`. Read it first. This plan implements its Wave 0 and fixes the procedure for Waves 1–3.

**Scope note:** this plan carries code for Wave 0 only. Each Wave 1–3 item needs its own reading of the backend, so it gets its own short plan when it starts (see "Waves 1–3" at the end). Writing that code now would be guesswork.

## Global constraints

- Read `CLAUDE.md` in faas-web before any task. Do not hand-edit `src/routeTree.gen.ts`, `src/lib/api/schema.d.ts`, `api/openapi.yaml`, `content/docs/*` or the new `content/capabilities/*`.
- Branch on `ApiError.code`, never on status or message. The one sanctioned exception is noted in place.
- Tokens only: no literal hex and no `dark:` in `src/components/dashboard` or `src/routes`.
- Every `/v1` path the mock answers must exist in `api/openapi.yaml` (`mock-spec-drift.test.ts`). Mock routes are declared at column 0 with `route(...)`.
- Every account money amount is USD (faas `pkg/financial/currency.go:7`, ADR-1430).
- Decide behaviour from faas `main` source. Write a "What the backend does" section in each PR body, with file:line references. Do not leave questions for the backend owner.
- Run these before every commit that ends a task:
  - `npx tsc --noEmit` exits 0.
  - `npm run lint` reports 0 errors and at most 4 warnings.
  - `npx prettier --check <touched files>` passes.
  - `npx vitest run --maxWorkers=8` exits 0 and prints no "Errors" line.
- Before review, click through every PR that changes UI in headless Chromium against `MOCK_API=1 npx vite --port <free port>`, at 1440 and 390 px. Use playwright-core from `/home/bahadir/GREGALE/launch-video/node_modules/playwright-core`. Log in through these localStorage keys: `gregale.session` = `{"email":"design@gregale.dev"}`, `gregale.onboarded` = `true`, `gregale.dev-bypass` = `true`.
- Upstream reference: faas `933e4fe5d7`. If faas `main` has moved by the time a task starts, re-check the cited lines before relying on them.

## Review focus

The five failure modes below are the most likely to reach a person, yet no feature test would naturally catch them. Each one has a pinning test in the task that owns the code.

1. **A gated tab before the registry answers, or when the registry errors.** Tabs must not vanish and reappear, and a deep link (`?tab=Debugger`) to a tab that is off must show the "not enabled" notice, not a blank panel or a 404 toast. Pinned in Task 6.
2. **A server without the capability gate.** `hidden_capabilities` is omitted, so every capability must count as on. Hiding everything would blank half the console on a self-hosted install. Pinned in Task 5.
3. **An upload interrupted mid-chunk, or answered 409 for an offset mismatch.** The upload resumes from the server's `received_bytes` instead of restarting or failing. A lost commit reply is recovered with the same `Deployment-Attempt-ID`, not by re-submitting. Pinned in Task 4.
4. **A company workspace where the member's role can't read billing.** The org billing routes answer 403. The page says whose billing it is and why it can't be shown; it doesn't crash or fall back to personal data. Pinned in Task 8.
5. **An upstream inventory row renamed or renumbered.** The ledger test names the row and both names, so the fix is obvious. It must not just fail a count. Pinned in Task 12.

---

### Task 1: Land the backlog

No code. This is the gate before every later task. Spec §0.1.

**Files:** none. This task produces the PR states below.

- [ ] **Step 1: Refresh the list.**

```bash
gh pr list --repo poyrazK/faas-web --state open --limit 60 --json number,title,isDraft,mergeable,updatedAt \
  -q '.[] | "#\(.number) draft=\(.isDraft) \(.mergeable) \(.updatedAt[0:10]) \(.title)"'
```

Expected: the 26 PRs named in the spec, or fewer if some have merged since. Anything new that isn't in the spec table gets a disposition from the same rules before you continue.

- [ ] **Step 2: Mark the console DX stack ready, in landing order.**

```bash
for n in 204 206 207 211 205 208 210 212; do gh pr ready $n --repo poyrazK/faas-web; done
```

Landing order: #204, then #206 (stacked on it), #207, then #211 (stacked on it), #205, #208, #210, #212. After each merge, rebase the next PR onto `main` and run the four verification commands from Global constraints before asking for review again. Two conflicts are already known:

- the Domains table, between #206 and #208;
- `useFreshRestart`, between #204 and #211. Keep one copy, in `src/lib/api/queries.ts`.

- [ ] **Step 3: Close the superseded PRs.** Ask Bahadir first: closing a PR is visible to others.

```bash
gh pr close 22  --repo poyrazK/faas-web --comment "Superseded by the console–backend parity plan (docs/superpowers/specs/2026-10-30-console-backend-parity-design.md); its surfaces are re-derived from the parity ledger."
gh pr close 123 --repo poyrazK/faas-web --comment "Superseded by parity Wave 2 row H152 (budgets), which rebuilds this on the current budgets API including alert channels."
```

- [ ] **Step 4: Rebase or fold the rest.**
  - #125 rebases into row G137 (Wave 2), #143 into H151 (Wave 1), #168 into A16 (Wave 1). For each, rebase onto `main`, run the verification commands, and either land it or close it with a comment naming the ledger row that replaces it.
  - #195 (Poyraz's) lands as it is.
  - #202 lands together with Task 2.
  - #170 stays parked.
  - Site, landing, docs and security PRs are outside this plan.

- [ ] **Step 5: Record the outcome.** Add a "Backlog outcome" table to the spec's §0.1 with one row per PR: final state and merge commit. Commit it on the spec branch.

```bash
git add docs/superpowers/specs/2026-10-30-console-backend-parity-design.md
git commit -m "docs(parity): record the backlog outcome"
```

---

### Task 2: Show account money in USD (PR "fix(console): account amounts are USD")

Branch: `fix/console-usd`. If #202 is still open, rebase onto it so the landing plan catalog and the console agree.

**Files:**

- Create: `src/lib/money.ts`, `src/lib/money.test.ts`
- Modify:
  - `src/components/dashboard/spend-control.tsx` (`eur` at :17–18, copy at :189)
  - `src/components/dashboard/spend-cap.tsx` (:11, :15–17, :109)
  - `src/components/dashboard/outbound/outbound-format.tsx:17`
  - `src/routes/dashboard.index.tsx:70`
  - `src/routes/will-it-run.tsx:331`
  - `src/routes/dashboard.usage.tsx:39`
  - `src/components/dashboard/needs-attention.tsx:152` (comment)
  - `src/components/dashboard/spend-control.test.ts` (test title)

**Interfaces:**

- Produces: `ACCOUNT_CURRENCY: 'USD'`, `formatCents(cents: number): string`, `formatMillicents(millicents: number): string`, all in `@/lib/money`.

- [ ] **Step 1: Write the failing tests.**

```ts
// src/lib/money.test.ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_CURRENCY, formatCents, formatMillicents } from './money';

describe('account money', () => {
  it('is USD, as apid reports it (faas pkg/financial/currency.go)', () => {
    expect(ACCOUNT_CURRENCY).toBe('USD');
  });
  it('formats cents and millicents as dollars', () => {
    expect(formatCents(2000)).toBe('$20.00');
    expect(formatCents(0)).toBe('$0.00');
    expect(formatMillicents(412_000)).toBe('$4.12');
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [full] : [];
  });
}

describe('no euro amounts in the console', () => {
  // The landing plan catalog parses upstream docs/plans.md and owns its own
  // currency (see plan-catalog-parser.ts); everything else is account money.
  const files = walk(resolve('src')).filter((f) => !/plan-catalog/.test(f));
  it.each(files.map((f) => [f.replace(resolve('.') + '/', ''), f]))(
    '%s formats no EUR amount',
    (_name, file) => {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(/currency:\s*'EUR'/);
      expect(text).not.toMatch(/€/);
    }
  );
});
```

- [ ] **Step 2: Run the tests and confirm they fail.**

Run: `npx vitest run src/lib/money.test.ts`
Expected: FAIL. `./money` doesn't exist yet, and the scan names `spend-control.tsx`, `spend-cap.tsx`, `outbound-format.tsx`, `dashboard.index.tsx`, `will-it-run.tsx`, `dashboard.usage.tsx` and `needs-attention.tsx`.

- [ ] **Step 3: Implement `src/lib/money.ts`.**

```ts
/**
 * Every amount apid reports for an account (overage, caps, forecasts, invoices,
 * outbound AI cost) is in US dollars: faas `pkg/financial/currency.go` and
 * ADR-1430. One formatter, so a currency change is one line.
 */
export const ACCOUNT_CURRENCY = 'USD' as const;

const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: ACCOUNT_CURRENCY });

/** Integer cents, as the overage cap and invoices carry them. */
export function formatCents(cents: number): string {
  return dollars.format(cents / 100);
}

/** Integer millicents (1/1000 of a cent), as forecasts and AI usage carry them. */
export function formatMillicents(millicents: number): string {
  return dollars.format(millicents / 100_000);
}
```

- [ ] **Step 4: Replace every call site.**
  - In `spend-control.tsx`, delete the `eur` helper. Change `eur(x)` to `formatCents(x)`. The forecast line now passes millicents directly: replace `{eur(projected / 1000)}` with `{formatMillicents(projected)}`. In the description at :189, change `€0` to `$0`.
  - In `spend-cap.tsx`:
    - `capLabel` builds `money` with `formatCents(cents)`.
    - `DESCRIPTION` says `$0`.
    - The toast at :109 becomes `` `Spend cap set to ${formatCents(value)}` ``.
  - In `outbound-format.tsx:17`, return `formatMillicents(value)`.
  - In `dashboard.index.tsx:70`, `will-it-run.tsx:331` and `dashboard.usage.tsx:39`, replace each local `Intl.NumberFormat(... 'EUR' ...)` helper's body with `formatCents(...)` or `formatMillicents(...)`. Use whichever matches the unit the helper divided by: `/ 100` means cents, `/ 100_000` means millicents.
  - In `needs-attention.tsx:152`, the comment says `$0`.
  - In `spend-control.test.ts`, rename the test `'treats a €0 cap …'` to `'treats a $0 cap …'`.

- [ ] **Step 5: Run the tests and confirm they pass.**

Run: `npx vitest run src/lib/money.test.ts src/components/dashboard/spend-control.test.ts src/routes/dashboard.usage.test.tsx`
Expected: PASS. If a usage test asserted a `€` string, update the expectation to the `$` form; the old value was the bug.

- [ ] **Step 6: Verify and commit.** Run all four verification commands.

```bash
git add src/lib/money.ts src/lib/money.test.ts src/components/dashboard/spend-control.tsx src/components/dashboard/spend-control.test.ts src/components/dashboard/spend-cap.tsx src/components/dashboard/outbound/outbound-format.tsx src/routes/dashboard.index.tsx src/routes/will-it-run.tsx src/routes/dashboard.usage.tsx src/components/dashboard/needs-attention.tsx
git commit -m "fix(console): show account amounts in USD

apid's forecast enum is USD only (faas pkg/financial/currency.go:7,
ADR-1430), and the console still formatted forecasts, caps, usage and AI
cost in EUR. One formatter in lib/money.ts, and a test that fails on any
euro amount outside the plan catalog."
```

---

### Task 3: Re-vendor the spec and fix what stops compiling (PR "chore(api): re-vendor faas spec")

Branch: `chore/revendor-spec`. The generated diff is about 170k lines, so keep the hand-written diff small. Spec §0.2, item 2.

**Files:**

- Modify (regenerated): `api/openapi.yaml`, `src/lib/api/schema.d.ts`
- Modify: `src/lib/release-process.ts`, `src/lib/release-process.test.ts`
- Modify: `src/lib/service-policy.ts:10`, `src/lib/api/bindings.ts:17`, `src/components/dashboard/service-policy-editor.tsx:277-278`
- Modify: `src/components/dashboard/trigger-form-model.ts:5,50,83`, `src/components/dashboard/trigger-create.tsx:27-33` and its `RECOVERY` map
- Modify: `src/components/dashboard/outbound/ai-gateway.tsx:139` (`BUDGET_LABELS`)
- Modify: `mock/events.ts` (AI route, usage item and alert fixtures near :516, :823, :877)
- Modify: `src/lib/api/cache.contract.test.ts:27`, `src/test/edge-rules.ts:10-19`
- Modify: the `PRESETS` map in `release-process.ts:73`
- Test: `src/lib/release-process.test.ts`, `src/lib/service-policy.test.ts` (create if absent), `src/components/dashboard/trigger-form-model.test.ts` (create if absent)

**Interfaces:**

- Produces:
  - `readStageState(raw: unknown): StageState | undefined`, where `StageState['current']` is `StageName | ''` and history rows carry `started_at`, `ended_at`, `duration_ms` and `status: 'completed' | 'failed' | 'cancelled'`;
  - `ServiceBindingPolicy = 'account' | 'declared' | 'project'`;
  - `CreatableBrokerKind = 'kafka' | 'nats' | 'redis_streams' | 'queue'`.

- [ ] **Step 1: Pull the spec and regenerate the types.**

```bash
npm run api:pull
git -C /home/bahadir/GREGALE/faas fetch -q origin && git -C /home/bahadir/GREGALE/faas rev-parse --short origin/main
npx tsc --noEmit 2>&1 | tee /tmp/revendor-tsc.txt | tail -20
```

Expected: about 9 errors, in `release-process.ts`, `service-policy.ts`, `trigger-create.tsx`, `trigger-form-model.ts`, `ai-gateway.tsx` and `mock/events.ts`. Record the faas sha in the commit body.

- [ ] **Step 2: Write the failing stage-state tests.** Add to `src/lib/release-process.test.ts`, inside `describe('readStageState', …)`:

```ts
it('reads an idle stage as no current stage, not an unknown one', () => {
  const state = readStageState({
    current: '',
    history: [
      {
        name: 'image_build',
        status: 'completed',
        started_at: null,
        ended_at: null,
        duration_ms: 4000,
      },
    ],
  });
  expect(state?.current).toBe('');
  expect(state?.history[0]).toMatchObject({
    name: 'image_build',
    status: 'completed',
    duration_ms: 4000,
  });
});

it('keeps cancelled stage rows instead of dropping them', () => {
  const state = readStageState({
    current: '',
    history: [{ name: 'image_build', status: 'cancelled', duration_ms: 10 }],
  });
  expect(state?.history.map((r) => r.status)).toEqual(['cancelled']);
});
```

And, inside the `releaseProcess` describe, using the file's existing `Deployment` fixture helper. Read the top of the test file for its name: it builds deployments with defaults and is used as `states(...)` at :32.

```ts
it('shows a cancelled build as skipped with the reason, not as pending', () => {
  const phases = releaseProcess({
    ...baseDeployment,
    status: 'cancelled',
    stage_state: {
      current: '',
      history: [{ name: 'image_build', status: 'cancelled', duration_ms: 10 }],
    },
  } as Deployment);
  expect(phases.find((p) => p.key === 'build')).toMatchObject({
    state: 'skipped',
    detail: 'image build cancelled',
  });
});
```

If the file's fixture isn't called `baseDeployment`, use the name it actually has.

- [ ] **Step 3: Run the tests and confirm they fail.**

Run: `npx vitest run src/lib/release-process.test.ts`
Expected: FAIL. The new upstream type doesn't compile against the old reader (`current` is `undefined`), and the cancelled row is dropped.

- [ ] **Step 4: Rewrite `readStageState` and the build-phase reader.** In `src/lib/release-process.ts`:

```ts
type StageRow = StageState['history'][number];
const ROW_STATUSES: readonly StageRow['status'][] = ['completed', 'failed', 'cancelled'];
const isRowStatus = (value: unknown): value is StageRow['status'] =>
  typeof value === 'string' && (ROW_STATUSES as readonly string[]).includes(value);
const isoOrNull = (value: unknown) => (typeof value === 'string' ? value : null);

/** Keep only well-formed stage rows; anything else is treated as not recorded. */
export function readStageState(raw: unknown): StageState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as Record<string, unknown>;
  const history: StageRow[] = Array.isArray(value.history)
    ? value.history.flatMap((row) => {
        if (!row || typeof row !== 'object') return [];
        const r = row as Record<string, unknown>;
        if (!isStage(r.name) || !isRowStatus(r.status)) return [];
        return [
          {
            name: r.name,
            status: r.status,
            started_at: isoOrNull(r.started_at),
            ended_at: isoOrNull(r.ended_at),
            duration_ms: typeof r.duration_ms === 'number' ? r.duration_ms : 0,
            reason: typeof r.reason === 'string' ? r.reason : undefined,
          },
        ];
      })
    : [];
  // apid sends '' when no stage is running (DeploymentStageState.current).
  const current = isStage(value.current) ? value.current : '';
  if (!history.length && !current) return undefined;
  return { current, history };
}
```

In `releaseProcess`:

- Change `const current = stage?.current;` to `const current = stage?.current || undefined;`.
- Inside `prep`, right after the `failed` branch, add:

```ts
const cancelled = rows.find((row) => row.status === 'cancelled');
if (cancelled)
  return {
    key,
    label: LABELS[key],
    state: 'skipped',
    detail: `${cancelled.name.replace(/_/g, ' ')} cancelled`,
  };
```

Then change the "done" branch to sum only completed rows. Replace `if (rows.length) {` and the `ms` line with:

```ts
const completed = rows.filter((row) => row.status === 'completed');
if (completed.length) {
  const ms = completed.reduce((sum, row) => sum + row.duration_ms, 0);
```

Add the new canary preset to `PRESETS`: `adaptive: 'adaptive canary',`.

- [ ] **Step 5: Write the failing policy and trigger tests.**

```ts
// src/lib/service-policy.test.ts (add, or append to the existing file)
import { describe, expect, it } from 'vitest';
import { draftFromServicePolicy } from './service-policy';

describe('service binding policy', () => {
  it('keeps a project policy instead of reading it as account', () => {
    const draft = draftFromServicePolicy({ service_binding_policy: 'project' } as never);
    expect(draft.policy).toBe('project');
  });
});
```

```ts
// src/components/dashboard/trigger-form-model.test.ts (add, or append)
import { describe, expect, it } from 'vitest';
import { allowedBrokerKinds } from './trigger-form-model';

describe('creatable trigger kinds', () => {
  it('never offers sqs_compat or realtime, even if a plan lists them', () => {
    // apid refuses sqs_compat with 422 trigger_kind_unavailable since faas
    // d69c41b965; realtime triggers are created from the Realtime surface (Wave 3).
    const kinds = allowedBrokerKinds({
      triggers_allowed: true,
      trigger_kinds: ['kafka', 'sqs_compat', 'realtime', 'queue'],
    } as never);
    expect(kinds).toEqual(['kafka', 'queue']);
  });
});
```

Add a render test for the editor. Put it in the existing `service-policy-editor` test file if there is one, and copy its render helper:

```tsx
it('offers the project policy', async () => {
  renderEditor(); // the file's existing helper
  expect(
    screen.getByRole('option', { name: 'Project services, declared targets elsewhere' })
  ).toBeInTheDocument();
});
```

- [ ] **Step 6: Run the tests and confirm they fail.**

Run: `npx vitest run src/lib/service-policy.test.ts src/components/dashboard/trigger-form-model.test.ts src/components/dashboard/service-policy-editor.test.tsx`
Expected: FAIL. `policy` collapses to `'account'`, `sqs_compat` is offered, and the option is missing.

- [ ] **Step 7: Implement.**
  - `src/lib/service-policy.ts:10`: `policy: 'account' | 'declared' | 'project';`
  - `src/lib/api/bindings.ts:17`: `service_binding_policy?: 'account' | 'declared' | 'project';`
  - `service-policy-editor.tsx`: after the Declared option, add `<option value="project">Project services, declared targets elsewhere</option>`. The label follows faas `pkg/api/service_bindings.go:25-28`: any service in its own project, and declared bindings for everything else.
  - `trigger-form-model.ts`:

```ts
export type BrokerKind = Exclude<S['TriggerKind'], 'cron'>;
/** Kinds the console creates. sqs_compat is refused (faas d69c41b965); realtime is Wave 3. */
export type CreatableBrokerKind = Extract<BrokerKind, 'kafka' | 'nats' | 'redis_streams' | 'queue'>;
const CREATABLE: CreatableBrokerKind[] = ['kafka', 'nats', 'redis_streams', 'queue'];

export function allowedBrokerKinds(limits: TriggerLimits): CreatableBrokerKind[] {
  if (!limits.triggers_allowed) return [];
  return limits.trigger_kinds.filter((kind): kind is CreatableBrokerKind =>
    CREATABLE.includes(kind as CreatableBrokerKind)
  );
}
```

- Change the signature `sourceDraft(kind: BrokerKind)` to `sourceDraft(kind: CreatableBrokerKind)`, and delete its `case 'sqs_compat':` branch. Existing `sqs_compat` triggers are still read through the other functions, which keep their branches.
- `trigger-create.tsx`: make the labels `Record<CreatableBrokerKind, string>` and drop `sqs_compat`. Add a `RECOVERY` entry: `trigger_kind_unavailable: 'That event source is no longer offered. Use a Platform queue trigger instead.',`.
- In `trigger-detail.tsx` and `trigger-source-fields.tsx`, wherever a kind is shown from a `Record`, add `realtime: 'Realtime channel'` if tsc asks for it.
- `ai-gateway.tsx`, `BUDGET_LABELS`: `tag_daily_cost: 'Tag daily cost',`.
- `mock/events.ts`:
  - In the `aiRoutes` fixture, add `strategy: 'ordered',`.
  - In the AI usage item, add zeroes for `bad_feedback`, `cache_saved_millicents`, `cached_requests`, `code_session_gb`, `empty_requests`, `evaluated_requests`, `evaluation_errors`, `evaluation_score_sum`, `file_searches`, `good_feedback`, `input_audio_tokens`, `invalid_json_requests`, `output_audio_tokens`, `prompt_cache_saved_millicents`, `refused_requests`, `tool_error_requests`, `truncated_requests`, `video_seconds` and `web_searches`.
  - In the AI alert, add `tag: null`.

- [ ] **Step 8: Flip the cache tripwire.** It was written to fail once upstream fixed the edge-rule union.
  - In `src/lib/api/cache.contract.test.ts:27`, change `it.fails(` to `it(` and delete the comment above it that explains the tripwire.
  - In `src/test/edge-rules.ts`, the cache action is now in the union, so drop the cast:

```ts
import type { EdgeRule } from '@/lib/api/queries';

export type CacheEdgeRule = Extract<EdgeRule, { kind: 'cache' }>;

/** A cache edge rule fixture; the upstream union now carries `kind: 'cache'` (ADR-122). */
export function cacheEdgeRule(rule: CacheEdgeRule): EdgeRule {
  return rule;
}
```

If `Extract` yields `never` because `EdgeRule` isn't a discriminated union on `kind`, keep the old `Omit<...> & { kind: 'cache'; action: CacheAction }` type, still return `rule` without the cast, and let tsc confirm it is assignable.

- [ ] **Step 9: Run the tests and confirm they pass.**

Run: `npx tsc --noEmit && npx vitest run src/lib/release-process.test.ts src/lib/service-policy.test.ts src/components/dashboard/trigger-form-model.test.ts src/lib/api/cache.contract.test.ts src/components/dashboard/service-policy-editor.test.tsx mock/events.test.ts`
Expected: tsc exits 0, and every listed test passes.

- [ ] **Step 10: Verify and commit.** Run all four verification commands.

```bash
git add -A
git commit -m "chore(api): re-vendor the faas spec at <sha>

Regenerates schema.d.ts and fixes what stopped compiling:
- stage state: current may be '' and history keeps cancelled rows
  (DeploymentStageState); a cancelled phase reads as skipped
- service_binding_policy gains 'project' (faas pkg/api/service_bindings.go:25)
- trigger create no longer offers sqs_compat (422 since faas d69c41b965);
  realtime triggers are Wave 3
- AI gateway budget tag_daily_cost, adaptive canary preset, mock fixtures
- the cache-action tripwire flips: upstream restored EdgeRuleCacheAction"
```

---

### Task 4: Deploy a tarball through resumable uploads (PR "feat(console): resumable tarball deploys")

Branch: `feat/resumable-uploads`. Spec §0.2, item 3.

- `POST /v1/apps/{slug}/deployments/source-tarball` is deprecated. Its documented sunset was 2026-10-01.
- Its replacement is:
  - `POST /v1/uploads` with `{app_slug, total_size, sha256_hex?, deploy_options?}`, which returns `201 {upload_id, chunk_size, total_size, expires_at}`.
  - `PATCH /v1/uploads/{id}` with an `Upload-Offset` header and an `application/offset+octet-stream` body. A 409 means the offset is wrong.
  - `GET /v1/uploads/{id}`, which returns `received_bytes`.
  - `POST /v1/uploads/{id}/commit` with an optional `Deployment-Attempt-ID` header (32 hex). It answers 201 with the deployment, or 202 when it recovers an attempt that was already accepted.

**Files:**

- Create: `src/lib/api/uploads.ts`, `src/lib/api/uploads.test.ts`
- Modify: `src/lib/api/queries.ts:3534-3563` (`useDeployTarball`)
- Modify: `src/components/dashboard/tarball-deploy.tsx` (progress line), `src/components/dashboard/tarball-deploy.test.tsx`
- Modify: `mock/plugin.ts` (four routes)

**Interfaces:**

- Produces:
  - `uploadTarball(input: { slug: string; file: Blob; options?: DeployOptions; onProgress?: (sent: number, total: number) => void; signal?: AbortSignal }): Promise<Deployment>`
  - `type DeployOptions = components['schemas']['UploadDeployOptions']`
  - `useDeployTarball(slug)` keeps its name. Its `mutationFn` input becomes `{ file: File; options?: DeployOptions; onProgress? }`.

- [ ] **Step 1: Write the failing tests.** Stub `fetch` and assert the protocol.

```ts
// src/lib/api/uploads.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadTarball } from './uploads';

type Call = { method: string; url: string; headers: Headers; size?: number };

function server(script: (call: Call) => Response) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const body = req.method === 'PATCH' ? await req.arrayBuffer() : undefined;
    const call = {
      method: req.method,
      url: new URL(req.url).pathname,
      headers: req.headers,
      size: body?.byteLength,
    };
    calls.push(call);
    return script(call);
  });
  return calls;
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('uploadTarball', () => {
  it('opens a session, sends chunks at the server chunk size, and commits with an attempt id', async () => {
    const calls = server((c) => {
      if (c.method === 'POST' && c.url === '/v1/uploads')
        return json(201, { upload_id: 'u1', chunk_size: 4, total_size: 10, expires_at: '' });
      if (c.method === 'PATCH') return new Response(null, { status: 200 });
      if (c.url === '/v1/uploads/u1/commit') return json(201, { id: 'dep-1' });
      return json(500, {});
    });
    const progress: number[] = [];
    const dep = await uploadTarball({
      slug: 'alpha',
      file: new Blob(['0123456789']),
      onProgress: (sent) => progress.push(sent),
    });
    expect(dep.id).toBe('dep-1');
    const patches = calls.filter((c) => c.method === 'PATCH');
    expect(patches.map((c) => [c.headers.get('upload-offset'), c.size])).toEqual([
      ['0', 4],
      ['4', 4],
      ['8', 2],
    ]);
    expect(patches[0].headers.get('content-type')).toBe('application/offset+octet-stream');
    expect(progress).toEqual([4, 8, 10]);
    const commit = calls.at(-1)!;
    expect(commit.headers.get('deployment-attempt-id')).toMatch(/^[0-9a-f]{32}$/);
  });

  it('resumes from the server offset after a 409 instead of restarting', async () => {
    let patched = 0;
    const calls = server((c) => {
      if (c.method === 'POST' && c.url === '/v1/uploads')
        return json(201, { upload_id: 'u2', chunk_size: 5, total_size: 10, expires_at: '' });
      if (c.method === 'PATCH') {
        patched += 1;
        if (patched === 2) return json(409, { code: 'conflict', title: 'offset', status: 409 });
        return new Response(null, { status: 200 });
      }
      if (c.method === 'GET')
        return json(200, {
          upload_id: 'u2',
          received_bytes: 5,
          total_size: 10,
          chunk_size: 5,
          status: 'open',
          app_slug: 'alpha',
          expires_at: '',
        });
      if (c.url === '/v1/uploads/u2/commit') return json(201, { id: 'dep-2' });
      return json(500, {});
    });
    await uploadTarball({ slug: 'alpha', file: new Blob(['abcdefghij']) });
    expect(
      calls.filter((c) => c.method === 'PATCH').map((c) => c.headers.get('upload-offset'))
    ).toEqual(['0', '5', '5']);
  });

  it('recovers a lost commit reply with the same attempt id', async () => {
    let commits = 0;
    const calls = server((c) => {
      if (c.method === 'POST' && c.url === '/v1/uploads')
        return json(201, { upload_id: 'u3', chunk_size: 10, total_size: 3, expires_at: '' });
      if (c.method === 'PATCH') return new Response(null, { status: 200 });
      if (c.url === '/v1/uploads/u3/commit') {
        commits += 1;
        if (commits === 1) throw new TypeError('Failed to fetch');
        return json(202, { id: 'dep-3' });
      }
      return json(500, {});
    });
    const dep = await uploadTarball({ slug: 'alpha', file: new Blob(['abc']) });
    expect(dep.id).toBe('dep-3');
    const ids = calls
      .filter((c) => c.url.endsWith('/commit'))
      .map((c) => c.headers.get('deployment-attempt-id'));
    expect(ids[0]).toBe(ids[1]);
  });
});
```

`server`'s script may throw. The stub rethrows it as a network failure, which is what the third test relies on.

- [ ] **Step 2: Run the tests and confirm they fail.**

Run: `npx vitest run src/lib/api/uploads.test.ts`
Expected: FAIL with "Cannot find module './uploads'".

- [ ] **Step 3: Implement `src/lib/api/uploads.ts`.**

```ts
import { api, unwrap } from './client';
import { ApiError } from './errors';
import type { components } from './schema';

export type DeployOptions = components['schemas']['UploadDeployOptions'];
type Deployment = components['schemas']['DeploymentResponse'];

/** 32 lowercase hex characters, the shape apid requires for Deployment-Attempt-ID. */
function attemptId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

const COMMIT_ATTEMPTS = 3;

/**
 * The console's half of `gregale deploy --tarball`, on the resumable upload
 * session that replaced the multipart route (deprecated upstream). Chunks go
 * at the server's chunk size; a 409 re-reads the server offset and resumes;
 * the commit carries one Deployment-Attempt-ID across retries, so a lost reply
 * is recovered (202) rather than deployed twice.
 */
export async function uploadTarball(input: {
  slug: string;
  file: Blob;
  options?: DeployOptions;
  onProgress?: (sent: number, total: number) => void;
  signal?: AbortSignal;
}): Promise<Deployment> {
  const { slug, file, options, onProgress, signal } = input;
  const session = await unwrap(
    api.POST('/v1/uploads', {
      body: {
        app_slug: slug,
        total_size: file.size,
        sha256_hex: await sha256Hex(file),
        ...(options ? { deploy_options: options } : {}),
      },
      signal,
    })
  );
  let offset = 0;
  while (offset < file.size) {
    const chunk = file.slice(offset, offset + session.chunk_size);
    try {
      await unwrap(
        api.PATCH('/v1/uploads/{id}', {
          params: { path: { id: session.upload_id }, header: { 'Upload-Offset': offset } },
          body: chunk as never,
          bodySerializer: () => chunk,
          headers: { 'Content-Type': 'application/offset+octet-stream' },
          signal,
        })
      );
      offset += chunk.size;
    } catch (error) {
      // Branching on status, not code, is deliberate: apid documents the
      // offset mismatch only as a 409 on this route (openapi PATCH /v1/uploads/{id}).
      if (!(error instanceof ApiError) || error.status !== 409) throw error;
      const state = await unwrap(
        api.GET('/v1/uploads/{id}', { params: { path: { id: session.upload_id } }, signal })
      );
      offset = state.received_bytes;
    }
    onProgress?.(offset, file.size);
  }
  const attempt = attemptId();
  for (let i = 1; ; i++) {
    try {
      return await unwrap(
        api.POST('/v1/uploads/{id}/commit', {
          params: { path: { id: session.upload_id }, header: { 'Deployment-Attempt-ID': attempt } },
          signal,
        })
      );
    } catch (error) {
      // Only a reply that never arrived is retried; an API refusal is final.
      if (error instanceof ApiError || i >= COMMIT_ATTEMPTS) throw error;
    }
  }
}
```

If openapi-fetch's types reject `params.header` for a header the spec marks as a parameter, pass it through `headers: { 'Upload-Offset': String(offset) }` instead and remove it from `params`. Let tsc decide.

- [ ] **Step 4: Run the tests and confirm they pass.**

Run: `npx vitest run src/lib/api/uploads.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Move the hook and the component onto it.** In `queries.ts`, replace the body of `useDeployTarball`:

```ts
export function useDeployTarball(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      file: File;
      options?: DeployOptions;
      onProgress?: (sent: number, total: number) => void;
    }) => uploadTarball({ slug, ...input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.deployments });
      void qc.invalidateQueries({ queryKey: keys.appDeployments(slug) });
    },
  });
}
```

Import `uploadTarball` and `type DeployOptions` from `./uploads`, and update the doc comment above the hook to name the upload session. Then, in `tarball-deploy.tsx`:

- Rename `sidecar:` to `options:`. The reason and tag fields exist on `UploadDeployOptions`.
- Add `const [sent, setSent] = useState<number | null>(null);` and pass `onProgress: (s, t) => setSent(Math.round((s / t) * 100))`.
- Render `{sent !== null && deploy.isPending && <p className="text-xs text-muted-foreground" role="status">Uploading… {sent}%</p>}` under the button.
- Reset `sent` to `null` in both the success and the error paths.

In `tarball-deploy.test.tsx`, change the expected `mutateAsync` argument from `sidecar` to `options`.

- [ ] **Step 6: Add the mock routes.** These go in `mock/plugin.ts`, at column 0, near the other deployment routes. The sessions live in memory.

```ts
const uploads = new Map<
  string,
  { slug: string; total: number; received: number; deployment?: string }
>();
route('POST', '/v1/uploads', ({ body }) => {
  const id = randomUUID();
  uploads.set(id, { slug: String(body.app_slug), total: Number(body.total_size), received: 0 });
  return status(201, {
    upload_id: id,
    chunk_size: 1_048_576,
    total_size: Number(body.total_size),
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  });
});
route('GET', '/v1/uploads/{id}', ({ params }) => {
  const u = uploads.get(params.id);
  if (!u) throw new Problem(404, 'not_found', 'No such upload session.');
  return {
    upload_id: params.id,
    app_slug: u.slug,
    chunk_size: 1_048_576,
    total_size: u.total,
    received_bytes: u.received,
    status: u.received >= u.total ? 'complete' : 'open',
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  };
});
route('PATCH', '/v1/uploads/{id}', ({ params, req }) => {
  const u = uploads.get(params.id);
  if (!u) throw new Problem(404, 'not_found', 'No such upload session.');
  if (Number(req.headers['upload-offset']) !== u.received)
    throw new Problem(409, 'conflict', 'Upload-Offset does not match the received bytes.');
  u.received += Number(req.headers['content-length'] ?? 0);
  return {};
});
route('POST', '/v1/uploads/{id}/commit', ({ params }) => {
  const u = uploads.get(params.id);
  if (!u) throw new Problem(404, 'not_found', 'No such upload session.');
  if (u.deployment) return status(202, findDeployment(u.deployment));
  const dep = createSourceDeployment(u.slug); // use the helper the source-tarball route uses
  u.deployment = dep.id;
  return status(201, dep);
});
```

Find the existing `POST /v1/apps/{slug}/deployments/source-tarball` handler. Reuse its deployment-creating code for `createSourceDeployment`, and its lookup for `findDeployment`; if it inlines that code, extract both into two local functions. `readBody` consumes the PATCH body as text, so count bytes from `content-length`, not from `body`. Keep the old route: apid still serves it.

- [ ] **Step 7: Click through.** Run the mock server, open an app, then go to Deployments → Deploy an archive and upload a small `.tar.gz`. Expect "Uploading… 100%", a "Build accepted" toast, and a new deployment walking its lifecycle. The network log must show `POST /v1/uploads`, then `PATCH`, then `POST …/commit`, and nothing hitting `source-tarball`.

- [ ] **Step 8: Verify and commit.** Run all four verification commands.

```bash
git add src/lib/api/uploads.ts src/lib/api/uploads.test.ts src/lib/api/queries.ts src/components/dashboard/tarball-deploy.tsx src/components/dashboard/tarball-deploy.test.tsx mock/plugin.ts
git commit -m "feat(console): deploy tarballs through resumable upload sessions

POST /v1/apps/{slug}/deployments/source-tarball is deprecated (faas
api/openapi.yaml; sunset 2026-10-01). The console now opens /v1/uploads,
sends chunks at the server's chunk size, resumes from received_bytes on
409, and commits with one Deployment-Attempt-ID so a lost reply recovers
(202) instead of deploying twice. Progress shows while uploading."
```

---

### Task 5: Capability access rule (PR "fix(console): one capability gate", part 1)

Branch: `fix/capability-gate`. This task depends on Task 3: `hidden_capabilities` has to be in the generated types.

**Files:**

- Modify: `src/lib/capability-state.ts`, `src/lib/api/capabilities.ts`
- Test: `src/lib/capability-state.test.ts` (create or extend), `src/lib/api/capabilities.test.tsx`

**Interfaces:**

- Produces:
  - `type CapabilityAccess = 'loading' | 'on' | 'off' | 'plan-not-entitled' | 'runtime-unavailable' | 'registry-error'`
  - `capabilityAccess(registry: CapabilityRegistry | undefined, id: string, phase: 'loading' | 'error' | 'ready'): CapabilityAccess`
  - `useCapabilityAccess(id: string): { access: CapabilityAccess; capability?: Capability; refresh: () => void }`

The rule (faas `handlers_capabilities.go:40-66`, `pkg/api/capabilities.go:25-39`):

- `hidden_capabilities` lists every catalog capability, internal ones included, whose flag is off for this account. A listed id is `off`.
- Internal capabilities never appear in `capabilities[]`, so an id that is absent from both lists is `on`. That is an internal capability released to this account.
- An entry that is present but has `enabled: false` is `plan-not-entitled` or `runtime-unavailable`, depending on its `unavailable_reason`.
- A server without the gate omits `hidden_capabilities`, which means nothing is hidden.

- [ ] **Step 1: Write the failing tests.**

```ts
// src/lib/capability-state.test.ts
import { describe, expect, it } from 'vitest';
import { capabilityAccess } from './capability-state';

const registry = (over: Record<string, unknown> = {}) =>
  ({
    registry_version: 1,
    plan: 'pro',
    capabilities: [
      { key: 'traffic-mirroring', maturity: 'preview', plans: ['pro'], enabled: true },
      {
        key: 'issues',
        maturity: 'preview',
        plans: ['scale'],
        enabled: false,
        unavailable_reason: 'plan_not_entitled',
      },
      {
        key: 'object-storage',
        maturity: 'preview',
        plans: ['pro'],
        enabled: false,
        unavailable_reason: 'runtime_unavailable',
      },
    ],
    ...over,
  }) as never;

describe('capabilityAccess', () => {
  it('waits for the registry, and reports a registry error as itself', () => {
    expect(capabilityAccess(undefined, 'issues', 'loading')).toBe('loading');
    expect(capabilityAccess(undefined, 'issues', 'error')).toBe('registry-error');
  });
  it('treats a hidden capability as off, internal ones included', () => {
    const r = registry({ hidden_capabilities: ['traffic-mirroring', 'route-insights'] });
    expect(capabilityAccess(r, 'traffic-mirroring', 'ready')).toBe('off');
    expect(capabilityAccess(r, 'route-insights', 'ready')).toBe('off');
  });
  it('treats an internal capability that is not hidden as released to this account', () => {
    expect(capabilityAccess(registry({ hidden_capabilities: [] }), 'route-insights', 'ready')).toBe(
      'on'
    );
  });
  it('treats everything as on when the server has no capability gate', () => {
    // hidden_capabilities is omitted by servers without the gate (faas handlers_capabilities.go:65)
    expect(capabilityAccess(registry(), 'route-insights', 'ready')).toBe('on');
    expect(capabilityAccess(registry(), 'traffic-mirroring', 'ready')).toBe('on');
  });
  it('keeps the plan and runtime reasons for listed entries', () => {
    expect(capabilityAccess(registry(), 'issues', 'ready')).toBe('plan-not-entitled');
    expect(capabilityAccess(registry(), 'object-storage', 'ready')).toBe('runtime-unavailable');
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail.**

Run: `npx vitest run src/lib/capability-state.test.ts`
Expected: FAIL, because `capabilityAccess` isn't exported.

- [ ] **Step 3: Implement.** Append to `src/lib/capability-state.ts`:

```ts
export type CapabilityAccess =
  'loading' | 'on' | 'off' | 'plan-not-entitled' | 'runtime-unavailable' | 'registry-error';

/**
 * Whether a catalog capability is usable by this account, read the way apid
 * decides it: `hidden_capabilities` names every capability whose flag is off,
 * internal ones included; internal ones are never listed in `capabilities`, so
 * an id absent from both is released to this account. A server without the
 * gate omits `hidden_capabilities`, which hides nothing.
 */
export function capabilityAccess(
  registry: CapabilityRegistry | undefined,
  id: string,
  phase: 'loading' | 'error' | 'ready'
): CapabilityAccess {
  if (phase === 'error') return 'registry-error';
  if (phase === 'loading' || !registry) return 'loading';
  if (registry.hidden_capabilities?.includes(id)) return 'off';
  const entry = registry.capabilities.find((c) => c.key === id);
  if (!entry || entry.enabled) return 'on';
  return entry.unavailable_reason === 'runtime_unavailable'
    ? 'runtime-unavailable'
    : 'plan-not-entitled';
}
```

Append to `src/lib/api/capabilities.ts`:

```ts
export function useCapabilityAccess(id: string) {
  const { query, phase } = useCapabilityRegistry();
  return {
    access: capabilityAccess(query.data, id, phase),
    capability: query.data?.capabilities.find((entry) => entry.key === id),
    refresh: () => void query.refetch(),
  };
}
```

Add `import { capabilityAccess } from '../capability-state';` alongside the existing import.

- [ ] **Step 4: Run the tests and confirm they pass.**

Run: `npx vitest run src/lib/capability-state.test.ts src/lib/api/capabilities.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/capability-state.ts src/lib/capability-state.test.ts src/lib/api/capabilities.ts
git commit -m "feat(console): read capability access the way apid decides it

hidden_capabilities names every capability whose flag is off, internal
ones included (faas handlers_capabilities.go:65); internal ones never appear
in capabilities[] (pkg/api/capabilities.go:39). An id absent from both is
on, and a server without the gate hides nothing."
```

---

### Task 6: Gate the app tabs, nav and wrongly keyed pages (PR "fix(console): one capability gate", part 2)

Same branch as Task 5.

- Since faas #5319, capgate answers 404 for an unreleased capability. The Routes, Upstreams, Mirrors, Tenant surfaces and Debugger tabs, the domain doctor and the supply-chain panel all hit that for default accounts.
- The automations editor checks `workflows-and-jobs`, but its capability is `automations`.
- Customers checks only `api-monetization`, but its tenant routes are `platform-tenants`.

**Files:**

- Modify: `src/components/dashboard/app-tab-navigation.tsx`
- Modify: `src/routes/dashboard.apps.$appSlug.tsx` (the tab bodies, around :668-726)
- Modify: `src/components/dashboard/nav-config.ts` (`NavItem.capability?`) and the sidebar and palette renderers that read nav-config. Find them with `grep -rln "NAV_GROUPS\|navGroups" src/components/dashboard`.
- Modify: `src/components/dashboard/automations-body.tsx:131`
- Modify: `src/components/dashboard/monetization-shared.tsx` (an optional `capability` prop on `MonetizationGate`), plus the Customers route that renders the tenant panels
- Modify: the domain-doctor panel and the supply-chain panel. Find them with `grep -rln "/doctor'\|/security'" src`.
- Create: `src/components/dashboard/capability-gate.tsx`
- Test: `src/components/dashboard/app-tab-navigation.test.tsx`, `src/components/dashboard/capability-gate.test.tsx`

**Interfaces:**

- Consumes: `useCapabilityAccess` and `CapabilityAccess` from Task 5.
- Produces:
  - `APP_TAB_CAPABILITY: Partial<Record<AppTab, string>>`
  - `visibleAppTabs(access: (id: string) => CapabilityAccess): AppTab[]`
  - `<CapabilityGate capability={id} title={string}>{children}</CapabilityGate>`

The tab-to-capability map, using faas `pkg/productcap/catalog.json` ids:

| Tab             | Capability                 | Tier     |
| --------------- | -------------------------- | -------- |
| Routes          | `route-insights`           | internal |
| Upstreams       | `data-upstreams`           | internal |
| Mirrors         | `traffic-mirroring`        | preview  |
| Tenant surfaces | `tenant-surfaces`          | preview  |
| Debugger        | `production-debugger`      | preview  |
| Issues, Errors  | `issues`                   | preview  |
| MCP             | `mcp-hosting`              | preview  |
| OpenAPI         | `openapi-contract-preview` | preview  |
| Consumers       | `api-consumers`            | internal |
| Consumer plans  | `api-monetization`         | internal |
| Automations     | `automations`              | internal |
| Queues          | `queues`                   | preview  |

Tabs not in the map are GA or beta and always show.

- [ ] **Step 1: Write the failing tests.**

```ts
// in src/components/dashboard/app-tab-navigation.test.tsx
import { visibleAppTabs, APP_TAB_CAPABILITY } from './app-tab-navigation';

describe('visibleAppTabs', () => {
  it('hides tabs whose capability is off and keeps GA tabs', () => {
    const tabs = visibleAppTabs((id) =>
      id === 'traffic-mirroring' || id === 'route-insights' ? 'off' : 'on'
    );
    expect(tabs).not.toContain('Mirrors');
    expect(tabs).not.toContain('Routes');
    expect(tabs).toContain('Deployments');
    expect(tabs).toContain('Debugger');
  });
  it('keeps every tab while the registry is loading or errored, so nothing flickers away', () => {
    expect(visibleAppTabs(() => 'loading')).toContain('Mirrors');
    expect(visibleAppTabs(() => 'registry-error')).toContain('Mirrors');
  });
  it('keeps a tab that is listed but not in the plan, so the upgrade notice can show', () => {
    expect(visibleAppTabs(() => 'plan-not-entitled')).toContain('Issues');
  });
  it('maps every gated tab to a catalog id', () => {
    expect(APP_TAB_CAPABILITY.Debugger).toBe('production-debugger');
    expect(APP_TAB_CAPABILITY.Automations).toBe('automations');
  });
});
```

```tsx
// src/components/dashboard/capability-gate.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CapabilityGate } from './capability-gate';

const access = vi.hoisted(() => ({ value: 'on' as string }));
vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: () => ({ access: access.value, capability: undefined, refresh: vi.fn() }),
}));

describe('CapabilityGate', () => {
  it('renders children only when on, so their queries never run otherwise', () => {
    access.value = 'on';
    render(
      <CapabilityGate capability="traffic-mirroring" title="Mirrors">
        <p>body</p>
      </CapabilityGate>
    );
    expect(screen.getByText('body')).toBeInTheDocument();
  });
  it('says the feature is not enabled and links to Previews when off (deep link to a hidden tab)', () => {
    access.value = 'off';
    render(
      <CapabilityGate capability="traffic-mirroring" title="Mirrors">
        <p>body</p>
      </CapabilityGate>
    );
    expect(screen.queryByText('body')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(/not enabled for this account/i);
    expect(screen.getByRole('link', { name: /previews/i })).toHaveAttribute(
      'href',
      '/dashboard/settings?section=previews'
    );
  });
  it('shows a spinner-free checking state while loading', () => {
    access.value = 'loading';
    render(
      <CapabilityGate capability="traffic-mirroring" title="Mirrors">
        <p>body</p>
      </CapabilityGate>
    );
    expect(screen.getByRole('status')).toHaveTextContent(/checking availability/i);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail.**

Run: `npx vitest run src/components/dashboard/app-tab-navigation.test.tsx src/components/dashboard/capability-gate.test.tsx`
Expected: FAIL, because these exports don't exist yet.

- [ ] **Step 3: Implement `capability-gate.tsx`.**

```tsx
import type { ReactNode } from 'react';
import { useCapabilityAccess } from '@/lib/api/capabilities';
import type { CapabilityAccess } from '@/lib/capability-state';
import { Panel } from './primitives';

const MESSAGES: Record<Exclude<CapabilityAccess, 'on'>, string> = {
  loading: 'Checking availability…',
  off: 'Not enabled for this account.',
  'plan-not-entitled': 'Not included in your plan.',
  'runtime-unavailable': 'Unavailable on this installation.',
  'registry-error': 'Availability could not be checked.',
};

/**
 * Renders `children` only when the account has the capability. Children mount,
 * and their queries run, only past the gate, so an unreleased feature never
 * calls a route apid answers with 404 (faas capgate, #5319).
 */
export function CapabilityGate({
  capability,
  title,
  children,
}: {
  capability: string;
  title: string;
  children: ReactNode;
}) {
  const { access, refresh } = useCapabilityAccess(capability);
  if (access === 'on') return <>{children}</>;
  return (
    <Panel title={title}>
      <div
        role="status"
        className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground"
      >
        <span>{MESSAGES[access]}</span>
        {access === 'off' && (
          <a className="text-brand underline" href="/dashboard/settings?section=previews">
            See previews you can join
          </a>
        )}
        {access === 'plan-not-entitled' && (
          <a className="text-brand underline" href="/dashboard/plans">
            View plans
          </a>
        )}
        {access === 'registry-error' && (
          <button type="button" className="text-brand underline" onClick={refresh}>
            Retry
          </button>
        )}
      </div>
    </Panel>
  );
}
```

The `?section=previews` link resolves once Task 7 adds the section. Until then it falls back to General, which is harmless.

- [ ] **Step 4: Implement the tab map and filter.** In `app-tab-navigation.tsx`:

```ts
import type { CapabilityAccess } from '@/lib/capability-state';

/** Catalog ids (faas pkg/productcap/catalog.json) for tabs that are not GA or beta. */
export const APP_TAB_CAPABILITY: Partial<Record<AppTab, string>> = {
  Routes: 'route-insights',
  Upstreams: 'data-upstreams',
  Mirrors: 'traffic-mirroring',
  'Tenant surfaces': 'tenant-surfaces',
  Debugger: 'production-debugger',
  Issues: 'issues',
  Errors: 'issues',
  MCP: 'mcp-hosting',
  OpenAPI: 'openapi-contract-preview',
  Consumers: 'api-consumers',
  'Consumer plans': 'api-monetization',
  Automations: 'automations',
  Queues: 'queues',
};

/** Hide a tab only once the registry has said its capability is off. */
export function visibleAppTabs(access: (id: string) => CapabilityAccess): AppTab[] {
  return APP_DETAIL_TABS.filter((tab) => {
    const id = APP_TAB_CAPABILITY[tab];
    return !id || access(id) !== 'off';
  });
}
```

`AppTabNavigation` then takes a `visible: readonly AppTab[]` prop:

- It filters each group's `tabs` by `visible`.
- It drops groups that end up with no tabs.

The caller in `dashboard.apps.$appSlug.tsx` computes `visible` with a hook. It reads the registry once and closes `capabilityAccess` over it:

```ts
const { query, phase } = useCapabilityRegistry();
const visible = visibleAppTabs((id) => capabilityAccess(query.data, id, phase));
```

In the same route file:

- Wrap each gated tab body in `<CapabilityGate capability={APP_TAB_CAPABILITY[tab]!} title={tab}>`. A deep link to a hidden tab then shows the notice instead of calling the route.
- If the selected `tab` isn't in `visible`, keep it selected so the notice renders. Don't redirect: the URL is the person's.

- [ ] **Step 5: Fix the wrong keys.**
  - `automations-body.tsx:131`: change `useCapability('workflows-and-jobs')` to `useCapability('automations')`. The tab is already gated, so the maturity label simply reads `''` for an internal capability, and that's correct.
  - `MonetizationGate`: add an optional `capability = MONETIZATION_CAPABILITY` prop and use it in `useCapability(capability)`. On the Customers route, wrap the tenant identity, link and suspend panels in `<MonetizationGate capability="platform-tenants" title=…>`. Rate cards and statements keep `api-monetization`. Both are internal and released per account, so check this one through `useCapabilityAccess`, not `useCapability`; the latter reports internal ones as `unknown`. Concretely, inside `MonetizationGate` replace `availability.state === 'available'` with `useCapabilityAccess(capability).access === 'on'`, and keep `CapabilityNotice` for the other states.
  - Domain doctor: wrap its panel in `<CapabilityGate capability="domain-doctor" title="Domain doctor">`.
  - Supply-chain panel (`PATCH /v1/apps/{slug}/security`): wrap it in `<CapabilityGate capability="signed-deploys" title="Supply chain">`.

- [ ] **Step 6: Gate the nav items.** Add `capability?: string` to `NavItem` in `nav-config.ts`. Set it on the items whose whole page is gated:
  - Storage → `object-storage`
  - Postgres → `managed-postgres`
  - Events → `events`
  - Integrations → `outbound-integrations`
  - Customers → `api-monetization`

  Where the sidebar, the breadcrumb and the ⌘K palette render items, filter out any whose `capability` is `off`, using the same `capabilityAccess` read. Add one case to `navigation.test.tsx`: with `hidden_capabilities: ['object-storage']` in the mocked registry, Storage is absent from the sidebar and the palette.

- [ ] **Step 7: Run the tests and confirm they pass.**

Run: `npx vitest run src/components/dashboard/app-tab-navigation.test.tsx src/components/dashboard/capability-gate.test.tsx src/components/dashboard/navigation.test.tsx src/components/dashboard/automations-body.test.tsx`
Expected: PASS. If an existing test renders a gated tab without a registry, give its registry mock `hidden_capabilities: []` and leave the assertion alone.

- [ ] **Step 8: Mock and click through.**
  - Make the mock's `GET /v1/capabilities` honour `MOCK_HIDDEN_CAPABILITIES` (comma list), so it returns `hidden_capabilities`. In `mock/plugin.ts`, at the route around :105:

```ts
const hidden = (process.env.MOCK_HIDDEN_CAPABILITIES ?? '').split(',').filter(Boolean);
return {
  ...mockCapabilities(plan, (process.env.MOCK_UNAVAILABLE_CAPABILITIES ?? '').split(',')),
  ...(hidden.length ? { hidden_capabilities: hidden } : {}),
};
```

- Document `MOCK_HIDDEN_CAPABILITIES` in CLAUDE.md's dev:mock paragraph.
- Run `MOCK_API=1 MOCK_HIDDEN_CAPABILITIES=route-insights,data-upstreams,traffic-mirroring,tenant-surfaces,production-debugger npx vite --port 3301`, then:
  - Open an app. Routes, Upstreams, Mirrors, Tenant surfaces and Debugger are gone.
  - Open `?tab=Debugger`. It shows "Not enabled for this account" with the Previews link.
  - The network log has no 404s.
  - Restart without the variable and all tabs are back.

- [ ] **Step 9: Verify and commit.** Run all four verification commands.

```bash
git add -A
git commit -m "fix(console): gate tabs, nav and pages on the capability the route needs

Since faas #5319 capgate answers 404 for a capability not released to the
account, so Routes, Upstreams, Mirrors, Tenant surfaces, Debugger, the domain
doctor and the supply-chain panel failed for default accounts. Tabs and nav
items now declare their catalog id and hide when apid hides the capability;
a deep link shows why. Automations checks 'automations', not
'workflows-and-jobs'; Customers' tenant panels check 'platform-tenants'."
```

---

### Task 7: Previews in Settings (PR "feat(console): join platform previews")

Branch: `feat/previews-settings`.

The API (faas ADR-20261021080640):

- `GET /v1/previews` returns `{items: Preview[]}`, where each `Preview` is `{key, label, description, retire_by?, joined, eligible, enabled}`.
- `PUT /v1/previews/{key}` joins and `DELETE /v1/previews/{key}` leaves. Errors: `preview_plan_not_eligible` (403), `preview_not_offered` (404), `preview_full` (409).
- A company workspace uses the same routes under `/v1/orgs/{slug}/previews…`.

**Files:**

- Create: `src/lib/api/previews.ts`, `src/components/dashboard/previews-settings.tsx`, `src/components/dashboard/previews-settings.test.tsx`
- Modify: `src/components/dashboard/settings-search.ts` (add `['previews', 'Previews']` after `integrations`), `src/routes/dashboard.settings.tsx` (render the section), `mock/plugin.ts`

**Interfaces:**

- Consumes: `useWorkspaceTarget()` from `src/lib/api/workspace-apps.ts`, which returns `{ org: string | null; label }`, and `capabilityKey(accountId)`.
- Produces: `usePreviews()`, `useJoinPreview()`, `useLeavePreview()`.

- [ ] **Step 1: Write the failing tests.** Render `PreviewsSettings` with a mocked `fetch` that returns two previews: one eligible and not joined, one joined. Assert:
  - each label shows with its description and `retire_by` date;
  - "Join" on the eligible one sends `PUT /v1/previews/<key>`;
  - "Leave" on the joined one asks for confirmation, then sends `DELETE`;
  - an ineligible preview shows a disabled "Join" button with the text "Not available on your plan";
  - a `preview_full` 409 shows "This preview is full";
  - after a join, the capabilities query is invalidated. Spy on `queryClient.invalidateQueries` and expect it to be called with `{ queryKey: capabilityKey('account') }`;
  - with an active org workspace (mock `useWorkspaceTarget` to return `{ org: 'acme', label: 'Acme' }`), the requests go to `/v1/orgs/acme/previews…` and the heading says "Previews for Acme".

```tsx
// src/components/dashboard/previews-settings.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreviewsSettings } from './previews-settings';

const workspace = vi.hoisted(() => ({ org: null as string | null, label: 'Personal' }));
vi.mock('@/lib/api/workspace-apps', () => ({ useWorkspaceTarget: () => workspace }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { id: 'account', plan: 'pro' } }) }));
const confirm = vi.hoisted(() => vi.fn(async () => true));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const items = [
  {
    key: 'realtime',
    label: 'Realtime',
    description: 'Channels.',
    retire_by: '2027-01-31',
    joined: false,
    eligible: true,
    enabled: false,
  },
  {
    key: 'events',
    label: 'Events',
    description: 'Event hub.',
    joined: true,
    eligible: true,
    enabled: true,
  },
  {
    key: 'gitlab',
    label: 'GitLab',
    description: 'GitLab deploys.',
    joined: false,
    eligible: false,
    enabled: false,
  },
];
let calls: { method: string; path: string }[] = [];
let joinStatus = 200;

beforeEach(() => {
  calls = [];
  joinStatus = 200;
  workspace.org = null;
  workspace.label = 'Personal';
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const path = new URL(req.url).pathname;
    calls.push({ method: req.method, path });
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    if (req.method === 'GET') return json(200, { items });
    if (req.method === 'PUT' && joinStatus === 409)
      return new Response(JSON.stringify({ code: 'preview_full', title: 'Full', status: 409 }), {
        status: 409,
        headers: { 'content-type': 'application/problem+json' },
      });
    return json(200, items[0]);
  });
});
afterEach(() => vi.unstubAllGlobals());

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const spy = vi.spyOn(qc, 'invalidateQueries');
  render(
    <QueryClientProvider client={qc}>
      <PreviewsSettings />
    </QueryClientProvider>
  );
  return spy;
}

describe('PreviewsSettings', () => {
  it('lists previews with their end date and joins an eligible one', async () => {
    const spy = renderPanel();
    const row = (await screen.findByText('Realtime')).closest('li')!;
    expect(row).toHaveTextContent('Channels.');
    expect(row).toHaveTextContent(new Date('2027-01-31').toLocaleDateString());
    await userEvent.click(within(row).getByRole('button', { name: 'Join' }));
    await waitFor(() =>
      expect(calls).toContainEqual({ method: 'PUT', path: '/v1/previews/realtime' })
    );
    expect(spy).toHaveBeenCalledWith({ queryKey: ['account', 'account', 'capabilities'] });
  });
  it('confirms before leaving', async () => {
    renderPanel();
    const row = (await screen.findByText('Events')).closest('li')!;
    await userEvent.click(within(row).getByRole('button', { name: 'Leave' }));
    expect(confirm).toHaveBeenCalled();
    await waitFor(() =>
      expect(calls).toContainEqual({ method: 'DELETE', path: '/v1/previews/events' })
    );
  });
  it('explains an ineligible preview and a full one', async () => {
    joinStatus = 409;
    renderPanel();
    const gitlab = (await screen.findByText('GitLab')).closest('li')!;
    expect(within(gitlab).getByRole('button', { name: 'Join' })).toBeDisabled();
    expect(gitlab).toHaveTextContent('Not available on your plan');
    const realtime = screen.getByText('Realtime').closest('li')!;
    await userEvent.click(within(realtime).getByRole('button', { name: 'Join' }));
    expect(await within(realtime).findByRole('alert')).toHaveTextContent('This preview is full');
  });
  it('uses the organization routes in a company workspace', async () => {
    workspace.org = 'acme';
    workspace.label = 'Acme';
    renderPanel();
    expect(await screen.findByRole('heading', { name: 'Previews for Acme' })).toBeInTheDocument();
    expect(calls[0]).toEqual({ method: 'GET', path: '/v1/orgs/acme/previews' });
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail.**

Run: `npx vitest run src/components/dashboard/previews-settings.test.tsx`
Expected: FAIL, because the module doesn't exist.

- [ ] **Step 3: Implement `src/lib/api/previews.ts`.**

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { capabilityKey } from './capabilities';
import { useWorkspaceTarget } from './workspace-apps';
import { useAuth } from '../auth';

export const previewsKey = (org: string | null) => ['previews', org ?? 'personal'] as const;

export function usePreviews() {
  const { org } = useWorkspaceTarget();
  return useQuery({
    queryKey: previewsKey(org),
    queryFn: ({ signal }) =>
      org
        ? unwrap(api.GET('/v1/orgs/{slug}/previews', { params: { path: { slug: org } }, signal }))
        : unwrap(api.GET('/v1/previews', { signal })),
  });
}

function usePreviewChange(method: 'PUT' | 'DELETE') {
  const { org } = useWorkspaceTarget();
  const { account } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => {
      if (org) {
        const opts = { params: { path: { slug: org, key } } };
        return unwrap(
          method === 'PUT'
            ? api.PUT('/v1/orgs/{slug}/previews/{key}', opts)
            : api.DELETE('/v1/orgs/{slug}/previews/{key}', opts)
        );
      }
      const opts = { params: { path: { key } } };
      return unwrap(
        method === 'PUT'
          ? api.PUT('/v1/previews/{key}', opts)
          : api.DELETE('/v1/previews/{key}', opts)
      );
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: previewsKey(org) });
      // Joining or leaving changes hidden_capabilities; the gate must re-read.
      if (account?.id) void qc.invalidateQueries({ queryKey: capabilityKey(account.id) });
    },
  });
}
export const useJoinPreview = () => usePreviewChange('PUT');
export const useLeavePreview = () => usePreviewChange('DELETE');
```

- [ ] **Step 4: Implement `previews-settings.tsx`.**
  - Use `Panel` for the heading. The title is "Previews" in a personal workspace and `Previews for ${label}` in an org workspace.
  - Read the list through `queryPhase`.
  - Render one `<li>` per preview with: label, description, "Ends <date>" when `retire_by` is set, a "Joined" pill when `joined`, and the action.
  - The action is "Join" (disabled with the text "Not available on your plan" when not `eligible`) or "Leave".
  - "Leave" goes through `useConfirm({ title: 'Leave <label>?', description: 'Pages and commands for this preview disappear for everyone in this workspace until you join again.' })`.
  - Branch errors on `ApiError.code`:
    - `preview_full` → "This preview is full."
    - `preview_plan_not_eligible` → "Not available on your plan."
    - `preview_not_offered` → "This preview is no longer offered."
    - anything else → `errorMessage(err)`.
  - Show the error in a `role="alert"` line inside the row.
  - Wire it into `dashboard.settings.tsx` as `{section === 'previews' && <PreviewsSettings />}`, and add the entry to `SETTINGS_SECTIONS`.

- [ ] **Step 5: Add the mock routes.** In `mock/plugin.ts`, add an in-memory list of three previews (eligible, joined, ineligible) and `GET`/`PUT`/`DELETE` for both `/v1/previews…` and `/v1/orgs/{slug}/previews…`.
  - `PUT` on an ineligible preview → `Problem(403, 'preview_plan_not_eligible')`.
  - `PUT` on an unknown key → `Problem(404, 'preview_not_offered')`.
  - Joining toggles `joined` and `enabled`. It also removes the matching capability id from the mock's `hidden_capabilities` when that id was hidden through `MOCK_HIDDEN_CAPABILITIES`. Keep a map from preview key to capability id in the mock: `realtime → realtime`, `events → events`.

- [ ] **Step 6: Run the tests, click through, and commit.**
  - Run `npx vitest run src/components/dashboard/previews-settings.test.tsx src/components/dashboard/navigation.test.tsx`. Expected: PASS.
  - Click through at 1440 and 390 px:
    1. Start with `MOCK_HIDDEN_CAPABILITIES=events`.
    2. Join Events in Settings → Previews.
    3. Events appears in the sidebar without a reload.
  - Run the verification commands.

```bash
git add -A
git commit -m "feat(console): join and leave platform previews from Settings

GET/PUT/DELETE /v1/previews (and /v1/orgs/{slug}/previews in a company
workspace, faas ADR-20261021080640). Joining re-reads capabilities so the
gated pages appear at once; leaving asks first; plan, full and withdrawn
previews are explained by code."
```

---

### Task 8: Org billing in a company workspace (PR "fix(console): company billing shows the company")

Branch: `fix/workspace-billing`.

**The bug:** with a company workspace active, Plans, Usage and Invoices show the personal account.

**The org routes:**

| Purpose        | Route                                |
| -------------- | ------------------------------------ |
| Billing status | `GET /v1/orgs/{slug}/billing/status` |
| Usage          | `GET /v1/orgs/{slug}/usage`          |
| Invoices       | `GET /v1/orgs/{slug}/invoices`       |
| Billing portal | `GET /v1/orgs/{slug}/billing/portal` |
| Plan change    | `PATCH /v1/orgs/{slug}/plan`         |

**Files:**

- Create: `src/lib/api/org-billing.ts`, `src/lib/api/org-billing.test.tsx`, `src/components/dashboard/org-billing.tsx`
- Modify: `src/routes/dashboard.plans.tsx`, `src/routes/dashboard.usage.tsx`, `src/routes/dashboard.invoices.tsx`, `CLAUDE.md` (the workspace paragraph)
- Test: `src/routes/-dashboard.invoices.test.tsx`, `src/routes/dashboard.usage.test.tsx`

**Interfaces:**

- Consumes: `useWorkspaceTarget()`.
- Produces: `useOrgBillingStatus(org)`, `useOrgUsage(org)`, `useOrgInvoices(org)`, `useOrgBillingPortal(org)`, `useChangeOrgPlan(org)`.
  - Each hook takes `org: string` and is enabled only when `org` is non-empty.
  - Response types come from the generated schema for those paths.
- Also produces `OrgInvoices`, `OrgUsage` and `OrgPlan` from `src/components/dashboard/org-billing.tsx`. Each takes `{ org: string; label: string }`.

- [ ] **Step 1: Read the schemas first.**
  - Run `grep -n "'/v1/orgs/{slug}/billing/status'\|'/v1/orgs/{slug}/usage'\|'/v1/orgs/{slug}/invoices'" src/lib/api/schema.d.ts` and open each response type.
  - Note which personal-page fields have no org equivalent. Those are left out of the org view, not faked (CLAUDE.md: "say so in the UI rather than inventing a plausible number").
  - Read faas `pkg/apid/apidserver` for the org billing handlers (`grep -rn "orgs/{slug}/billing" pkg/apid/apidserver/server.go`) to learn which org role may read and which may change the plan. Write both rules into the PR body.

- [ ] **Step 2: Write the failing tests.** These test the org components directly with a stubbed `fetch`, so they don't depend on how the route test files mock things.

```tsx
// src/lib/api/org-billing.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrgInvoices, OrgPlan, OrgUsage } from '@/components/dashboard/org-billing';

vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => async () => true }));

let calls: { method: string; path: string }[] = [];
let forbid = false;
beforeEach(() => {
  calls = [];
  forbid = false;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const path = new URL(req.url).pathname;
    calls.push({ method: req.method, path });
    if (forbid)
      return new Response(
        JSON.stringify({ code: 'org_role_forbidden', title: 'Forbidden', status: 403 }),
        {
          status: 403,
          headers: { 'content-type': 'application/problem+json' },
        }
      );
    const body = path.endsWith('/invoices') ? { invoices: [] } : {};
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
});
afterEach(() => vi.unstubAllGlobals());

const wrap = (ui: React.ReactNode) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {ui}
    </QueryClientProvider>
  );

describe('company billing', () => {
  it('reads the organization invoices, never the personal ones', async () => {
    wrap(<OrgInvoices org="acme" label="Acme" />);
    await waitFor(() =>
      expect(calls).toContainEqual({ method: 'GET', path: '/v1/orgs/acme/invoices' })
    );
    expect(calls.some((c) => c.path === '/v1/invoices')).toBe(false);
    expect(screen.getByRole('heading', { name: /Acme/ })).toBeInTheDocument();
  });
  it('tells a member without a billing role who can see the invoices', async () => {
    forbid = true;
    wrap(<OrgInvoices org="acme" label="Acme" />);
    expect(
      await screen.findByText("Only Acme's owners and billing admins can see its invoices.")
    ).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/v1/invoices')).toBe(false);
  });
  it('reads the organization usage', async () => {
    wrap(<OrgUsage org="acme" label="Acme" />);
    await waitFor(() =>
      expect(calls).toContainEqual({ method: 'GET', path: '/v1/orgs/acme/usage' })
    );
  });
  it('changes the organization plan, not the personal one', async () => {
    wrap(<OrgPlan org="acme" label="Acme" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Switch to Pro' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm switch' }));
    await waitFor(() =>
      expect(calls).toContainEqual({ method: 'PATCH', path: '/v1/orgs/acme/plan' })
    );
  });
});
```

Adjust the `{ invoices: [] }` fixture key to match the org invoices response shape you read in Step 1. The button names match the personal Plans page (`-dashboard.plans.test.tsx`), whose plan cards `OrgPlan` reuses.

- [ ] **Step 3: Run the tests and confirm they fail.**

Run: `npx vitest run src/lib/api/org-billing.test.tsx`
Expected: FAIL, because `@/components/dashboard/org-billing` doesn't exist.

- [ ] **Step 4: Implement the hooks.**

```ts
// src/lib/api/org-billing.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';

const k = (org: string, part: string) => ['orgs', org, 'billing', part] as const;

export function useOrgBillingStatus(org: string) {
  return useQuery({
    queryKey: k(org, 'status'),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/orgs/{slug}/billing/status', { params: { path: { slug: org } }, signal })
      ),
    enabled: Boolean(org),
  });
}
export function useOrgUsage(org: string) {
  return useQuery({
    queryKey: k(org, 'usage'),
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/orgs/{slug}/usage', { params: { path: { slug: org } }, signal })),
    enabled: Boolean(org),
  });
}
export function useOrgInvoices(org: string) {
  return useQuery({
    queryKey: k(org, 'invoices'),
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/orgs/{slug}/invoices', { params: { path: { slug: org } }, signal })),
    enabled: Boolean(org),
  });
}
export function useOrgBillingPortal(org: string) {
  return useMutation({
    mutationFn: () =>
      unwrap(api.GET('/v1/orgs/{slug}/billing/portal', { params: { path: { slug: org } } })),
  });
}
export function useChangeOrgPlan(org: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (plan: string) =>
      unwrap(
        api.PATCH('/v1/orgs/{slug}/plan', {
          params: { path: { slug: org } },
          body: { plan } as never,
        })
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['orgs', org, 'billing'] }),
  });
}
```

Replace `body: { plan } as never` with the request type the schema names for `PATCH /v1/orgs/{slug}/plan`. If the body has more required fields, add them as Step 1 found them.

- [ ] **Step 5: Branch the pages.** In each of the three routes:
  - Read `const { org, label } = useWorkspaceTarget();`.
  - When `org` is set, render the org view from `org-billing.tsx`: `OrgInvoices`, `OrgUsage` and `OrgPlan`, each built from the hooks above with `queryPhase`.
  - Otherwise render the existing personal view, unchanged.
  - Never call the personal hooks while `org` is set. Put the branch above the hook calls by splitting each page into `PersonalX` and `OrgX` components.
  - The `org_role_forbidden` message names the org (`label`).
  - The org plan page reuses the plan cards. Its change button calls `useChangeOrgPlan`, and its step-up, 402 and 202 handling is the same as the personal page: copy the branches from `dashboard.plans.tsx` into a shared `applyPlanChange(result)` helper rather than duplicating them.

- [ ] **Step 6: Update CLAUDE.md.** Replace the "The workspace is an organization." paragraph's claim that `/v1/apps/{slug}/…` routes are creator-scoped. Per faas ADR-202610171901 and `pkg/apid/appaccess/routes.go`, company members reach app routes through the app's `org_id`. The new paragraph says:
  - `/v1/apps` and `/v1/projects` are still account-only;
  - org data comes from `/v1/orgs/{slug}/apps`, `/projects` (Task 9), `/postgres` (Task 10) and the billing routes above.

- [ ] **Step 7: Run the tests, add the mock routes, click through, and commit.**
  - Add the mock routes for the five org billing paths. The usage and invoices routes return small fixtures. When `MOCK_ORG_ROLE=member`, every one of them answers 403 `org_role_forbidden`.
  - Run the route tests. Expected: PASS.
  - Click through: switch to a company workspace in the breadcrumb, open Plans, Usage and Invoices, and confirm each shows the company. Then do the same with `MOCK_ORG_ROLE=member`, and each should explain who can see the page.
  - Run the verification commands.

```bash
git add -A
git commit -m "fix(console): show company billing in a company workspace

Plans, Usage and Invoices read /v1/orgs/{slug}/billing/status, /usage,
/invoices, /billing/portal and PATCH /plan when a company workspace is
active, instead of the signed-in person's own account. A member without a
billing role is told who can see it. CLAUDE.md's workspace note now follows
ADR-202610171901."
```

---

### Task 9: Org projects in a company workspace (PR "fix(console): company projects")

Branch: `fix/workspace-projects`.

**The bug:** `GET /v1/projects` is account-only (faas `handlers_projects.go:29`), so projects created by teammates are invisible.

**The org routes:** `GET /v1/orgs/{organization}/projects` and `GET|PATCH|DELETE /v1/orgs/{organization}/projects/{slug}`.

**Files:**

- Modify: `src/lib/api/projects.ts`, `src/routes/dashboard.projects.index.tsx`, `src/routes/dashboard.projects.$projectSlug.tsx`
- Test: `src/lib/api/projects-workspace.test.tsx` (create)

**Interfaces:**

- Consumes: `useWorkspaceTarget()`.
- Produces: `useProjects()` and `useProject(slug)`, which keep their names but read the org routes when `org` is set. Their query keys include `org ?? 'personal'`.

- [ ] **Step 1: Write the failing test.** This one tests at the hook level, so it doesn't depend on the route file's mocking.

```tsx
// src/lib/api/projects-workspace.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProjects } from './projects';

const workspace = vi.hoisted(() => ({ org: null as string | null, label: 'Personal' }));
vi.mock('./workspace-apps', () => ({ useWorkspaceTarget: () => workspace }));

let paths: string[] = [];
beforeEach(() => {
  paths = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    paths.push(new URL(new Request(input, init).url).pathname);
    return new Response(JSON.stringify({ projects: [{ slug: 'shop', created_by: 'teammate' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
});
afterEach(() => vi.unstubAllGlobals());

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

describe('projects in a workspace', () => {
  it('lists the company projects, including ones a teammate created', async () => {
    workspace.org = 'acme';
    const { result } = renderHook(() => useProjects(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(paths).toEqual(['/v1/orgs/acme/projects']);
  });
  it('keeps the personal route in the personal workspace', async () => {
    workspace.org = null;
    const { result } = renderHook(() => useProjects(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(paths).toEqual(['/v1/projects']);
  });
});
```

Use the response key (`projects` or `items`) that the two list routes return, from `schema.d.ts`. Assert the teammate's project shows in the result once `toProjectSummary` exists (Step 3), if a mapping is needed.

- [ ] **Step 2: Run the test and confirm it fails.**

Run: `npx vitest run src/lib/api/projects-workspace.test.tsx`
Expected: FAIL. The org case requests `/v1/projects`.

- [ ] **Step 3: Implement.** In `projects.ts`, at :21 and wherever the detail is read:

```ts
export function useProjects() {
  const { org } = useWorkspaceTarget();
  return useQuery({
    queryKey: ['projects', org ?? 'personal'],
    queryFn: ({ signal }) =>
      org
        ? unwrap(
            api.GET('/v1/orgs/{organization}/projects', {
              params: { path: { organization: org } },
              signal,
            })
          )
        : unwrap(api.GET('/v1/projects', { signal })),
  });
}
```

Apply the same branch to the detail hook. If the org list's response shape differs from the personal one (compare them in `schema.d.ts`), add a mapping function `toProjectSummary` in `projects.ts` with a unit test. The other modules that read `['projects']` keys keep working, because the prefix is unchanged.

- [ ] **Step 4: Run the tests, add the mock routes, click through, and commit.**
  - Add the mock routes for the org list and detail.
  - Click through in a company workspace: the project list shows the teammate's project.
  - Run the verification commands.

```bash
git add -A
git commit -m "fix(console): list a company's projects in its workspace

GET /v1/projects is account-only (faas handlers_projects.go:29); a company
workspace now reads /v1/orgs/{organization}/projects, so projects created by
teammates are visible."
```

---

### Task 10: Org Postgres in a company workspace (PR "fix(console): company databases")

Branch: `fix/workspace-postgres`. The org routes are `GET|POST /v1/orgs/{organization}/postgres/databases`, `GET …/postgres/capabilities` and `GET …/postgres/usage`, plus the per-database routes under the same prefix. Find those with `grep -n "'/v1/orgs/{organization}/postgres" src/lib/api/schema.d.ts`.

**Files:**

- Modify: `src/lib/api/queries.ts` (`usePostgresDatabases`, around :3572, and its siblings), `src/routes/dashboard.postgres.tsx`
- Test: `src/lib/api/postgres-workspace.test.tsx` (create)

**Interfaces:**

- Produces: the existing Postgres hooks keep their names and read org routes when `useWorkspaceTarget().org` is set. Their keys become `['postgres', org ?? 'personal', …]`.

- [ ] **Step 1: Write the failing test.**

```tsx
// src/lib/api/postgres-workspace.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePostgresDatabases } from './queries';

const workspace = vi.hoisted(() => ({ org: null as string | null, label: 'Personal' }));
vi.mock('./workspace-apps', () => ({ useWorkspaceTarget: () => workspace }));

let paths: string[] = [];
beforeEach(() => {
  paths = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    paths.push(new URL(new Request(input, init).url).pathname);
    return new Response(JSON.stringify({ databases: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
});
afterEach(() => vi.unstubAllGlobals());

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

describe('Postgres in a workspace', () => {
  it('lists the company databases in a company workspace', async () => {
    workspace.org = 'acme';
    const { result } = renderHook(() => usePostgresDatabases(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(paths).toEqual(['/v1/orgs/acme/postgres/databases']);
  });
  it('keeps the personal route otherwise', async () => {
    workspace.org = null;
    const { result } = renderHook(() => usePostgresDatabases(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(paths).toEqual(['/v1/postgres/databases']);
  });
});
```

Use the list response key from `schema.d.ts`, and add the same pair of cases for the create mutation's `POST` path.

- [ ] **Step 2: Run the test and confirm it fails.** Run `npx vitest run src/lib/api/postgres-workspace.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add an `org` branch to each Postgres hook, as in Task 9. For each per-database operation that has no org route (compare the two path lists in `schema.d.ts`), keep the personal route. The app access rules let members operate a database by id: check `pkg/apid/appaccess/routes.go` for the Postgres prefixes and cite it in the PR body. If a needed per-database route is neither org-scoped nor covered by appaccess, hide that action in a company workspace and say "Manage this database with `gregale postgres …` as its owner", using `CliCommand`.
- [ ] **Step 4: Run the test, mock, click through, and commit.** Use the same flow as Task 9.

```bash
git add -A
git commit -m "fix(console): show a company's databases in its workspace

Postgres reads /v1/orgs/{organization}/postgres/* in a company workspace."
```

---

### Task 11: Vendor the capability inventory (PR "feat(parity): ledger", part 1)

Branch: `feat/parity-ledger`.

**Files:**

- Create: `scripts/pull-capabilities.mjs`
- Create: `content/capabilities/ga-capability-inventory.md` and `content/capabilities/catalog.json` (vendored)
- Create: `src/lib/parity/inventory.ts`, `src/lib/parity/inventory.test.ts`
- Modify: `package.json` (`"capabilities:pull": "node scripts/pull-capabilities.mjs"`), `.prettierignore` (`content/capabilities`)

**Interfaces:**

- Produces:
  - `type Tier = 'GA' | 'beta' | 'preview' | 'internal'`
  - `interface InventoryRow { row: number; section: string; name: string; tier: Tier; catalog: string[] }`
  - `parseInventory(markdown: string): InventoryRow[]`

- [ ] **Step 1: Write the pull script.** Copy the token logic from `scripts/pull-docs.mjs`: `githubToken()`, and the contents API with `Accept: application/vnd.github.raw`. Pull these two paths at `CAPABILITIES_REF ?? 'main'`:
  - `docs/ga-capability-inventory.md` → `content/capabilities/ga-capability-inventory.md`
  - `pkg/productcap/catalog.json` → `content/capabilities/catalog.json`

  Write a header comment explaining why the files are vendored: the parity ledger is checked against them in CI, and a refresh shows up as a reviewable diff. Run it:

```bash
npm run capabilities:pull && git diff --stat content/capabilities
```

Expected: two new files. The markdown has 168 numbered rows, and the catalog is about 263 entries.

- [ ] **Step 2: Write the failing parser tests.**

```ts
// src/lib/parity/inventory.test.ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseInventory } from './inventory';

const SAMPLE = `
## A. Deploy and build

| # | Capability | Where it lives | Catalog | Gate today | Tier |
|---|---|---|---|---|---|
| 13 | Per-app deploy tokens for CI | \`deploy-tokens\` | **MISSING** | — | GA |
| 20 | Environments and Environment GitOps (field ownership) | x | \`environments\` preview, \`environment-gitops\` preview | — | preview |

## G. Observability

| # | Capability | Where it lives | Catalog | Gate today | Tier |
|---|---|---|---|---|---|
| 168 | On-demand profile captures | x | \`profile-captures\` preview | — | preview |
`;

describe('parseInventory', () => {
  it('reads row number, section, name, tier and catalog ids', () => {
    expect(parseInventory(SAMPLE)).toEqual([
      { row: 13, section: 'A', name: 'Per-app deploy tokens for CI', tier: 'GA', catalog: [] },
      {
        row: 20,
        section: 'A',
        name: 'Environments and Environment GitOps (field ownership)',
        tier: 'preview',
        catalog: ['environments', 'environment-gitops'],
      },
      {
        row: 168,
        section: 'G',
        name: 'On-demand profile captures',
        tier: 'preview',
        catalog: ['profile-captures'],
      },
    ]);
  });
  it('parses the vendored inventory into unique row numbers with known tiers', () => {
    const rows = parseInventory(
      readFileSync(resolve('content/capabilities/ga-capability-inventory.md'), 'utf8')
    );
    expect(rows.length).toBeGreaterThanOrEqual(167);
    expect(new Set(rows.map((r) => r.row)).size).toBe(rows.length);
    expect(rows.every((r) => ['GA', 'beta', 'preview', 'internal'].includes(r.tier))).toBe(true);
  });
});
```

- [ ] **Step 3: Run the tests and confirm they fail.**

Run: `npx vitest run src/lib/parity/inventory.test.ts`
Expected: FAIL, because the module doesn't exist.

- [ ] **Step 4: Implement `src/lib/parity/inventory.ts`.**

```ts
export type Tier = 'GA' | 'beta' | 'preview' | 'internal';
export interface InventoryRow {
  row: number;
  section: string;
  name: string;
  tier: Tier;
  /** Catalog ids named in the row (faas pkg/productcap/catalog.json); empty when MISSING. */
  catalog: string[];
}

const TIERS: readonly Tier[] = ['GA', 'beta', 'preview', 'internal'];

/**
 * Reads faas docs/ga-capability-inventory.md. Rows are `| # | Capability |
 * Where | Catalog | Gate | Tier |` under `## <Letter>. <Title>` headings.
 * Upstream appends new rows rather than renumbering (row 168 sits in G), so
 * the row number is the stable key.
 */
export function parseInventory(markdown: string): InventoryRow[] {
  const rows: InventoryRow[] = [];
  let section = '';
  for (const line of markdown.split('\n')) {
    const heading = /^## ([A-J])\. /.exec(line);
    if (heading) {
      section = heading[1];
      continue;
    }
    if (!section || !/^\| \d+ \|/.test(line)) continue;
    const cells = line
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.trim());
    const tier = cells[cells.length - 1].replace(/[`*]/g, '') as Tier;
    if (!TIERS.includes(tier)) continue;
    const catalog = cells[3].includes('MISSING')
      ? []
      : [...cells[3].matchAll(/`([a-z0-9-]+)`/g)].map((m) => m[1]);
    rows.push({ row: Number(cells[0]), section, name: cells[1], tier, catalog });
  }
  return rows;
}
```

`name` keeps the cell verbatim, backticks included. The ledger compares it exactly.

- [ ] **Step 5: Run the tests and confirm they pass.**

Run: `npx vitest run src/lib/parity/inventory.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add scripts/pull-capabilities.mjs content/capabilities package.json .prettierignore src/lib/parity/inventory.ts src/lib/parity/inventory.test.ts
git commit -m "feat(parity): vendor faas's capability inventory and catalog

npm run capabilities:pull copies docs/ga-capability-inventory.md and
pkg/productcap/catalog.json, the same way docs:pull vendors docs, so the
parity ledger is checked against what faas says customers can do."
```

---

### Task 12: The parity ledger and its test (PR "feat(parity): ledger", part 2)

Same branch as Task 11.

**Files:**

- Create: `src/lib/parity/ledger.ts`, `src/lib/parity/ledger.test.ts`

**Interfaces:**

- Consumes: `parseInventory` and `InventoryRow` from Task 11, `APP_DETAIL_TABS` from `app-tab-navigation.tsx`, and `SETTINGS_SECTIONS` from `settings-search.ts`.
- Produces:
  - `type ParityStatus = 'full' | 'partial' | 'cli' | 'none'`
  - `interface LedgerEntry { row: number; name: string; status: ParityStatus; surfaces: string[]; capability?: string; cli?: string; gap?: string; wave?: 0 | 1 | 2 | 3 }`
  - `LEDGER: LedgerEntry[]`

- [ ] **Step 1: Write the failing ledger test.** Write it before any entries exist, so it lists every missing row.

```ts
// src/lib/parity/ledger.test.ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_DETAIL_TABS } from '@/components/dashboard/app-tab-navigation';
import { SETTINGS_SECTIONS } from '@/components/dashboard/settings-search';
import { parseInventory } from './inventory';
import { LEDGER } from './ledger';

const inventory = parseInventory(
  readFileSync(resolve('content/capabilities/ga-capability-inventory.md'), 'utf8')
);
const catalog = new Set(
  (
    JSON.parse(readFileSync(resolve('content/capabilities/catalog.json'), 'utf8')) as {
      capabilities: { id: string }[];
    }
  ).capabilities.map((c) => c.id)
);
const routes = new Set(
  [
    ...readFileSync(resolve('src/routeTree.gen.ts'), 'utf8').matchAll(/^\s+'(\/[^']*)': typeof /gm),
  ].map((m) => m[1])
);
const byRow = new Map(LEDGER.map((e) => [e.row, e]));
const customer = inventory.filter((r) => r.tier !== 'internal');

describe('parity ledger', () => {
  it('has an entry for every GA, beta and preview capability', () => {
    const missing = customer
      .filter((r) => !byRow.has(r.row))
      .map((r) => `${r.section}${r.row} ${r.name}`);
    expect(missing).toEqual([]);
  });
  it('names each row exactly as upstream does, so a renumber is caught', () => {
    const drift = LEDGER.flatMap((e) => {
      const up = inventory.find((r) => r.row === e.row);
      return up && up.name !== e.name
        ? [`row ${e.row}: ledger "${e.name}" vs upstream "${up.name}"`]
        : [];
    });
    expect(drift).toEqual([]);
  });
  it('lists no row upstream no longer has', () => {
    const rows = new Set(inventory.map((r) => r.row));
    expect(LEDGER.filter((e) => !rows.has(e.row)).map((e) => e.row)).toEqual([]);
  });
  it('points every surface at a real route, tab or settings section', () => {
    const bad = LEDGER.flatMap((e) =>
      e.surfaces.flatMap((s) => {
        const [path, query = ''] = s.split('?');
        const params = new URLSearchParams(query);
        const tab = params.get('tab');
        const section = params.get('section');
        const ok =
          routes.has(path) &&
          (!tab || (APP_DETAIL_TABS as readonly string[]).includes(tab)) &&
          (!section || SETTINGS_SECTIONS.some(([id]) => id === section));
        return ok ? [] : [`row ${e.row}: ${s}`];
      })
    );
    expect(bad).toEqual([]);
  });
  it('keeps status, gap, CLI and capability consistent', () => {
    const bad = LEDGER.flatMap((e) => {
      const up = inventory.find((r) => r.row === e.row);
      const problems: string[] = [];
      if (e.status === 'full' && e.gap) problems.push('full with a gap');
      if (e.status !== 'full' && !e.gap) problems.push('not full but no gap');
      if (e.status === 'cli' && !e.cli) problems.push('cli without a command');
      if ((e.status === 'full' || e.status === 'partial') && e.surfaces.length === 0)
        problems.push('no surface');
      if (up?.tier === 'preview' && e.status !== 'none' && !e.capability)
        problems.push('preview surface without a capability gate');
      if (e.capability && !catalog.has(e.capability))
        problems.push(`unknown catalog id ${e.capability}`);
      return problems.map((p) => `row ${e.row}: ${p}`);
    });
    expect(bad).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails.**

Run: `npx vitest run src/lib/parity/ledger.test.ts`
Expected: FAIL. "has an entry for every…" lists about 126 rows.

- [ ] **Step 3: Write the ledger skeleton and the known gaps from the spec.**

```ts
// src/lib/parity/ledger.ts
/**
 * One entry per GA, beta and preview row of faas docs/ga-capability-inventory.md
 * (vendored in content/capabilities by `npm run capabilities:pull`), saying where
 * the console covers it. The spec is
 * docs/superpowers/specs/2026-10-30-console-backend-parity-design.md; every
 * parity PR moves its rows' status and gap. `npm run parity` prints coverage.
 */
export type ParityStatus = 'full' | 'partial' | 'cli' | 'none';
export interface LedgerEntry {
  row: number;
  /** Verbatim from the inventory; the test fails if upstream renames the row. */
  name: string;
  status: ParityStatus;
  /** Console routes; `?tab=` must be an app tab and `?section=` a settings section. */
  surfaces: string[];
  /** The catalog id the surface is gated on; required for preview rows with a surface. */
  capability?: string;
  /** The exact `gregale` command shown where the console defers to the CLI. */
  cli?: string;
  /** What is missing, in one line; required unless status is 'full'. */
  gap?: string;
  /** The spec wave that closes the gap. */
  wave?: 0 | 1 | 2 | 3;
}

export const LEDGER: LedgerEntry[] = [
  // Entries are added in Step 4, in inventory row order.
];
```

- [ ] **Step 4: Audit every customer row and write its entry.** This is a mechanical audit with a clear rule, done row by row in inventory order.

  **Rows the spec already names:**

| Row     | Status                   | Wave | Gap                                                                                        |
| ------- | ------------------------ | ---- | ------------------------------------------------------------------------------------------ |
| A1      | `partial`                | 1    | Recently deleted: /v1/deleted-apps list and restore                                        |
| A2      | `full` once Task 4 lands | –    | –                                                                                          |
| A5      | `partial`                | 1    | GitHub status, sync and disconnect                                                         |
| A11     | `partial`                | 1    | release_policy, release_probe_paths and function_concurrency not shown                     |
| A13     | `none`                   | 1    | Deploy tokens                                                                              |
| A16     | `none`                   | 1    | Source-review results on the deployment                                                    |
| A19     | `partial`                | 1    | Update, delete, project previews and new fields                                            |
| B24     | `partial`                | 1    | Deployment diff, runtime upgrade preview, promote, rollback status and rollout observation |
| B25     | `partial`                | 1    | Same as B24                                                                                |
| B26     | `none`                   | 2    | –                                                                                          |
| B27     | `partial`                | 1    | Create a preview, and preview by slug                                                      |
| B28–B31 | `none`                   | 3    | –                                                                                          |
| B35     | `partial`                | 3    | –                                                                                          |
| B36     | `partial`                | 3    | –                                                                                          |
| B37     | `none`                   | 3    | –                                                                                          |
| C21     | `none`                   | 3    | –                                                                                          |
| C44     | `none`                   | 1    | –                                                                                          |
| C53     | `none`                   | 3    | –                                                                                          |
| C54     | `partial`                | 3    | –                                                                                          |
| C55     | `none`                   | 3    | –                                                                                          |
| C56     | `none`                   | 3    | –                                                                                          |
| C58     | `none`                   | 3    | –                                                                                          |
| C60     | `partial`                | 1    | History, rollback and config guard                                                         |
| C61     | `partial`                | 1    | References and revocations                                                                 |
| D63     | `partial`                | 1    | –                                                                                          |
| D66     | `partial`                | 1    | –                                                                                          |
| D68–D70 | `none`                   | 3    | –                                                                                          |
| D74     | `partial`                | 2    | –                                                                                          |
| D75     | `partial`                | 2    | –                                                                                          |
| D76     | `none`                   | 2    | –                                                                                          |
| D83     | `partial`                | 3    | –                                                                                          |
| E93     | `partial`                | 2    | –                                                                                          |
| E94     | `partial`                | 2    | –                                                                                          |
| E95     | `partial`                | 2    | –                                                                                          |
| E96     | `partial`                | 2    | –                                                                                          |
| E97     | `partial`                | 3    | –                                                                                          |
| E98     | `partial`                | 3    | –                                                                                          |
| E99     | `partial`                | 3    | –                                                                                          |
| E101    | `none`                   | 3    | –                                                                                          |
| E103    | `partial`                | 2    | –                                                                                          |
| E104    | `none`                   | 3    | –                                                                                          |
| F108    | `partial`                | 3    | –                                                                                          |
| F109    | `partial`                | 3    | –                                                                                          |
| F110    | `none`                   | 3    | –                                                                                          |
| F112    | `none`                   | 3    | –                                                                                          |
| F114    | `partial`                | 3    | –                                                                                          |
| F115    | `partial`                | 3    | –                                                                                          |
| G119    | `partial`                | 2    | –                                                                                          |
| G122    | `none`                   | 2    | –                                                                                          |
| G125    | `partial`                | 2    | –                                                                                          |
| G127    | `partial`                | 3    | –                                                                                          |
| G128    | `none`                   | 3    | –                                                                                          |
| G129    | `none`                   | 3    | –                                                                                          |
| G134    | `partial`                | 2    | –                                                                                          |
| G135    | `partial`                | 3    | –                                                                                          |
| G137    | `none`                   | 2    | –                                                                                          |
| G138    | `partial`                | 1    | –                                                                                          |
| G168    | `none`                   | 3    | –                                                                                          |
| H151    | `partial`                | 1    | –                                                                                          |
| H152    | `none`                   | 2    | –                                                                                          |

Where the Gap cell shows "–", copy the gap text from the spec's wave tables.

**Every other GA, beta and preview row:**

- Find its console page: `grep -rn` its routes from the inventory's "Where it lives" column across `src/lib/api`, then follow the hook to its route file.
- If a page covers what the row describes, mark it `full` with that route in `surfaces`.
- If it covers part, mark it `partial`, with a gap and the wave matching its tier: 1 for GA, 2 for beta, 3 for preview.
- If no surface exists and the CLI does it, mark it `cli` with the exact command from faas `cmd/gregale/cli_meta.go`. If there is no CLI command either, mark it `none`.
- Rows that are developer tools rather than console surfaces get `cli` with the command or `full` with the docs route, plus a one-line gap explaining why:
  - I156 `gregale` CLI
  - I158 SDKs
  - I161 Docs site
- I157, "Web dashboard", is the console itself: `full`, surface `/dashboard`.

**For every preview entry with a surface:** set `capability` to the row's first catalog id from `parseInventory`, or to the id its page gates on in Task 6.

**Gaps found during the audit** that the spec doesn't list go in the spec's wave table for their tier. Commit those spec edits in the same PR.

- [ ] **Step 5: Run the test and confirm it passes.**

Run: `npx vitest run src/lib/parity/ledger.test.ts`
Expected: PASS. Any failure names the row and the problem. Fix the entry, not the test.

- [ ] **Step 6: Commit.**

```bash
git add src/lib/parity/ledger.ts src/lib/parity/ledger.test.ts docs/superpowers/specs/2026-10-30-console-backend-parity-design.md
git commit -m "feat(parity): ledger of every customer capability and its console surface

One entry per GA, beta and preview row of faas's capability inventory, with
status, surfaces, gate, CLI command and gap. The test fails when upstream
adds or renames a row, when a surface route does not exist, or when a
preview surface has no capability gate."
```

---

### Task 13: Coverage report, PR template and the drift routine (PR "feat(parity): ledger", part 3)

Same branch as Tasks 11–12.

**Files:**

- Create: `scripts/parity-report.mjs`, `.github/pull_request_template.md`
- Modify: `package.json` (`"parity": "node --experimental-strip-types scripts/parity-report.mjs"`), `CLAUDE.md` (Gotchas)
- Test: `src/lib/parity/coverage.test.ts`, `src/lib/parity/coverage.ts`

**Interfaces:**

- Consumes: `LEDGER` and `parseInventory`.
- Produces: `coverage(inventory: InventoryRow[], ledger: LedgerEntry[]): Record<'GA' | 'beta' | 'preview', { total: number; full: number; partial: number; cli: number; none: number }>`.

- [ ] **Step 1: Write the failing test.**

```ts
// src/lib/parity/coverage.test.ts
import { describe, expect, it } from 'vitest';
import { coverage } from './coverage';
import type { InventoryRow } from './inventory';
import type { LedgerEntry } from './ledger';

describe('coverage', () => {
  it('counts ledger statuses per tier and ignores internal rows', () => {
    const inv: InventoryRow[] = [
      { row: 1, section: 'A', name: 'a', tier: 'GA', catalog: [] },
      { row: 2, section: 'A', name: 'b', tier: 'GA', catalog: [] },
      { row: 3, section: 'A', name: 'c', tier: 'preview', catalog: [] },
      { row: 4, section: 'A', name: 'd', tier: 'internal', catalog: [] },
    ];
    const led: LedgerEntry[] = [
      { row: 1, name: 'a', status: 'full', surfaces: ['/dashboard'] },
      { row: 2, name: 'b', status: 'none', surfaces: [], gap: 'x' },
      { row: 3, name: 'c', status: 'partial', surfaces: ['/dashboard'], gap: 'y', capability: 'z' },
    ];
    expect(coverage(inv, led)).toEqual({
      GA: { total: 2, full: 1, partial: 0, cli: 0, none: 1 },
      beta: { total: 0, full: 0, partial: 0, cli: 0, none: 0 },
      preview: { total: 1, full: 0, partial: 1, cli: 0, none: 0 },
    });
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails.**

Run: `npx vitest run src/lib/parity/coverage.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `coverage.ts` and the report.**

```ts
// src/lib/parity/coverage.ts
import type { InventoryRow } from './inventory';
import type { LedgerEntry, ParityStatus } from './ledger';

type Counts = { total: number } & Record<ParityStatus, number>;
const empty = (): Counts => ({ total: 0, full: 0, partial: 0, cli: 0, none: 0 });

export function coverage(inventory: InventoryRow[], ledger: LedgerEntry[]) {
  const out = { GA: empty(), beta: empty(), preview: empty() };
  const byRow = new Map(ledger.map((e) => [e.row, e]));
  for (const row of inventory) {
    if (row.tier === 'internal') continue;
    const counts = out[row.tier];
    counts.total += 1;
    counts[byRow.get(row.row)?.status ?? 'none'] += 1;
  }
  return out;
}
```

```js
// scripts/parity-report.mjs
import { readFileSync } from 'node:fs';
import { parseInventory } from '../src/lib/parity/inventory.ts';
import { LEDGER } from '../src/lib/parity/ledger.ts';
import { coverage } from '../src/lib/parity/coverage.ts';

/** Prints console coverage of faas's customer capabilities, by tier. */
const inventory = parseInventory(
  readFileSync('content/capabilities/ga-capability-inventory.md', 'utf8')
);
for (const [tier, c] of Object.entries(coverage(inventory, LEDGER))) {
  const pct = c.total ? Math.round(((c.full + c.cli) / c.total) * 100) : 100;
  console.log(
    `${tier.padEnd(8)} ${String(pct).padStart(3)}%  full ${c.full}  cli ${c.cli}  partial ${c.partial}  none ${c.none}  of ${c.total}`
  );
}
```

`pull-docs.mjs` already imports `docs-manifest.ts` the same way. If the Node version here can't strip types, run the report the way `docs:pull` runs: check its `package.json` script and copy that invocation.

- [ ] **Step 4: Add the PR template and the CLAUDE.md note.**

```md
<!-- .github/pull_request_template.md -->

## What changed

## What the backend does

<!-- Behaviour decided from faas main: handler, ADR, docs — with file:line. -->

## Parity

Ledger rows touched: <!-- e.g. A13 none → full; C60 partial (gap: rollback) -->

## Verification

- [ ] `npm run check`
- [ ] `npx vitest run --maxWorkers=8` exits 0, no "Errors" line
- [ ] Clicked through against `npm run dev:mock` at 1440 and 390 px
```

Add this Gotcha to CLAUDE.md:

> **The parity ledger tracks the backend.** `src/lib/parity/ledger.ts` has one entry per GA/beta/preview row of faas's capability inventory (`content/capabilities/`, pulled by `npm run capabilities:pull`); `npm run parity` prints coverage. A console change that adds or completes a customer capability updates its row. Weekly, run `npm run api:pull && npm run capabilities:pull`, fix what stops compiling, and give every new ledger-test failure an entry (status `none`, a gap, its tier's wave).

- [ ] **Step 5: Run the tests and the report, then commit.**

```bash
npx vitest run src/lib/parity && npm run parity
```

Expected: tests PASS, and the report prints three lines, e.g. `GA  41%  full 17 …`. Record the three numbers in the PR body as the Wave 0 baseline.

```bash
git add -A
git commit -m "feat(parity): coverage report, PR template and the weekly drift routine"
```

---

## Waves 1–3: procedure

Waves 1–3 start once Tasks 1–13 have landed. The spec's wave tables, now mirrored in the ledger, are the backlog, in this order:

1. Wave 1, top to bottom.
2. Wave 2.
3. Wave 3, by the order column.

For each item:

1. **Pull.** Run `git -C /home/bahadir/GREGALE/faas fetch origin`, then `npm run api:pull && npm run capabilities:pull` on a fresh branch off `main`. Fix any drift first, as its own commit.
2. **Read the backend.** Find the item's handlers, ADR and customer doc in faas `main`: routes via `pkg/apid/apidserver/server.go`, the catalog entry, and `docs/`. Write a short "What the backend does" note with file:line references, covering:
   - each route's auth and scopes, and whether step-up is needed;
   - every error code it returns;
   - states and enums;
   - limits from `pkg/api/limits.go`;
   - whether the capability is gated.
3. **Write a short plan.** Use superpowers:writing-plans and save it to `docs/superpowers/plans/<date>-parity-<row>.md`. It contains test-first tasks, mock routes for every new path, the `CapabilityGate` or nav `capability` for preview items, and the ledger edit.
4. **Implement.** Use superpowers:subagent-driven-development.
5. **Click through.** Use headless Chromium against the mock, at 1440 and 390 px. Fix what it finds before review.
6. **Open the PR.** Use the template. The ledger rows move. Paste the `npm run parity` before and after numbers into the body.
7. **Keep PRs small and unstacked.** One ledger row, or a few closely related rows, per PR. Don't stack on an unmerged parity PR unless the second one needs the first one's code.

**Closing each wave:**

- The last PR of each wave includes `npm run parity` in its body.
- Wave 1 is done when every GA row is `full`, or `cli` with a reason.
- Wave 2 is done when every beta row is.
- Wave 3 is done when every preview row is `full` or `partial` behind its gate.
