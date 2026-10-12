# Canvas v2: Wizard-First Entry and Polish

**Status:** Approved in brainstorming on 2026-10-10. Builds on `2026-10-10-infrastructure-canvas-design.md` (v1, implemented on `feat/canvas`). Same gating: owner-local, `VITE_FEATURE_CANVAS` in `.env.development.local` only.

## Goal

Make the canvas the best place to build a backend on Gregale. The top priorities, in order, are user experience and UI quality.

- **Empty accounts:** a guided wizard takes you from nothing to a live app without leaving the canvas.
- **Accounts with apps:** you get a calmer, more legible, more navigable canvas, where every surface (nodes, edges, inspector, drafts, menus) meets one consistent design system.

Reference mockups (brainstorming companion, `.superpowers/brainstorm/47142-1791634102/content/`):

- `wizard-flow-v2.html` (frames 1–11)
- `canvas-polish.html` (frames A–E)

## Decisions

| Question                                    | Decision                                                                                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| When is the wizard the first thing you see? | **Empty accounts only.** Accounts with apps land on the graph. The same wizard opens from **+ New** in the toolbar, or with `N`.                 |
| How deep does "Deploy an app" go?           | **Inline Git and CLI, with a live build.** Both paths finish on the canvas. The app node shows build progress itself.                            |
| What does the front door look like?         | Frosted Gregale mark, "Build your backend", one sentence, one **Deploy an app** button. No locked rows.                                          |
| How does the wizard hand off to the graph?  | **The card becomes the node:** a shared-element morph from the card's box to the app node's box.                                                 |
| What happens after the app goes live?       | **One ghost at a time.** "+ Add a domain" appears first. Cron and storage ghosts appear on hover of the app. Suggestions retire after first use. |
| Where is the toolbar?                       | Bottom-centre, floating glass pill: + New · Jump to a node (`/`) · Fit · − · zoom % · +.                                                         |

## Design system for the canvas

Every canvas surface uses these values. Nothing is ad hoc.

- **Type scale:**
  - 14px / 600: node titles and inspector section values.
  - 12.5px / 400: body text, menu rows, inspector rows.
  - 11.5px / 400: secondary text and metrics rows (tabular numbers).
  - 10.5px mono, uppercase, 0.06em tracking: status and labels.
  - 18px / 600: wizard titles and KPI values. 20px: front-door title only.
- **Spacing:** a 4px grid. Card padding 24px. Node padding 14px horizontal. Stack gaps 4 / 8 / 12 / 16 / 24.
- **Radii:**
  - nodes 12px;
  - wizard card 16px;
  - tiles and inputs 8–12px;
  - menus 12px;
  - kbd chips 4px.
- **Elevation:** the existing `--elevation-1/2/3`. Nodes rest at 2. Hover, selected, menus and the wizard card sit at 3.
- **Colour:**
  - Charcoal surfaces; glass tokens from v1 (`--canvas-glass`, `--canvas-glass-border`).
  - **One mint accent per surface:** a primary button, a selection ring, live edges or a draft border. Never two competing.
  - Category tokens (`--cat-network/compute/storage`) only on glyph tiles and legend dots.
  - Status tokens only on status dots and their words.
- **Motion:**
  - `--motion-ease`, 150 / 240 / 380ms.
  - The card-to-node morph is 600ms.
  - Under reduced motion, every movement becomes a 150ms cross-fade, particles and breathing stop, and status stays in text.
- **Focus:** a 2px mint ring with a 2px background gap on every focusable element, including nodes. Programmatic focus always uses `{ preventScroll: true }`.
- **Node sizes are fixed per kind:**
  - app 248×76;
  - domain, cron, bucket and Postgres 216×56;
  - Internet 44×44.

  The layout never jumps when data arrives.

## Part 1: The wizard

### Where it lives

