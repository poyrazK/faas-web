# Spending limits: every cap and budget on one page

**Status:** approved in chat on 2026-11-23 (mockup plus playback, "lgtm go on").

**Owner:** Bahadir.

## Intent

faas has many spending limits. The console shows two: the spend cap (on Usage) and account compute budgets (their own page). The rest can only be set through the API or CLI:

- the egress allowance, which stops apps;
- the object storage ceiling;
- agent budgets;
- consumer and tenant caps;
- integration and AI limits;
- organization budgets.

A customer whose apps just stopped, or who wants to avoid a surprise bill before launch, has nowhere to see all of them.

This design adds one **Spending limits** page under Billing. Every limit in faas lives there, and the page says first whether anything is stopped.

## Goals

- **One page, `/dashboard/limits`** ("Spending limits"). It replaces the Billing nav item "Budgets", and `/dashboard/budgets` keeps working.
- **The answer first.** A status strip says "Nothing is stopped", names the limit that's close, or says exactly what's stopped, why, and the one action that lifts it.
- **One row anatomy for every limit:**
  - a name;
  - a plain sentence saying what happens at the limit;
  - a meter of this month's (or today's) use against the limit, where faas reports use;
  - a state (mint for fine, amber for at or above 80% or "asks you", red for reached);
  - one action.
- **Sections in order of harm**, each described below:
  1. Your bill
  2. Alerts and budgets
  3. Agents
  4. Your customers
  5. Integrations and AI
- **Company workspaces** read and write the organization's cap, egress choice and budgets. Personal-only limits (agents) say so.
- **Plain English** per `docs/console-plain-english.md`; technical detail goes on request.

## Non-goals

- **Run budgets** (`/v1/run-controls/budgets/{kind}/{ref}`). faas has no list endpoint, so there's nothing to enumerate, and the console's vendored spec doesn't have the route yet. Leave them out until faas adds a list.
- **Not money limits:** route budgets (advisory latency), Postgres connection budgets, `streaming-cap`, and platform-tenant request ceilings (admitted-request counts, per their own description).
- **Rebuilding the budget editor.** The existing budget list, form, detail and preview components are reused as they are.
- **New backend work.** Everything reads and writes existing faas routes.

## Anti-goals

- A page that shows a limit as fine while it's actually reached, or a meter made up from a scalar faas doesn't report. If faas gives no current use for a limit, the row shows the limit with no meter.
- A wall of empty sections. A specialist section appears only when the account uses that feature.
- Moving the spend cap off Usage without leaving a way back. Usage keeps a one-line summary that links to the page.

## The page

### Status strip (top)

The strip picks the worst state across **Your bill** and **Agents**, in this order:

1. **Red — data is about to be lost:** object storage's `over_ceiling` block is present. "Files will be deleted on Dec 2: storage is 12 GiB over its 250 GiB ceiling." It says how to get back under (delete files, or ask support to raise the ceiling). Downloads are refused meanwhile (402 `account_bytes`).
2. **Red — something is stopped:**
   - spend cap reached, or a $0 cap: "Your apps are stopped: overage reached your $50 cap." Action: change the cap.
   - egress allowance reached with overage off: "Your apps are stopped: egress reached 500 GiB." Action: pay beyond, or view plans on Free.
3. **Amber — something is close:** any bill limit at or above 80%, or an agent at its budget ("Codex's changes now wait for you").
4. **Mint:** "Nothing is stopped", plus one line with the spend cap's use and the closest other limit.

The list numbering above is order of precedence: data loss, then stopped, then close, then fine.

**Organizations.** faas reports overage only for personal accounts (`/v1/usage/summary`). `/v1/orgs/{slug}/usage` has no overage figure; see `WorkspaceUsageSummary` in `org-billing.ts`. So in a company workspace:

