# Console Redesign Implementation Plan

**Goal:** Make the console fast to read. Fewer words, every section on the page it belongs to, and one compact, data-dense component set in place of today's mix of card styles, label voices and decoration.

**Architecture:** Change the primitives first and let TypeScript drive the migration: when a prop is removed (`description`, `lit`, `elevation`), every call site that used it stops compiling and gets a decision. Page structure moves after the primitives, one area per commit. Old URLs keep resolving. Everything is scoped to `.console`; the landing, docs and auth pages do not change.

**Tech stack:** React 19, TypeScript, TanStack Router and Query, Tailwind CSS 4, Vitest, Testing Library. `d3-shape` and `d3-scale` (already dependencies) for charts.

**Delivery:** One PR from `feat/console-redesign`, made of atomic commits that each pass `npm run check`. Reviewers can read it commit by commit.

## Decisions

Taken:

| Topic             | Decision                                                                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Visual reference  | Cloudflare dashboard: utilitarian, table-first, dense, hairline structure, colour only for state and actions.                                                     |
| Flair             | Removed from the console, kept on landing. That covers dithered charts, glow, gradients, lit edges, rolling numbers, the greeting hero and the background fields. |
| Density           | Compact: 13px body, 32px table rows, 28px controls.                                                                                                               |
| Component gallery | Yes. Dev-only route, excluded from the production build.                                                                                                          |

Proposed defaults, to confirm before step 6:

1. **App pages get a contextual sidebar.** Opening an app swaps the rail to that app's sections, the way Cloudflare swaps to a zone's sections. The existing groups become rail headings and the pages become rows. This replaces today's two navigation levels (group tabs plus a segmented control). `?tab=` stays the URL state.
2. **Invoke becomes a header action** (a sheet next to Deploy) instead of a page.
3. **Metrics moves to the Observe group.** Stateless contract moves to Configure → Configuration.
4. **The account-level Debugger rail row goes.** It is an app picker wrapped around the app's own Debugger. The route stays reachable from ⌘K and redirects to the selected app's Debugger.
5. **Selects stay native.** `color-scheme: dark` already themes the popup. The 66 raw `<select>`s consolidate on `ui/field.tsx`'s `Select`, and `AppSelect` stays on Radix for its rich rows.
6. **Create and edit flows open in a right-side sheet.** Confirms stay centred.
7. **Fonts:** Satoshi stays as the sans. Mono is only for identifiers, hashes and code, not for labels.

## Baseline (main, 2026-11-02)

- Main JS chunk `index-*.js`: 2,327,789 B raw / 725,381 B gzip. 166 JS chunks, 8.1 MB in `dist/assets`.
- Route files export page bodies that other routes import, including `dashboard.logs`, `secrets`, `env`, `jobs`, `routes`, `releases`, `plans`, `domains`, `projects` and `triggers`. That defeats `autoCodeSplitting`, and Vite warns about it on every dev start.
- Copy: 188 page and panel descriptions, median 93 characters, 101 of them two or more sentences. Internal terms in visible copy: "evidence" ×56, "telemetry" ×13, "catalog" ×8, "contract" ×7, plus "apid", "Firecracker" and raw codes such as `bindings_release_required`.
- Structure: 181 `Panel`s, 97 `StatTile`s, 299 `label-mono`s, 66 raw `<select>`s, 12 create forms always expanded on list pages.

## Global constraints

- `.console` scope only. The marketing site, docs and auth pages must look exactly as they do now.
- No literal hex and no `dark:` in components. New colours get a token in both `:root` and `.console`.
- Status keeps colour + icon + text (README § Conventions).
- `queryPhase()` precedence is unchanged: loading, empty, error and unreachable stay distinct.
- Every moved surface keeps its old URL working, through a redirect or a search-param mapping.
- No capability is lost. `npm run parity` coverage is the same before and after; only surface paths change.
- Motion stays only where it is functional (sheet, toast, tooltip, popover) and honours reduced motion.
- No drive-by reformatting. Generated files are never hand-edited.
- Tests: add only for behaviour people rely on. Delete tests that only pin removed prose or removed structure, and don't write tests for unlikely edge cases.
- Commit messages follow the repo style: `type(scope): lowercase summary`.

