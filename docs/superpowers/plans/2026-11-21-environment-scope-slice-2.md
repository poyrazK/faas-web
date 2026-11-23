# Environment scope, slice 2: the Environments tab follows the top bar

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The project page shows the environment the top bar is in (`?env=`). Its own picker goes, app rows read in one line with the ids behind one "Technical details", "What's different" speaks in plain sentences, and the Overview tab's environment cards switch the scope.

**Architecture:** `dashboard.projects.$projectSlug.tsx` reads the environment from `useEnvironmentScope()` (slice 1) instead of its own `?environment=`. A legacy `?environment=X` is rewritten once to `?env=X` with `replace`. `ProjectEnvironments` takes a required `environment` and no longer renders a picker. The plain-English helpers and the "What's different" panel come over from faas-web#390 (branch `feat/project-environments-cards`), adapted to #389's layout. #390 is then closed as superseded.

**Spec:** `docs/superpowers/specs/2026-11-21-environment-scope-design.md` (the "Project page › Environments tab" and "Overview tab" rows).

## Global Constraints

- Production is the absence of `?env=`. Everything the tab reads for production is what it reads today.
- No literal hex and no `dark:`. Copy is sentence case, plain words first, ids only behind "Technical details" (`docs/console-plain-english.md`).
- An unknown secret fingerprint reads "can't tell", never "the same".
- Promotion preview loads only on an explicit comparison (`?compare=`). With none, offer the one-click "Preview promoting from <Name>".
- Keep: the invalid and unavailable alerts, the company-workspace notice, the stage queue bindings, the "Promotions and verification" section, and the readiness search params.
- Verify with `npx tsc --noEmit`, `npm run lint` (2 known warnings), `npm run format:check`, `npx vitest run --maxWorkers=6`, `npm run build`.

## Review Focus

