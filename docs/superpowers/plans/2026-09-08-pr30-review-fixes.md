# PR #30 Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PR #30's first-deployment wizard create a valid, plan-compatible, durably GitHub-bound app and complete onboarding only after the first source deployment is accepted.

**Architecture:** Keep `NewAppWizard` as the shared dashboard/onboarding UI. Put GitHub source validation in a small pure module, extend the existing plan helpers for resident-instance eligibility, and add a variable-slug repository-binding mutation alongside the existing create-wizard mutations. For Git sources, the submit sequence becomes create app → bind repository → submit source ref; scaling remains an independent best-effort configuration write, and onboarding completion moves to the accepted-deployment boundary.

**Tech Stack:** React 19, TypeScript, Vite 6, TanStack Router and Query, `openapi-fetch`, Vitest, React Testing Library, `@testing-library/user-event`, Tailwind design tokens.

**Spec:** [PR #30](https://github.com/poyrazK/faas-web/pull/30), its four review findings, `api/openapi.yaml` (`SourceRefDeployRequest`, `AccountResponse`, and the app-install bind endpoint), and the backend `faas/cmd/apid/handlers_source_ref.go::isValidRef` contract.

## Global Constraints

- Implement in a fresh isolated worktree created with `superpowers:using-git-worktrees`; do not modify `/home/bahadir/GREGALE/faas-web`, which contains unrelated landing-page work.
- Start from PR #30 head `a5ec0635106ea2b74c1c906d8b38aaa1160da4ad`. Fetch before work and confirm whether the remote head changed; if it changed, review the new diff before applying this plan.
- Do not hand-edit `src/lib/api/schema.d.ts` or `src/routeTree.gen.ts`.
- Reuse the existing API operations. This repair requires no `faas/` or OpenAPI change.
- Branch on `ApiError.code`, not response prose or bare HTTP status.
- Keep source data live. Do not add fixtures under `src/`.
- Use design tokens only; do not add literal hex colours or `dark:` variants.
- Tests live beside implementation as `*.test.ts(x)` and every task is test-first.
- Do not add to the repository's lint-warning count.
- Run the production build before the final test run because `src/prerender.test.ts` reads `dist/index.html`.
- Use conventional commits without attribution lines.

## File Map

| File                                               | Responsibility                                                                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `src/components/dashboard/new-app-source.ts`       | New pure validation helpers matching the API/backend GitHub repository and ref contracts.                       |
| `src/components/dashboard/new-app-source.test.ts`  | Boundary and rejection tests for repository/ref validation.                                                     |
| `src/lib/plan.ts`                                  | Existing plan capability helpers; gains resident-instance eligibility.                                          |
| `src/lib/plan.test.ts`                             | Free versus paid resident-instance tests.                                                                       |
| `src/lib/api/queries.ts`                           | Shared bind request plus a variable-slug `useBindRepoFor()` mutation for newly created apps.                    |
| `src/components/dashboard/new-app-wizard.tsx`      | Integrates validation, plan gate, binding-first Git submission, and accepted-deployment callback.               |
| `src/components/dashboard/new-app-wizard.test.tsx` | New regression tests for binding order, failed deployment onboarding, retry completion, and the Free-plan gate. |
| `src/routes/onboarding.tsx`                        | Renames the callback wiring so `markOnboarded()` means deployment accepted, not merely app created.             |

---

### Task 1: Validate GitHub repository and ref before app creation

**Files:**

- Create: `src/components/dashboard/new-app-source.ts`
- Create: `src/components/dashboard/new-app-source.test.ts`
- Modify: `src/components/dashboard/new-app-wizard.tsx:120-139, 455-486`

**Interfaces:**

- Produces: `isValidGitHubRepo(value: string): boolean`
- Produces: `isValidGitRef(value: string): boolean`
- The wizard's effective ref remains `ref.trim() || 'main'`.

- [ ] **Step 1: Write failing validation tests**

Create `src/components/dashboard/new-app-source.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isValidGitHubRepo, isValidGitRef } from './new-app-source';

describe('new app Git source validation', () => {
  it('accepts API-shaped GitHub owner/repository slugs', () => {
    for (const repo of ['gregale/api', 'one-box/faas_web.git', 'A.B-C/repo_2']) {
      expect(isValidGitHubRepo(repo), repo).toBe(true);
    }
  });

  it('rejects repositories that the source-ref API cannot address', () => {
    for (const repo of ['', 'owner', 'owner/repo/extra', 'owner/repo?ref=main', 'owner/my repo']) {
      expect(isValidGitHubRepo(repo), repo).toBe(false);
    }
  });

  it('accepts ordinary branches, tags, and canonical commit SHAs', () => {
    for (const ref of ['main', 'feature/onboarding', 'v1.2.3', 'a'.repeat(40)]) {
      expect(isValidGitRef(ref), ref).toBe(true);
    }
  });

  it('mirrors the backend ref-shape rejections', () => {
    for (const ref of [
      '',
      '@',
      '/main',
      'main/',
      'feature//x',
      'feature/../main',
      '.hidden',
      'main.lock',
      'abc123',
      'bad ref',
      'main?',
      'x'.repeat(201),
    ]) {
      expect(isValidGitRef(ref), ref).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run the new test and verify the missing-module failure**

```bash
npm test -- src/components/dashboard/new-app-source.test.ts
```

Expected: FAIL because `./new-app-source` does not exist.

- [ ] **Step 3: Implement the pure validators**

Create `src/components/dashboard/new-app-source.ts`:

```ts
const GITHUB_REPO = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;
const FORBIDDEN_REF_CHAR = /[\\\0`?%[\]{}<>"'*\x00-\x20\x7f:^~]/;

export function isValidGitHubRepo(value: string): boolean {
  return GITHUB_REPO.test(value.trim());
}

export function isValidGitRef(value: string): boolean {
  const ref = value.trim();
  if (
    ref.length < 1 ||
    ref.length > 200 ||
    ref === '@' ||
    ref.startsWith('/') ||
    ref.endsWith('/') ||
    ref.includes('//') ||
    ref.includes('..') ||
    ref.includes('@{') ||
    ref.endsWith('.') ||
    FORBIDDEN_REF_CHAR.test(ref)
  ) {
    return false;
  }
  if (ref.length < 7 && /^[0-9a-f]+$/.test(ref)) return false;
  return ref
    .split('/')
    .every(
      (part) =>
        part.length > 0 && !part.startsWith('.') && !part.endsWith('.') && !part.endsWith('.lock')
    );
}
```

This deliberately mirrors `apid`'s cheap preflight rather than attempting a network existence check.

- [ ] **Step 4: Integrate both validators into the wizard**

In `new-app-wizard.tsx`, replace the permissive regex and introduce one normalized ref:

```ts
const normalizedRef = ref.trim() || 'main';
const repoValid = isValidGitHubRepo(repo);
const refValid = isValidGitRef(normalizedRef);
const gitSourceValid = source !== 'git' || (repoValid && refValid);
```

Use `normalizedRef` in the initial source-ref mutation, retry mutation, review summary, and success toast. Change all create/retry guards and Source-step buttons to require `gitSourceValid`. Add `maxLength={200}` and `aria-invalid={!refValid || undefined}` to the ref input, then render this message while invalid:

```tsx
{
  !refValid && (
    <span className="text-xs" style={{ color: 'var(--status-critical)' }}>
      Use a valid branch, tag, or commit SHA of at most 200 characters.
    </span>
  );
}
```

The create guard must become:

```ts
if (deployBlocked || !nameValid || !gitSourceValid || (source === 'git' && !githubConnected)) {
  return;
}
```

- [ ] **Step 5: Format and verify the focused tests**

```bash
npx prettier --write src/components/dashboard/new-app-source.ts src/components/dashboard/new-app-source.test.ts src/components/dashboard/new-app-wizard.tsx
npm test -- src/components/dashboard/new-app-source.test.ts
npm run typecheck
```

Expected: validation tests PASS and TypeScript reports no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard/new-app-source.ts src/components/dashboard/new-app-source.test.ts src/components/dashboard/new-app-wizard.tsx
git commit -m "fix(console): validate first-deployment Git sources"
```

---

### Task 2: Gate resident instances by plan

**Files:**

- Modify: `src/lib/plan.ts`
- Modify: `src/lib/plan.test.ts`
- Modify: `src/components/dashboard/new-app-wizard.tsx:122-127, 597-610, 642-660`

**Interfaces:**

- Produces: `residentInstancesAllowed(account: Pick<Account, 'plan'> | null): boolean`
- Consumes: the existing `isPaidPlan()` helper.
- The effective Free-plan setting is always scale-to-zero; no unsupported PATCH is sent.

- [ ] **Step 1: Write the failing plan-capability test**

Add `residentInstancesAllowed` to the imports in `src/lib/plan.test.ts`, then append:

```ts
it('allows resident instances only on paid plans', () => {
  expect(residentInstancesAllowed(null)).toBe(false);
  expect(residentInstancesAllowed({ plan: 'free' })).toBe(false);
  expect(residentInstancesAllowed({ plan: 'hobby' })).toBe(true);
  expect(residentInstancesAllowed({ plan: 'pro' })).toBe(true);
  expect(residentInstancesAllowed({ plan: 'scale' })).toBe(true);
});
```

- [ ] **Step 2: Run the test and verify the missing-export failure**

```bash
npm test -- src/lib/plan.test.ts
```

Expected: FAIL because `residentInstancesAllowed` is not exported.

- [ ] **Step 3: Add the plan helper**

Append to `src/lib/plan.ts`:

```ts
export function residentInstancesAllowed(account: Pick<Account, 'plan'> | null): boolean {
  return account !== null && isPaidPlan(account.plan);
}
```

- [ ] **Step 4: Make the wizard derive an allowed effective value**

Import the helper and define:

```ts
const canKeepResident = residentInstancesAllowed(account);
const effectiveScaleToZero = scaleToZero || !canKeepResident;
```

Use `effectiveScaleToZero` in the PATCH decision and Review value. Set the switch to:

```tsx
<Switch
  checked={effectiveScaleToZero}
  disabled={!canKeepResident}
  onCheckedChange={setScaleToZero}
  aria-label="Scale to zero"
  aria-describedby={!canKeepResident ? 'scale-to-zero-plan-note' : undefined}
  className="mt-1 data-[state=checked]:bg-brand"
/>
```

Render this beneath the existing description for Free accounts:

```tsx
{
  account && !canKeepResident && (
    <p id="scale-to-zero-plan-note" className="mt-1 text-xs text-muted-foreground">
      Keeping an instance resident requires a paid plan.
    </p>
  );
}
```

- [ ] **Step 5: Run focused verification**

```bash
npx prettier --write src/lib/plan.ts src/lib/plan.test.ts src/components/dashboard/new-app-wizard.tsx
npm test -- src/lib/plan.test.ts
npm run typecheck
```

Expected: plan tests PASS and TypeScript reports no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/plan.ts src/lib/plan.test.ts src/components/dashboard/new-app-wizard.tsx
git commit -m "fix(console): gate resident instances by plan"
```

---

### Task 3: Bind Git apps before deployment and complete onboarding on acceptance

**Files:**

- Modify: `src/lib/api/queries.ts:90-120, 1718-1747`
- Modify: `src/components/dashboard/new-app-wizard.tsx:61-80, 129-225`
- Create: `src/components/dashboard/new-app-wizard.test.tsx`
- Modify: `src/routes/onboarding.tsx:21-23, 53-56`

**Interfaces:**

- Produces: `useBindRepoFor()` with `mutateAsync(input)` where input is `{ slug: string; installationId: number; repo: string; branch: string }`.
- Renames: `NewAppWizardProps.onAppCreated` → `onDeploymentAccepted`.
- Git submission order is bind, then deploy. The bind operation is idempotent, so retry repeats both operations safely.
- `onDeploymentAccepted` fires only after a source-ref request returns a real deployment, including a successful retry.

- [ ] **Step 1: Create a failing wizard regression suite**

Create `src/components/dashboard/new-app-wizard.test.tsx`. Use hoisted mocks so each test controls the async writes:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { NewAppWizard } from './new-app-wizard';

const mocks = vi.hoisted(() => ({
  addWorkflow: vi.fn(),
  bindRepo: vi.fn(),
  deployFromRef: vi.fn(),
  updateApp: vi.fn(),
  toast: vi.fn(),
  account: {
    plan: 'hobby' as 'free' | 'hobby' | 'pro' | 'scale',
    app_count: 0,
    github_install_id: '42',
    limits: { ram_mb: 512, deployed_apps: 10 },
  },
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
  useNavigate: () => vi.fn(),
}));
vi.mock('@/lib/use-unsaved-guard', () => ({ useUnsavedGuard: vi.fn() }));
vi.mock('@/components/dashboard/deployment-progress', () => ({
  DeploymentProgress: () => <div>deployment progress</div>,
}));
vi.mock('@/components/dashboard/repo-picker', () => ({
  RepoPicker: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <input
      aria-label="Repository"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));
vi.mock('@/lib/store', () => ({
  useData: () => ({ addWorkflow: mocks.addWorkflow }),
}));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    loading: false,
    account: mocks.account,
  }),
}));
vi.mock('@/lib/api/queries', () => ({
  useBindRepoFor: () => ({ mutateAsync: mocks.bindRepo }),
  useDeployFromRefFor: () => ({ mutateAsync: mocks.deployFromRef }),
  useUpdateAppFor: () => ({ mutateAsync: mocks.updateApp }),
}));

