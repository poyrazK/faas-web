# Environment scope, slice 3c: upstreams and Postgres bindings follow the environment

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** In Staging, an app's Upstreams list and declare Staging's placement hints, and connecting a Postgres database to an app writes its credential into Staging's scope. Production keeps today's requests.

**What faas does (source):**

- **Upstreams** (`pkg/apid/apidserver/handlers_upstreams.go`, ADR-098 deployment-scope overlay) carry `scope` (the env-var scope) and `deployment_scope`, the deployment the hint is about. `deployment_scope` is part of the dedupe key, so Staging's and production's rows never collide. Both default to `default`.
  - **List filter:** the list takes the documented `?deployment_scope=<scope>`; omitted means every deployment.
  - **Server flag:** behind `FAAS_DATA_PLACEMENT`, which is off by default.
- **Postgres bindings:** `CreateManagedPostgresBindingRequest.scope` is the env scope the credential secret is written into. A staging deployment reads scope `staging` (the same rule as slice 3a).

**Spec:** `docs/superpowers/specs/2026-11-21-environment-scope-design.md`, the "Upstreams" and "Postgres bindings (app)" rows.

## Global Constraints

- **Production upstreams:** `GET /v1/apps/{slug}/upstreams` stays unchanged. Rows whose `deployment_scope` is another environment's are hidden client-side, so production shows only `default` / `production` / absent.
- **Staging upstreams:** list with `query: { deployment_scope: <env> }` and cache under `['apps', slug, 'upstreams', env]`. Declare sends `deployment_scope: <env>` in the body.
- **Postgres "Connect an app":** inside a project in a non-production environment, the scope field starts at that environment's slug instead of `default`. Production is unchanged.
- **Protected stage:** on Upstreams there's no declare or remove. A protected stage's lock fails closed until the environment list or state says it isn't protected. That comes from `useAppEnvironment` for per-app pages.
- **Copy:** the upstreams note is "Showing Staging's upstreams." The binding sheet adds the hint "Staging's scope: the credential reaches Staging's deployments."
- **Verify:** `npx tsc --noEmit`, `npm run lint` (2 known warnings), `npm run format:check`, `npx vitest run --maxWorkers=6`, `npm run build`.

## Review Focus

- **Declaring an upstream in Staging** sends `deployment_scope: 'staging'`, and Staging's list reads `deployment_scope=staging`. Test in Task 1.
- **A Staging upstream** never shows on production's list. Test in Task 1.
- **Protected stage:** no declare or remove on Upstreams. Test in Task 1.
- **Connecting a database in Staging** writes `scope: 'staging'` by default. Production still defaults to `default`. Test in Task 2.

---

### Task 1: Upstreams follow the environment

**Files:**

- `src/lib/api/queries.ts`:
  - `useUpstreams(slug, deploymentScope?)` lists with the filter and its own cache key when the scope is set.
  - In production (no scope) it filters out rows whose `deployment_scope` is another environment's.
  - `useAddUpstream(slug, deploymentScope?)` and `useDeleteUpstream(slug, deploymentScope?)` invalidate the matching key; production invalidates the prefix.
- `src/components/dashboard/pages/upstreams.tsx`: `UpstreamsBody({ slug, scope?, readOnly? })` sends `deployment_scope` on declare, hides declare and remove when read-only, and shows the note.
- `src/routes/dashboard.apps.$appSlug.tsx`: the Upstreams tab is wrapped in `EnvironmentValuesGate`, passing `scope` and `readOnly`.
- **Tests:** hook tests in `src/lib/api/app-values-scope.test.tsx`; page tests in a new `src/components/dashboard/pages/upstreams-environment.test.tsx`.

- [ ] **Step 1: Failing tests:**
  - "Staging lists upstreams with deployment_scope=staging and declares with it";
  - "production lists as before and hides other environments' rows";
  - "a protected stage shows upstreams without declare or remove".
- [ ] **Steps 2–5:** run, see them fail, implement, run, see them pass, then commit `feat(console): upstreams follow the environment`.

### Task 2: Postgres "Connect an app" starts in the environment's scope

**Files:**

- `src/components/dashboard/postgres.tsx`: the `Bindings` scope state starts at `useEnvironmentScope()`'s environment when it applies and isn't production; otherwise `default`. Show the hint under the field.
- **Tests:** `src/components/dashboard/postgres.test.tsx`.

- [ ] **Step 1: Failing tests:**
  - "in Staging, connecting an app writes Staging's scope by default";
  - "production still defaults to the default scope".
- [ ] **Steps 2–5:** run, see them fail, implement, run, see them pass. Then the whole gate, then commit `feat(console): connecting a database in Staging writes Staging's scope`.
