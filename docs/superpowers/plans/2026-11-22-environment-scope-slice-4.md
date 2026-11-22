# Environment scope, slice 4: "This shows production" on pages with no environment

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** In a non-production environment, every console page whose API has no environment says clearly that it shows production and that changes there apply to production. The app header's Deploy and Roll back name production. Production pages are unchanged.

**Spec:** `docs/superpowers/specs/2026-11-21-environment-scope-design.md`, Goal 4 and the page table's "Production, with the banner" row.

**Ruling against the spec's letter:** the spec asked for "Save to production" on every write button of these pages. Dozens of buttons across about fifteen pages would be noisy and easy to miss one of. Instead:

- the banner itself says changes apply to production;
- the two header actions that act on the whole app, Deploy and Roll back, say "Deploy to production" and "Roll back production" outside production.

## Global Constraints

- **Copy:** the banner reads "This shows production. Changes here apply to production; Staging doesn't have its own {what} yet." `{what}` is the page's plural noun in lower case, e.g. "alerts" or "logs".
- **Look:** the same stage-tinted `EnvironmentNote` style as the scoped pages, with a neutral production icon. The Staging name in the sentence comes from `useEnvironmentScope().name`.
- **Where it shows:** only when `useEnvironmentScope().applies` and the environment isn't production. Never on account pages, in production, for standalone apps, or in a company workspace (all already covered by `applies`).
- **No banner, already scoped:** the app tabs Environment, Routes and Upstreams; Jobs › Scheduled requests; the project page.
- **No banner, account-wide:** Domains, Postgres and Object storage, which keep their "Account-wide" note.
- **Verify:** `npx tsc --noEmit`, `npm run lint` (2 known warnings), `npm run format:check`, `npx vitest run --maxWorkers=6`, `npm run build`.

## Review Focus

- **A scoped app tab** (Environment, Routes, Upstreams) never shows the production banner. Test in Task 1.
- **A production-only app tab** (Logs, Alerts) shows it in Staging and not in production. Test in Task 1.
- **The banner never appears** where environments don't apply. Test in Task 1.
- **Deploy and Roll back** say production in Staging and keep their labels in production. Test in Task 2.

---

### Task 1: The banner, placed

**Files:**

- `src/components/dashboard/production-only-banner.tsx`, new, with:
  - `ProductionOnlyBanner({ what })`;
  - `withProductionBanner(what, Page)`, which renders the banner above a route component;
  - `appTabShowsProduction(tab: string): boolean`, false for `Environment`, `Routes` and `Upstreams`;
  - `productionNoun(tab: string): string`, the tab's name in lower case.
- `src/routes/dashboard.apps.$appSlug.tsx`: one `<ProductionOnlyBanner>` above the tab bodies when `appTabShowsProduction(tab)`.
- `src/routes/dashboard.jobs.tsx`: the banner under the section tabs for workloads, automations and triggers.
- Routes, each wrapped with `withProductionBanner`:
  - `dashboard.releases.tsx` ("releases");
  - `dashboard.instances.tsx` ("instances");
  - `dashboard.events.tsx` ("events");
  - `dashboard.integrations.tsx` ("integrations");
  - `dashboard.customers.tsx` ("customers");
  - `dashboard.analytics.tsx` ("analytics");
  - `dashboard.invocations.tsx` ("invocations");
  - `dashboard.edge-rules.tsx` ("edge rules").
- Tests: `src/components/dashboard/production-only-banner.test.tsx`, mocking `useEnvironmentScope`.

- [ ] **Step 1: Failing tests:**
  - "says Staging shows production for this page";
  - "nothing in production";
  - "nothing where environments don't apply";
  - "scoped app tabs have no banner, production-only ones do";
  - "withProductionBanner renders the page under the banner".
- [ ] **Steps 2–5:** run, see them fail, implement and place, run, see them pass, then commit `feat(console): pages with no environment say they show production`.

### Task 2: Deploy and Roll back name production

**Files:**

- The app header in `src/routes/dashboard.apps.$appSlug.tsx`, where Deploy is rendered, and `src/components/dashboard/app-actions-menu.tsx` (`RollbackButton`): outside production, Deploy reads "Deploy to production" and Roll back reads "Roll back production".
- Tests: the existing app header / rollback tests, or a new one next to `app-actions-menu.tsx`.

- [ ] **Step 1: Failing test:** "in Staging, Roll back says production; in production it reads Roll back", plus the same for Deploy.
- [ ] **Steps 2–5:** run, see it fail, implement, run, see it pass. Then the whole gate, a look in the mock, and commit `feat(console): deploy and roll back name production outside it`.