async function submitGitApp(onDeploymentAccepted = vi.fn()) {
  const user = userEvent.setup();
  render(<NewAppWizard onboarding onDeploymentAccepted={onDeploymentAccepted} />);
  await user.type(screen.getByLabelText(/repository/i), 'gregale/demo');
  await user.click(screen.getByRole('button', { name: /continue/i }));
  await user.type(screen.getByLabelText(/function name/i), 'demo-app');
  await user.click(screen.getByRole('button', { name: /review/i }));
  await user.click(screen.getByRole('button', { name: /deploy function/i }));
  return { onDeploymentAccepted };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.account.plan = 'hobby';
  mocks.addWorkflow.mockResolvedValue({ id: 'demo-app', url: 'https://demo-app.example' });
  mocks.bindRepo.mockResolvedValue({ binding_id: 'bind-1' });
  mocks.deployFromRef.mockResolvedValue({ id: 'deployment-1' });
  mocks.updateApp.mockResolvedValue({});
});

describe('NewAppWizard Git submission', () => {
  it('prevents Free accounts from requesting a resident instance', async () => {
    mocks.account.plan = 'free';
    const user = userEvent.setup();
    render(<NewAppWizard onboarding />);
    await user.type(screen.getByLabelText(/repository/i), 'gregale/demo');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    expect(screen.getByRole('switch', { name: /scale to zero/i })).toBeDisabled();
    expect(screen.getByText(/requires a paid plan/i)).toBeInTheDocument();
  });

  it('binds the new app before submitting its first source deployment', async () => {
    await submitGitApp();

    await waitFor(() => expect(mocks.deployFromRef).toHaveBeenCalledTimes(1));
    expect(mocks.bindRepo).toHaveBeenCalledWith({
      slug: 'demo-app',
      installationId: 42,
      repo: 'gregale/demo',
      branch: 'main',
    });
    expect(mocks.bindRepo.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deployFromRef.mock.invocationCallOrder[0]
    );
  });

  it('does not complete onboarding when binding or deployment is rejected', async () => {
    mocks.deployFromRef.mockRejectedValueOnce(new Error('GitHub unavailable'));
    const { onDeploymentAccepted } = await submitGitApp();

    await screen.findByText(/deployment progress/i);
    await waitFor(() => expect(mocks.deployFromRef).toHaveBeenCalledTimes(1));
    expect(onDeploymentAccepted).not.toHaveBeenCalled();
  });

  it('completes onboarding after a successful accepted deployment', async () => {
    const { onDeploymentAccepted } = await submitGitApp();

    await waitFor(() => expect(onDeploymentAccepted).toHaveBeenCalledTimes(1));
  });
});
```

- [ ] **Step 2: Run the suite and verify the expected failures**

```bash
npm test -- src/components/dashboard/new-app-wizard.test.tsx
```

Expected: FAIL because `onDeploymentAccepted` and `useBindRepoFor` do not exist and the bind expectation is unmet.

- [ ] **Step 3: Share the bind request and add the variable-slug hook**

In `src/lib/api/queries.ts`, define one internal request used by both hooks:

```ts
type BindRepoInput = {
  installationId: number;
  repo: string;
  branch: string;
};

