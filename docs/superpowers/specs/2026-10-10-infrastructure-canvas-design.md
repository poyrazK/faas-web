# Infrastructure Canvas Design

**Status:** Approved in brainstorming on 2026-10-10. Internal and local-only until the owner decides otherwise.

## Goal

Give the console a spatial view of an account: one canvas that shows how traffic enters (Internet → domains), which apps serve it, and what those apps are connected to (buckets, Postgres, other apps, crons). Each node opens a detail panel with real metrics and live logs, and "+" connectors create new connected resources inline.

The prompt was a Cloudflare design-engineering demo ("what if the Cloudflare dashboard was a canvas", nandafyi, 2026-10-09). We take the interaction model, not the look: the canvas must read as Gregale.

Success means the owner can use the canvas locally against the real API, judge whether it earns a place in the product, and nothing about it reaches a preview or production bundle until the flag is deliberately enabled there.

## Audience and gating

- **Audience:** the owner only, on `npm run dev` / `npm run dev:mock`.
- **Flag:** `featureFlags.canvas = enabled(import.meta.env.VITE_FEATURE_CANVAS)` in `src/lib/feature-flags.ts`. It is set only in the owner's `.env.local`. It is not set on Vercel Preview or Production.
- **Boundaries:** the flag is checked in exactly two places, following the README's "gate at one boundary" guidance:
  1. the nav entry in `src/components/dashboard/nav-config.ts`, and
  2. the route's `beforeLoad`, which redirects to `/dashboard` when the flag is off.
- **Bundle:** the route component is lazy, and the flag access stays literal, so Rollup folds it to `false` and eliminates the canvas code and `@xyflow/react` from every build without the flag.
- **Branching:** the work merges to `main` with the flag off, per README § feature flags. Production is unaffected.

## Prerequisite: refresh the vendored API spec

The console's `api/openapi.yaml` exposes 370 operations. faas `main` exposes 1,017. The canvas needs three things that are missing from the vendored copy:

- `getAppBindingInventory` (`GET /v1/apps/{slug}/bindings`): the unified edge list.
- `AppResponse.service_bindings`: app → app edges.
- `getAppHealth`: the app phase shown in the panel header.

Step one of the implementation is `npm run api:pull` in its own commit. That commit fixes whatever stops compiling and passes `npm run check`, `npm run build` and `npm run test` before any canvas code is written. If the drift is too large to absorb in one commit, the canvas ships v1 without service-binding edges and binding-inventory states, and those return after a separate spec-refresh PR. Domains, crons, buckets, Postgres and `getAppsMetrics` are already vendored.

## Visual language: Wind

Chosen from three mocked directions (Schematic, Console cards, Wind).

- **Surface:** the console charcoal (`--background`) with a dither dot field lit from the northeast, using the same lighting as `.console-atmosphere` and `.brand-wash`.
- **Nodes:** glass cards (translucent `--card`, backdrop blur, `shadow-elevation-2`, `--console-surface-radius`). Each has a category-tinted glyph tile using the existing wayfinding tokens:
  - `--cat-network` for domains;
  - `--cat-compute` for apps and crons;
  - `--cat-storage` for buckets and Postgres.

  The title is in Satoshi. Kind and state use the mono uppercase label voice (`.label-mono`). App nodes carry a mint top hairline and two real scalars: requests over 24h and p95.

- **State:**
  - Status is always shown as colour plus icon plus text, as `StateBadge` does.
  - Parked apps (scale-to-zero snapshot) get a breathing ring, extending the existing `breathe` motif ("state is breath").
  - A pending domain has an amber spinner and an amber dotted edge.
- **Edges:** thin neutral curves. Requests travel as mint particles. **Particle density comes from real `request_count`.** Zero or unknown traffic means no particles, never decorative motion.
- **Motion:** only `--motion-ease` and `--motion-fast/base/slow`. Popovers and draft nodes enter from the northeast, as `animate-item-enter` does. Under `prefers-reduced-motion`, particles become a static mint stroke whose width encodes rate, and breathing stops.
- **Tokens:** new values (glass fill, glass border, particle alpha, dither-field alpha) are added as tokens in `src/index.css` under both `:root` and `.console`. Components use no literal hex and no `dark:`, so `conventions.test.ts` keeps passing.
- **Icons:** `iconoir-react` at the shell's stroke width.

Reference mockups were made with the brainstorming visual companion (`node-language.html`, `creation-and-panel.html`).

## Layout and route

- **Route:** `src/routes/dashboard.canvas.tsx` with `head: consoleHead('canvas')`.
  - It is full-bleed, escaping the shell's `max-w-[1100px]` main column. The shell gets one prop or route-level opt-out for this; the canvas does not fight the layout with negative margins.
  - Add `canvas` to the `/dashboard(...)` allowlist regex in `vercel.json` and to `public/_redirects`, so a local production build (`vite preview`) and any later preview deploy resolve the path.