- **Component:** `src/components/canvas/wizard/` — a single `Wizard` card plus one component per step. It renders centred over the canvas (`ViewportPortal` is not used: the card is screen-anchored until the morph).
- **URL state:** the step lives in the route search, `?wizard=<step>`, with steps `start | source | git | cli`. Reload, back and forward, and the GitHub round-trip all return to the same step.
- **Visibility:**
  - It opens automatically when `useTopology()` reports `phase === 'empty'`.
  - It opens on demand from **+ New** or `N` on any account.
  - Esc on the first step closes it. That's only possible on non-empty accounts; on an empty account the first step has nowhere to go back to.

### Steps

1. **Start** (empty accounts) or **New** (accounts with apps).
   - **Empty:** the front door (mockup frame 1).
   - **New:** the same card listing every action (Deploy an app, Add a domain, Schedule a cron, Create a bucket). The last three ask for an app with an inline app picker, then open the v1 draft on that app's node.
2. **Source** (frame 2). Two tiles, GitHub repository and Command line, chosen with ←/→ and ↵.
   - The GitHub tile shows "Connected · <org>" or a **Connect GitHub** button (frame 8).
   - The connect flow reuses `GitHubConnectForm` with a new `returnTo` prop, set to `/dashboard/canvas?wizard=source`.
3. **Git** (frame 3).
   - **Repository:** `RepoPicker`, type-to-filter, showing language and last push where the list provides them.
   - **Branch:** defaults to the repository's default branch.
   - **App name:** derived from the repo name, validated by `appNameError`, with a live URL preview (`<name>.gregale.app`).
   - **Plan footer:** "Scale to zero · 256 MB".
   - **Primary button:** "Deploy <name>".
   - **Plan limits** (`appQuotaExceeded`, `memoryAllowed`) show as an inline warning before Deploy, and Deploy is disabled (frame 9).
4. **CLI** (frame 4). Names the app, creates it, then shows the verified commands with a "Copy all":
   ```
   curl -fsSL https://get.gregale.dev | sh
   gregale login
   gregale deploy --name <name>
   ```
   - It shows "Waiting for your first deploy…" and polls the app's deployments (`useAppDeployments(slug)`, 3s interval while waiting).
   - "Do it later" closes the card into the waiting node.

### Shared create-and-deploy logic

The existing `NewAppWizard` (`src/components/dashboard/new-app-wizard.tsx`, 936 lines) owns app creation, repo binding, deploy-from-ref and quota checks inline. That logic moves into `useCreateAndDeploy()` in `src/lib/api/create-and-deploy.ts`, which both wizards call:

```ts
useCreateAndDeploy(): {
  create(input: { name: string; source: 'git' | 'cli'; repo?: string; ref?: string }):
    Promise<{ app: Workflow; deploymentId?: string }>;
  pending: boolean;
  error: unknown;
}
```

The existing wizard's tests are the safety net for the extraction; its behaviour must not change.

### The morph: the card becomes the node

- **Placement:** for the empty-account flow, the wizard card is centred on the exact screen position where the new app node will appear (the layout's first app slot under the current viewport).
- **On Deploy, or on "Do it later":**
  - the card's box animates to the node's box over 600ms on `--motion-ease` while its content cross-fades;
  - then the real React Flow node takes over at that position;
  - the Internet node fades in to its left with a dashed edge.
- **Implementation:** `motion`'s layout animation, from the card's measured rect to the node's screen rect (obtained from React Flow's `flowToScreenPosition`). The node is created by the normal topology refetch. The morph only bridges the gap.

### The app node during its first deploy

- **New app states:**
  - `waiting` (no deployment yet; CLI);
  - `queued`, `building`, `deploying` and `live` (from the deployment status);
  - `failed`.
- **Progress rail:** the node shows a four-segment rail (Queued · Build · Deploy · Live) plus the latest build log line, from `useLogStream({ kind: 'build', deploymentId })`. This is the one exception to fixed node heights: an app in a first-deploy state (`waiting` through `failed`) is 96px tall, and `layout()` reserves 96 for it, so the switch to 76 on `live` eases rather than jumps.
- **Live:** the status becomes "Serving", the default URL shows on the node as a link, the Internet edge turns solid, and particles start.
- **Failed** (frame 10):
  - the node gets a destructive border tint;
  - "Build failed · step N of 4";
  - the failing line from `failureSummary(...)`;
  - **View logs** opens the inspector's Logs tab on the build stream;
  - **Retry** resubmits the same repo and ref.