- the spend cap row shows the cap with no meter: "Gregale doesn't report this organization's overage here. Workloads stop when it reaches $X";
- the strip never counts the cap as fine. Its mint line reads "No other limit is stopped", with no claim about the cap.
- Whether an organization owns its resources is not readable: faas exposes it only by refusing an organization budget save with 422 `financial_budget_activation_unavailable` (`handlers_financial_budgets.go`, `orgFinancialBudgetProblem`). So there is no note up front. The budgets section shows that refusal's own message when a save fails (slice 2).
- Reading `/v1/orgs/{slug}/billing/costs` to get an overage figure is out of scope, because even reading it needs session MFA.

### 1. Your bill

These are hard limits: at the limit, workloads stop.

| Row                | Limit and use                                                                                                                                                                                                                      | Action                                                                                                                                                                             | Source                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Spend cap**      | `overage_cap_cents` against the month's `overage_cents`                                                                                                                                                                            | Change (the existing `SpendCapEditor`, which already handles orgs and step-up). The forecast and cap history that `SpendControl` shows today go into this row's expandable detail. | `/v1/account/overage-cap` or `/v1/orgs/{slug}/overage-cap`; usage summary                 |
| **Egress**         | `included_egress_gb` against `used_egress_gb`; the sentence depends on `enabled` ("Stops at 500 GiB" vs "Pays $0.03 per GiB beyond 500 GiB, counted toward your spend cap")                                                        | Turn on / Turn off "pay beyond". Needs admin and a recent step-up, like the cap. On Free (`electable: false`) it's a plan upsell, not a hidden control.                            | `GET`/`PUT /v1/account/egress-overage` or `/v1/orgs/{slug}/egress-overage`; usage summary |
| **Object storage** | `policy.max_account_bytes` against `usage.observed_bytes`. The sentence says the ceiling comes from the plan and the spend cap. When `over_ceiling` is present, the row turns red with `excess_bytes` and `deletion_scheduled_at`. | None in-app ("Ask support to raise it"); when over the ceiling, a link to the account's buckets to delete files                                                                    | `/v1/account/object-storage-usage` (org: the org's object-storage-usage)                  |

- **Postgres** has no row of its own. A note under the spend cap says managed Postgres overage counts toward it and databases stop at it.
- The object storage row only appears when the `object-storage` capability is on, and the Postgres note only when `managed-postgres` is on.

### 2. Alerts and budgets

- The existing account budget list (`BudgetsPage` body: rows, status, add, detail, delete), shown as a section. The existing `budgets` capability gate applies to this section only.
- **In a company workspace** (shipped in slice 2): organization budgets through `/v1/orgs/{slug}/billing/budgets[/{id}]`, its `/revisions` and `/preview`, which take the same bodies (faas `docs/billing.md`, "Organization budgets"). Org budgets notify and stop previews; strict budgets aren't offered for orgs, so the form hides strict mode there. Org alerts go to the organization's billing contact, and notification channels stay with account budgets, so the org form hides channels.

### 3. Agents

Shipped in slice 3 (`docs/superpowers/plans/2026-11-24-spending-limits-slice-3.md`), behind the `agents` flag.

- One row per agent connection (`GET /v1/agent-connections`).
- The budget comes from `GET /v1/agent-connections/{id}/budget`: `monthly_cents`, `spent_cents`, `source`, `key_unlimited`.
- The sentence explains `source`, for example "Default: half your plan's default cap". Past the budget, each change waits for a person's approval.
- **Change** offers: set an amount, unlimited, or back to default (`PUT`/`POST` per faas).
- Hidden when the account has no agent connections.
- **In a company workspace:** an "Agent ceiling" row shows the organization's highest agent budget (`max_agent_budget_cents`, the org agent policy in PR #394). A member agent's row reports `source: org_ceiling` and `org_max_cents` when that ceiling binds.
- Builds on the agent budget hooks, editor and mocks from PR #386 (merged), not a second copy.
- The whole section, the org agent-ceiling row included, sits behind the `agents` build flag (`featureFlags.agents`, off by default) like the Agents pages. With the flag off it doesn't render, and the status strip ignores agents.