## Step 1: Fix the false "Cannot reach the API" banner

**Files:** `src/lib/auth.tsx`

- The mount-time `refreshAccount()` can reject with TanStack's `CancelledError` when another fetch of `['account']` supersedes it. The `.catch` treats anything that isn't a 401 as unreachable, so the banner appears on every page while the API answers 200.
- Ignore cancellations (`isCancelledError` from `@tanstack/react-query`), and one regression test.

Commit: `fix(console): a cancelled account check no longer reports the API unreachable`

## Step 2: Code-split every route

**Files:** route files that export bodies; new homes under `src/components/dashboard/pages/`

- Move each exported page body out of its route file (`LogsBody`, `SecretsBody`, `EnvBody`, `RoutesBody`, `DeploymentsPage`, `ProjectInventory`, `DocsIndex` and the rest). Route files then export only `Route`.
- Update the imports in `dashboard.apps.$appSlug.tsx`, `dashboard.projects.*` and tests.
- Measure the main chunk again and record it in the PR.

Commits: one `refactor(routes): move <area> bodies out of route files` per cluster (about 4), then `perf(console): …` with the numbers.

## Step 3: Foundation tokens and removing the flair

**Files:** `src/index.css`, `components/dashboard/shell.tsx`, `routes/dashboard.index.tsx`, `components/dashboard/primitives.tsx`, `components/ui/button.tsx`

- **Console tokens:**
  - surface radius 6px, control radius 4px
  - controls 28px tall, table rows 32px
  - one surface colour, so a card is the page colour with a hairline border
  - no elevation shadows in `.console`
- **One label voice.** Add `.label`: 12px, medium weight, muted, sentence case. Rename `label-mono` to `label` in console files (299 uses, done by codemod). Mono stays for IDs and code.
- **Remove from the console:**
  - `console-atmosphere`
  - `WindFlow`, `FlowDotsField` and the `WordReveal` greeting
  - `lit` and `elevation` on `Panel`
  - the gradient on the New app button
  - `CountUp` and the odometer
  - `animate-item-enter` and `Stagger`
  - the `StateBadge` pulse and cross-fade
  - `BreatheRing`, replaced by skeleton rows

Commits: `style(console): compact density and flat surface tokens`, `style(console): one sentence-case label voice`, `refactor(console): drop decorative motion and backgrounds`.

## Step 4: The component kit

**Files:** `components/dashboard/primitives.tsx`, `resource-table.tsx`, `tabs.tsx`, `components/ui/*`, new `components/dashboard/kit/`

