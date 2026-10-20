# Sidebar by resource category: design

**Status:** approach approved in conversation on 2026-10-20 (Option A, "cloud-console nouns"), awaiting review of this written spec.
**Branch:** `feat/console-sidebar-categories`, off `main` at 7376e5f. One PR.

## Why

The rail groups pages by task: Build, Operate, Account. The seven Operate rows have nothing in common except "not building and not paying", so a developer looking for buckets, domains or the event router has to scan the whole group. Developers arriving from AWS, GCP or Railway look for a thing by its kind: compute, storage, networking. The console already carries that model in its four `--cat-*` colour tokens (compute, storage, network, security) but never says the words.

This change regroups the **account-wide** rail by resource category. Per-app resources (logs, secrets, queues, routes and the rest) stay as tabs on the app page: the 2026-08-22 decision to take them out of the rail stands, because each of them would need its own "which app?" picker.

## The rail

Group titles keep today's style (small mono label, title case). Rows marked **new** are not in the rail today.

```
Overview

Compute
  Projects
  Releases
  Jobs
  Instances

Storage
  Object storage      ← today's "Storage" row, relabelled
  Postgres

Networking
  Domains
  Edge rules          ← new: the account-wide /dashboard/edge-rules page

Messaging
  Events
  Integrations

Monetize
  Customers

Observe
  Analytics
  Debugger
  Invocations
  Audit Log

Account
  Billing ▸
    Usage
    Invoices
    Plans
  Settings
```

20 rows and 7 group headings, against 21 rows and 3 headings today. Templates and Import leave the rail (see decision 2).

## Decisions