- **Announcements:** the node's status is a polite `aria-live` region.

### Next-step ghosts

- They appear only on the app created by the wizard, only after it is live, and only until the user creates any resource from a ghost or dismisses them. Dismissal is remembered per app in `localStorage`, which is a per-viewer convenience.
- **Initial ghost:** "+ Add a domain", placed in the domain lane.
- **On hover or selection of the app:** "+ Schedule a cron" (above) and "+ Storage" (right) appear at 85% opacity.
- **Clicking a ghost** opens the v1 draft for that kind, in place.

## Part 2: Canvas polish

### A · Focus mode, toolbar, minimap, inspector

- **Focus mode:** selecting a node lights its incident edges mint (`stroke` 1.5px, 55% mint) and dims every node and edge not in its one-hop neighbourhood to 32% opacity, over 240ms. Clearing the selection restores everything.
- **Column headers:** "Ingress · Domains · Apps · Resources" as 10px mono labels in flow coordinates above each lane, at 55% muted.
- **Toolbar** (bottom-centre glass pill):
  - **+ New:** opens the wizard. Also `N`.
  - **Jump to a node:** a fuzzy finder over node titles, using the existing `src/lib/fuzzy.ts`, opened with `/`. Choosing a result flies the camera to the node (`setCenter`, 380ms) and selects it.
  - **Fit, −, zoom %, +:** zoom % is live, and clicking it resets to 100%.
- **Minimap:** bottom-left, 168×104, glass. It is rendered only when the graph's bounds exceed the viewport. It uses React Flow's `MiniMap`, styled with tokens, with the viewport frame in mint.
- **Edge hover:** an edge shows a small label with its real `requests24h` ("441.6k req / 24h"). Edges without a known count show no label.
- **Inspector:**
  - **Header:** glyph, name, status with runtime, **Open app**, close; then the default URL with Copy.
  - **Tabs:** Overview · Logs · Connections (with a count).
  - **Overview:**
    - a 2×2 KPI grid (Requests, Error rate, p95, Cold starts) in 18px values, so nothing ever wraps;
    - "Requests per hour" as an area chart with peak and axis labels;
    - a "Connected" list.
  - **Logs:** the live SSE log, unwrapped, with level colours and no-wrap lines that ellipsize.
  - **Connections:** every incident edge. Clicking one flies to that node.
  - **Unknown values:** say why ("Metrics on Hobby", "Series unavailable"). They never show a number.

### B · Node anatomy

| State              | Visual                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| Default            | Glyph tile 32px, title, status dot and word, metrics row (app only).                                 |
| Hover              | Border 16% white, elevation 3, `translateY(-1px)`. Connectors fade in.                               |
| Selected           | 1.5px mint ring. Connectors stay visible, which serves touch.                                        |
| Keyboard focus     | 2px mint ring with a 2px gap. Nodes are tabbable in layout order. ↵ selects.                         |
| Parked             | Breathing mint ring (v1). Metrics row reads "Woke 18m ago" when known.                               |
| Deploying          | Status "Deploying · v<N>" plus the four-segment rail.                                                |
| Error              | Destructive border tint. The status names the error ("Error · 3.2% 5xx" from metrics, or the phase). |
| Metrics unknown    | The metrics row reads "Metrics on Hobby" on a 402, or "Metrics unavailable" otherwise.               |
| Domain pending     | Amber border tint, "Pending DNS".                                                                    |
| Long title         | Ellipsis, with the full name in `title`.                                                             |
| Connections failed | The metrics row reads "Connections unavailable · Retry". Retry refetches that app's reads.           |

### C · Drafts get room

