# Release Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the release details popup with a dedicated release page: a header, a process
line, bento tiles and a facts strip, where each tile opens a centred popup.

**Architecture:**
- **Canonical page:** a new un-nested TanStack file route at
  `/dashboard/apps/$appSlug/releases/$deploymentId` renders `ReleasePage` from a new
  `src/components/dashboard/release-page/` folder.
- **Popups:** tiles open popups through a URL search param, `panel`. The popup bodies reuse
  today's components unchanged.
- **Slug-free shortcut:** `/dashboard/releases/$deploymentId` resolves the app slug and
  redirects to the canonical page.
- **Old links redirect:** links carrying `?deployment=` redirect to the page; every entry
  point is updated to link there directly.

**Tech Stack:** React 19, TanStack Router (file routes) + Query, Vitest + React Testing
Library, `openapi-fetch` client, the existing `Modal`, `PageHeader`, `queryPhase` and
`.surface`/`.well`/`.bento-label` material.

**Spec:** `docs/superpowers/specs/2026-11-21-release-page-design.md`. Read it first; this plan
argues from it.

## Global Constraints

- Work in `/home/bahadir/GREGALE/.worktrees/faas-web-release-page` on `feat/release-page`. Run
  `npm ci` once first; worktrees don't share `node_modules`.
- Follow `CLAUDE.md`. In particular:
  - no literal hex and no `dark:` in components;
  - never hand-edit `src/routeTree.gen.ts` or `src/lib/api/schema.d.ts`;
  - don't reformat files you don't otherwise change;
  - every new route gets a `head`;
  - follow `docs/console-plain-english.md` for copy.
- Never show a number the API did not return. Every tile handles four states through
  `queryPhase()`: loading, empty, error, unreachable. Never pass a disabled query's
  `isPending` as loading.
- No new backend endpoints. Tiles read only the endpoints listed in the spec's tile table.
- Run the full suite with `npm run test -- --maxWorkers=8`; it OOMs on this machine otherwise.
- Gates for every task: `npm run check` passes, with lint warnings staying at **4**. Every
  commit message is prefixed `feat(release-page):`, `refactor(release-page):` or
  `test(release-page):`.
- `panel` values are exactly: `changes`, `output`, `rollout`, `runtime`, `security`,
  `provenance`, `release-command`, `canary`, `activity`, `details`.

## Review Focus