| Primitive                     | Change                                                                                                                                                                                                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PageHeader`                  | Title, an optional inline `meta` slot (status, count), and actions. `description` is deprecated, then removed in step 6.                                                                                                                                              |
| `Panel`                       | Header row with a title and actions; a `flush` option replaces `padded`. New `help` prop (see `HelpTip`). `description`, `lit` and `elevation` are deprecated, then removed.                                                                                          |
| `Stats` / `Stat`              | Replaces grids of separate `StatTile` cards. One bordered strip with hairline dividers. Each cell has a label, a value and at most one short sub-line, and an optional plain sparkline. `StatTile` becomes a thin alias during migration.                             |
| `ResourceTable`               | 32px rows, a sticky header, sentence-case 12px headings, numeric columns right-aligned with tabular figures, and skeleton rows while loading. `Pill` becomes `Badge`.                                                                                                 |
| `Sheet`                       | Right-side panel built on `Modal placement="right"`. Header, scrolling body, and a sticky footer with the primary action. Sizes `sm`, `md` and `lg`.                                                                                                                  |
| `HelpTip`                     | A "?" button that opens a popover with one paragraph and an optional docs link. Built on Radix Popover, which `range-picker` already uses. It is where explanations go instead of description lines.                                                                  |
| Read states                   | `InlinePhase` becomes the default in a panel. The dashed full-size boxes stay only for empty pages and first-run states.                                                                                                                                              |
| `Tabs` / `SegmentedControl`   | Restyled to 32px. Underline tabs are used for single-level page tabs only.                                                                                                                                                                                            |
| `Button` / `Input` / `Select` | Heights 28px and 32px. Primary is solid brand colour.                                                                                                                                                                                                                 |
| Charts                        | New `LineChart`, `AreaChart`, `BarChart` and `Sparkline`: plain SVG built on `d3-shape`, a muted grid, one accent colour, and a hover readout. They replace Dither Kit in `app-analytics`, `custom-metrics`, `log-drain-detail`, `upstream-history` and `primitives`. |

**Gallery:**

- A dev-only route at `/dashboard/kit`. Every primitive appears in its ready, loading, empty, error and unreachable states, at desktop and mobile widths.
- `beforeLoad` throws `notFound()` unless `import.meta.env.DEV`, and the gallery module is imported behind that same flag so the production build drops it.
- Sample props live only in that module. It is not listed in `nav-config`, and its head is `consoleHead('kit')`.

Commits: one `feat(kit): …` per primitive (about 9), then `feat(kit): dev-only component gallery`.

## Step 5: Move every page onto the kit

**Files:** all console routes and dashboard components. The order follows the rail groups.

- `StatTile` grids become `Stats`, and Dither charts become kit charts.
- The 66 raw `<select>`s become `Select`. `SelectField` in `edge-rules/fields.tsx` folds into `Select`.
- **The 12 always-expanded create forms move into a `Sheet` behind a "Create …" button:**
  - Postgres
  - CORS presets
  - Domains
  - Upstreams
  - Alerts
  - Outbound webhooks
  - Stripe inbound webhook endpoints
  - Secrets
  - Secret references
  - Env vars
  - Mirrors
  - Tenant surfaces
- **Forms inside detail panels follow one rule.** Three or more fields go in a sheet; one or two fields become a single inline row behind an "Add" button.
  - To sheets: Postgres bind, private registry.
  - Inline rows: deploy token, aliases, outbound bind, bucket grant, S3 credential, trusted publisher.
- **Existing create modals switch to `Sheet`.** Customers, consumers, plans, log drains, scheduled requests, workloads, integrations, edge rules and rule lists. Confirms stay centred.

Commits: one `refactor(<area>): adopt the console kit` per rail group (Compute, Storage, Networking, Messaging, Monetize, Observe, Account, App pages), plus one `refactor(console): create flows open in a sheet`.

## Step 6: Copy pass

**Files:** every `PageHeader` and `Panel` call site (188 descriptions), the footnotes, and `nav-config.ts`

- **The rule:** a page has no subtitle. A panel has a title only. Explanations nobody will act on are deleted. Explanations someone needs before acting become a `HelpTip` with a docs link.
- **Footnotes:**
  - "As of …" becomes a timestamp in the panel header.
  - "Showing top N" becomes the table's footer count.
  - Plan-limit footnotes move to Plans.
- **Internal terms are rewritten in plain words:**
  - apid → Gregale
  - Firecracker microVMs → instances
  - evidence → details or checks
  - telemetry → request data
  - raw error codes leave visible copy
- **Sentence case everywhere:** Edge rules, Audit log, API keys, Needs attention. The "Cron Jobs" rail entry becomes "Scheduled requests", the name its page already uses.
- When the migration is done, remove the `description` props from `PageHeader` and `Panel`, so TypeScript stops new ones.
- Add `src/lib/copy.test.ts`, modelled on `landing/hedging.test.ts`. It strips comments, then fails on the internal terms above in string literals and JSX text.

Commits: per rail group, `copy(<area>): cut descriptions and internal terms` (about 8), then `refactor(console): remove description props` and `test(console): pin console copy rules`.

## Step 7: Put sections where they belong

| Area          | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App page      | Contextual rail (decision 1). Delete the `AppTabNavigation` tab strip and segmented control. Rows are capability-gated through `APP_TAB_CAPABILITY`, and the mobile drawer reuses the same body. Metrics moves to Observe, Invoke becomes a header sheet (`?invoke=1`, with legacy `?tab=Invoke` mapped), and Stateless contract moves to Configure. Analytics state on Metrics moves into the URL, so deep links from Analytics keep working.                                  |
| Overview      | Remove the hero, the background fields and the greeting. The `verdictOf` result becomes a one-line status, with failing apps folded into Needs attention. Apps, Deployments and Recents become compact tables. One `Stats` strip, all from `/v1/apps/metrics`, so there is one error rate instead of three. Remove the per-app `AnalyticsSection` (Metrics shows the same data) and delete `analytics-section.tsx`, `analytics-grid.tsx` and the `gregale.analytics.order` key. |
| Analytics     | Account-level only: a `Stats` strip plus the apps table. A row opens that app's Metrics with the window kept. Remove the selected-app drill-down, which duplicated six Metrics panels. Old `?app=`, `group`, `route` and `method` links redirect to the app's Metrics.                                                                                                                                                                                                          |
| Usage         | In order: allowance and projection (one strip plus a bar), the spend cap, by-app usage, then Object storage. Label the two egress figures "Compute egress" and "Storage egress". App capacity and the plan-limits footnote move to Plans.                                                                                                                                                                                                                                       |
| Edge rules    | Single-level page tabs: Rules, CORS presets, Rule lists, instead of three stacked panels.                                                                                                                                                                                                                                                                                                                                                                                       |
| Rail          | Sentence-case labels. Remove the Debugger row (decision 4).                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Parity ledger | Update the surface paths in `src/lib/parity/ledger.ts` (Invoke, Debugger, Analytics drill-down). `npm run parity` coverage stays the same.                                                                                                                                                                                                                                                                                                                                      |

Commits: one `feat(<area>): …` per row, plus `chore(parity): point moved surfaces at their new homes`.

## Step 8: Tests and docs

- Delete or rewrite tests that pin removed descriptions, the drill-down, the group tabs and `analytics-grid`. Assert behaviour, not prose.
- New tests stay few:
  - the banner regression (step 1)
  - the copy rules (step 6)
  - contextual rail: app pages list the app's sections, and legacy `?tab=` values resolve
  - old Analytics `?app=` links redirect to the app's Metrics
- Update README § Conventions, § Motion and § Theming, CLAUDE.md's primitive list, and `docs/superpowers/specs/2026-10-20-sidebar-categories-design.md` for the contextual rail.

Commits: `test(console): …`, `docs: …`.

## Completion gate

- `npm run check` and `npm run build` pass. Lint stays at 4 warnings.
- `npm run dev:mock`, then `npm run tour` at 1440 and 390 px, including `MOCK_EMPTY=1` and `MOCK_LATENCY`.
- `npm run build:mock && npm run preview:mock`, then `BASE_URL=http://localhost:4173 npm run tour`, with no CSP violations.
- `grep -r "kit" dist/assets` finds nothing from the gallery in the production build.
- Main-chunk size before and after, in the PR body.
- `npm run parity` matches main.
- The PR body is short: what changed and how, one line per template heading.

## Risks

- **Size.** About 40 commits touching most console files. Mitigation: each commit compiles and passes on its own, and the order follows the rail.
- **Test churn.** Many of the 4,225 tests assert visible copy. Expect deletions; keep the behavioural ones.
- **Drift from main.** The repo merges often. Merge `main` into the branch after each step, as the repo history does, rather than rebasing.
