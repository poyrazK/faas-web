# Spending limits, slice 3: agents

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Spending limits page gets an **Agents** section: one row per connected agent with its monthly always-on budget, and in a company workspace an "Agent ceiling" row. An agent at its budget turns the status strip amber. Everything sits behind `featureFlags.agents`, so with the flag off nothing renders, no agent route is read, and the code folds out of the bundle.

**Spec:** `docs/superpowers/specs/2026-11-23-spending-limits-design.md`, "3. Agents" and the status strip's precedence list.

**Tech stack:** React 19, TanStack Query, Vitest and RTL, the Vite mock (`mock/agents.ts` already answers every agent route).

## Global Constraints

- **Routes** (all already in the vendored spec and the mock):
  - `GET /v1/agent-connections` (personal) and `GET /v1/orgs/{slug}/agent-connections` (company), read with `useAgentConnections(org)`.
  - `GET`/`PUT /v1/agent-connections/{id}/budget`. A colleague's agent answers 404, which is an answer, not a fault (`agent-page.tsx` `BudgetPanel`).
  - `GET /v1/orgs/{slug}/agent-policy` → `max_agent_budget_cents` (read with `useAgentPolicy(org)`).
- **Reuse, don't copy.** `BudgetDialog` moves out of `agent-page.tsx` into `agents/budget-dialog.tsx`, exported, and both the agent page and the new section use it. `budgetWords` and `agentName` from `src/lib/agents.ts`.
- **The flag.** `LimitsPage` renders `featureFlags.agents ? <AgentAwareStrip …/> : <StatusStrip …/>` and `{featureFlags.agents && <AgentsSection />}`. Hooks for agents only run inside components that only mount under the flag. The flag stays off in tests and in customer builds.
- **Status strip.** `BillFacts` gets an optional `agents?: AgentFact[]` (`{ name, spentCents, limitCents?: number }`). `billStatus` adds a "close" line per agent whose budget is **above $0 and reached**: "`{name}`’s changes now wait for you." It never outranks data loss or stopped workloads. `agents` undefined means "not counted", exactly as today.
- **Wait, don't guess.** With the flag on, the strip waits until the connection list and every budget read have answered (success or error). A failed or 404 budget read adds nothing to the strip.
- **Plain English.** Row sentences:
  - with a limit above $0: "Past $25.00 a month, each always-on change waits for your approval."
  - $0: "Every always-on change waits for your approval."
  - unlimited: "No limit: changes are never held for cost."
  - a colleague's agent (404): "Only {member} can see and change its budget." No meter, no action.
  - a failed read: neutral, "Couldn’t read this budget." plus Retry.
  - note line: `budgetWords(budget).source`.
- **Hidden when there are no agent connections** (personal or company), per the spec.
- **Agent ceiling row** (company only): "No agent acting in {label} may have a budget above $X a month." or "No ceiling: each agent’s own budget applies." Action: a link to `/dashboard/agents/policy`, "Change", where the existing policy editor lives.
- **Verify:** `npx tsc --noEmit`, `npm run lint` (2 known warnings), `npm run format:check`, `npx vitest run --maxWorkers=6`, `npm run build`.

## My calls

- **A $0 budget doesn't turn the strip amber.** It is Free's default, so every Free account with an agent would read "Close to a limit" forever. The row still says every change waits.
- **Agents at 80% don't count as close.** The spec's amber rule for agents is "at its budget"; the 80% rule is for bill limits.
- **The ceiling row links to the policy page** rather than editing inline, because the policy editor already handles roles, step-up and revocation counts.
- **Agents aren't personal-only after all:** the spec's §3 lists org connections and the ceiling, so a company workspace shows the organization's agents.

## Review Focus

1. Flag off: no Agents section, no `/agent-connections` request, strip unchanged (test in Task 3).
2. A colleague's agent never shows a meter or a Change button.
3. An agent at a $0 budget never turns the strip amber; an agent at $25 of $25 does, below a reached cap.
4. Switching Personal → company swaps the agent list (keys are per workspace already).

---

### Task 1: Agents in the status verdict

**Files:** modify `src/lib/limits.ts`; test `src/lib/limits.test.ts`.

- [ ] Failing tests:
  - `'an agent at its budget is close'`: facts fine + `agents: [{ name: 'Codex', spentCents: 2500, limitCents: 2500 }]` → tone warning, detail contains "Codex’s changes now wait for you."
  - `'a $0 agent budget is not close'`: limitCents 0 → unchanged mint.
  - `'a reached cap outranks an agent'`: stopped stays critical.
  - `'an unlimited agent adds nothing'`.
- [ ] Implement `AgentFact` and the close line.
- [ ] Commit `feat(console): an agent at its budget turns the limits strip amber`.

### Task 2: The Agents section

**Files:**

- Create `src/components/dashboard/agents/budget-dialog.tsx` (moved `BudgetDialog`), modify `agent-page.tsx` to import it.
- Modify `src/lib/api/agents.ts`: add `useAgentBudgetReads(ids)` returning `{ reads: Map<id, { data?, error, isPending, refetch }>, settled }`.
- Create `src/components/dashboard/limits/use-agent-facts.ts` and `limits/agents-section.tsx`.
- Test `limits/agents-section.test.tsx`.

- [ ] Failing tests:
  - `'lists each agent with its budget used'`: two agents, a meter for the one with a limit, the sentence and the source note.
  - `'a colleague’s agent says who can change it'`: 404 → "Only Ada can see and change its budget.", no meter, no Change.
  - `'Change opens the budget dialog and saves'`: PUT `/v1/agent-connections/{id}/budget` with `{ monthly_cents }`.
  - `'is hidden with no agents'`.
  - `'a company shows its agent ceiling'`: org workspace, policy `max_agent_budget_cents: 5000` → "No agent acting in Acme may have a budget above $50.00 a month." with a link to `/dashboard/agents/policy`.
- [ ] Implement.
- [ ] Run `npx vitest run src/components/dashboard/limits src/components/dashboard/agents`.
- [ ] Commit `feat(console): agents and their budgets on Spending limits`.

### Task 3: Wire it behind the flag

**Files:** modify `limits/limits-page.tsx`, `limits/status-strip.tsx` (`AgentAwareStrip`); test `limits/limits-page.test.tsx`.

- [ ] Failing tests:
  - `'with the agents flag off, nothing about agents renders or loads'`: no "Agents" heading, `GET /v1/agent-connections` never called.
  - `AgentAwareStrip` test: an agent at budget → "Close to a limit" naming it; while a budget read is pending the strip shows its checking state.
- [ ] Implement.
- [ ] Commit `feat(console): agents on Spending limits behind the agents flag`.

### Task 4: Gate, mock check, review, PR

- [ ] Full gate.
- [ ] Mock: `VITE_FEATURE_AGENTS=1 MOCK_API=1 npx vite`: personal and company `/dashboard/limits` screenshots; without the flag, no Agents section.
- [ ] Parity ledger row 1091's gap mentions Spending limits shows agent budgets behind the flag.
- [ ] Spec: §3 says shipped.
- [ ] Fresh review, one fix pass, PR.