- **Selection:** stored in the URL via `validateSearch`, as `?node=<kind>:<id>` (for example `?node=app:acme-api`). Back, forward and reload restore the panel.
- **Breakpoint:** below `md`, the route renders a "Canvas needs a wider screen" notice instead of the canvas.

## Components

All new code lives in `src/components/canvas/` unless noted. Each unit has one job and can be tested on its own.

| Unit                  | Responsibility                                                                                                                                                                                                                                                                       | Depends on                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `use-topology.ts`     | Fetches and joins reads into a typed `Topology { nodes, edges, issues }`. Edges come **only** from identifiers in API responses: `app_id`, binding records and `service_bindings`. Nothing is inferred from names or proximity.                                                      | TanStack Query hooks in `src/lib/api/queries.ts`                                |
| `layout.ts`           | Pure `Topology → PositionedTopology`. Fixed columns are Internet, Domains, Apps and Resources. Apps get one row each in stable order (slug). Crons sit above their app. Apps reached only through a service binding stack below their caller. Deterministic, with no layout library. | nothing                                                                         |
| `traffic.ts`          | Pure: maps a real request count (or `undefined`) to particle count and speed.                                                                                                                                                                                                        | nothing                                                                         |
| `canvas.tsx`          | React Flow host: pan, zoom, fit-to-view, selection, keyboard focus and node dragging (positions are not persisted).                                                                                                                                                                  | `@xyflow/react`                                                                 |
| `nodes/`              | `InternetNode`, `DomainNode`, `AppNode`, `CronNode`, `BucketNode`, `PostgresNode` and `DraftNode`.                                                                                                                                                                                   | tokens and `ui/` primitives                                                     |
| `edges/wind-edge.tsx` | Curved edge. Variants: live (particles), idle, draft (dashed, marching mint) and pending (dotted amber).                                                                                                                                                                             | `traffic.ts`                                                                    |
| `connect-menu.tsx`    | The directional "+" menu (see Creation).                                                                                                                                                                                                                                             | Radix Popover, using the pattern in `src/components/dashboard/range-picker.tsx` |
| `inspector.tsx`       | The right-docked detail panel.                                                                                                                                                                                                                                                       | existing hooks, `dither-kit`, `LogView`                                         |
| `start-card.tsx`      | The empty-account state.                                                                                                                                                                                                                                                             | nav and New App flow                                                            |

React Flow does mechanics only. Every visible node, edge, handle and control is a Gregale component, and React Flow's default stylesheet is not imported. Only its required base styles are, scoped to the canvas.

## Data flow

**Account-wide reads** (one request each):

- `listApps`, via `useApps`
- `listDomains`, via `useDomains`
- `listCrons`, via `useCrons`
- `getAppsMetrics('24h')`, via `useAppsMetrics`. This drives app badges and particle density.
- `listManagedPostgresDatabases`, then `listManagedPostgresBindings` per database (`usePostgresDatabases`, `usePostgresBindings`). Postgres is an internal capability, so a 403 or 404 here hides Postgres nodes without raising an error.

**Per-app reads** (parallel `useQueries`, one entry per app):

- `listObjectBuckets` (new hook `useObjectBuckets(slug)`). The response's `enabled` and `max_buckets_per_app` also drive the connect menu.
- `getAppBindingInventory` (new hook, after the spec pull), for service, Postgres and other binding states.

**Detail panel reads** (only for the selected node):

