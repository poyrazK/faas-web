# Environment scope, slice 1: the `?env=` scope, the top-bar pill and the amber line

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inside a project the console is always in one environment, named in the URL as `?env=`, shown by a tinted pill in the top bar, and marked by a 2px amber line across the top whenever it is not production.

**Architecture:** A small `lib/environment-scope.ts` owns the URL contract (validation, the search middleware that keeps `?env=` while you stay in a project and drops it when you leave or switch project) and a `useEnvironmentScope()` hook that combines the URL with the project scope and the project's environment list. `environment-switcher.tsx` renders the pill, its dropdown and the line from that hook. No page reads or writes a scoped environment yet; that is slice 3.

**Tech Stack:** React 19, TanStack Router (search middlewares) and Query, Tailwind 4, Radix dropdown (`@/components/ui/dropdown-menu`), Vitest + RTL.

**Spec:** `docs/superpowers/specs/2026-11-21-environment-scope-design.md`

## Global Constraints

- No `?env=` means production. Production pages send exactly the requests they send today.
- The environment comes only from the URL. Nothing is remembered in storage.
- The pill and the line never appear on account pages (`isAccountPath`), outside a project, for `?project=_standalone`, or in a company workspace (`useWorkspaceTarget().org` set).
- Colours: production uses `--status-good`, every stage `--status-warning`, previews neutral (`--muted-foreground`). No literal hex and no `dark:` (pinned by `src/lib/conventions.test.ts`). A new token, if one is needed, is defined in both `:root` and `.console`.
- Copy: "Production", "Staging" (the slug capitalised), dropdown statuses like "Protected · 3 live" and "Nothing deployed", the item "Compare environments". Sentence case, no "please", no "successfully".
- The line is 2px, full viewport width, at the very top, fixed, above the top bar, `aria-hidden`. The pill carries the accessible meaning.
- Verify with `npx tsc --noEmit`, `npm run lint` (the 2 known warnings only), `npm run format:check`, `npx vitest run --maxWorkers=6`, `npm run build`.

## Review Focus

- **`?env=` naming an environment the project doesn't have** (a stale link, a deleted stage). Expect the pill to read "<Name> · not in this project" in the warning style, with the dropdown still listing the real environments. Never fall back to production silently. Test in Task 3.
- **Switching project while in Staging.** Expect the new project to open in production (`?env=` dropped), because the other project may have no `staging`. Test in Task 1.
- **The environment list loading or failing.** Expect the pill to show the URL's name with no status, and the dropdown to say "Loading environments…" or "Environments could not be read" with a Retry. Never a guessed list. Test in Task 3.
- **Leaving the project** (logo, Back to Overview, All projects, an account page). Expect `?env=` gone and no line. Test in Task 1 (middleware) and Task 4 (no line on account pages).
- **A project page path without `?project=`** (`/dashboard/projects/shop?env=staging`). Expect the pill to read Staging and links from that page into the project rail to keep `?env=staging`. Test in Task 1.

---

### Task 1: The `?env=` URL contract

**Files:**
- Create: `src/lib/environment-scope.ts`
- Create: `src/lib/environment-scope.test.ts`
- Modify: `src/routes/dashboard.tsx` (the `validateSearch` and `search.middlewares` of the `/dashboard` route)