function bindRepo(slug: string, input: BindRepoInput) {
  return unwrap(
    api.POST('/v1/apps/{slug}/install/bind', {
      params: { path: { slug } },
      body: {
        installation_id: input.installationId,
        repo_full_name: input.repo,
        production_branch: input.branch,
      },
    })
  );
}

export function useBindRepo(slug: string) {
  return useMutation({ mutationFn: (input: BindRepoInput) => bindRepo(slug, input) });
}

export function useBindRepoFor() {
  return useMutation({
    mutationFn: ({ slug, ...input }: { slug: string } & BindRepoInput) => bindRepo(slug, input),
  });
}
```

Keep this beside `useInstallRepos` and `useBindRepo`; do not duplicate the endpoint body near `useDeployFromRefFor`.

- [ ] **Step 4: Bind before every Git source submission**

Import and instantiate `useBindRepoFor()` in `NewAppWizard`. Add this helper inside the component:

```ts
async function submitGitSource(slug: string) {
  const installationId = Number(account?.github_install_id);
  if (!Number.isSafeInteger(installationId) || installationId <= 0) {
    throw new Error('Connect GitHub before deploying from a repository.');
  }
  await bindRepo.mutateAsync({
    slug,
    installationId,
    repo: repo.trim(),
    branch: normalizedRef,
  });
  return deployFromRef.mutateAsync({
    slug,
    repo: repo.trim(),
    ref: normalizedRef,
    format: 'tarball',
  });
}
```

Use `submitGitSource(created.id)` for the initial Git promise and `submitGitSource(createdId)` in `retrySourceDeploy()`. Binding first ensures an accepted deployment is attached to the exact installation/repository/production branch selected in the wizard.

- [ ] **Step 5: Move onboarding completion to deployment acceptance**

Rename the prop and its comment:

```ts
/** Called after the first source-ref deployment has been accepted. */
onDeploymentAccepted?: () => void;
```

Delete the callback immediately after `setCreatedUrl(created.url)`. Call it only in the fulfilled branch after `setDeploymentId(...)`, and after a successful retry:

```ts
setDeploymentId(deployment.id);
onDeploymentAccepted?.();
```

In `src/routes/onboarding.tsx`, rename `finish` to `finishDeployment` and wire:

```tsx
<NewAppWizard
  onboarding
  onDeploymentAccepted={finishDeployment}
  onConnectGitHub={beginOnboardingGitHubConnect}
