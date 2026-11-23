# Environment scope, slice 3a: env vars and secrets edit the selected environment

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** In Staging, an app's Variables and Secrets read and write Staging's own values (`?scope=staging`). Production pages send exactly what they send today. An app that isn't in Staging says so instead of showing production. A protected stage is read-only. Actions that have no environment are hidden outside production.

**Architecture:**

- **Scoped hooks:** `useAppEnv`, `useSetEnv`, `useDeleteEnv`, `useAppSecrets`, `useSetSecret`, the secret delete hook and `useRotateSecret` take an optional `scope`. When it's set they send `query: { scope }` and key their cache under `[...keys.appX(slug), 'scope', scope]`, the shape `secret-references.ts` already uses.
- **`useAppEnvironment(slug)`** in `lib/environment-scope.ts` says, for one app, whether the environment in force has it and whether that environment is protected.
- **The app page's Environment tab** shows an editing note, the "isn't in Staging yet" state, or the read-only state, and passes `scope` and `readOnly` to `EnvBody` and `SecretsBody`.

**Spec:** `docs/superpowers/specs/2026-11-21-environment-scope-design.md`:

- the "Env vars, app secrets (app tabs)" row;
- the Decided bullets "Production keeps today's requests", "Protected non-production environments are read-only" and "Apps follow the environment".

## Global Constraints

- **Scope:** production (`scope` undefined) sends no `scope` param and keeps today's query keys byte-for-byte. Staging sends `scope=<env slug>` on every env and secrets read and write, rotate included.
- **No environment in the API:** these actions are hidden outside production, never sent to production from a Staging page:
  - restart, plus the "fresh restart" offer after a secret change (`POST /v1/apps/{slug}/restart`);
  - env compare (`GET /v1/apps/{slug}/env-diff`).
- **Copy:**
  - the editing note: "Editing Staging. Production keeps its own values.";
  - an app missing from the environment: "<app> isn't in Staging yet. Deploy it there with `gregale deploy --environment staging`.";
  - a protected stage: "Staging is protected: changes go through a promotion."
  - Sentence case, no "please".
- **Styling:** no literal hex, no `dark:`. The stage tint comes from `--status-warning`.
- **Verify:** `npx tsc --noEmit`, `npm run lint` (2 known warnings), `npm run format:check`, `npx vitest run --maxWorkers=6`, `npm run build`.

## Review Focus

- **Saving a variable in Staging** must send `scope=staging` and must not invalidate or overwrite production's cached list. Test in Task 1.
- **Deleting a secret in Staging:** the optimistic removal must touch Staging's cache key, not production's. Test in Task 1.
- **An app whose project has no Staging workload for it:** the tab must say "isn't in Staging yet" and must read no env or secrets. Test in Task 3.
- **A protected stage:** no add, edit, delete, rotate or import controls. Test in Task 3.
- **Production:** the page is unchanged (no note, the same requests). Test in Task 3.

---

### Task 1: Scoped env and secrets hooks

**Files:** `src/lib/api/queries.ts` (the env and secrets hooks, and the secret delete or revoke hook wherever it lives); tests in a new `src/lib/api/app-values-scope.test.tsx`.

**Interfaces:**

- **Produces:** the existing signatures, each with an extra last parameter `scope?: string`:
  - `useAppEnv(slug, scope?)`, `useSetEnv(slug, scope?)`, `useDeleteEnv(slug, scope?)`;
  - `useAppSecrets(slug, scope?)`, `useSetSecret(slug, scope?)`, `useRotateSecret(slug, scope?)`;
  - the delete or revoke secret hook gets the same treatment.
- **Exported for later tasks:** `appValuesKey(kind: 'env' | 'secrets', slug: string, scope?: string)`.

- [ ] **Step 1: Failing tests** (via `spyApi`, rendered with `renderHook` and a QueryClient wrapper):
  - "reads and writes production with no scope, as before" asserts params `{ path: { slug: 'api' } }` with no `query`.
  - "reads and writes Staging with scope=staging" covers GET env, PUT env, DELETE env, GET secrets, PUT secret, rotate and delete, each with `query: { scope: 'staging' }`.
  - "a Staging write leaves production's cached list alone" seeds `keys.appEnv('api')` data, runs a Staging `useSetEnv`, and asserts production's cache was neither refetched nor changed.
- [ ] **Step 2:** run them and see them fail.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** run `npx vitest run src/lib/api/` and expect PASS.
- [ ] **Step 5:** commit `feat(console): env and secrets hooks take an environment scope`.

### Task 2: `useAppEnvironment(slug)`

**Files:** `src/lib/environment-scope.ts`; tests in `src/lib/environment-scope-hook.test.tsx`.

**Interfaces:**

- **Consumes:** `useEnvironmentScope()` and `useEnvironmentState(accountId, project, environment)`.
- **Produces:**

```ts
export interface AppEnvironment {
  /** The scope to send: undefined in production (today's requests). */
  scope: string | undefined;
  name: string;
  kind: EnvironmentKind;
  /** Whether the environment in force has this app; null while unknown; always true in production. */
  present: boolean | null;
  /** True for a protected non-production environment: read-only in the console. */
  readOnly: boolean;
}
export function useAppEnvironment(slug: string): AppEnvironment;
```

- **Rules:**
  - Outside a project, or where environments don't apply, it behaves as production: `scope` undefined, `present` true, `readOnly` false.
  - `present` is true when the environment's state lists a workload with `workload_slug === slug`.

- [ ] **Step 1: Failing tests:**
  - "production: no scope, present, editable";
  - "staging: scope=staging, present when the environment runs the app";
  - "staging without the app: present false";
  - "a protected stage is read-only";
  - "where environments don't apply it behaves as production".
- [ ] **Steps 2–5:** run, see them fail, implement, run and see them pass, then commit `feat(console): useAppEnvironment says whether an environment has an app`.

### Task 3: The Environment tab edits the selected environment

**Files:**

- `src/components/dashboard/pages/env.tsx` and `src/components/dashboard/pages/secrets.tsx`: `EnvBody` and `SecretsBody` take `scope?: string` and `readOnly?: boolean`.
  - **`readOnly`:** hides add, edit, delete, rotate and import.
  - **`scope` set:** hides compare and the restart offer.
- `src/routes/dashboard.apps.$appSlug.tsx`, in the Environment tab:
  - `present === false` → the "isn't in Staging yet" state, with no bodies mounted.
  - Otherwise an editing note (stage tint) when `scope` is set, and the read-only note when `readOnly`.
  - `scope` and `readOnly` are passed to both bodies.
- `src/routes/dashboard.env.tsx` and `src/routes/dashboard.secrets.tsx` get the same, via `useAppEnvironment(slug)`.
- **Tests:** `env.test.tsx` and `secrets.test.tsx` if they exist, otherwise new ones next to the bodies; plus an app-page test for the tab states.

- [ ] **Step 1: Failing tests:**
  - "in Staging the variables list reads scope=staging and says it edits Staging";
  - "an app not in Staging shows how to deploy it there and reads nothing";
  - "a protected stage shows values without edit controls";
  - "Staging hides compare and the restart offer";
  - "production is unchanged" (no note, no `scope` in requests).
- [ ] **Steps 2–4:** run, see them fail, implement, run and see them pass.
- [ ] **Step 5:** run the whole gate, check in the mock (`/dashboard/apps/api-gateway?project=acme-shop&env=staging`, Environment tab), then commit `feat(console): variables and secrets edit the selected environment`.
