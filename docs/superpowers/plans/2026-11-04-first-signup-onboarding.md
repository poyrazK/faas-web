# First-signup onboarding implementation plan

Date: 2026-11-04

Baseline: `faas-web` main at `3ad16ff2`

Status: Implemented on `feat/first-signup-onboarding`, behind a default-off flag. Production release remains blocked on the deployment prerequisites and real-account smoke tests below.

## Outcome and scope

Take a newly authenticated customer from signup to a real live app, with a public URL they can open. The first screen offers **Try a sample** and **Deploy my repository**, plus **Explore the console**. A supplied repository/ref bypasses the choice screen and keeps the customer's original intent.

Ship an onboarding presentation that reuses the existing creation, deployment and recovery code. Keep the general New app journey compatible. The MVP uses existing APIs; it does not require a new onboarding backend endpoint, a template marketplace, a questionnaire, or a change to invocation entitlements.

Keep already-open work separate. In particular, coordinate with #287's account-local-state changes, #278's provider placement, and #283's console components without merging or reimplementing those PRs as part of this work. Recheck their status and current main before implementation.

## Confirmed starting points

- `src/routes/onboarding.tsx` forces `source: 'git'` and passes `markOnboarded` to both app-created and deployment-accepted callbacks.
- `NewAppWizard` calls app-created before submitting a deployment. An accepted deployment is also not proof that it is live.
- Browser-written functions already deploy through `useDeployFunctionSourceFor`; the packaged starter comes from `FUNCTION_STARTERS`, `tarball` and `gzip`.
- `DeploymentProgress` already reports real status, logs, `onLive` and terminal states. Git recovery already verifies the app/deployment association and protects ambiguous submissions.
- `DeploymentRecoveryContext` requires a Git repository/ref. It cannot represent a sample deployment without a separate source-aware model.
- `FirstResponse` uses the paid invoke API. Free users can open the public URL or use curl, but cannot use that API to verify a response inside the console.
- The existing onboarding hint is a browser-wide boolean. It cannot establish account-specific deployment success.

## Product contract

| Stage            | Customer sees                                   | Completion evidence                                             |
| ---------------- | ----------------------------------------------- | --------------------------------------------------------------- |
| Start            | Sample, repository, or explore                  | Explicit choice; existing repo intent wins                      |
| Prepare          | A short form with a generated editable app name | Valid configuration and confirmed account/plan                  |
| Deploy           | Actual build status, logs and recovery          | API returns an app and a deployment belonging to it             |
| Live             | Public URL, Open app, Copy URL/curl, View logs  | A fresh successful deployment read reports live                 |
| Response checked | A response only when actually observable        | A real request result; opening a link alone is not verification |

A failed or unavailable read must not become an empty workspace or a success. Creating an app, receiving a deployment ID, skipping setup and opening a URL are distinct events.

Use a quiet layout with one primary action per stage, a short progress indicator, keyboard focus management, and the existing theme tokens. Keep the explanation of public visibility and compute allowance beside the deployment action. Use the current plan's values rather than hardcoded prices or promised deployment times.

## Delivery order

### 1. Establish a reliable authentication handoff

**Files:** `src/lib/auth.tsx`, `src/routes/index.tsx`, `src/routes/login.tsx`, and focused auth/route tests.

- [x] Turn the reproduced fresh-OAuth StrictMode cancellation into a regression test that expects successful recovery.
- [x] Ensure a cancelled boot verification can be replaced even when there is no user hint yet. Do not finish authentication while verification has no result.
- [x] Consume an OAuth handoff after verified success or an explicit terminal authentication refusal. Keep recoverable failures visible with Retry and preserve the safe destination.
- [x] Preserve CLI authorization, invitation and other validated `next` destinations. Do not send every authenticated journey through onboarding.
- [ ] Verify production's Vercel-to-API requests receive API responses instead of interactive Cloudflare challenges. This is a deployment prerequisite; a frontend change cannot solve an upstream challenge.