- **Old links with `?environment=staging`** (bookmarks, #389's cards). Expect them to land on `?env=staging&tab=environments` once, with Back not looping. Test in Task 2.
- **`?env=` naming an environment the project lacks.** Expect "Selected environment is unavailable." and no state reads for it, never production's data. Test in Task 2.
- **A project with one environment.** Expect no "What's different" panel and no "Compare with". Test in Task 1.
- **Comparison defaults.** In production, compare the first other environment against production. In staging, compare production against staging. An explicit `?compare=` wins. Test in Task 1.
- **Overview card for the current environment.** Expect it marked current; clicking production clears `?env=`. Test in Task 4.

---

### Task 1: Plain differences, carried over from #390

**Files:**

- Create: `src/components/dashboard/projects/environment-words.ts` and `.test.ts`, from `feat/project-environments-cards`, with `environmentName` imported from `@/lib/environment-scope` (not redefined).
- Modify: `src/components/dashboard/projects/environment-diff.tsx`. Add `EnvironmentDifferences({ data, control })` from #390 and keep today's view as `EnvironmentDiffTechnical` behind its "Technical details".
- Modify: `src/components/dashboard/projects/environment-readiness.tsx`. Add `previewSource?: string` and `onPreview?: () => void`, as in #390: a "Preview promoting from <Name>" button when `source` is unset.
- Modify: `src/components/dashboard/projects/environment-selector.tsx`. Show `EnvironmentDifferences` whenever the project has another environment.
  - **Default comparison:** `compare` when valid, else `production` when the selected environment isn't production, else the first other environment.
  - **"Compare with" select:** sits in the panel header and sets `compare`.
- Test: `environment-diff.test.tsx`, `environment-readiness.test.tsx` and `environment-selector.test.tsx`, ported from #390 and adjusted.

**Interfaces:**

- Produces:
  - `describeDifferences(diff)`, `workloadDifferences`, `groupLabel`, `releaseWords(release)`, `environmentSummary(state)` and `shortId(id)` (#390's signatures);
  - `EnvironmentDifferences({ data: EnvironmentDiff; control?: ReactNode })`;
  - `EnvironmentReadiness` gains `previewSource` and `onPreview`.

- [ ] **Step 1: Port the tests first** (#390's `environment-words.test.ts` and the diff and readiness tests). Add to the selector test: "compares production against staging by default when staging is selected", and "shows no comparison for a project with one environment".
- [ ] **Step 2: Run them and see them fail.** `npx vitest run src/components/dashboard/projects/` should fail on the missing modules and exports.
- [ ] **Step 3: Port the code.**
- [ ] **Step 4: Run and see them pass.** `npx vitest run src/components/dashboard/projects/` should pass.
- [ ] **Step 5: Commit** `feat(console): plain What's different on the Environments tab`.

### Task 2: The tab follows `?env=`, with no picker of its own

**Files:**

- Modify: `src/routes/dashboard.projects.$projectSlug.tsx`.
  - Read `environment` from `useEnvironmentScope().environment`.
  - Keep `environment` in `validateSearch` for legacy links only. When it's present, `navigate({ replace: true, search: (s) => ({ ...s, environment: undefined, env: <it, or undefined for production>, tab: 'environments' }) })` in an effect.
  - Default the tab to `environments` when `?compare=`, a promotion or an approval is present. `?env=` alone doesn't, since the top bar sets it on every page.
- Modify: `environment-selector.tsx`.
  - `environment` becomes required.
  - Remove `SegmentedControl`, the environment `Select` and `SEGMENT_LIMIT`.
  - The unavailable check compares against the list.
  - `onChange` now only sets `compare`.
- Test: `src/routes/-dashboard.projects.test.tsx` and `environment-selector.test.tsx`.

**Interfaces:**

- Consumes: `useEnvironmentScope()` (`environment`, `available`).
- Produces: `ProjectEnvironments` props `{ …; environment: string; compare?: string; onChange: (next: { compare?: string }) => void }`.

- [ ] **Step 1: Write the failing tests.**
  - "rewrites a legacy ?environment= link to ?env= and opens the Environments tab";
  - "shows the environment the URL is in, with no picker of its own" (no `Environment` select or segmented control);
  - "says an environment the project lacks is unavailable and reads nothing for it".
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run src/components/dashboard/projects/ src/routes/-dashboard.projects.test.tsx`. Expect PASS.
- [ ] **Step 5: Commit** `feat(console): the Environments tab follows the top bar`.

### Task 3: One line per app, one "Technical details"

**Files:**

- Modify: `src/components/dashboard/projects/environment-state.tsx`.
  - **App row:** `WorkloadRow` keeps the dot, name and "Open app". Instead of "Live", it shows `releaseWords(release)`: `release 1d3ffd2` or "not deployed", the short id in mono.
  - **Technical details:** each row's "Show details" `Disclosure` goes. One `DetailDisclosure` titled "Technical details", summary "ids, variables, secrets", follows the list. It holds today's facts grouped per app under the app's name, plus the configuration and release set that are already there.
- Test: `environment-diff.test.tsx` (the state view test), and an `environment-state` test if one exists.

- [ ] **Step 1: Write the failing test.** "lists each app on one line and keeps ids behind one Technical details". Expect no "Show details" buttons and one "Technical details" button. Before opening, `release dep-1` is visible and the full id isn't. After opening, the full deployment id, the `REGION` variable and the secret fingerprints are visible.
- [ ] **Step 2: Run and see it fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run src/components/dashboard/projects/`. Expect PASS.
- [ ] **Step 5: Commit** `feat(console): environment apps on one line, ids behind Technical details`.

### Task 4: Overview cards switch the scope

**Files:**

- Modify: `src/components/dashboard/projects/project-overview.tsx`, in the `EnvironmentCards` link.
  - **Link target:** `search: (s) => ({ ...s, tab: 'environments', env: item.slug === 'production' ? undefined : item.slug, environment: undefined, compare: undefined })`.
  - **Current card:** the card for `useEnvironmentScope().environment` gets `aria-current="true"` and a "Current" tag.
- Test: the existing project overview test file, or `-dashboard.projects.test.tsx`.

- [ ] **Step 1: Write the failing test.** "an environment card switches the scope and the current one says so". Expect the staging card's href to contain `env=staging` and the production card's not to contain `env=`. With `?env=staging`, the staging card is `aria-current`.
- [ ] **Step 2: Run and see it fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the whole gate.** Expect the result described in Global Constraints. Then check it in the mock at 1440 and 390 px.
- [ ] **Step 5: Commit** `feat(console): environment cards switch the scope`.