- `getAppMetrics('24h')` for the tiles: requests, error rate, p95, and wakes with cold-start percentage.
- `getAppRequestAnalyticsTimeseries` (via `useAppAnalyticsTimeseries`) for the hourly request chart (24 hourly buckets). Hourly is the finest grain the API offers, and the chart says "per hour". CLAUDE.md still says the console has no time-series and must not chart. That rule predates this endpoint and is stale (faas-web#141); `analytics-grid.tsx` already charts this endpoint. The working rule this spec follows is to chart only a real series and never interpolate from scalars.
- `getAppHealth` for the header phase.
- `useLogStream` for live logs, rendered with `LogView`.

**Freshness:**

- 30s stale time, and refetch on window focus.
- Domains with `verified: false` poll every 30s while the canvas is mounted.
- Mutations invalidate the list they change.

**Scale:** accounts are beta-sized. Up to about 30 apps render as-is. Above that, the canvas renders anyway and shows a notice that it is tuned for smaller accounts; filtering is out of scope.

## Creation

**Directional ports:**

- **Left "+" on an app:** things that send traffic into it, namely **Domain** and **Cron**.
- **Right "+" on an app:** things it talks to, namely **Bucket**.
- **Out of scope:** Postgres, queues, edge rules and anything else not listed above do not appear in the menu. There are no disabled "later" rows.

**Draft node:** the draft node is always the anchor. Choosing an item places a dashed draft node on the canvas, wired to the app by a marching edge. Its label reads "→ creates on <app>".

- **Single-field creations type straight into the node:**
  - Domain takes a hostname.
  - Bucket takes a name.

  `↵` commits. `esc` dissolves the draft.

- **Multi-field creations grow the draft into a compact form in place.** Cron takes a schedule (required), a path, a timezone and skip-if-running. It has explicit Cancel and Create buttons.

The draft is the confirmation step. There is no extra modal. On success the draft becomes a real node. On failure it stays open with the error inline.

**Calls** reuse existing mutation plumbing, so CSRF handling and the client's automatic `Idempotency-Key` behave as they do elsewhere:

| Create | Endpoint                                                                | Hook                              | After success                                                                                                                                             |
| ------ | ----------------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain | `POST /v1/domains {domain, app_id}`                                     | `useAddDomain`                    | Node is pending. A record card shows the `txt_record` / `challenge_token` to add, with copy. Verification is polled. The node links to the domain doctor. |
| Cron   | `POST /v1/crons {app_id, schedule, path?, timezone?, skip_if_running?}` | `useCreateCron`                   | Cron node above the app, showing its schedule and `last_fired_at`. No next-run time is computed client-side.                                              |
| Bucket | `POST /v1/apps/{slug}/buckets {name}`                                   | new `useCreateObjectBucket(slug)` | Bucket node to the right of the app.                                                                                                                      |

Client-side validation is limited to shape (an empty field, an obviously malformed hostname, a cron with the wrong number of fields). The server is the authority.

## Errors and honest states

The rule: **unknown is never drawn as empty.** Loading, empty, error and unreachable are four different states. Their precedence comes from `queryPhase()` in `dashboard/primitives.tsx`. A disabled query's `isPending` is never treated as loading: per-app queries are only enabled once their app list has resolved.

- **Failed create:** the draft stays open. The message is mapped from `ApiError.code`. Unknown codes fall back to the problem `detail`.
- **One per-app read fails:** that app's node shows "Couldn't load connections · Retry". The rest of the graph still renders. `Topology.issues` records the failure so tests can assert it.
- **Free plan:** `getAppMetrics` and `getAppsMetrics` answer 402. The tiles say "Metrics need Hobby" and edges carry no particles.
- **Time-series unavailable** (telemetry gate): the chart section says so instead of drawing a flat line.
- **Buckets not enabled, or the per-app limit reached:** the Bucket item is disabled and states the reason.
- **Logs:** existing SSE reconnect handling in `useLogStream`.
- **Empty account:** the centred start card. "Deploy an app" opens the existing New App flow. Domain, cron and bucket need an app, so they are explained rather than offered.
- **Loading:** glass skeleton nodes in the final column positions, so nothing jumps when data arrives.

## Testing

- **Pure units (Vitest):**
  - `layout.ts`: columns, stable ordering, determinism and no overlaps.
  - `traffic.ts`: zero and `undefined` produce no particles, and output is monotonic in rate.
  - `use-topology` join: edges come only from identifiers, an orphaned `app_id` is dropped and reported, and failed reads differ from empty ones.
- **Components (Testing Library):**
  - `DraftNode`: `↵` submits, `esc` cancels, and an `ApiError.code` renders inline.
  - Cron form: required fields.
  - `connect-menu`: left vs right options, plus disabled reasons.
  - Inspector: 402 and unavailable-series states.
- **Flag:**
  - With the flag off, the nav entry is absent and the route redirects.
  - A build check confirms the canvas code is not in `dist/` with the flag off, and is present with it on. This extends the "verified in both directions" approach of `feature-flags.test.ts`, using a sentinel string.
- **Mock:**
  - Fixtures and mutation handlers for domains, crons, buckets, bindings and analytics in `mock/`.
  - `mock-spec-drift.test.ts` guards the paths.
  - `MOCK_EMPTY=1` covers the empty state and `MOCK_LATENCY` covers loading.
- **Gates:** `npm run check`, `npm run test` and `npm run build`. The lint warning ceiling is unchanged.
- **Tour:** `npm run tour` against `dev:mock` with the flag on, to catch error boundaries, spinners that never resolve, and unmocked paths.
- **Real API:** only after the mock walkthrough. Each create is exercised once against a scratch app, with the owner confirming before each real write, and cleaned up afterwards.

## Out of scope for v1

- Creating Postgres, queues, edge rules, webhooks, realtime endpoints or upstreams from the canvas.
- Deleting, disconnecting or editing from the canvas.
- Persisted node positions or saved layouts.
- Filtering, search or grouping by project or environment.
- Mobile layout.
- Any API change in `faas`. The canvas consumes the existing `/v1` surface only.