1. **The URL slug and the release's app disagree** (`/apps/a/releases/<id of b's
   release>`). The page must say "This release is not part of this app." and render no
   tile from b's data. Test in Task 2.
2. **An invalid or irrelevant `panel` in the URL** (`panel=nope`, or `panel=canary` on a
   non-canary release). No popup opens, and the param is dropped with `replace`. Tests in
   Tasks 1 and 3.
3. **A release still deploying while a popup is open.** The page keeps polling every
   2.5 s, the popup stays open and updates, and the header's main action changes once
   the release goes live. Test in Task 2.
4. **One endpoint failing** (scan 404 because nothing was scanned, provenance unreachable).
   Only that tile shows its state ("Not scanned", or a retry); the rest of the page
   renders. Test in Task 4.
5. **The release belongs to an app outside the active workspace** (shortcut route). The
   page shows plain words, not a spinner that never resolves or a raw 404. Test in Task 6.

---

### Task 1: Panel model and old-section mapping

**Files:**
- Create: `src/components/dashboard/release-page/panels.ts`
- Test: `src/components/dashboard/release-page/panels.test.ts`

**Interfaces:**
- Produces:
  - `RELEASE_PANELS: readonly ReleasePanel[]`, in the order of the Global Constraints list.
  - `type ReleasePanel` (union of those strings).
  - `interface ReleasePageSearch extends Record<string, unknown> { panel?: ReleasePanel }`.
  - `validateReleasePageSearch(raw: Record<string, unknown>): ReleasePageSearch` keeps
    foreign keys such as `project` and drops an invalid `panel`.
  - `panelForSection(section: unknown): ReleasePanel | undefined` implements the spec's
    mapping table: `output→output`, `provenance→provenance`, `scans→security`,
    `lifecycle→rollout`, `runtime→runtime`, `audit→activity`. Anything else returns
    `undefined`.

- [ ] **Step 1: Write the failing tests.**
  - `validateReleasePageSearch({ panel: 'security', project: 'p' })` equals
    `{ panel: 'security', project: 'p' }`.
  - `validateReleasePageSearch({ panel: 'nope' }).panel` is `undefined`.
  - `panelForSection('scans')` returns `'security'`.
  - `panelForSection('lifecycle')` returns `'rollout'`.
  - `panelForSection('audit')` returns `'activity'`.
  - `panelForSection('overview')` and `panelForSection(undefined)` return `undefined`.
- [ ] **Step 2:** Run `npx vitest run src/components/dashboard/release-page/panels.test.ts`.
  Expect FAIL (module not found).
- [ ] **Step 3:** Implement `panels.ts` with the exports above.
- [ ] **Step 4:** Run the same test. Expect PASS.
- [ ] **Step 5:** Commit: `feat(release-page): panel model and old section mapping`.

### Task 2: Canonical route, page shell, header and facts strip

**Files:**
- Create: `src/routes/dashboard.apps.$appSlug_.releases.$deploymentId.tsx` (route file).
- Create: `src/components/dashboard/release-page/release-page.tsx` (`ReleasePage`).
- Create: `src/components/dashboard/release-page/release-header.tsx`.
- Create: `src/components/dashboard/release-page/facts.tsx`, holding the facts strip and
  the `details` popup body. It moves `EvidenceFields` out of `release-detail.tsx`.
- Create: `src/components/dashboard/release-page/panel-host.tsx`.
- Test: `src/routes/-dashboard.apps.releases-page.test.tsx`. Copy the memory-router harness
  from `src/routes/-dashboard.releases.test.tsx:210-240` (`spyApi`, the mocked
  `useProjectScope`).

**Interfaces:**
- Consumes: Task 1's `ReleasePanel`, `validateReleasePageSearch`.
- Produces:
  - `Route` for `/dashboard/apps/$appSlug_/releases/$deploymentId`. It uses
    `validateSearch: validateReleasePageSearch` and
    `head: () => consoleHead('releases')`.
  - `ReleasePage({ appSlug, deploymentId }: { appSlug: string; deploymentId: string })`.
  - `ReleasePanelHost({ panel, onClose, panels }: { panel?: ReleasePanel; onClose: () => void; panels: Partial<Record<ReleasePanel, { title: string; width?: string; render: () => ReactNode }>> })`
    renders one centred `Modal` for the current panel. The description is the release
    name. Width defaults to `max-w-3xl`; `changes` and `output` pass `max-w-5xl`.
  - `releaseName(d: { revision?: number | null; id: string }): string` returns `v{revision}`,
    else `id.slice(0, 8)`.
  - `useReleasePanel(): { panel?: ReleasePanel; open(p: ReleasePanel): void; close(): void }`.
    `open` pushes a history entry; `close` replaces it.
  - Later tasks register tiles and popups through one array in `release-page.tsx`:
    `const TILES: ReleaseTileSpec[]` (type from Task 3). Each entry is
    `{ panel, span?: 1 | 2, when?(ctx): boolean, Tile(ctx), title, width?, Popup(ctx) }`,
    where `ctx: ReleaseContext = { slug: string; deployment: Deployment; build?: Build; summary?: DeploymentSummary }`.
    Export `ReleaseContext` from `release-page.tsx`. `Deployment` and `DeploymentSummary`
    come from `lib/api/queries.ts`. There is no exported `Build` type, so define
    `type Build = NonNullable<ReturnType<typeof useBuild>['data']>` beside `ReleaseContext`.

- [ ] **Step 1: Write the failing route tests.**
  - `renders the release name, status and traffic`: deployment `{ revision: 14, status: 'active', traffic_percent: 100 }`
    gives the heading "v14", text "Live", and "100% of traffic".
  - `polls while deploying and keeps an open popup open`: start with
    `status: 'building'` at `?panel=details`, then make the next read return `active`.
    After advancing fake timers 2.5 s, the dialog is still open and the header shows
    "Live" (Review Focus 3).
  - `refuses a release from another app`: the slug's app id differs from the deployment's
    `app_id`. Expect "This release is not part of this app." and no
    `role="region"` named "Release tiles" (Review Focus 1).
  - `shows the failure card first`: `status: 'failed'` with `error_why` set. The
    `FailurePanel` heading comes before the "Process" region in DOM order.
  - `facts strip copies full IDs`: there is a `CopyableId` for the deployment ID, the
    build ID and the image digest. "All details" opens `panel=details` with the evidence
    labels (Kind, Error code, Build status, Source size).
  - `drops an unknown panel`: `?panel=canary` on a non-canary release leaves no dialog,
    and the location search has no `panel` (Review Focus 2).
- [ ] **Step 2:** Run `npx vitest run src/routes/-dashboard.apps.releases-page.test.tsx`.
  Expect FAIL.
- [ ] **Step 3: Implement.**
  - **Route file:** un-nest it with the trailing `_` (spec § URL and routing). After the
    deployment resolves, call `useDocumentTitle(\`${releaseName} · ${appSlug}\`)`.
  - **`ReleasePage`:**
    - Read `useApp(appSlug)`, and `useDeployment(id)` with the same `refetchInterval` rule
      as `release-detail.tsx:78-80`.
    - Read `useBuild(deployment.build_id)` and `useDeploymentSummary(slug, id)`.
    - Gate everything on `queryPhase` for the app and the deployment reads.
    - Wrong-app check as `release-detail.tsx:84-86`.
    - Render, in order: header, `FailurePanel` (same condition and `failureSummary` call as
      `release-detail.tsx:118-122,182-195`), `ReleaseProcess` with a "Shipped … · took …"
      line, the tile grid (`<section aria-label="Release tiles">`), then the facts strip.
  - **`ReleaseHeader`:** `PageHeader`, with `meta` = `ReleaseStatusLabel` + traffic +
    `DeploymentPreviewUrl` + the "Updating" spinner. Leave an `actions` slot for Task 5.
  - **Unknown or ineligible panel:** `ReleasePage` drops a `panel` that has no registered
    entry, or whose `when` returns false, with `navigate({ replace: true })`.
- [ ] **Step 4:** Run the test file. Expect PASS.
- [ ] **Step 5:** Commit: `feat(release-page): canonical route, header, facts strip`.

### Task 3: Tile primitive and grid

**Files:**
- Create: `src/components/dashboard/release-page/tile.tsx`
- Test: `src/components/dashboard/release-page/tile.test.tsx`

**Interfaces:**
- Produces:
  - `ReleaseTile` takes these props:
    - `title: string`
    - `phase: QueryPhase`
    - `value?: ReactNode`
    - `line?: ReactNode`
    - `hint: string` (the quiet "what's inside")
    - `emptyMessage?: string`
    - `error?: unknown`
    - `onRetry?: () => void`
    - `onOpen: () => void`
    - `span?: 1 | 2`
  - `ReleaseTile` renders one `<button>` with `aria-label={\`Open ${title}\`}` and the
    `.surface` class, plus `.bento-label` for the title.
  - In the `error` and `unreachable` states it renders `InlinePhase` with a retry, *and*
    still opens the popup on click.
  - `ReleaseTileGrid({ children })`: `grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-4`;
    `span=2` maps to `md:col-span-2`.
  - `type ReleaseTileSpec`, as described in Task 2's Interfaces.

- [ ] **Step 1: Write the failing tests.**
  - `ready` shows the title, value, line and hint; clicking calls `onOpen` once.
  - `loading` shows no value.
  - `empty` shows `emptyMessage`.
  - `unreachable` shows the retry button, and clicking retry does not call `onOpen`.
  - The accessible name is "Open Security".
- [ ] **Step 2:** Run it. Expect FAIL.
- [ ] **Step 3:** Implement. Retry is a nested control, so render the tile as a `div` with
  `role="group"`, and make the title row the single `<button>`. Never nest a button inside
  a button.
- [ ] **Step 4:** Run it. Expect PASS.
- [ ] **Step 5:** Commit: `feat(release-page): tile primitive`.

### Task 4: The nine tiles and their popups

**Files:**
- Create: `src/components/dashboard/release-page/tiles.tsx`, holding every
  `ReleaseTileSpec` plus small read hooks. If it passes ~250 lines, split it into
  `tiles-change.tsx` (changes, output, activity) and `tiles-evidence.tsx` (security,
  provenance, runtime, release-command, canary).
- Modify: `src/components/dashboard/release-page/release-page.tsx` to register them.
- Test: `src/components/dashboard/release-page/tiles.test.tsx`

**Interfaces:**
- Consumes: Task 3's `ReleaseTile`, `ReleaseTileSpec`; Task 2's `ReleaseContext`.
- Produces: `RELEASE_TILES: ReleaseTileSpec[]`, in this order: changes(2), output(2),
  rollout, runtime, security, provenance, release-command, canary, activity(2).
  `rollout`'s `Popup` is a placeholder until Task 5.

Tile key values and popup bodies are exactly the spec's tile table. Sources:

| panel | tile reads | `when` | Popup |
|---|---|---|---|
| changes | `useReleaseDiff(id).data.summary`; empty → "No earlier release to compare" | always | `DeploymentReleaseSummary` (with `showRollback={false}`, added in Task 5) + `DeploymentDiff` |
| output | the last 2 of `useLogStream({kind:'build', deploymentId, limit: 500}).lines` + build `duration_seconds` | always | `LogStreamRecovery` + `LogView` (move the empty-state copy from `release-detail.tsx:350-358`) |
| rollout | `traffic_percent`; "Step n of m" when canary | always | Task 5 |
| runtime | `useDeploymentRuntime(id).data.status` in plain words | always | `DeploymentControls` (same `key` as `release-detail.tsx:401`) + `DeploymentRuntime` |
| security | `useDeploymentScan(id).data.severity_counts` critical + high; `useDeploymentSecretScan(id).data.findings.length`; a 404 → "Not scanned" | always | `ReleaseScans` |
| provenance | `useBuildProvenance(build_id)`: `commit_sha.slice(0,7)` + "SBOM ready" when `sbom_storage_key` | `Boolean(deployment.build_id)` | `ReleaseProvenance` |
| release-command | `deployment.release.status` + duration from `started_at`/`finished_at` (no duration while either is missing) | `Boolean(deployment.release)` | `ReleaseCommand` |
| canary | "Step {canary_step} of {canary_total_steps}" | `Boolean(deployment.canary_total_steps)` | `CanaryHealth` |
| activity | `useDeploymentAudit(id, 1).data.items[0]` (`kind`, `actor`, `at`), as "{label} by {actor} · {relative at}". The label comes from `AUDIT_LABEL` in `deployment-insights.tsx:34`; export it, don't copy it. | always | `ResourceActivityTimeline` + `DeploymentAudit` |

- [ ] **Step 1: Write the failing tests** (via `spyApi`):
  - `security says Not scanned on a 404 and the page still renders the other tiles`
    (Review Focus 4).
  - `security shows critical and high counts and the secret finding count`, using
    `severity_counts: { critical: 0, high: 1, … }` and two findings.
  - `provenance never says Signed`: assert `queryByText(/signed/i)` is null.
  - `release-command and canary tiles are absent when the release has neither`.
  - `changes falls back when the diff has no summary`.
  - `each tile opens its panel`: click "Open Security" and the URL has `panel=security`
    and a dialog titled "Security".
- [ ] **Step 2:** Run it. Expect FAIL.
- [ ] **Step 3:** Implement the specs and register them in `release-page.tsx`.
  `WhenCapable` gates stay inside the popups that already use them.
- [ ] **Step 4:** Run it. Expect PASS. Then run Task 2's route test again; it should still
  pass.
- [ ] **Step 5:** Commit: `feat(release-page): tiles and popups`.

### Task 5: Header main action and the grouped Traffic & rollout popup

**Files:**
- Create: `src/components/dashboard/release-page/main-action.ts` (pure choice) and
  `main-action.tsx` (renders it).
- Create: `src/components/dashboard/release-page/rollout-popup.tsx`.
- Modify: `src/components/dashboard/deployment-release-summary.tsx`. Add
  `showRollback?: boolean`, defaulting to `true`. When it is `false`, hide the
  "Roll back to …" button and its `RollbackStatus`.
- Modify: `release-page.tsx` and `tiles.tsx`, to wire the action and the popup.
- Test: `main-action.test.ts`, `rollout-popup.test.tsx`

**Interfaces:**
- Produces:
  - `type MainAction = { kind: 'retry' } | { kind: 'advance-canary' } | { kind: 'rollback-to-this' } | { kind: 'rollback-to'; targetId: string; targetLabel: string } | { kind: 'promote' }`.
  - `chooseMainAction(d: Deployment, summary?: DeploymentSummary): MainAction | null`.
    The first matching rule wins:
    1. `deploymentPhase(status)==='failed'` and the status is not `cancelled` → `retry`.
    2. `canAdvanceCanary(d)` (`deployment-actions.tsx`) → `advance-canary`.
    3. phase `superseded` → `rollback-to-this`.
    4. phase `live` and `traffic_percent === 0` → `promote`.
    5. phase `live` and `summary?.rollback_target_id` → `rollback-to`, labelled
       `v{rollback_target_revision}` or the target id's first 8 characters.
    6. Otherwise → `null`.
  - `ReleaseMainAction` renders each kind with the existing flow:
    - `retry`: opens `panel=rollout` and scrolls to `#recover`.
    - `advance-canary`: `AdvanceCanaryButton`.
    - `rollback-to-this`: `RollbackToRelease`.
    - `rollback-to`: `useRollbackFlow(slug).start(targetId, targetLabel)` plus
      `RollbackStatus`, lifted from `deployment-release-summary.tsx:32-90`.
    - `promote`: `PromoteDeployment`.
  - A **More** button opens `panel=rollout`.
  - `RolloutPopup({ slug, deployment })` renders up to six `<section>`s. Each has an `h3` and
    a one-line lead, and a section with nothing to show is left out. In order:
    1. `now`: `DeploymentRolloutState`, `RolloutObservation`.
    2. `move`: `AdvanceCanaryButton`, `PromoteDeployment`, `ReorderDeploymentControl`, and
       `ReleaseSchedule` inside `WhenCapable scheduled-releases`.
    3. `approval`: `ReleaseApprovalSection` inside `WhenCapable release-approvals`.
    4. `recover`, with `id="recover"`: `RolloutRecovery`, `RollbackToRelease`,
       `DeploymentLifecycle`.
    5. `stages`: `DeploymentStages`.
    6. `aliases`: `DeploymentAliasesHere`.

    Note that rule 4 comes before rule 5 on purpose, following the comment in
    `rollback-status.tsx`.

- [ ] **Step 1: Write the failing tests.**
  - `chooseMainAction`, table-driven, one row per rule plus:
    - `cancelled` → `null`;
    - live at 100% with no summary → `null`;
    - live at 100% with `rollback_target_revision: 13` → `rollback-to` labelled `'v13'`.
  - `RolloutPopup` renders the headings "Now", "Move traffic", "Approval", "Recover",
    "Stages" and "Aliases" in that order.
  - `RolloutPopup` omits "Approval" when `MOCK_HIDDEN_CAPABILITIES` hides
    `release-approvals`; reuse the capability mock used by the existing `WhenCapable`
    tests.
  - `DeploymentReleaseSummary` with `showRollback={false}` has no "Roll back to" button.
  - The page shows exactly one "Roll back to v13" button with the `changes` popup open.
- [ ] **Step 2:** Run them. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run them, plus the Task 2 and Task 4 tests. Expect PASS.
- [ ] **Step 5:** Commit: `feat(release-page): main action and grouped rollout popup`.

### Task 6: Slug-free shortcut route and approval link

**Files:**
- Create: `src/routes/dashboard.releases_.$deploymentId.tsx` (`ReleaseResolver`).
- Rename: `dashboard.releases_.$deploymentId.approval.tsx` →
  `dashboard.releases_.$deploymentId_.approval.tsx`, with `createFileRoute` path
  `'/dashboard/releases_/$deploymentId_/approval'`. The URL is unchanged.
- Create: `src/lib/ids.ts` with `normalizeId(id: string): string`, which removes hyphens
  and lower-cases. Replace the local `normalize` in `webhook-deliveries.tsx:226` with it.
- Modify: the approval page's "Open the release" link. It goes to the canonical route with
  `appSlug = status.data.app` and `search: { panel: 'rollout' }`. When the status has no app
  yet, fall back to the shortcut route.
- Test: `src/routes/-dashboard.releases-resolver.test.tsx`, `src/lib/ids.test.ts`

**Interfaces:**
- Consumes: Task 1's `validateReleasePageSearch`; `useApps`, `useWorkspaceTarget`,
  `useOrgApps` (`lib/api/workspace-apps.ts`).
- Produces: `resolveAppSlug(appId: string, personal: App[] | undefined, org: OrgAppSummary[] | undefined): string | undefined`,
  exported for tests. Personal wins, then org; both are compared with `normalizeId`.

- [ ] **Step 1: Write the failing tests.**
  - `normalizeId('0123-ABCD')` returns `'0123abcd'`.
  - `resolveAppSlug` finds a personal app, finds an org app whose `id` is a hyphenated
    UUID, and returns `undefined` otherwise.
  - Route tests:
    - A personal app redirects (`replace`) to `/dashboard/apps/<slug>/releases/<id>`, keeping
      `panel`.
    - An org app with an active org redirects the same way.
    - No match shows "This release belongs to an app outside this workspace." and a link
      to Releases, with no spinner (Review Focus 5).
    - A 404 deployment shows the normal `ErrorState`.
    - The approval page still renders at `/dashboard/releases/<id>/approval`.
- [ ] **Step 2:** Run them. Expect FAIL.
- [ ] **Step 3:** Implement. Render, then `navigate({ replace: true })` once the slug resolves;
  until then, show `LoadingState`. Only wait on `useOrgApps` when `target.org` is set, so the
  "never pass a disabled query's pending" rule holds.
- [ ] **Step 4:** Run them, plus `src/routes/-dashboard.releases.test.tsx`. Expect PASS.
- [ ] **Step 5:** Commit: `feat(release-page): slug-free release shortcut`.

### Task 7: Redirects, entry points, breadcrumb and nav

**Files:**
- Modify: `src/routes/dashboard.releases.tsx`. Add a `beforeLoad`: when `search.deployment`
  is set, redirect (`replace`) to `/dashboard/releases/$deploymentId` with
  `panel: panelForSection(search.releaseSection)`, keeping `project`. Leave `build` alone.
- Modify: `src/routes/dashboard.apps.$appSlug.tsx`. Same `beforeLoad`, redirecting to the
  canonical route. Remove the `ReleaseDetailPanel` render (`:668`) and the
  `deployment`/`releaseSection` search keys (`:212-233`). Make every
  `onOpenDeployment`/`onDeployed` navigate to the canonical route; Release safety passes
  `panel: 'rollout'`.
- Modify each entry point to link to the canonical route when it has the slug, else to the
  shortcut. Map its old `releaseSection` with `panelForSection`:
  - `pages/releases.tsx`: row click and footer.
  - `command-palette.tsx:267`
  - `resource-activity.tsx:298`
  - `deployment-progress.tsx:316,378`
  - `deployment-lifecycle.tsx:219,230`
  - `app-health.tsx:184`
  - `instance-detail.tsx:107`
  - `needs-attention.tsx:265`
- Modify: `Breadcrumbs` in `src/components/dashboard/shell.tsx`. When
  `section === 'apps' && segments[2] === 'releases'`:
  - the app crumb links to `/dashboard/apps/$slug`;
  - then a "Deployments" crumb links to the app with `search: { tab: 'Deployments' }`;
  - then the last crumb is "Release".

  The header carries the real release name, so the breadcrumb can stay route-only.
- Check `findNavHub` in `nav-config.ts`. `/dashboard/apps/x/releases/y` must light
  Projects. It already falls through the Apps hub rule; add a test, and change code only
  if the test fails.
- Test: extend `src/components/dashboard/shell` breadcrumb tests (find them with
  `grep -l "Breadcrumb" src/components/dashboard/*.test.tsx`) and `nav-config.test.ts`;
  add redirect tests to `-dashboard.releases.test.tsx`.

- [ ] **Step 1: Write the failing tests.**
  - `/dashboard/releases?deployment=dep-1&releaseSection=scans` lands on
    `/dashboard/apps/<slug>/releases/dep-1?panel=security`.
  - `/dashboard/apps/a?tab=Deployments&deployment=dep-1&releaseSection=lifecycle` lands on
    `…/releases/dep-1?panel=rollout`.
  - `?build=build-only` on `/dashboard/releases` still opens the build popup (Task 8 owns
    the popup; this asserts there is no redirect).
  - The breadcrumb on the release page reads `<app> › Deployments › Release`.
  - `findNavHub('/dashboard/apps/a/releases/b').label` is `'Projects'`.
  - `grep -rn "releaseSection" src --include=*.tsx | grep -v test` finds only the redirect
    mapping. Run this as a check after Step 3, not as a unit test.
- [ ] **Step 2:** Run them. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm run test -- --maxWorkers=8 src/routes src/components/dashboard`.
  Expect PASS, apart from tests that assert the old popup; Task 8 owns those.
- [ ] **Step 5:** Commit: `feat(release-page): route every release link to the page`.

### Task 8: Build-only popup, removing `ReleaseDetailPanel`, updating old tests

**Files:**
- Create: `src/components/dashboard/build-detail.tsx` (`BuildDetailPanel`). Lift the
  no-deployment branch of `release-detail.tsx`: build `EvidenceFields`, build output, and
  `ReleaseProvenance`, under the sections `overview`/`output`/`provenance` and `Modal` title
  "Build details". When the build has a `deployment_id`, the Builds view links to the
  release page instead of opening this popup.
- Modify: `pages/releases.tsx`. Render `BuildDetailPanel` for `?build=`.
- Delete: `src/components/dashboard/release-detail.tsx` and
  `src/components/dashboard/deployment-detail.tsx` (the re-export), once
  `grep -rn "release-detail'\|deployment-detail'" src` finds no component import. The
  `lib/api/deployment-detail` imports are a different module and stay.
- Keep `RELEASE_SECTIONS`/`ReleaseSection` in `releases-search.ts`; the redirects still use
  them.
- Modify these tests in `src/routes/-dashboard.releases.test.tsx`, which assert the popup:
  - lines 280, 407, 596, 705, 717, 736, 784, 796.
  - Each now asserts the redirect target URL, or the page content via the canonical route.
  - Tests about build-only selection (`671`, `705`) assert `BuildDetailPanel`.
  - Delete only assertions about popup sections that no longer exist. Keep every
    behaviour they protected: Back/Forward restore, foreign search kept, Debugger state
    kept.
- Test: `src/components/dashboard/build-detail.test.tsx`

- [ ] **Step 1: Write the failing test.** `BuildDetailPanel` for a build with no deployment
  shows "Build details", source size, and the SBOM download for a succeeded build.
  Then update the route tests listed above.
- [ ] **Step 2:** Run `npx vitest run src/routes/-dashboard.releases.test.tsx src/components/dashboard/build-detail.test.tsx`.
  Expect FAIL.
- [ ] **Step 3:** Implement, then delete the old files.
- [ ] **Step 4:** Run `npm run test -- --maxWorkers=8`, then `npm run check`. Expect
  everything to pass with 4 lint warnings.
- [ ] **Step 5:** Commit: `refactor(release-page): build-only popup, remove release detail dialog`.

### Task 9: Mock coverage, tour, full verification

**Files:**
- Modify: `mock/` handlers, only if `npm run dev:mock` returns `404 not_mocked` for one of
  `/v1/deployments/{id}/diff`, `/runtime`, `/scan`, `/secret-scan`, `/audit`,
  `/v1/builds/{id}/provenance`, `/v1/apps/{slug}/deployments/{id}/summary`.
  `mock-spec-drift.test.ts` must still pass.
- Modify: the `PAGES` list in `scripts/tour.mjs:37`. Add one seeded release page with
  `?panel=security`, taking a deployment ID from the mock seed.

- [ ] **Step 1:** Run `MOCK_API=1 npm run dev:mock`, open a seeded release page, and confirm
  the dev server logs no `not_mocked`. Add any missing handler.
- [ ] **Step 2:** Run `BASE_URL=http://localhost:3000 npm run tour`. Expect it to pass with
  no error boundary and no spinner left running. Repeat with `MOCK_BUILD_FAIL=1` on a
  freshly deployed release; the failure card and Retry should show.
- [ ] **Step 3:** Run `npm run build`. Expect success.
- [ ] **Step 4:** Commit: `test(release-page): mock coverage and tour`.
