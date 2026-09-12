# Actionable Deployment Failures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Work inline unless the user requests delegation.

**Goal:** A developer opening a failed deployment can identify the reported cause, inspect supporting evidence, and reach an appropriate recovery action without searching several tabs.

**Architecture:** Use one pure explanation adapter and one presentational failure panel across existing release details and first-deploy progress. The backend remains the authority for causes, remediation, retry eligibility, and rollback targets. Preserve current queries, account/app boundaries, and URL-driven detail sections.

**Tech Stack:** React 19, TypeScript, TanStack Router/Query, existing console primitives, Vitest/Testing Library, Playwright browser validation. No new dependencies or API endpoints.

**Spec:** This conversation's third product enhancement: “Make failures actionable”—lead with what failed, relevant evidence, and the next step; keep raw logs available underneath. The proposed first increment below covers deployment/build failures, not runtime request groups.

## Scope and starting point

## Execution report — 2026-09-12

Tasks 1–4 are implemented. The original checklist below is retained as the planning record; this report records actual execution and verification.

- Added the pure evidence adapter and shared explanation-first panel, integrated into release details and first-deploy progress.
- Retry rejection stays inline with the selected stage preserved; accepted retries link to the returned deployment ID. Duplicate pending submissions are guarded.
- Production build, typecheck, formatting, and lint pass (six existing lint warnings). The final full suite passes: 124 test files, 966 tests. The first full check exposed an incomplete new build fixture; correcting that fixture restored the suite without changing production code.
- Browser-verified the failed release → excerpts → output → Back → retry options flow, a 403 rejection, then an accepted retry pointing at the new ID. Verified desktop and 390px mobile with reduced motion, no horizontal overflow, and no page errors.
- Automated tests cover raw/blank evidence fallbacks, build-only failures, cancelled/in-flight/live states, unreadable and wrong-app deployment evidence, first-deploy live-endpoint gating, and submission-retry app identity. These variants were not each repeated manually in the browser.
- Screenshots captured locally at `/tmp/gregale-actionable-failure-desktop.png`, `/tmp/gregale-actionable-failure-mobile.png`, and `/tmp/gregale-failure-panel.png`.
- Commit grouping: preserve the preceding first-deploy feature as its own commit, then save this cross-surface failure experience as one cohesive feature commit instead of separate commits for every internal layer. No PR, push, or merge performed.

### Original starting point

The first-deploy improvements are currently uncommitted on `feat/first-deploy-experience`. Preserve them. When execution is requested, establish the approved base containing that work; do not mix its commit with this feature or overwrite it.

Existing capabilities verified in the code:

- `DeploymentResponse` has `error`, `error_code`, `error_why`, `error_fix`, `error_hint`, and `error_relevant_logs`. Log excerpts contain optional `ts`, `level`, `source`, and `message`.
- `BuildResponse.failure_class` is `oom | timeout | user_error | infra`. A build can lack a readable deployment record.
- `ReleaseDetailPanel` is shared by account and app release surfaces. It currently places raw errors after metadata and offers recovery on the Lifecycle section.
- `DeploymentProgress` now renders cause/remediation, but does not render relevant log excerpts.
- `DeploymentLifecycle` already retries from a user-selected stage. Retry returns a new deployment, not an update to the failed row. Its current success feedback is a toast.
- `ErrorsBody` groups runtime request failures and displays deployment IDs as text. That is a separate next increment, not a missing build-error endpoint.

## Global constraints

- Plan only until the user requests implementation. No product code changes, commits, PRs, or merges as part of planning.
- Keep the existing charcoal-and-mint tokens. Critical color marks failure, not the entire panel. No new literal hex values or `dark:` variants in console components.
- No AI-generated diagnoses, log regex diagnosis engine, speculative fixes, automatic retries, automatic configuration changes, or automatic rollback.
- Render evidence as text; never execute suggested commands or turn backend prose into executable actions.
- Keep missing, loading, failed reads, cancellation, and confirmed deployment failures distinct. A disconnected log stream does not mean the deployment failed.
- Never display cross-app deployment evidence before the existing ownership check passes.
- No extra per-row detail fetches on the release list. Use fields already returned; show a less specific explanation when details are absent.
- Keep existing permission/MFA/plan handling; present rejected mutations inline without bypassing gates.
- Reuse existing build-log access. Do not introduce diagnostic exports containing raw logs, headers, or secrets in this increment.
- Do not hand-edit generated route or API schema files.

## Proposed interaction

Opening a failed release lands on Overview as today. The failure panel precedes technical metadata:

```text
Deployment failed

What happened
[API explanation; raw error if no explanation exists]

Next step
[API remediation; otherwise a clearly non-diagnostic instruction to inspect logs]

Relevant evidence
[Up to three server-selected log excerpts, with available source/time]
[Show remaining evidence]

[View build output]  [Retry options, only for a retryable failed deployment]

Technical details: error code and existing release metadata
```