### 4. Your customers

- Folded by default, and shown only when the `platform-tenants` capability is on or any app has API consumers.
- **Tenants:** `GET /v1/account/platform-tenants`, then each tenant's `GET .../spend-cap` (`monthly_cap_millicents`, `amount_due_millicents`, `capped`). Set or clear with `PUT`/`DELETE`.
- **Consumers:** consumer caps are per app, so the section has an app picker (`AppSelect`, as other per-app pages do), lists that app's consumers (`useConsumers`) with each one's `GET .../spend-cap`, and sets or clears with `PUT`/`DELETE`.
- At the cap, faas answers that customer with 402 `consumer_spend_cap_reached` or `tenant_spend_cap_reached`. The sentence says so in plain words.

### 5. Integrations and AI

- Folded by default, and shown only when the `outbound-integrations` capability is on and at least one integration exists.
- **Per integration**, from the list:
  - `daily_request_limit`, against today's count (`usage.daily_request_count`, as `integrations-body.tsx` already reads);
  - `ai_daily_token_limit`, `ai_daily_cost_limit_millicents`, `ai_monthly_cost_limit_millicents`.
- **Per-tag AI cost limits** come from `GET`/`PUT .../ai-tag-limits`.
- **Per app binding**, behind an app picker: `daily_request_limit` and `ai_daily_token_limit` (`GET /v1/apps/{slug}/outbound-bindings`; set with `PUT .../budget` and `PUT .../ai-budget`).
- **Editing:** request and token limits link to the existing integration detail or binding editor where one already edits them. Only per-tag cost limits get a new editor here.
- All these writes need MFA and deploy-write scope.

## Elsewhere in the console

- **Navigation:** in `nav-config.ts`, the Billing group item `Budgets` (PiggyBank, `capability: 'budgets'`) becomes `Spending limits` → `/dashboard/limits`, with no capability gate on the item. Add it to ⌘K, the breadcrumb and `isAccountPath()`.
- **Redirects:** `/dashboard/budgets` redirects to `/dashboard/limits#budgets`, keeping any search params the budget detail uses.
- **Usage page:** the `SpendControl` panel is replaced by a one-line "Spending limits" summary (the status strip's sentence and an "Open spending limits" link).
- **Head:** `consoleHead('limits')`.

## Decided in chat

- One page under Billing, sections in the order above, with folded specialist sections that show only when used. The mockup is in the 2026-11-23 conversation.
- The spend cap moves there from Usage; Usage keeps a summary.

## My calls (check these)

- **Run budgets are left out** until faas has a list endpoint.
- **The existing editors are reused**, not rebuilt. Request and token limits link to the existing integration and binding editors rather than editing inline.
- **Amber at 80%** for every meter, matching `capStanding`.
- **Data loss ranks above stopped workloads** in the strip, so storage that's about to be deleted outranks a reached cap.
- **Organizations get no cap verdict**, because their overage isn't reported. Ownership surfaces only as faas's refusal on a budget save, so there's no up-front note.
- **Company workspaces get an agent-ceiling row.**
- **Agents stay behind the `agents` flag** until launch, as Bahadir asked on 2026-11-23.
- **The route is `/dashboard/limits`**, and the nav label is "Spending limits".

## Left to the builder

- Component structure, file names and the order of slices. Suggested slices:
  1. page shell, status strip, Your bill, nav, redirect and Usage summary;
  2. budgets, including org budgets;
  3. agents;
  4. customers;
  5. integrations and AI.
- Loading, empty, error and unreachable states, through `queryPhase()`. Each section loads on its own and fails on its own.
- Whether the org usage summary reports egress use. If it doesn't, the org Egress row shows the election with no meter.
- Mock fixtures for the new routes in `mock/`, plus `mock-spec-drift` coverage. Some routes may need `npm run api:pull` first.
- Updating the parity ledger rows for the capabilities this completes.