**Acceptance:** Fresh email signup, Google/GitHub signup, reload and expired-session recovery have deterministic destinations. A blocked or failed account read shows recovery rather than silently landing on the marketing page.

### 2. Define progress, dismissal and resume state

**Create:** `src/lib/onboarding-progress.ts`, `src/lib/onboarding-draft.ts`, and their focused tests.

**Integrate:** `src/routes/onboarding.tsx`, `src/routes/dashboard.tsx`, signup/login routing, and the existing GitHub handoff helpers.

- [x] Add `VITE_FEATURE_ONBOARDING_V2` to the existing flag registry, disabled by default, before integrating new entry or routing behavior.
- [x] Separate API-derived deployment progress from presentation preferences such as dismissal and the current draft. Use states covering choosing, preparing, creating, deploying, live, failed and unknown outcomes.
- [x] Use authenticated app/deployment reads as the source of truth. Reuse cached dashboard queries; do not add app-list requests to anonymous landing visits.
- [x] Keep the dashboard's authentication guard synchronous. Resolve onboarding progress after authenticated data is available, and allow customers to explore the console without a mandatory setup redirect loop.
- [x] Key saved drafts and dismissal by confirmed account ID and intended workspace. Clear mounted state immediately when the actor changes; verify ownership again before restoring or mutating resources.
- [x] Save a versioned, validated descriptor: source kind, app slug, deployment ID, Git repo/ref or sample identifier/version, and submission phase. Keep raw code, secrets and credentials out of URLs and storage.
- [x] Preserve the existing Git recovery format. Add a separate sample descriptor instead of filling its required Git fields with dummy values.
- [x] Do not infer activation from the legacy `gregale.onboarded` flag. A legacy value may influence dismissal only when its account ownership is established.

**Acceptance:** A reload or GitHub return resumes the same known app/attempt. Account changes cannot restore another customer's draft. Server resources allow progress to be rediscovered on another device; an unsubmitted draft remains device-local in the MVP.

### 3. Add the two-path onboarding presentation

**Create:** `src/components/onboarding/onboarding-flow.tsx` and a small onboarding start view.

**Modify:** `src/routes/onboarding.tsx`, `src/components/dashboard/new-app-wizard.tsx`, and onboarding search validation.

- [x] Replace the forced Git source with the explicit sample/repository choice. Respect existing repository/ref and recovery links.
- [x] Add an optional onboarding presentation to the existing wizard while retaining its creation and submission owner. Avoid a second implementation of app creation or a wholesale wizard refactor.
- [x] Collapse onboarding configuration and review into one short form with an inline deployment summary. Keep type/runtime/visibility overrides under Advanced and retain existing folded resource settings.
- [x] Generate an editable, valid name; explain collisions and quota failures inline. Wait for confirmed account limits before enabling deployment.
- [x] Default to a public app and scale-to-zero using the existing supported starter and plan helpers. No resource is created until Deploy is explicitly clicked.

**Acceptance:** The first screen has two meaningful deployment choices and a working explore action. A new customer can reach deployment without making infrastructure decisions. The ordinary New app flow retains its existing behavior.

### 4. Make the sample path work without GitHub

**Reuse:** `src/lib/function-starters.ts`, `src/lib/tar.ts`, `useDeployFunctionSourceFor`, and existing workspace creation hooks.

**Extend minimally:** Wizard progress callbacks and the source-aware onboarding draft.

- [x] Start with the existing Node.js function sample and its declared runtime. Show the sample code on demand; defer editable code and additional languages until after the MVP.
- [x] Reuse the existing packaging and multipart deployment contract, including the starter's required companion files.
- [x] Expose optional validated app/deployment receipts from the wizard so the onboarding wrapper can save progress for samples as well as Git. Keep existing callbacks compatible.
- [x] Save the app pointer as soon as its creation is confirmed. Restore samples by reading that app and deployment, not by creating them again.
- [x] Reuse existing retained-source retry controls for failed attempts. Do not present Git-only repair controls for a sample or silently substitute a newer starter version.
- [x] Treat a lost creation/submission response as unknown. Disable automatic mutation retries, reconcile against actual resources and endpoint contracts, and require an explicit action before another attempt. A disabled button alone is not an idempotency guarantee.

