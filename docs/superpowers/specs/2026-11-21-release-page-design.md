# Release page — design

Date: 2026-11-21 · Branch: `feat/release-page` · Status: approved in chat, layout C

## Why

Release details is a popup (`ReleaseDetailPanel`, `src/components/dashboard/release-detail.tsx`,
443 lines) with seven tabs: Overview, Build output, Provenance / SBOM, Security scans,
Lifecycle, Runtime controls, Audit context. It holds too much for a popup. The console
direction since 2026-11-15 is "pages, not popups": a release is something people link to,
come back to and act on, so it gets its own page. Inside that page, the heavy detail opens
in popups, so the page itself stays short and answers first
(`docs/console-plain-english.md`).

## Goals

- A dedicated release page with its own URL, reachable from every place that opens release
  details today.
- Layout C, picked from three mockups: a header, a process line, then a grid of bento tiles.
  Each tile shows one honest key fact. Clicking a tile opens a centred popup holding the full
  detail.
- Everything in today's seven tabs survives, moved into a tile's popup. Nothing is dropped.
- The open popup is in the URL, so a link can open straight to, for example, Security.
- Old links (`?deployment=…&releaseSection=…` on `/dashboard/releases` and on the app page)
  keep working by redirecting to the new page with the matching popup open.

## Non-goals

- No new backend calls or endpoints. Every tile reads an endpoint the popup already reads.
- No redesign of the inner components (`DeploymentDiff`, `ReleaseScans`,
  `DeploymentLifecycle`, …). They move into popups as they are. Only the grouping around them
  is new.
- Build-only details (a build with no deployment, opened from the Releases page's Builds view
  via `?build=`) are not a release, so they stay a popup. See "Build-only details" below.

## Anti-goals

- A tile must never show a number the API did not return. If an endpoint has no answer,
  the tile says so ("Not scanned", "No earlier release to compare"). No fabricated "Signed"
  badges: provenance has no signature field.
- The page must not become today's popup flattened onto a page. It answers first; detail is
  one click away.
- The Lifecycle crowding must not just move into the Traffic & rollout popup unchanged.

## URL and routing

**Canonical page:** `/dashboard/apps/$appSlug/releases/$deploymentId`, as the file route
`src/routes/dashboard.apps.$appSlug_.releases.$deploymentId.tsx`. The trailing `_`
un-nests it from the app page, which has no `<Outlet>`. Living under the app means the
breadcrumb, the project scope (`?project=`) and app access for org members all come from the
app, as they do for the app page.

Search params:

- `panel?: 'changes' | 'output' | 'rollout' | 'runtime' | 'security' | 'provenance' | 'release-command' | 'canary' | 'activity' | 'details'`
  is the open popup. Closing the popup clears it with `replace`. Opening it pushes, so
  browser Back closes the popup before leaving the page.
- `project` is carried as everywhere else in the console.

**Slug-free resolver:** `/dashboard/releases/$deploymentId`
(`src/routes/dashboard.releases_.$deploymentId.tsx`). Some entry points only have a
deployment ID: the command palette, instance detail, and old bookmarks. This route reads
`/v1/deployments/{id}`, then finds the app's slug by `app_id`, and redirects (`replace`)
to the canonical page, carrying `panel`. While it loads it shows the loading state.

Finding the slug *(builder check, my call)*: `DeploymentResponse` has `app_id` but no
slug. `/v1/apps` lists only the signed-in account's own apps, and ignores the active
organization. So look in two places:

1. `useApps()`.
2. Then, when the active workspace is an organization, its inventory
   (`GET /v1/orgs/{slug}/apps`, `lib/api/workspace-apps.ts`). That endpoint returns
   hyphenated UUIDs while `app_id` is 32 hex characters, so compare with the same
   normaliser as `webhook-deliveries.tsx:226`; lift it into a shared helper.

The console already reads both lists; no new endpoint is used. Org members can read the
deployment itself: faas `pkg/apid/appaccess/routes.go:69` maps `GET /v1/deployments/{id}`
to `OrgActionReadApp`.

If the deployment is missing, the normal error state shows. If the app is in neither list,
the page says, in plain words, that the release belongs to an app outside this workspace,
and links back to Releases.

The approval page does not need the resolver. It already has the app slug from
`useReleaseApproval` (`status.data.app`), so its "Open the release" links straight to the
canonical page with `panel=rollout`. That matters because approvers are often org members
who did not create the app. Slack and email approval links keep landing on the approval
page, unchanged.

Adding this route makes the existing approval route
(`dashboard.releases_.$deploymentId.approval.tsx`) its child. Rename that file to
`dashboard.releases_.$deploymentId_.approval.tsx` so its URL and behaviour are unchanged.

**Old links redirect.** In `beforeLoad` of `/dashboard/releases` and `/dashboard/apps/$appSlug`:
when `deployment` is in the search, redirect (`replace`) to the new page and map
`releaseSection` to `panel`:

| old `releaseSection` | new `panel`  |
| -------------------- | ------------ |
| `overview` / missing | (none)       |
| `output`             | `output`     |
| `provenance`         | `provenance` |
| `scans`              | `security`   |
| `lifecycle`          | `rollout`    |
| `runtime`            | `runtime`    |
| `audit`              | `activity`   |