**Interfaces:**
- Produces:
  - `validateEnvironmentSearch(search: Record<string, unknown>): { env?: string }`: keeps `env` only when `validEnvironment(env)` (from `@/lib/api/projects`) holds and `env !== 'production'`. Production is the absence of the param, so `?env=production` normalises away.
  - `retainEnvironment: SearchMiddleware<{ project?: string; env?: string }>`: keeps the current `env` on a navigation unless the navigation (a) sets `env` explicitly (including to `undefined`), (b) explicitly clears `project`, or (c) sets `project` to a defined value different from a defined current `project`. A current `project` of `undefined` (a project page path) counts as "same project", so links out of `/dashboard/projects/shop?env=staging` keep it.
  - `environmentKind(slug: string, environment?: ProjectEnvironment): 'production' | 'stage' | 'preview'`: `production` for `'production'`, `preview` when `environment?.branch` is set, else `stage`.
  - `environmentName(slug: string): string`: the slug with its first letter capitalised (`staging` → `Staging`). Slice 2 points `projects/environment-words.ts` (from #390) at this one.

- [ ] **Step 1: Write the failing tests**

In `environment-scope.test.ts`, unit tests for `validateEnvironmentSearch`, `environmentKind` and `environmentName`. Then a router test using `createMemoryHistory` with a `/dashboard` route that uses the real `validateSearch` and middlewares, and children `/dashboard/releases`, `/dashboard/projects/$projectSlug` and `/dashboard/usage`. It asserts the resulting `router.state.location.search` after `router.navigate`:

```ts
it('drops production and anything that is not an environment slug', () => {
  expect(validateEnvironmentSearch({ env: 'staging' })).toEqual({ env: 'staging' });
  expect(validateEnvironmentSearch({ env: 'production' })).toEqual({});
  expect(validateEnvironmentSearch({ env: 'Bad Slug!' })).toEqual({});
  expect(validateEnvironmentSearch({})).toEqual({});
});
it('keeps ?env= while moving inside the project', async () => {
  // from /dashboard/releases?project=shop&env=staging to /dashboard/usage with search: (s) => s
  // expect env 'staging' kept
});
it('keeps ?env= on links out of a project page path', async () => {
  // from /dashboard/projects/shop?env=staging to /dashboard/releases search { project: 'shop' }
  // expect { project: 'shop', env: 'staging' }
});
it('drops ?env= when switching to another project', async () => {
  // from /dashboard/releases?project=shop&env=staging, navigate search { project: 'tools' }
  // expect no env
});
it('drops ?env= when leaving the project', async () => {
  // navigate to /dashboard with search { project: undefined } -> no env
});
it('lets a link set or clear the environment explicitly', async () => {
  // search { env: 'preview-42' } -> 'preview-42'; search { env: undefined } -> no env
});
it('names environments and tells production, stages and previews apart', () => {
  expect(environmentName('staging')).toBe('Staging');
  expect(environmentKind('production')).toBe('production');
  expect(environmentKind('staging', { branch: undefined } as never)).toBe('stage');
  expect(environmentKind('pr-42', { branch: { name: 'feat/x' } } as never)).toBe('preview');
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `npx vitest run src/lib/environment-scope.test.ts`
Expected: FAIL, the module does not exist.

- [ ] **Step 3: Implement `environment-scope.ts` (the pure parts) and wire the route**

In `dashboard.tsx`, spread `...validateEnvironmentSearch(search)` into `validateSearch` and set `middlewares: [retainSearchParams(['project']), retainEnvironment]`. Before writing the middleware, read `node_modules/@tanstack/router-core/dist/esm/searchMiddleware.js`: `retainSearchParams` learns about explicit keys from `next(search, true)` and its `meta.explicit` / `meta.removed`. `retainEnvironment` uses the same mechanism to tell "the link didn't mention env" from "the link cleared env". Keep the comment on the route accurate: project and environment both ride along.

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run src/lib/environment-scope.test.ts src/components/dashboard/navigation.test.tsx src/routes/-dashboard.projects.test.tsx`
Expected: PASS. The existing navigation and projects tests still pass, so project retention is unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/lib/environment-scope.ts src/lib/environment-scope.test.ts src/routes/dashboard.tsx
git commit -m "feat(console): ?env= scope that stays inside a project"
```

### Task 2: `useEnvironmentScope()`

**Files:**
- Modify: `src/lib/environment-scope.ts`
- Test: `src/lib/environment-scope.test.ts`

**Interfaces:**
- Consumes: `useProjectScope()` (`@/lib/project-scope`), `isAccountPath`, `STANDALONE`, `useProjectEnvironments(accountId, slug)` (`@/lib/api/projects`), `useAuth()`, `useWorkspaceTarget()`, `useRouterState`.
- Produces:

```ts
export interface EnvironmentScope {
  /** False where environments don't apply (account pages, no project, standalone, company workspace). */
  applies: boolean;
  /** The environment slug in force: the URL's, else 'production'. */
  environment: string;
  kind: 'production' | 'stage' | 'preview';
  name: string;
  /** The project's environments, production first then by name; null while loading or on error. */
  choices: ProjectEnvironment[] | null;
  /** True when choices loaded and include `environment`; null while unknown. */
  available: boolean | null;
  /** The list query, for the dropdown's loading, error and retry states. */
  list: { isPending: boolean; isError: boolean; refetch: () => void };
}
export function useEnvironmentScope(): EnvironmentScope;
```

`environment` is read from the location's `env` search param through `validateEnvironmentSearch`. When the project scope is a real project, the project slug is `useProjectScope().project`, which already resolves a project page path. `useProjectEnvironments` is called only when `applies`, so account pages make no environment request.

- [ ] **Step 1: Write the failing tests**

Render a probe component inside a memory router and the providers the hook needs. Mock `@/lib/auth` and `@/lib/api/workspace-apps` the way `src/components/dashboard/projects/environment-selector.test.tsx` does, and answer `GET /v1/projects/{slug}/environments` with `spyApi`. Assert:

```ts
it('is production when the URL names no environment', ...)            // environment 'production', kind 'production'
it('reads ?env= and checks it against the project', ...)              // env=staging -> available true, name 'Staging'
it('marks an environment the project lacks as unavailable', ...)      // env=gone -> available false, never 'production'
it('does not apply, and reads nothing, on account pages or for standalone apps', ...)
                                                                      // /dashboard/usage and ?project=_standalone -> applies false, no environments GET
it('does not apply in a company workspace', ...)                      // org 'acme' -> applies false, no GET
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/lib/environment-scope.test.ts`
Expected: FAIL, `useEnvironmentScope` is not exported.

- [ ] **Step 3: Implement `useEnvironmentScope()`**

Sort the choices production first, then by slug. The list comes from `/v1/projects/{slug}/environments` for the scoped project's slug, so no further filtering is needed.

- [ ] **Step 4: Run and see them pass**

Run: `npx vitest run src/lib/environment-scope.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/environment-scope.ts src/lib/environment-scope.test.ts
git commit -m "feat(console): useEnvironmentScope reads the environment in force"
```

### Task 3: The environment pill and its dropdown

**Files:**
- Create: `src/components/dashboard/environment-switcher.tsx`
- Create: `src/components/dashboard/environment-switcher.test.tsx`
- Modify: `src/components/dashboard/shell.tsx` (`Breadcrumbs`: render `<EnvironmentSwitcher />` right after `<ProjectSwitcher />`)

**Interfaces:**
- Consumes: `useEnvironmentScope()`, `environmentKind`, `environmentName` (Task 1 and 2), `useEnvironmentState(accountId, slug, environment)` (`@/lib/api/projects`) for each dropdown item's status, `DropdownMenu*` from `@/components/ui/dropdown-menu`.
- Produces: `export function EnvironmentSwitcher(): JSX.Element | null`, which renders nothing when `!applies`.

The pill (variant A):
- **Trigger:** a `/` separator as `ProjectSwitcher` draws one, then a rounded-full pill, `h-7`, `gap-1.5`, 13px text, containing an icon, the name and a chevron.
  - **Icons:** `ShieldCheck` for production, `Flask` for stages, `GitFork` for previews, all from `iconoir-react`.
  - **Tint:** production `bg-status-good/12 text-status-good ring-1 ring-status-good/30`; stages the same with `status-warning`; previews `bg-muted text-muted-foreground ring-border`.
- **Accessible name:** `Environment: <Name>. Switch environment`.
- **Unavailable:** when `available === false`, the label reads `<Name> · not in this project` in the warning tint.
- **Dropdown:** label "Environments", then one item per choice.
  - **Item row:** a small pill of the same style, and on the right a status from that environment's state. The status reads `Protected · N live` when the environment is protected and has live apps, `N live`, `Nothing deployed`, or nothing while loading.
  - **Current item:** a check, plus an sr-only "(current)".
- **Selecting an item:** navigate with `search: (s) => ({ ...s, env: slug === 'production' ? undefined : slug })` on the current path.
- **Compare environments:** after a separator, a link to `/dashboard/projects/$projectSlug` with `search: { tab: 'environments' }`.
- **Loading and errors:** while `list.isPending` the dropdown shows `Loading environments…`. On `list.isError` it shows `Environments could not be read` and a Retry button calling `list.refetch`.

- [ ] **Step 1: Write the failing tests**

```ts
it('shows Production with the shield when the URL names no environment', ...)
  // getByRole('button', { name: 'Environment: Production. Switch environment' })
it('shows Staging in the stage style and lists each environment with its status', ...)
  // open; items 'Production' with 'Protected · 3 live', 'Staging' with 'Nothing deployed' and '(current)'
it('switches environment by URL and drops ?env= for production', ...)
  // select Production -> location search has no env; select Staging -> env 'staging'
it('says an environment the project lacks is not in this project', ...)
  // env=gone -> trigger text 'Gone · not in this project'
it('never guesses a list while it loads or fails', ...)
  // pending -> 'Loading environments…'; error -> 'Environments could not be read' and Retry calls refetch
it('renders nothing on account pages', ...)
```

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run src/components/dashboard/environment-switcher.test.tsx`
Expected: FAIL, the module does not exist.

- [ ] **Step 3: Implement `EnvironmentSwitcher` and mount it in `Breadcrumbs`**

- [ ] **Step 4: Run and see them pass, with the shell suites**

Run: `npx vitest run src/components/dashboard/environment-switcher.test.tsx src/components/dashboard/navigation.test.tsx src/components/dashboard/shell.test.tsx`
Expected: PASS. If `navigation.test.tsx` lists breadcrumb links exactly, extend only the project-page expectations by the new trigger.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/environment-switcher.tsx src/components/dashboard/environment-switcher.test.tsx src/components/dashboard/shell.tsx
git commit -m "feat(console): environment pill in the top bar"
```

### Task 4: The amber line, and a look in the mock

**Files:**
- Modify: `src/components/dashboard/environment-switcher.tsx` (export `EnvironmentLine`)
- Modify: `src/components/dashboard/shell.tsx` (render `<EnvironmentLine />` once at the top of the shell, before the sidebar)
- Test: `src/components/dashboard/environment-switcher.test.tsx`

**Interfaces:**
- Consumes: `useEnvironmentScope()`.
- Produces: `export function EnvironmentLine(): JSX.Element | null`, a `<div aria-hidden data-testid="environment-line" className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5 bg-status-warning" />`. It renders when `applies && kind === 'stage'`. For a preview it renders in `bg-muted-foreground/60`; for production it renders nothing.

- [ ] **Step 1: Write the failing tests**

```ts
it('draws the amber line in staging and nothing in production or on account pages', ...)
  // env=staging -> getByTestId('environment-line') has class 'bg-status-warning'
  // no env -> queryByTestId null; /dashboard/usage?env=staging -> null (an account page: applies is false)
```

- [ ] **Step 2: Run and see it fail**

Run: `npx vitest run src/components/dashboard/environment-switcher.test.tsx`
Expected: FAIL, `EnvironmentLine` is not exported.

- [ ] **Step 3: Implement `EnvironmentLine` and mount it in the shell**

- [ ] **Step 4: Run the whole gate**

Run: `npx tsc --noEmit && npm run lint && npm run format:check && npx vitest run --maxWorkers=6 && npm run build`
Expected: types clean, lint shows the 2 known warnings, Prettier clean, every test file passes, the build prints `prerendered`. If a test times out at 5 s on a loaded machine, rerun that file alone before treating it as a failure.

- [ ] **Step 5: Check in the mock**

Run `MOCK_API=1 npx vite --port 3017 --strictPort`, then open `/dashboard/projects/acme-shop` and `/dashboard/releases?project=acme-shop&env=staging` at 1440 and 390 px. The mock seeds `production` and `staging` for acme-shop. Expect:
- **Production:** a green pill and no line.
- **Staging:** an amber pill and a 2px amber line above the top bar.
- **Dropdown:** both environments with their statuses.
- **Leaving:** clicking the logo drops `?env=` and the line.

Save screenshots to `/home/bahadir/GREGALE/.worktrees/parity-tools/ux-shots/env-scope-*.png`. Kill vite by PID.

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard/environment-switcher.tsx src/components/dashboard/environment-switcher.test.tsx src/components/dashboard/shell.tsx
git commit -m "feat(console): amber line across the top outside production"
```

---

## Later slices (not planned here)

2. **The Environments tab follows `?env=`.** Remove its segmented picker, and replace "Show details" with one readable "Technical details". Port faas-web#390's plain "What's different" onto #389's tab, then close #390.
3. **Pages that edit the environment, one PR each.**
   - Env vars and app secrets: `?scope=`.
   - Upstreams: `deployment_scope`.
   - Crons: `environment`.
   - Routes, policies and queue bindings: project environment workload routes.
   - Scaling.
   - Postgres bindings.
   - Releases.
   - Environment config and shared secrets.

   Also in this slice:
   - **Protected stages are read-only.**
   - **Apps follow the environment's state.** An app the environment lacks shows "isn't in Staging yet".
   - **API pull first,** if any route needs a newer spec.
4. **The "This shows production" banner** and "Save to production" on pages with no environment.