- **Opening a draft** makes `layout()` receive the open draft (kind, app, side) and reserve its height in that app's band. Bands below ease down over 240ms, so nothing is covered.
- **Camera:** if the draft would be off-screen, the camera pans to include it (`fitBounds` on the draft and the app, 380ms).
- **Cancelling** restores the layout.

### D · Gaps and the connect menu

- **Load gaps** (`summarizeIssues`) render as one glass bar, top-centre, with a warning dot, the joined sentences, and **Retry**. This replaces v1's corner box.
- **Connect menu:**
  - ↑/↓ moves between options and ↵ picks;
  - focus is set once, on open, and is not re-taken on re-render;
  - a failed bucket read shows "Storage unavailable · Retry" instead of "Checking storage…".

### E · Remaining fixes

1. **Refit once:** run fit once when the first complete topology arrives (buckets and Postgres settled), not only on mount.
2. **Failed create keeps focus:** after a failed create, the draft's field is focused again, and the input stays `readOnly` rather than `disabled` while pending.
3. **Unreachable banner:** inside the canvas, `UnreachableBanner` renders as an overlay bar and does not change the canvas height.
4. **Unique edge ids:** Postgres edges are keyed by binding id.
5. **Breadcrumb** reads "Canvas", not "canvas".
6. **Double-submit test:** rewritten against a real `QueryClient` with a never-resolving POST, asserting exactly one call.

## Data and API

- **No new endpoints.** Everything reads from operations already in `api/openapi.yaml`:
  - `POST /v1/apps` (via `addWorkflow`);
  - the repo binding and deploy-from-ref hooks;
  - `GET /v1/apps/{slug}/deployments`;
  - `GET /v1/deployments/{id}`;
  - the build log SSE stream;
  - the install repos list.
- **GitHub return:** `GitHubConnectForm` gains a `returnTo` prop. Before relying on it, the implementation verifies that `apid` accepts a `/dashboard/canvas?...` return path. If it does not, the wizard writes its step to `sessionStorage` before leaving and restores it on return to `/dashboard/settings`, by redirecting back to the canvas.

## Error handling

- Every create and deploy error maps through `createErrorMessage` (v1) or `errorMessage`, shown inline in the wizard step that caused it. **The card never closes on error.**
- **App created but the build submission failed:** the morph still happens, because the app exists. The node shows `failed` with "Build was not submitted", plus Retry.
- **Quota or memory over limit:** stated before Deploy, with real numbers from the account limits.

## Testing

- **Pure units:**
  - layout with a reserved draft band (no overlap, deterministic);
  - focus-mode neighbourhood (one-hop set);
  - edge label formatting;
  - the issue bar copy;
  - the node state mapping from deployment status to rail state.
- **Components:**
  - wizard step transitions, including Esc/back, URL sync and the empty-account auto-open;
  - Git step validation and quota warning;
  - CLI step polling to `waiting → building`;
  - failed node with Retry;
  - jump-to-node fuzzy finder;
  - inspector tabs;
  - connect menu arrow keys and focus stability;
  - draft refocus after error.
- **`useCreateAndDeploy`:** tests run against a real `QueryClient` with a mocked `api`. The existing `NewAppWizard` tests must still pass unchanged.
- **Browser** (headless Chromium against `dev:mock`, scripts in the plan):
  - the full empty-account flow (`MOCK_EMPTY` crashes upstream, so the mock gains `MOCK_CANVAS_EMPTY=1`, which clears only apps, domains, crons and buckets);
  - the morph timing;
  - focus mode;
  - draft room-making with no overlap (bounding-box check);
  - no horizontal scroll jump on any focus.
- **Gates:** `npm run check`, `npm run build`, and the flag fold-out both ways (v1 sentinel).

## Out of scope

- Templates in the canvas wizard. Templates still deploy through the CLI, so they add nothing over the CLI path.
- Service-binding edges, binding inventory and health phase (still blocked on the spec-refresh PR).
- Persisted layouts.
- Mobile canvas.