Success, in-flight, and cancelled views retain their own states. An old failed deployment remains failed after a retry; the retry result links to the new deployment so the user can follow it.

## Task 1: Normalize existing failure evidence

**Files:** Create `src/components/dashboard/failure-summary.ts` and `failure-summary.test.ts`.

**Interfaces:** Consume the existing generated response types; produce the shared display model below. The adapter selects evidence only; callers decide whether the entity is a confirmed failure.

```ts
import type { components } from '@/lib/api/schema';
type Deployment = components['schemas']['DeploymentResponse'];
type Build = components['schemas']['BuildResponse'];
export interface FailureSummary {
  cause: string;
  nextStep: string;
  code?: string;
  evidence: NonNullable<Deployment['error_relevant_logs']>;
}
export function failureSummary(input: { deployment?: Deployment; build?: Build }): FailureSummary;
```

- [ ] Write failing tests for structured explanation precedence, blank fields, raw-error fallback, build-only failures, and empty evidence. Example:

```ts
expect(failureSummary({})).toEqual({
  cause: 'No failure explanation was recorded.',
  nextStep: 'Review the build output for more detail.',
  code: undefined,
  evidence: [],
});
```

- [ ] Run `npm test -- src/components/dashboard/failure-summary.test.ts` and confirm the missing implementation is the failure.
- [ ] Implement trimmed, non-empty precedence: cause = `error_why`, then `error`, then build-class label, then the tested generic fallback. Next step = `error_fix`, then `error_hint`, then the tested inspection instruction. Preserve the original error code for technical details. Filter excerpts without a non-empty message; preserve source/time and ordering.

```ts
const classLabel = {
  oom: 'The build ran out of memory.',
  timeout: 'The build exceeded its time limit.',
  user_error: 'The build reported an application error.',
  infra: 'The build reported an infrastructure error.',
} satisfies Record<NonNullable<Build['failure_class']>, string>;
const present = (text?: string | null) => text?.trim() || undefined;
```

Do not suggest raising runtime memory based on a build OOM: these are different resource contexts.

- [ ] Run the adapter tests and typecheck; commit this independent normalization contract when implementation is authorized.

## Task 2: Build an explanation-first failure panel

**Files:** Create `src/components/dashboard/failure-panel.tsx` and `failure-panel.test.tsx`.

**Interfaces:** Consume `FailureSummary`; no queries or mutation hooks in this component.

```ts
export interface FailurePanelProps {
  summary: FailureSummary;
  onViewOutput: () => void;
  onRetryOptions?: () => void;
}
export function FailurePanel(props: FailurePanelProps): React.ReactNode;
```

- [ ] Write failing component tests. In the fixture, use five server excerpts; assert only three are visible initially, opening the disclosure reveals the remaining two, and the output/retry controls invoke their callbacks. Assert the retry control is absent when no callback is supplied.

```tsx
render(<FailurePanel summary={summary} onViewOutput={viewOutput} />);
await userEvent.click(screen.getByRole('button', { name: 'View build output' }));
expect(viewOutput).toHaveBeenCalledOnce();
expect(screen.queryByRole('button', { name: 'Retry options' })).not.toBeInTheDocument();
```

- [ ] Run `npm test -- src/components/dashboard/failure-panel.test.tsx` and confirm the expected failure.
- [ ] Implement a named region (`aria-label="Failure explanation"`) with cause and next-step paragraphs, wrapping excerpt messages, optional timestamps/source, and one native `details` disclosure for remaining excerpts. Use `summary.evidence.slice(0, 3)` and `.slice(3)`; render messages through JSX text, never HTML. Render absent metadata as absent, not invented timestamps.
- [ ] Keep code/IDs in a secondary technical disclosure; do not duplicate repeated alert announcements while polling. Buttons use existing `Button` variants with visible focus.
- [ ] Run component tests and typecheck; commit the reusable panel.

## Task 3: Integrate release details and first-deploy progress

**Files:** Modify `release-detail.tsx`, `deployment-progress.tsx`, `deployment-progress.test.tsx`, `deployment-detail.test.tsx`, and `src/routes/-dashboard.releases.test.tsx`.

**Interfaces:** Preserve `ReleaseDetailPanel`'s existing props and URL-owned section state. Use the Task 1 adapter and Task 2 panel. Leave submission errors in `DeploymentProgress` separate: those do not yet have a deployment to retry.

