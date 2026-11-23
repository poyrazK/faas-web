# Spending limits, slice 5: integrations and AI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Spending limits page gets an **Integrations and AI** section, folded by default. For each outbound integration it shows:

- its daily request limit against today's count;
- for AI integrations, the daily token limit and the daily and monthly cost limits, against today's and this month's use;
- the per-tag daily cost limits, with an editor.

**Spec:** `docs/superpowers/specs/2026-11-23-spending-limits-design.md`, "5. Integrations and AI".

## Global Constraints

- **Routes** (all in the vendored spec):
  - `GET /v1/outbound/integrations`: list, with `daily_request_limit`, `ai_daily_token_limit`, `ai_daily_cost_limit_millicents` and `ai_monthly_cost_limit_millicents`.
  - `GET /v1/outbound/integrations/{integration}/usage`: `daily_request_count`, `daily_request_limit` and `resets_at`, read with `useOutboundUsages`.
  - `GET /v1/outbound/integrations/{integration}/ai-usage`: `items[].daily_token_count`/`daily_token_limit`, plus `daily_cost_millicents`/`daily_cost_limit_millicents` and `monthly_cost_millicents`/`monthly_cost_limit_millicents`, read with `useOutboundAIUsage`.
  - `GET`/`PUT /v1/outbound/integrations/{integration}/ai-tag-limits`: `{ limits: [{ tag, daily_cost_limit_millicents }] }`. An empty list removes every limit. It needs MFA and deploy-write scope.
- **Where it shows:** only when `outbound-integrations` is on and at least one integration exists. Integrations belong to the signed-in account (`/v1/outbound` ignores the workspace). In a company workspace the section shows one quiet line instead: "Integrations belong to your personal account. Switch to Personal to see their limits."
- **Folded by default:** a `<details>` whose summary names how many integrations and how many limits are close or reached ("3 integrations · 1 at its limit").
- **Rows** (`LimitRow`, one per limit that exists):
  - **Requests**: "Requests stop at 10,000 a day; the gateway answers 429." A meter of today's count, plus "resets at 00:00 UTC". With no limit: "No daily request limit."
  - **AI tokens**: "Calls stop once today’s tokens reach 2,000,000."
  - **AI cost today** and **AI cost this month**: "Calls stop at $20.00 a day." / "Calls stop at $300.00 this month."
  - A meter only where faas reports the use. A limit with no reported use shows no meter.
- **Editing:**
  - Request and token limits link to `/dashboard/integrations`, where the existing editors live. The token limit has no editor after creation, so its row has no action.
  - **Per-tag cost limits** get a small editor: tag plus dollars a day, with add, remove and save. It replaces the whole list with `PUT`. A refusal (`mfa_required`, `forbidden`, validation) shows apid's message.
- **Mock:** `GET`/`PUT ai-tag-limits` in `mock/plugin.ts`, kept per integration in memory, plus `mock-spec-drift` coverage.
- **Parity:** the outbound-integrations ledger row's gap no longer lists tag limits.
- **Verify:** the full gate.

## My calls

- **The status strip ignores integrations.** The spec's strip reads Your bill and Agents only. An integration at its limit is refused with 429; it doesn't stop workloads.
- **App bindings' limits stay on each app's Integrations tab.** They are per app and need an app picker; the spec lists them, but the binding editor already shows them where they're set. The section links there in its help.
- **No editor for AI token or cost limits** in this slice: faas sets them through `PUT …/ai` (the AI policy), which the console doesn't edit yet anywhere. The rows say what's set.
- **A company workspace shows nothing**, per CLAUDE.md (never show personal figures in a company workspace); a note would be noise for companies whose members have no integrations.

## Tasks

### Task 1: Hooks and mock for tag limits

- [ ] Failing test in `src/lib/api/outbound-tag-limits.test.tsx`: `useAITagLimits(accountId, id)` GETs the route; `useSetAITagLimits` PUTs `{ limits }` and updates the cache.
- [ ] Implement in `src/lib/api/outbound.ts`. Add mock routes, and confirm `mock-spec-drift` passes.
- [ ] Commit.

### Task 2: Pure row model

- [ ] Failing tests in `src/lib/integration-limits.test.ts`: `integrationLimitRows(integration, usage?, aiUsage?)` returns `{ key, name, sentence, meter?, tone? }[]` covering:
  - request limit with and without usage;
  - no limit;
  - AI token, daily cost and monthly cost;
  - unreported use, which gets no meter;
  - the summary counts.
- [ ] Implement. Commit.

### Task 3: The section

- [ ] Failing tests in `limits/integrations-section.test.tsx`:
  - hidden with no integrations;
  - folded by default, with a summary count;
  - rows per integration;
  - the tag editor saves with `PUT` and shows apid's refusal;
  - a company workspace shows the note and reads no `/v1/outbound` route.
- [ ] Implement `IntegrationsSection` behind `CapabilityGate`-style access, without the panel noise. Wire it into `LimitsPage` after budgets (and after agents).
- [ ] Commit.

### Task 4: Gate, mock check, review, PR
