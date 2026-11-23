# Environment scope, slice 3b: scheduled requests and route traffic follow the environment

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** In Staging, the Scheduled requests page lists and creates Staging's crons, and an app's Routes tab shows Staging's route traffic. Production behaves exactly as today.

**Why these two first:** the faas API is unambiguous for both.

- A cron carries an immutable `environment` field: `CreateCronRequest.environment` and `CronResponse.environment`, where omitted means production (faas ADR-20261104120000).
- `GET /v1/apps/{slug}/routes` takes `?environment=<named env>`.

Upstreams take an undocumented `scope` alongside the documented `deployment_scope` filter, and Postgres bindings are created from the account-wide Postgres drawer. Both move to slice 3c, after their semantics are read from source.

**Spec:** `docs/superpowers/specs/2026-11-21-environment-scope-design.md`, the "Jobs › scheduled requests (crons)" and "Routes (app tab)" rows.

## Global Constraints

- **Production:** no `?env=` means today's requests: `GET /v1/crons`, cron create without `environment`, routes without `environment`.
- **Cron list:** filtered client-side (`/v1/crons` has no environment query). In production, show crons whose `environment` is absent or `production`. In another environment, show crons whose `environment` equals it.
- **Cron create:** a non-production environment sends `environment: <slug>`. The field is immutable, so edit never sends it.
- **Protected stage:** Scheduled requests hides create, edit, enable or disable, delete and fire-now, and shows the read-only note.
- **Copy:** the note reads "Showing Staging's scheduled requests." Routes reads "Route traffic in Staging." Read-only reads "Staging is protected: changes go through a promotion."
- **Verify:** `npx tsc --noEmit`, `npm run lint` (2 known warnings), `npm run format:check`, `npx vitest run --maxWorkers=6`, `npm run build`.

## Review Focus

- **Creating a cron in Staging** sends `environment: 'staging'` and the new cron appears in Staging's list, not production's. Test in Task 1.
- **A production cron** never appears on the Staging page, and the reverse. Test in Task 1.
- **A protected stage:** no write control on Scheduled requests. Test in Task 1.
- **Routes in Staging** request `environment=staging` and cache apart from production. Test in Task 2.

---

### Task 1: Scheduled requests follow the environment

**Files:**

- `src/components/dashboard/jobs-scheduled.tsx`: filter rows by environment, send `environment` on create, `readOnly`, and the note.
- `src/components/dashboard/environment-values-gate.tsx`: export `EnvironmentNote({ name, readOnly, children? })`, the note the gate already draws, reused here.
- Tests: the existing jobs-scheduled test file, or a new `jobs-scheduled-environment.test.tsx`.

**Interfaces:**

- **Consumes:** `useEnvironmentScope()`, with `environment`, `choices[].protected`, `name` and `applies`.
- **Produces:** `export function EnvironmentNote({ name, readOnly, children }: { name: string; readOnly: boolean; children?: ReactNode })`.
- **Helper:** `export function cronInEnvironment(cron: { environment?: string }, environment: string): boolean` in `jobs-scheduled.tsx` or a small words module.

- [ ] **Step 1: Failing tests:**
  - "production lists only production crons";
  - "Staging lists only Staging's crons and says so";
  - "creating in Staging sends environment: staging";
  - "a protected stage shows crons without write controls";
  - unit tests for `cronInEnvironment`.
- [ ] **Steps 2–5:** run them and see them fail, implement, run them and see them pass, then commit `feat(console): scheduled requests follow the environment`.

### Task 2: Route traffic follows the environment

**Files:**

- `src/lib/api/queries.ts`: `useAppRoutes(slug, environment?)`. When the environment is set, send `query: { environment }` and key the cache `['apps', slug, 'routes', environment]`.
- `src/components/dashboard/pages/routes.tsx`: `RoutesBody` takes `environment?: string` and shows "Route traffic in Staging." when it's set.
- `src/routes/dashboard.apps.$appSlug.tsx`: the Routes tab passes `useAppEnvironment(fn.id).scope`.
- Tests: `src/lib/api/app-values-scope.test.tsx` for the hook, and the routes page test for the note.

- [ ] **Step 1: Failing tests:**
  - "routes read with environment=staging in Staging and without it in production, cached apart";
  - "the Routes tab says it shows Staging's traffic".
- [ ] **Steps 2–5:** run them and see them fail, implement, run them and see them pass, run the whole gate, check in the mock, then commit `feat(console): route traffic follows the environment`.