1. **Account-wide pages only.** Nothing per-app comes back into the rail. The "App sections" strip on standalone per-app pages (`/dashboard/logs` and the like) is unchanged.
2. **Templates and Import leave the rail.** Both rows are redirect-only routes to `/dashboard/apps/new?source=…`, so the rail never lights them as current (the 2026-10-20 DX audit lists this under navigation). The wizard is already one click away from the **New app** button on every page and from the ⌘K action "Deploy a template". Both stay in ⌘K's "Go to" list and keep their redirect routes, so bookmarks and the `g t` / `g i` chords keep working.
3. **Projects becomes a plain row.** With Templates and Import gone it has no sections, so it is a link, not a disclosure. The app list and app pages keep lighting it, as today.
4. **The Data hub dissolves** into two plain rows, Object storage and Postgres. The page at `/dashboard/storage` is retitled **Object storage** (rail row, page title via `SECTION_LABELS`, and its `PageHeader`); the "App capacity" panel stays on that page and its description still mentions it. "Storage" under a group called Storage would say the word twice.
5. **The Observe hub dissolves** into plain rows. Debugger, Invocations and Audit Log stay under the Observe heading; **Instances moves to Compute**, because it lists the microVMs that run apps, not a way of watching them. Analytics joins the Observe group.
6. **Edge rules gets a rail row** under Networking. The account-wide page exists (`/dashboard/edge-rules`, every app's rules plus CORS presets) but is reachable only through ⌘K today. The per-app view stays the app tab under Connect.
7. **Customers sits alone under Monetize.** It is what you charge your customers, not what Gregale charges you, so it does not belong under Billing (the comment in `nav-config.ts` already argues this). The app page calls the same area Monetize. A one-row group is the honest size of that area today; API monetization is `internal` maturity and gated.
8. **Events and Integrations share Messaging.** Events is the account-level event router; Integrations holds outbound integrations and the AI gateway (`?view=ai`). The AI gateway stays a view inside Integrations rather than its own row until it leaves preview (see questions for Poyraz).
9. **Billing stays a disclosure.** It is the one second level left. Flattening it would leave `NavDisclosure` unused and force a shell edit, and "Billing ▸ Usage / Invoices / Plans" reads correctly under Account.
10. **No "Apps" row.** Projects remain the way in (2026-10-16). `/dashboard/apps` keeps its hub entry so its title, breadcrumb and ⌘K entry survive, and `findNavHub` keeps mapping it to Projects.
11. **No renames that belong to the naming proposal.** Releases, Jobs, Cron Jobs, Customers and the rest keep today's labels. `console-naming-proposal-2026-10-20.md` is waiting on Poyraz; this change must not pre-empt it.
12. **Icon colours follow the group.** Compute rows `text-cat-compute/80`, Storage rows `text-cat-storage/80`, Networking, Messaging and Monetize rows `text-cat-network/80`, Observe rows `text-cat-security/80` (Analytics switches from brand to this), Overview keeps brand, Account rows stay uncoloured. No new tokens.

## What changes

### `src/components/dashboard/nav-config.ts`

- `NAV_HUBS`: Projects loses its `sections`. The Data hub becomes two hubs (`/dashboard/storage` labelled Object storage, `/dashboard/postgres` labelled Postgres). The Observe hub becomes four hubs (Debugger, Invocations, Instances, Audit Log). A new Edge rules hub points at `/dashboard/edge-rules` with an Iconoir glyph that reads as a filter or rule set. Apps, Jobs, Releases, Domains, Customers, Events, Integrations, Analytics, Billing and Settings are unchanged apart from `sidebarIconClassName`.
- `SIDEBAR_GROUPS` becomes the seven titled groups above plus the untitled Overview group, in that order.
- Templates and Import move to a small `PALETTE_ONLY: NavItem[]` list that `NAV_ITEMS` spreads in after the hubs, so ⌘K and `SECTION_LABELS` still know them. Their `to` stays the redirect path (`/dashboard/templates`, `/dashboard/import`); repointing redirect callers is the naming-and-nav cleanup pass, not this one.
- `findNavHub`: the Observe special case in the comment goes. The Debugger hub matches `/dashboard/debug` directly. The Apps → Projects mapping and the Settings legacy-path mapping stay.
- `SECTION_LABELS` is derived, so `storage` becomes "Object storage" and `edge-rules` stays "Edge rules" (from `APP_TABS`). No manual entries change.
- `isDisclosureHub`, `sidebarSectionsFor` and the `NavHub` type are unchanged.

### `src/routes/dashboard.storage.tsx`

`PageHeader` title becomes "Object storage". The description keeps mentioning app capacity.

### `src/components/dashboard/shell.tsx`

No change. Groups, disclosures, the collapsed rail and the mobile drawer all render from `NAV_GROUPS`.

### `src/components/dashboard/secondary-navigation.tsx`

No change, but two pages change behaviour because they now have a hub without sections:

- `/dashboard/edge-rules` loses the collapsible "App sections" strip. Intended: it is the account view, and the per-app view is the app tab.
- `/dashboard/debug` loses the same strip. Accepted: Debugger is an Observe destination with its own app picker, and the app tab under Observe is the per-app way in.

### Tests

- `src/components/dashboard/navigation.test.tsx`: `RAIL` becomes the 20-row list above; `RAIL_GROUPS` the seven titles; `RAIL_PARENTS` is `['Billing']`; `GROUPS` keeps only the Billing entry. The disclosure tests (close and reopen, `gregale.sidebar.closedGroups`, ⌘B focusing the first disclosure button) retarget Billing. The "Storage → Postgres tab order" test goes; there is no Data strip any more. The breadcrumb assertion "Observe › Debugger" becomes "Debugger". The ⌘K "Go to" fixture `['Data', '/dashboard/storage']` becomes `['Object storage', '/dashboard/storage']`, and the search that types "Data" retargets a label that still exists. Add one assertion each for: Edge rules is a rail link under Networking; Templates and Import are not rail links but are ⌘K results; `/dashboard/edge-rules` lights Edge rules, not Projects; `/dashboard/instances` lights Instances under Compute.
- `src/routes/-dashboard.navigation.test.tsx`, `-dashboard.hub-navigation.test.tsx`, `-dashboard.settings-hub.test.tsx`, `src/lib/customer-surface.test.ts`: expected to pass unchanged. They check routes, redirects and the Jobs, Releases and Settings strips, none of which move.
- The same file looks up a rail link named "Storage" in several places (the rail fixture, the ⌘K fixture, the palette search, and the Data strip tests); each becomes "Object storage" or goes with the strip. No other test asserts the Storage page title.

### Docs

- `README.md` § navigation (around line 645): one sentence saying the rail is grouped by resource category and that per-app resources are app tabs, pointing at this spec.
- The `nav-config.ts` doc comment above `SIDEBAR_GROUPS` is rewritten to state the category rule and the "account-wide only" boundary, replacing the paragraph about the earlier ten-row pass.

## Vertical budget

Rows are 32px (28px nested), a group heading is 24px, and groups are 16px apart. Today's rail body is about 870px; the new one is about 940px, because four more headings and the flattened Observe and Data rows cost more than the three removed rows save. Both already scroll on a 768px-tall laptop and both fit a 1080p window with browser chrome. If the laptop check in verification shows the new rail clipping Settings where the old one did not, the fallback is reducing the group gap from `gap-4` to `gap-3` in `SidebarBody` (saves 28px) before anything else is considered. Collapsing Billing by default is not an option: open-by-default is a stated rule in `shell.tsx`.

## Not changing

- Per-app resources, the app page's seven tabs, and the "App sections" strip on standalone per-app pages.
- The Jobs and Releases pages' own `?section=` / `?view=` navigation.
- Settings' eight panels staying out of the rail.
- The `g` chords, the ⌘K actions, and recents migration.
- Redirect routes. All 18 keep resolving; the routes test pins them.
- Any label that the naming proposal is deciding.
- Colour tokens. A fifth category colour for Observe or Messaging can come later if the violet and rose reuse reads wrong.

## Questions for Poyraz

None block the merge. They decide whether the groups get fuller later.

1. **AI gateway as its own row?** It is `preview` behind the `AIGateway` platform flag and lives as `?view=ai` inside Integrations. When it leaves preview, should it be a Messaging row of its own ("AI gateway") or stay a view? The console will add the row when he says it is customer-facing by default.
2. **Realtime.** `apps/{slug}/realtime` has 78 operations and account-level publishers and workers, but no console page. When it ships, is it Messaging (channels, publishers) or Compute (workers)? The console will reserve the slot he names.
3. **Static sites.** `sites` is operator-only behind `FAAS_FRONTEND_HOSTING_ENABLED`. If it becomes customer-facing, it is a Compute row next to Projects; confirm it will stay account-scoped rather than per-app.
4. **Managed Postgres maturity.** The Postgres row shows a `PlanGated` page and the capability is `internal`. Is it fine for Storage to show a row that most accounts cannot use yet, or should the row hide behind `useCapability('managed-postgres')` the way AI gateway hides? Today the row is already in the rail, so the default is to keep showing it.

## Verification

In the worktree, all must pass before the PR is opened:

1. `npx tsc --noEmit` exits 0.
2. `npm run lint` reports 0 errors and no more than the existing 4 warnings.
3. `npm run format:check` exits 0; Prettier runs only on touched files.
4. `npx vitest run --maxWorkers=8` exits 0 with no "Errors" line in the summary.
5. `npm run build` succeeds.
6. `npm run dev:mock` and a walk of the rail: every row lights on its own page, `/dashboard/edge-rules` and `/dashboard/instances` light their new rows, `/dashboard/apps/<slug>` lights Projects, ⌘K finds Templates, Import and Object storage, and the rail at 1366×768 scrolls no worse than main does. `npm run tour` against the mock server passes.