**Acceptance:** An empty Free account with no GitHub installation can deploy a real sample and open its assigned URL. Refresh, repeated clicks and recovery do not automatically create another app or deployment. Source-retention failures remain explicit.

### 5. Shorten the repository path and preserve recovery

**Reuse:** `RepoPicker`, `GitHubConnectForm`, `useSourceRefScan`, `DeploymentProgress`, `FirstDeploymentRecovery` and `RecoverySourceForm`.

- [x] Request a GitHub installation only after the repository path is chosen. Explain why GitHub sign-in and repository access are different permissions.
- [x] Retain repo/ref and the onboarding destination through the existing Settings installation return; do not replace its reviewed return URL contract.
- [x] Use the repository's reported default branch and existing scan results for supported defaults. Preserve an explicitly supplied commit SHA and distinguish it from the branch watched for auto-deploy.
- [x] Show the resulting configuration together with the deploy action. Keep manual corrections available when detection is unavailable.
- [x] Route multi-service repositories through the existing project-import handoff with the selected context intact.
- [x] Keep failed builds, logs, immutable retry and deploying a fixed ref in the same saved app. Preserve the existing unknown-outcome protections.

**Acceptance:** Connected and disconnected GitHub accounts complete the flow. Denied/partial installation access, monorepos, build failures and browser Back/Forward all have an actionable next step without losing the selected app.

### 6. Complete on live state and provide a useful dashboard return

**Create:** `src/components/onboarding/onboarding-success.tsx` and an onboarding checklist component.

**Modify:** Onboarding wrapper, wizard callback interface, `DeploymentProgress`/`FirstDeploymentRecovery` forwarding, dashboard placement and `FirstResponse` only where needed.

- [x] Remove onboarding-completion writes from app-created and deployment-accepted handlers in the new flow. Forward confirmed `onLive` notifications through initial and restored deployment views.
- [x] Make completion idempotent for an account/app/deployment tuple. A cached live result followed by a failed refetch must not announce new success.
- [x] Lead the success view with the API-assigned public URL, Open app, Copy URL/curl and View logs. Keep the URL inactive until the API confirms a live release.
- [x] Preserve Free-plan access through the public URL/curl. Keep the paid invoke tester optional and never label a link click as a verified successful response.
- [x] Let Explore dismiss the presentation without claiming activation. Show a resumable dashboard checklist only when useful, with one contextual next step.

**Acceptance:** Creating an app or receiving an accepted build never completes onboarding. A confirmed live app does. Free customers reach the success view without an upgrade; failures and unavailable status remain recoverable.

## Verification and release

Add focused tests for the meaningful transitions above, extending the existing auth, wizard, deployment-progress, first-response and onboarding-recovery suites. Preserve the standard New app regressions.

Browser acceptance must cover:

1. Fresh Free signup -> sample -> live URL, without GitHub.
2. GitHub installation -> same repo/ref -> live deployment.
3. Refresh during a build, a failed build, and a lost-response/unknown outcome.
4. Dismiss -> dashboard -> resume, plus account switching and another device with existing resources.
5. A supplied deployment intent through password and OAuth signup, and an explicit CLI/invitation destination.
6. 1440 px and 390 px, keyboard-only navigation, reduced motion and visible API failures.

Run `npm run build` before `npm run check` so tests against prerendered output execute. Run the existing mock tour and add the focused onboarding journey. Mock browser success is not a replacement for a real Free-account deployment and a real GitHub installation smoke test.

Add `VITE_FEATURE_ONBOARDING_V2` through `src/lib/feature-flags.ts`, following the existing literal-access convention. It is a build-time flag: enable it in preview, verify real flows, then enable it in a production build. The flag controls new entry into the experience. Existing app/deployment pointers must still open a shared recovery/status view or the conventional app page when it is disabled. Rollback must not delete resources, discard saved pointers or resubmit a mutation. Validate old recovery links and known sample pointers with either flag value.

