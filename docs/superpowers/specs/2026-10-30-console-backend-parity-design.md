# Console–backend parity

**Date:** 2026-10-30
**Status:** design, for review
**Baseline:** faas `933e4fe5d7` (main, 2026-10-30), faas-web `e9db443` (main, 2026-10-29)

## Goal

Every customer-facing capability Gregale offers is usable from the console:
anything a customer can do through the API or the CLI, they can see and do here.
Where the console deliberately leaves an action to the CLI, it shows the exact
`gregale` command (the `CliCommand` pattern from #206). Operator, admin and
internal surfaces are out of scope.

"Customer-facing" is not decided here. It comes from faas's own
`docs/ga-capability-inventory.md`, which lists every customer-reachable
capability on `main` (167 rows, kept complete by faas's
`make capability-coverage-check` gate), and tiers each one:

| Tier | Rows | Meaning upstream | What the console owes it |
|---|---|---|---|
| GA | 46 | On for every account; the v1.0 charge bar | Complete surface |
| beta | 32 | On for every account, labelled beta | Complete surface, labelled beta |
| preview | 48 | Off by default; released per account by a platform flag | Complete surface, shown only when the account has it |
| internal | 42 | Hidden from customers; frozen until after v1.0 | Nothing new. Existing pages are gated, not extended |

## Where the console stands

Measured on the baseline commits.

- **Operations.** The upstream spec has 1,909 operations. faas-web's vendored copy
  has 1,410 (499 behind, none removed). The console calls 384 of them.
- **What the other 1,525 are.** Grouped into capabilities, they split into:
  - customer capabilities the console lacks or covers partly (the waves below);
  - preview and internal capabilities;
  - agent, CI or SDK plumbing (uploads, submissions, staging, OIDC exchange,
    SDK ingest);
  - tenant and end-consumer self-service (`platform-tenant-self`, consumer
    signup and billing);
  - operator and admin routes (every one sits behind `requireOperator*` or
    `requireAdminMutationPolicy`; none is customer-facing).
- **Live breakage today:**
  - **Five app tabs 404 for default accounts.** Routes, Upstreams, Mirrors,
    Tenant surfaces and Debugger call preview or internal capabilities. Since
    faas #5319 (2026-10-25), capgate answers 404 to any account the capability
    is not released to. The domain doctor and the supply-chain panel (internal
    `signed-deploys`) have the same problem.
  - **Wrong capability keys.**
    - The automations editor checks `workflows-and-jobs`
      (`automations-body.tsx:131`), but automations are internal.
    - Customers checks only `api-monetization` (`monetization-shared.tsx:18`),
      but tenant routes are gated by `platform-tenants`.
  - **Billing forecast currency.** It is rendered in EUR, but the API now
    returns only USD (`spend-control.tsx:17`; faas `pkg/financial/currency.go:7`).
  - **The trigger form still offers `sqs_compat`.** apid has refused it with
    422 since faas `d69c41b965`.
  - **The service-binding policy editor shows "Account" for `project` apps.**
    It offers only Account and Declared (`service-policy-editor.tsx:277`).
- **Workspaces are incomplete.** With a company workspace active:
  - Plans, Usage, Invoices, Storage and Postgres still show the personal
    account.
  - Projects created by teammates are invisible, because `GET /v1/projects` is
    account-only.

  App pages already work for members (ADR-202610171901), which makes the
  workspace note in CLAUDE.md out of date.
- **Contract drift is small.** Re-vendoring the upstream spec gives 9 type
  errors and 1 deliberate tripwire test to flip. About 70 operations the
  console already calls gained fields or states it ignores: release policy,
  scheduled release, config guard, cancelled stages, the `challenge` edge
  rule, the `adaptive` canary preset, the `realtime` trigger kind, `datadog`
  drains.
- **Deprecated upload endpoint.** `POST …/deployments/source-tarball` is
  deprecated and past its documented sunset. Its replacement is `/v1/uploads`.
- **26 faas-web PRs are open,** including all of October's console DX work.

## Approach

A **parity ledger** in faas-web maps every customer capability in the upstream
inventory to its console surface, and a test fails when a new upstream
capability has no entry. Work then proceeds in **waves by tier**: foundations,
then GA gaps, then beta, then preview.

Two other approaches were considered and rejected:
- **Page by page.** GA gaps would wait behind preview work on earlier pages,
  and nothing would stop the drift from recurring.
- **Contract only, features as they come.** This is how the console fell
  behind in the first place.

## Wave 0: foundations

Nothing in later waves starts until the console PRs in 0.1, and all of 0.2 and
0.3, have landed. 0.4 and 0.5 can run alongside.

### 0.1 Land the backlog

New work is not stacked on the open PRs. Each one is landed, refreshed or
closed.

| PRs | Disposition |
|---|---|
| #204 → #206 (stacked), #207 → #211 (stacked), #205, #208, #210, #212 | Mark ready and land in that order. Resolve the known Domains-table and `useFreshRestart` overlaps at merge time |
| #195 service migrations (Poyraz) | Land. It covers capability A7 |
| #202 USD plan catalog | Land together with the forecast fix in 0.2. USD is now confirmed by the forecast enum |
| #125 observed app health (Poyraz), #143 usage trend, #168 compatibility checks | Rebase. Then fold #125 into G137 (wave 2), #143 into H151 (wave 1) and #168 into A16 (wave 1), or close each one if superseded |
| #123 budgets (stale, conflicting) | Close. It is superseded by H152 (wave 2) |
| #22 phase-1 CLI gaps (stale since 2026-09-01) | Close. Its surfaces are re-derived from the ledger |
| #170 canvas | Keep parked. It is outside parity |
| #203, #197, #196, #214, #215, #178, #167, #124, #40, #28 (site, landing, docs, security) | Outside this plan. Tracked separately |

### 0.2 Contract refresh

Three PRs, in this order:

1. **Forecast currency.** Render the forecast in USD and drop the EUR branch.
   This is a live bug, and it pairs with #202.
2. **Re-vendor and compile fixes.**
   - Run `npm run api:pull` and fix the 9 type errors:
     - `release-process.ts:42`: stage state with `current: ''`, history timings,
       and cancelled rows that are currently dropped;
     - `service-policy.ts:49`: add the `project` policy, with a "Project"
       option in the editor;
     - `trigger-create.tsx:27`, `trigger-form-model.ts:59`: the `realtime`
       label, and remove `sqs_compat` from the form;
     - `ai-gateway.tsx:139`: the `tag_daily_cost` label;
     - three mock fixtures in `mock/events.ts`.
   - Flip the `cache.contract.test.ts` tripwire and delete its cast.
   - Add labels for the new enum values that the console only displays: alert
     metrics, `datadog` drains, `challenge` rules, the `adaptive` canary preset.
   - Generator flags stay as they are (`--default-non-nullable=false` still
     behaves).
3. **Deploys through resumable uploads.** Move `useDeployTarball`
   (`queries.ts:3548`) to `POST /v1/uploads` → `PATCH` → `/commit`. This is the
   deprecated endpoint's replacement.

### 0.3 One capability gate

A single source of truth for "is this on for this account":
- **`useCapabilities()`** in `src/lib/api/capabilities.ts`. It is one cached
  `GET /v1/capabilities` per session; it refetches on window focus and after a
  preview join or leave.
- **`hasCapability(key)`**, and **`<CapabilityGate capability fallback>`**.
- **Declarations.** Nav items in `src/components/dashboard/nav-config.ts` and
  app tabs in `app-tab-navigation.tsx` declare a `capability`, and are hidden when it is
  absent. Pages behind a gate render a "Not enabled for this account" state
  that links to Previews, not an error.
- **`hidden_capabilities`.** This lists every catalog capability, internal ones
  included, whose platform flag is off for the account
  (`handlers_capabilities.go:65`). A capability on that list is off. One that
  is absent from it is on, unless the registry entry says the plan is not
  entitled. This keeps internal pages, such as Routes, working for the
  accounts that have them. What an account can join self-serve comes from
  `/v1/previews`, and the off state links there.
- **Previews panel** in Settings: `GET /v1/previews` and `PUT`/`DELETE
  /v1/previews/{key}` for the personal workspace, and the
  `/v1/orgs/{slug}/previews…` equivalents for a company workspace, for flags
  marked `self_serve` (ADR-20261021080640).

The first PR uses the gate to fix the live breakage: the five tabs, the domain
doctor, the supply-chain panel, the automations key, and Customers (gated on
`platform-tenants` and `api-monetization` per route).

### 0.4 Workspace correctness

When a company workspace is active, these pages read org-scoped routes:
- **Billing:** `/v1/orgs/{slug}/billing/status`, `/usage` and `PATCH …/plan`.
- **Projects:** `/v1/orgs/{organization}/projects…`, reusing the personal
  project components with a scoped base URL.
- **Storage and Postgres:** the org object and Postgres routes.

It also rewrites the workspace paragraph in CLAUDE.md to match
ADR-202610171901.

### 0.5 The parity ledger

- **`npm run capabilities:pull`** (`scripts/pull-capabilities.mjs`, modelled on
  `pull-docs.mjs`). It vendors `docs/ga-capability-inventory.md` and
  `pkg/productcap/catalog.json` into `content/capabilities/`, so an upstream
  change shows as a reviewable diff.
- **`src/lib/parity/ledger.ts`.** One entry per GA, beta and preview row, keyed
  by the inventory row number (upstream appends rather than renumbers; row 168
  sits in section G). Each entry has:
  - `row` and `name`. The name must match upstream, which catches a renumber.
  - `tier`.
  - `capability`: the catalog key used by the gate, when one exists.
  - `status`: `full` | `partial` | `cli` | `none`.
  - `surfaces`: route paths, which must exist in `routeTree.gen.ts`.
  - `cli`: the command shown where the status is `cli` or `partial`.
  - `gap`: one line saying what is missing, required unless the status is
    `full`.
- **`parity-ledger.test.ts`** fails when:
  - a GA, beta or preview row has no entry;
  - a name drifts;
  - a surface route does not exist;
  - a `full` entry has a `gap`;
  - a gated surface has no `capability`.

  Internal rows may be listed (status `none`, gap "internal tier") but are not
  required.
- **`npm run parity`** prints coverage by tier. It is the progress number for
  this plan.

The first ledger PR audits every row against the console. Rows the research
below did not flag get their status from that audit. Any gap it finds joins its
tier's wave, using the same table format.

## Wave 1: GA gaps

All on for every account. S = a panel on an existing page, M = a new tab or
page, L = a section.

| Row | Capability | Gap to close | Size | Placement |
|---|---|---|---|---|
| A1 | Apps | "Recently deleted": `GET /v1/deleted-apps`, `POST …/{id}/restore` (the slug restore in #208 covers only the grace window) | S | Apps list |
| A5 | GitHub | Status, sync and disconnect (`GET/DELETE …/install/bind`, `POST …/install/sync`) | S | App source settings |
| A11 | App config | New app fields: `release_policy`, `release_probe_paths`, `function_concurrency` | S | Configuration |
| A13 | Deploy tokens | List, create, rotate and revoke (admin scope plus step-up) | S | App › Configure |
| A16 | Stateless-contract checks | Land or replace #168; show source-review results on the deployment | M | Deployment detail |
| A19 | Projects | Update and delete; project previews; reads of new fields (`depends_on`, `org_id`) | M | Project detail |
| B24, B25 | Rollback, rollouts | Deployment detail: diff, runtime upgrade preview, promote, rollback status, rollout observation; new deployment fields (`scheduled_release`, `rollout_hold`, `rollout_decision`, `configuration`) | M | Deployment drawer |
| B27 | PR previews | Create a preview; preview by slug | S | Releases |
| C44 | Service wake-ahead | Read and set | S | App › Services |
| C60 | Env vars | History, rollback and config guard. Every env or secret write opens a guard the console drops today | S | Environment |
| C61 | Secrets | References and revocations | S | Secrets |
| D63 | Custom domains | Domain detail and default. Mostly done by #206 and #208; finish here | S | Domains |
| D66 | Service bindings | Verification runs, release policy, queue canaries | L | App › Services |
| G138 | Audit log | Request audit (opt-in) and route-customer usage | S | Observe |
| H151 | Plans and billing | Billing identity (`PATCH /v1/account/billing`), billing status, invoice refresh, account usage; fold in #143 | S | Settings › Billing |

## Wave 2: beta gaps

All on for every account and labelled beta in the UI.

| Row | Capability | Gap to close | Size | Placement |
|---|---|---|---|---|
| B26 | Deployment aliases | List, set, remove | S | Deployments |
| D74 | Edge rules | Versions and rollback, rule lists, suggestions, WAF review; `challenge` and `penalty` kinds | M | Networking › Edge |
| D75 | CORS presets | Edit | S | Networking › Edge |
| D76 | Edge protection | Pre-auth observations, attack mode | S–M | Networking › Edge |
| E93 | Jobs | Retry a task, replay failed runs, artifacts download, registry credentials, schedule fields (on top of #208) | M | Jobs detail |
| E94 | Workflows | Runs (list, cancel, resume, retry a step, events, callbacks), schedules, insights (attention, outcomes, performance), recovery policy | L | App › Automate › Workflows |
| E95 | Delayed tasks | List | S | App › Queues |
| E96 | Async invocations | Keyed replay; new fields (`work_policy_name`, `deadline_at`, destinations) | S | Invocations |
| E103 | Outbound webhooks | Account release webhooks and deliveries; webhook health and attempts | M | Webhooks |
| G119 | Log drains | Drain detail and delivery health; `datadog` kind | S | Logs › Drains |
| G122 | Custom metrics | List and define | S | App › Metrics |
| G125 | Alerts | Notification channels (beta, all paid plans, no flag), with `channel_ids` on rules; rule-form catch-up (about 24 metrics, baseline comparisons, `slo_id`, `synthetic_check_id`, `log_query`); alert detail | M | Alerts › Channels |
| G134 | Debug | Request replay and export, debug status, regression review | M | App › Debugger |
| G137 | App health assessment | Fold in or replace #125 | S | Overview |
| H152 | Budgets | Policies, projections, alerts and channels, automatic stops | M | Billing › Budgets |

## Wave 3: preview gaps

These are shown only when `/v1/capabilities` reports the capability, or offered
through "Join preview" when it is self-serve. They are ordered by customer
value: the products Gregale markets first, then the ones that follow from them.

| Order | Row | Capability | Gap to close | Size |
|---|---|---|---|---|
| 1 | F108 | Object storage (after #211) | Versioning toggle and version restore, lifecycle editing, CORS, tags, encryption, object lock, multipart uploads, upload routes, notifications and compute triggers, write receipts | L |
| 2 | F109 | Managed Postgres | Usage, compute cap and its `suspended` state, resize, compute policy, cutovers | M |
| 3 | E98, E99, E97 | Events and queues | Events hub: subscriptions, deliveries, schemas, acknowledgements, delivery controls, replays and recoveries. Unified dead-letter ledger. Trigger `delivery` mode and the `realtime` kind | L |
| 4 | F112 | Realtime | Endpoints, connections, occupancy, send and publish. The preview family (consumer groups, history, push) follows | L |
| 5 | B28–B31, B35–B37 | Release controls | Approvals and policy, freezes, gates, scheduled releases, route-health gate, mirror detail, alert-triggered rollbacks | L |
| 6 | A20 | Environments | Create, config, secrets and routes; promotions, approvals and rollback; release sets; GitOps | L |
| 7 | D68–D70 | Private networking | Private networks and peerings; TCP and UDP listeners | L |
| 8 | C55, C56, G168, G135 | Production debugging | Forks, crash snapshots, profile captures, debugger evidence. None of these has a CLI command, so the console is their first UI | M each |
| 9 | G127–G129 | Reliability | Issues workflow (policies, Linear, saved views), SLOs, synthetic checks | L |
| 10 | C54, F114, F115 | MCP and AI | MCP readiness and diagnostics; AI gateway routes, canaries, traces and tokens; integration binding budget and usage | L |
| 11 | E104, C53, C21, F110, C58, E101, D83 | The rest | Operations and work policies, disposable runs, app tasks, Data API usage, developer environments, inbox and outbox, OpenAPI diff and apply | S–M each |

## Gaps the ledger audit added

The first ledger PR audited every customer row against `main`. These gaps were
not in the wave tables above and join their tier's wave:

| Wave | Rows |
|---|---|
| 0 | A2 tarball deploys through `/v1/uploads` |
| 1 | E92 cron occurrences and command-run cancel; C47 health probes and restart policy shown (CLI command meanwhile) |
| 2 | A17 single-app deploy diff; A23 deploy queue controls; B34 release command status; C48 snapshot lifecycle hooks shown (CLI meanwhile); C50 warm pool and warm snapshots |
| 3 | A6 GitLab; A21 app tasks; D71 static egress IP; D81 async routes; D88 route monitor; E101 inbox and outbox; F111 durable entities; F113 live queries; G124 trace ingest settings; H147 application Auth; I160 management MCP server (CLI) |

## Out of scope

- **Internal tier (42 rows).** Includes feature flags, route requirements and
  the route advisor family, change timeline, service map, continuous profiling,
  durable entities, data pipelines, commit relay, signed deploys, platform
  tenants, API monetization, application standards, and automations authoring.
  - Pages the console already ships for internal capabilities (Customers and
    monetization, the automations editor, tenant surfaces) stay in place,
    behind the correct capability. They get no new work until faas moves them
    out of internal.
- **Operator and admin.** Section J, `/v1/admin`, operator routes, and the
  all-account audit log.
- **Agent, CI and SDK plumbing.** Uploads (beyond the move in 0.2, item 3), submissions and
  staging, OIDC exchange, SDK issue ingest, OTLP ingest, browser approval
  requests, field ownership, and GitHub bearer-only routes.
- **End-customer self-service.** `/v1/platform-tenant-self/*`, consumer
  self-billing and public signup.

## Every parity PR

- **Small.** One ledger row, or a few closely related rows, per PR, sized for a
  single reviewer.
- **Updates the ledger.** It moves its rows' `status` and `gap`, so `npm run
  parity` goes up.
- **Decided from the backend code.** Semantics come from faas `main`: handler,
  ADR, docs. The PR body has a "What the backend does" section with file:line
  references. Open questions are not left for the backend owner.
- **Test-first,** branching on `ApiError.code`, using tokens only, with dev
  mock routes for every new path.
- **Gated.** A preview or beta surface declares its `capability`, and its tests
  cover the off state.
- **Clicked through** in headless Chromium against the mock, at 1440px and
  390px, before review. This caught a security regression and layout bugs this
  month that the unit tests missed.
- **Uses the shared primitives:**
  - `CliCommand` where the console defers to the CLI;
  - `Timestamp` and `CopyableId` (#207);
  - `ProblemHelp` errors (#205);
  - `useConfirm` for destructive actions;
  - `queryPhase` for the four read states.
- **Documented.** It publishes the capability's customer doc page when faas has
  one that faas-web doesn't yet publish, subject to the docs manifest's rules.
- **Verified:**
  - `npm run check` exits 0, with no new lint warnings;
  - `npx vitest run --maxWorkers=8` exits 0 with no "Errors" line;
  - `npm run build` passes.

## Staying matched

- **A weekly drift run** (manual at first, a scheduled job later) pulls the spec
  and the capability inventory with `api:pull` and `capabilities:pull`. The
  ledger test then names every new or renamed row, and type errors name every
  contract change. Each one becomes a ledger entry with status `none`, and an
  issue.
- **The PR template** gains one line: "Ledger rows touched".
- **The parity number,** coverage by tier, is reported in each wave's closing
  PR.

## Done means

- Every GA and beta row is `full`, or `cli` with a reason.
- Every preview row is `full` or `partial` behind its gate.
- The ledger test, contract re-vendor and click-through pass on `main`.
- No console request 404s for a default account because a capability is
  missing.

## Risks

- **Review throughput.** One reviewer, with 26 PRs already open. Mitigations:
  land the backlog first, keep PRs small and unstacked, and keep the ledger as
  the progress signal, not the PR count.
- **Upstream pace.** faas moved 768 commits in the 8 days before this spec.
  Mitigations: the weekly drift run, and pulling `main` before starting each
  PR.
- **Tier changes.** Upstream recommends tiers "for owner review", so a row can
  move between tiers. The ledger keys rows by number and reads each row's tier
  from the vendored inventory, so a moved row changes its wave automatically.
- **Inventory and catalog disagree.** For example, Postgres is internal in the
  catalog but preview in the inventory, and workflows are preview in the
  catalog but beta in the inventory. The gate follows `/v1/capabilities`, which
  reflects what the account actually has. The ledger follows the inventory
  tier for priority.