/>
```

`finishDeployment` continues to call only `markOnboarded()`. The user remains on the live deployment-progress screen.

- [ ] **Step 6: Add a retry regression test**

Extend the suite so the first source deployment rejects and the retry succeeds:

```tsx
it('completes onboarding when retry later receives a deployment id', async () => {
  mocks.deployFromRef
    .mockRejectedValueOnce(new Error('temporary failure'))
    .mockResolvedValueOnce({ id: 'deployment-2' });
  const { onDeploymentAccepted } = await submitGitApp();

  const retry = await screen.findByRole('button', { name: /retry/i });
  expect(onDeploymentAccepted).not.toHaveBeenCalled();
  await userEvent.setup().click(retry);

  await waitFor(() => expect(onDeploymentAccepted).toHaveBeenCalledTimes(1));
  expect(mocks.bindRepo).toHaveBeenCalledTimes(2);
  expect(mocks.deployFromRef).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 7: Format and run focused verification**

```bash
npx prettier --write src/lib/api/queries.ts src/components/dashboard/new-app-wizard.tsx src/components/dashboard/new-app-wizard.test.tsx src/routes/onboarding.tsx
npm test -- src/components/dashboard/new-app-wizard.test.tsx src/components/dashboard/new-app-source.test.ts src/lib/plan.test.ts src/lib/auth.test.ts
npm run typecheck
```

Expected: all focused tests PASS and TypeScript reports no errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/api/queries.ts src/components/dashboard/new-app-wizard.tsx src/components/dashboard/new-app-wizard.test.tsx src/routes/onboarding.tsx
git commit -m "fix(console): bind first deployment before onboarding completes"
```

---

### Task 4: Current-main integration and release verification

**Files:**

- No intentional source changes; resolve only real merge conflicts if `origin/main` moved.

**Interfaces:**

- Consumes all prior task outputs.
- Produces a PR branch that is tested against current `origin/main` without altering the original WSL checkout.

- [ ] **Step 1: Inspect branch and remote state**

```bash
git status --short --branch
git fetch origin
git log --oneline --decorate -5
git rev-list --left-right --count origin/main...HEAD
```

Expected: only the three planned commits are ahead of the PR head and the worktree is clean.

- [ ] **Step 2: Merge current main into the repair branch**

```bash
git merge --no-ff origin/main
```

Expected from the 2026-09-06 synthetic merge: no conflicts. If the command now conflicts because `main` changed, stop after recording `git status --short`; do not resolve by discarding either side.

- [ ] **Step 3: Run the repository gates in the required order**

```bash
npm ci
npm run build
npm run check
git diff --check origin/main...HEAD
```

Expected:

- Production build and all prerendered routes succeed.
- Typecheck has zero errors.
- ESLint stays within the existing warning ceiling with zero errors.
- Formatting is clean.
- All Vitest files pass, including the new source and wizard suites.
- `git diff --check` emits no output.

- [ ] **Step 4: Run a focused mock smoke test**

```bash
MOCK_EMPTY=1 npm run dev:mock
```

In a clean browser profile: sign up, enter onboarding, connect/select a mocked Git repository, confirm the Free-plan scale-to-zero switch is disabled, deploy, and verify the UI remains in deployment progress until a real deployment id is present. Then open `/dashboard/workflows/new` under a paid mock account and verify “Create empty” still creates an app without invoking Git binding.

- [ ] **Step 5: Review the final diff**

```bash
git diff --stat origin/main...HEAD
git diff origin/main...HEAD -- src/components/dashboard/new-app-source.ts src/lib/plan.ts src/lib/api/queries.ts src/components/dashboard/new-app-wizard.tsx src/routes/onboarding.tsx
git status --short --branch
```

Confirm the final diff contains no backend/schema edits, no generated-file edits, and no unrelated landing-page files.

- [ ] **Step 6: Prepare the PR update**

Do not push until the user requests it. Report the commit hashes, verification output, and whether the PR head needs a normal push or a new pull request. Never force-push the co-founder's branch without explicit authorization.

## Acceptance Checklist

- Invalid repository/ref input cannot reach `POST /v1/apps`.
- A Free account cannot request `min_instances: 1`; Hobby, Pro, and Scale accounts can.
- A Git-created app is bound to its installation/repository/branch before source deployment is submitted.
- A binding failure prevents source submission and remains retryable.
- A source-deployment failure does not mark onboarding complete.
- A successful initial submission or retry marks onboarding complete exactly once.
- Dashboard “Create empty” behavior remains unchanged.
- Current-main merge, build, check, and whitespace verification all pass.