- [ ] Add failing integration tests: structured cause/fix/excerpts appear before metadata for a failed deployment, output action selects the Output section, retry options selects Lifecycle, a failed build without a readable deployment still shows its build-class explanation but no retry action, and wrong-app responses expose neither explanation nor excerpts.
- [ ] Run `npm test -- src/routes/-dashboard.releases.test.tsx src/components/dashboard/deployment-detail.test.tsx src/components/dashboard/deployment-progress.test.tsx` to verify the new cases fail.
- [ ] Insert the panel inside the existing ownership/read-state guards. Preserve the current section-switch mechanism:

```tsx
<FailurePanel
  summary={failureSummary({ deployment, build })}
  onViewOutput={() => (onSectionChange ?? setLocalSection)('output')}
  onRetryOptions={
    deployment?.status === 'failed'
      ? () => (onSectionChange ?? setLocalSection)('lifecycle')
      : undefined
  }
/>
```

Render only for confirmed deployment failure (excluding cancellation) or failed build. For a build whose deployment read fails, show the build explanation alongside the existing unavailable-evidence notice; never reuse stale deployment details as confirmed evidence.

- [ ] In `DeploymentProgress`, replace only the confirmed-deployment error block with the shared panel. Its output callback opens the existing log disclosure; retry-options callback navigates to `/dashboard/deployments` with `{ deployment: deploymentId, releaseSection: 'lifecycle' }`. Keep submission retry, live endpoint gating, and cancelled/status-read-error behavior unchanged.
- [ ] Run integration tests, including direct URLs and Back/Forward. Verify no new list-row queries. Commit the integration.

## Task 4: Make retry outcomes followable and failures persistent

**Files:** Modify `deployment-lifecycle.tsx` and `deployment-lifecycle.test.tsx`.

**Interfaces:** Keep existing `DeploymentLifecycle({ deployment })` and `useRetryDeployment()` signatures. Use the returned `DeploymentResponse.id` for an inline link, never the failed deployment ID.

- [ ] Write failing tests for the new-result link, permission rejection shown inline with the selected retry stage retained, and no duplicate submission while pending. Existing tests for live/cancelled eligibility remain.
- [ ] Run `npm test -- src/components/dashboard/deployment-lifecycle.test.tsx` and confirm failures.
- [ ] Retain `Resume from` and the explicit mutation button. Add local retry-result/error state. Do not select an inferred retry stage or automatically retry a request. On success render:

```tsx
<Link
  to="/dashboard/deployments"
  search={{ deployment: retryResult.id, releaseSection: 'overview' }}
>
  View new deployment
</Link>
```

On rejection show `errorMessage(error)` in an inline alert; do not label the old deployment as live or overwrite its evidence. Keep the existing `busy={retry.isPending}` guard. The failed record stays available, and the user deliberately follows the new deployment.

- [ ] Run lifecycle tests and the release integration suite; commit recovery feedback.

## Task 5: Verify the full diagnostic journey

**Files:** Extend the preceding test files only if browser checks reveal a specific regression. No permanent production fixture data.

- [ ] Run `npm run build && npm run check` in this order, then `git diff --check`. Review warning counts against the existing baseline rather than suppressing new warnings.
- [ ] Against the local mock server with intercepted responses, walk: failed release → cause → excerpt → full output → retry options → accepted new deployment. Assert the final link uses the returned ID and no app is recreated.
- [ ] Repeat for raw-error-only response, build-only OOM, absent logs, disconnected logs, 403 retry rejection, cancelled deployment, and unreadable deployment evidence.
- [ ] At 390px and desktop width, check long error text/commands, keyboard focus, disclosure controls, and reduced motion. Query changes must not replay the console page transition or discard the selected release.
- [ ] Verify first-deploy progress still gates Open app on confirmed live state and preserves app identity through submission retries.
- [ ] Deliver screenshots and verification results. Do not open a PR or merge unless requested.

## Follow-up increment: runtime request failures

Plan separately after this increment: make `ErrorsBody` request/deployment identifiers navigable, preserve app scope when opening related release evidence, and present request-group impact from reported counts/statuses/time windows. Validate retention, redaction, and permission behavior first. Do not reuse build retry controls for runtime errors or imply that a grouped request sample proves a deployment caused an incident.

## Success criteria

- A known structured failure opens with the reported cause and remediation, not an ID grid.
- Relevant evidence is readable without opening the complete log stream.
- Output and retry options are reachable directly from the explanation.
- A retry result leads to the new deployment; rejection remains visible and recoverable.
- No new backend dependency, fabricated diagnosis, duplicate app, or loss of app/permission boundaries.

## Plan review

Requirements map: cause/remediation normalization → Task 1; evidence-first layout → Task 2; consistent surfaces and guarded fallbacks → Task 3; recovery feedback → Task 4; end-to-end safety and usability → Task 5. Runtime errors are explicitly a separate increment. All new interfaces are defined above; existing API types and retry response fields were inspected before writing this plan.