`/dashboard/releases` redirects to the slug-free resolver, since it may not know the slug.
The app page redirects straight to the canonical page. `build` on `/dashboard/releases` is
not redirected (build-only details stay a popup).

**Update every entry point** to link to the page directly instead of relying on the redirect.
Found with `grep releaseSection` and `to="/dashboard/releases"`:

- `src/components/dashboard/pages/releases.tsx`: row click and the popup footer link.
- `src/routes/dashboard.apps.$appSlug.tsx`: Deployments tab history, aliases panel, tarball
  deploy, Release safety's `onOpenDeployment`.
- `command-palette.tsx`, `resource-activity.tsx`, `deployment-progress.tsx` (2),
  `deployment-lifecycle.tsx` (2), `app-health.tsx`, `instance-detail.tsx`,
  `needs-attention.tsx`.
- `dashboard.releases_.$deploymentId_.approval.tsx`: "Open the release" goes straight to the
  canonical page (slug from the approval status) with `panel=rollout`.

Keep the redirects anyway, for bookmarks and links already pasted elsewhere.

## Page layout

Top to bottom:

1. **Header** (`PageHeader`): the release name (`v{revision}`, else the deployment ID's
   first 8 characters), a status label (`ReleaseStatusLabel`), the traffic share ("Live ·
   100% of traffic"), and the preview URL (`DeploymentPreviewUrl`). An "Updating" spinner
   shows while the deployment is not terminal; it polls every 2.5 s as today.
   - **One main action**, chosen by state, first match wins *(builder check, my call:
     the approved mockup showed "Roll back to v13" on a live release; this reuses the two
     rollback flows that already exist, with no new rules)*:
     - failed (not cancelled): **Retry**, which opens the `rollout` popup at its recovery
       group.
     - a canary in progress: **Advance canary** (`AdvanceCanaryButton`). Aborting stays in
       the popup's Recover group (`RolloutRecovery`).
     - superseded: **Roll back to this release** (`RollbackToRelease`, which renders only for
       superseded releases).
     - live and the deployment summary offers a `rollback_target_id`: **Roll back to vN**,
       the flow `DeploymentReleaseSummary` already has (`useDeploymentSummary`,
       `deployment-release-summary.tsx:30-82`). Lift that button into the header and remove
       it from the `changes` popup, so the destructive action appears once.
     - live at 0% traffic: **Promote** (`PromoteDeployment`), following the existing
       comment in `rollback-status.tsx` that a release with no traffic is promoted, not
       rolled back to.
     - otherwise: no main action.
   - Everything else goes in a **More** menu that opens the `rollout` popup.
2. **Failure card** when the deployment or build failed: `FailurePanel`, full width, above
   everything else. "View output" opens `panel=output`.
3. **Process line**: `ReleaseProcess` with "Shipped 12 min ago · took 1m 48s" from the
   deployment and build timings, as the Overview tab shows today.
4. **Tile grid**: four columns on wide screens, two on tablet, one on phone. Some tiles span
   two columns (marked below). Each tile is a single button (whole tile clickable, focusable,
   with an `aria-label` naming the popup it opens). It shows a title, one key value, one
   plain-English line, and a quiet "what's inside" hint. Each tile handles its own
   loading, empty, error and unreachable states with `queryPhase()`; one failing endpoint
   never blanks the page.
5. **Facts strip**: deployment ID, build ID and image digest as `CopyableId`, plus created
   time. It has no popup. The full evidence list (kind, error code, canary, traffic, build
   status, source size, enqueued/started/finished) lives in the `details` popup, which a
   "All details" link at the end of the strip opens.

Use the console's existing bento tile material from the Overview pass (`feat/overview-bento`,
merged in #353) so this page matches; do not invent a new card style.

## Tiles and their popups

Dashed (conditional) tiles render only when the release has that thing.

| Tile (span) | Key value on the tile | Source | Popup (`panel`) holds |
| --- | --- | --- | --- |
| What changed (2) | `ReleaseDiff.summary` ("new code, 2 config keys, 5 packages") | `/v1/deployments/{id}/diff` | `changes`: `DeploymentReleaseSummary` (without its rollback button, now in the header) + `DeploymentDiff` |
| Build output (2) | last two log lines + build duration | build log SSE (`useLogStream`) + build | `output`: `LogStreamRecovery` + full `LogView` |
| Traffic & rollout | traffic % ; canary step if any | deployment | `rollout`: grouped Lifecycle (below) + `DeploymentAliasesHere` |
| Runtime | runtime `status` / `current` in plain words | `/v1/deployments/{id}/runtime` | `runtime`: `DeploymentControls` + `DeploymentRuntime` |
| Security | critical + high from `severity_counts`; secret findings count | `/scan`, `/secret-scan` | `security`: `ReleaseScans` |
| Provenance | short commit SHA; "SBOM ready" when `sbom_storage_key` is set | `/v1/builds/{id}/provenance` | `provenance`: `ReleaseProvenance` |
| Release command (dashed) | its status + duration | `deployment.release` | `release-command`: `ReleaseCommand` |
| Canary health (dashed) | "Step n of m" + its verdict | deployment canary fields | `canary`: `CanaryHealth` |
| Activity (2) | latest audit row ("Deployed by you via the CLI · 12 min ago") | `/v1/deployments/{id}/audit` | `activity`: `ResourceActivityTimeline` + `DeploymentAudit` |
| (facts strip link) | — | deployment + build | `details`: the two `EvidenceFields` lists from today's Overview |

Gates kept as today: `release-approvals` and `scheduled-releases` sections stay inside
`WhenCapable`. Capability-hidden content stays hidden; a tile whose whole popup is hidden is
not rendered.

**The Traffic & rollout popup is grouped**, so the Lifecycle crowding doesn't move in as one
long column. Each group has a heading and a one-line plain-English lead, and a group with
nothing to show is left out:

1. **Now**: `DeploymentRolloutState`, `RolloutObservation`.
2. **Move traffic**: `AdvanceCanaryButton`, `PromoteDeployment`, `ReorderDeploymentControl`,
   `ReleaseSchedule` (gated).
3. **Approval**: `ReleaseApprovalSection` (gated).
4. **Recover**: `RolloutRecovery`, `RollbackToRelease`, `DeploymentLifecycle` (retry options).
5. **Stages**: `DeploymentStages`.
6. **Aliases**: `DeploymentAliasesHere`.

Retry from the header opens this popup scrolled to Recover.

**Popups** use the existing `Modal` (centred, `placement="center"`), width `max-w-3xl`; `output` and
`changes` use `max-w-5xl`. Title is the tile name, description is the release name. Escape,
backdrop and the close button clear `panel`.

## Breadcrumb, title, nav

- `Breadcrumbs` in `src/components/dashboard/shell.tsx` already handles `apps/<slug>`. Extend it:
  when `segments[2] === 'releases'`, the app crumb becomes a link to the app, then add
  "Deployments" (link to the app page's Deployments tab), then the release name.
- `head`: `consoleHead('releases')` is the minimum; prefer a title naming the release and app
  if `consoleHead` supports a detail label. Check `src/lib/seo.ts`.
- `nav-config.ts`: `findNavHub` must light the same row the app page lights (Projects). No new
  rail row, since a release page is not a destination of its own.

## What happens to `ReleaseDetailPanel`

Split `release-detail.tsx` into:

- `src/components/dashboard/release-page/` (new): the page body, header action logic,
  tile grid, each tile, and the popup bodies. Keep each file under ~200 lines.
- **Build-only details:** keep a slim `BuildDetailPanel` popup for the Releases page's Builds view
  (`?build=` with no deployment): build facts, build output and provenance, which is what
  the panel shows today when no deployment is attached. When the build *has* a deployment,
  the Builds view links to the release page instead.
- Delete `ReleaseDetailPanel` and the `DeploymentDetailPanel` re-export once nothing imports
  them. `RELEASE_SECTIONS` and `ReleaseSection` stay only for the redirect mapping.

## Testing

- Unit tests (Vitest + RTL) beside the code:
  - tile rendering per state (loading, empty, error, unreachable; conditional tiles absent
    when not relevant);
  - the main-action choice per deployment state;
  - `panel` open/close round trip;
  - the `releaseSection → panel` mapping;
  - the resolver's redirect and its error states.
- Update the existing route tests that assert the popup: `-dashboard.releases.test.tsx`,
  `-dashboard.releases-scope.test.tsx`, `-dashboard.apps-polish.test.tsx`, and
  `-dashboard.apps-scope.test.tsx` as they touch it.
- `npm run dev:mock`, then `npm run tour`, with the release page reachable from the tour. Make
  sure every endpoint a tile reads is mocked (`mock-spec-drift` test).
- `npm run check`, `npm run test`, `npm run build`. Lint warnings stay at 4.

## Calls made without asking (check these)

- **Build-only details stay a popup.** They aren't a release; `BuildDetailPanel` keeps them
  small.
- **The page lives under the app** (`/dashboard/apps/<slug>/releases/<id>`). A slug-free
  `/dashboard/releases/<id>` redirects to it.
- **The open popup is in the URL** as `?panel=`. Opening one adds a history entry, so Back
  closes it.
- **The Traffic & rollout popup is split into six headed groups**, so today's Lifecycle tab
  doesn't arrive as one long column.
- **The header's main action follows existing flows**: Retry, Advance canary, Roll back to
  this release, Roll back to vN, or Promote. The rollback button moves out of the What
  changed popup, so it appears once.
- **The resolver finds an org app through the workspace inventory.** The approval page
  links directly with the slug it already has.
- **No "Signed" badge on Provenance**: the API has no signature field.

## Left to the builder

- Exact tile copy within the plain-English rules; spacing; tile hover and motion within the
  existing console motion tokens and reduced-motion rules.
- How the Build output tile trims its last two lines.
- Whether the resolver redirects in `beforeLoad` (async) or renders and navigates once the
  data arrives. Pick whichever keeps the four query states honest.