Use the existing approved analytics integration for coarse funnel events: start, path selected, deployment requested, deployment live, deployment failed, endpoint opened and setup dismissed. Do not treat endpoint opened as response verified. Confirm custom-event availability before relying on it for rollout reporting; do not invent an analytics API or collect repository names, code or credentials.

Compare signup-to-live conversion, median time to live, GitHub-connection drop-off, build failure/recovery and Free-versus-paid completion. Establish the baseline before setting numerical targets.

## Suggested commit sequence

1. Authentication handoff regressions and cancellation recovery; verify the deployment prerequisite.
2. Default-off flag, account-scoped onboarding progress/draft model and nonblocking routing.
3. Two-path onboarding presentation with safe defaults.
4. Sample deployment and sample resume/retry support.
5. Repository quick setup and preserved installation/recovery handoffs.
6. Live-state completion, success view and dashboard checklist.
7. Browser acceptance, release configuration and approved funnel instrumentation.

The first customer release includes both paths, reliable resume and honest live-state completion. Richer sample choices, editable onboarding code, durable cross-device drafts and extra education can follow after observing the initial funnel.

## Implementation and release evidence

- Auth regression tests cover fresh OAuth under StrictMode, an upstream challenge,
  explicit retry, and retaining a validated CLI destination.
- Scoped progress/descriptor tests cover ownership, workspace changes, malformed
  storage, interrupted mutations, cached-live/refetch failures and mismatched
  app/deployment IDs. Source creation/upload/ref mutations explicitly disable
  automatic retries even if the query client defaults allow them.
- The existing New app tests remain in place. Focused quickstart tests cover
  Free sample packaging without GitHub, same-tick clicks, a lost response,
  invalid receipts, saved names and an actor-bound owner unmounting mid-create.
- Chromium acceptance passed at 1440 px and 390 px, including reduced motion and
  keyboard navigation: fresh OAuth handoff, explore/dashboard resume, Free sample
  to live, refresh during build, Settings/GitHub installation return, immutable
  SHA, Back/Forward, repository to live, a committed upload with a dropped
  response, explicit history reconciliation, visible inventory failure, failed
  builds and explicit retained-source retry in the same app.
- With the flag disabled, a saved receipt still reads real live status and opens
  its app page without resubmitting a request. Explicit legacy Git recovery links
  keep their existing format and take precedence over device-local resume state.
- Repository status was checked before implementation: #287 and #278 remained
  open; #283 was closed and unmerged. This change does not merge those works or
  move the root data provider.

The browser checks above use the mock API. Real Google/GitHub/email signup,
real Free-account deployment and a real GitHub installation still need preview
credentials and operator validation. The production same-origin API/auth route
was returning a Cloudflare interactive challenge during the investigation;
fixing that requires infrastructure access. Keep the production flag off until
these checks pass. Confirm custom-event availability in the Vercel account before
using the coarse SDK events for rollout reporting. No production configuration
was enabled by this implementation.

The broader existing console tour was also run. Two mock endpoints return 404:
`/v1/apps/{slug}/dlq` and `/v1/apps/{slug}/config/guard`. Both reproduce with the
onboarding flag disabled; no mock handler changed here. A shorter settle window
also produced transient loading reports; those disappeared when allowing the
existing views to settle. These gaps do not block the focused onboarding tour,
whose complete sample, Git, monorepo, failed-build and lost-response checks pass.

Backend contracts were rechecked against faas main `6d1c6ee8`: account/creation
in `pkg/apid/apidserver/handlers.go`, multipart deployment in `deploy_inputs.go`,
and retained-source retry/ownership in `handlers_retry.go`. No backend change or
new API is required. Parity remains GA 100%, beta 94%, preview 34%; ledger and
capability catalog are unchanged.

Validation completed so far: `npm run check` passed with 563 test files and
5,689 tests, typecheck/format clean and three existing lint warnings. The new
analytics URL-filter suite separately passed all nine cases. Both the default-off
production build (122 prerendered routes) and the flag-enabled client build passed;
the final parallel test/build results are recorded in PR #348.
