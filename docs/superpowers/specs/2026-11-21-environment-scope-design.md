# Environments as a scope: design

Date: 2026-11-21. Status: draft for Bahadir's approval.

## Why

Bahadir, on the project page's Environments section: production and staging
should be treated **as separate projects**. The top bar should always say
which one you are in, with a component that looks good, and **you should be
able to configure everything on staging**.

Today (main a6d5d6ba, after faas-web#389) the project page has four tabs, and
its **Environments** tab (`?tab=environments`) picks an environment with a
segmented control and lists one row per app, each with a **"Show details"**
toggle that opens a grid of ids, digests, variables and secret fingerprints —
the part Bahadir called messy and hard on the eyes. The comparison panel is
still the old dense one. faas-web#390 (two cards, plain "What's different")
was built against the page before #389 and now conflicts. Every other console
page silently means production. Someone testing in staging has no way to stay "in staging" while
they move around, and nothing on screen says which environment a page edits.

## How faas models environments (from the source, not guessed)

- A project environment (`production`, a stage like `staging`, a preview)
  gives each workload its **own deployments, variables, secrets, settings,
  route and edge policies, databases and buckets** (faas
  ADR-20261104120000). It is the same app, not a copy with another slug.
- `''` (empty) is the default scope and means production everywhere.
- What takes an environment today (faas `api/openapi.yaml`, main f0f9844):
  - project environment routes: `/v1/projects/{slug}/environments/{env}` and
    its `config` (non-secret configuration, versioned), `secrets` (shared by
    every service of that environment), `state`, `diff`, `flags`, `releases`,
    `release-sets`, `promotions`, `approvals`, `gitops`, `branch`, and per
    workload `routes`, `policies`, `queue-bindings`;
  - per app: `/v1/apps/{slug}/routes`, `/scaling`, `/postgres-bindings`,
    `/deployments` (fields carry an environment scope), `/status`, `/health`,
    `/issues`, `/operational-summary`, `/work-policies`;
  - crons: `CreateCronRequest` and `CronResponse` carry `environment`.
- App variables and secrets **are** scoped: `/v1/apps/{slug}/env` and
  `/secrets` take `?scope=<slug>` (omitted = `default`), `/upstreams` takes
  `deployment_scope`. At runtime a deployment inherits its environment's
  `config` and environment `secrets`, and **the app's own value in the same
  scope wins** (faas conformance `project_config_runtime_env_cases.go`,
  `project_secrets_runtime_cases.go`; ADR-1136, ADR-1139).
- **Production is one serving lane with two scope names**: the legacy default
  scope (`''`/`default`) and `production` (faas `pkg/state/environment_scope.go`,
  `EnvironmentOwnsScope`). A direct write into production must land in the lane
  actually serving it (`EnvironmentDeploymentScope`): normally the default
  scope, `production` after a release-graph promotion.
- What does **not** take an environment yet: `/logs`, `/metrics`,
  `/analytics/timeseries`, `/alerts`, `/webhooks`, `/edge-rules`,
  `/instances`, `/event-subscriptions`, `/rollback`, and account resources
  (`/v1/domains`, `/v1/postgres/databases`). faas is moving triggers, subscriptions, edge
  rules and work policies to per-environment one at a time (same ADR).

The console's vendored `api/openapi.yaml` is behind faas main; the first slice
runs `npm run api:pull`.

## Goals

1. **An environment is a scope, like a project.** Inside a project you are
   always in exactly one environment. It rides in the URL as `?env=<slug>`,
   kept on every `/dashboard` link the way `?project=` is
   (`retainSearchParams(['project', 'env'])` on the `/dashboard` route).
   No `?env=` means production.
2. **The top bar always says where you are** (variant A, chosen): after the
   project switcher, a tinted pill — Production green with a shield, Staging
   (and any non-production stage) amber with a flask, previews neutral with a
   git-branch icon — that opens a dropdown of the project's environments, each
   with a one-line status ("Protected · 3 live", "nothing deployed"), and a
   "Compare environments" item that opens the project page's comparison.
   **In any non-production environment a 2px amber line runs across the top of
   the console**, full width, so nobody edits staging thinking it is
   production or the reverse.
3. **Everything the API can scope edits the selected environment.** Every
   project page that has an environment-aware endpoint reads and writes the
   selected environment (list below).
4. **Pages that cannot be scoped yet say so, and show production.** In a
   non-production environment, a page whose endpoint has no environment shows
   production's data under a clear, quiet banner: "This shows production.
   Staging doesn't have its own <thing> yet." Writes on such a page still go
   to production, so its save buttons say "Save to production". Hidden would
   make staging look broken; silent would be dangerous. (Bahadir's default,
   2026-11-21.)

## Non-goals

- No new backend endpoints. If faas cannot scope something, the console does
  not fake it.
- No creating or deleting environments from the top bar (the project page
  keeps environment management).
- Account pages (Overview, Projects, Billing, Audit log, Settings, Support)
  have no environment; the pill and the line do not appear there.
- Standalone apps (`?project=_standalone`) have no project environments; the
  pill does not appear for them.
- Company workspaces: project environment routes resolve under the signed-in
  account (environment-selector.tsx comment, faas `ProjectBySlug`), so in a
  company workspace the pill does not appear, as the Environments panel
  already explains.

## Anti-goals (would make this a failure even if it works)

- A page that edits production while the top bar says Staging, without saying
  so on that page.
- An environment guessed from anything but the URL (no "last used" memory that
  silently puts someone in staging).
- Staging styled so loudly that the console feels broken, or production styled
  so quietly that it is not recognisable.

## Page-by-page (first pass; the builder confirms each endpoint)

| Page or tab                                                                             | In a non-production environment                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project page › Overview tab (environment cards)                                         | The card for `?env=` is marked current; clicking a card switches the scope                                                                                                                                                                                                                                        |
| Project page › Environments tab                                                         | Shows the selected environment only: the segmented picker goes (the top bar replaces it). Per-app rows stay one line; "Show details" is replaced by one readable "Technical details" per environment. "What's different" compares the selected environment with production in grouped plain sentences (from #390) |
| Releases / deployments                                                                  | Scoped list and deploy target, where `/deployments` carries the scope                                                                                                                                                                                                                                             |
| Jobs › scheduled requests (crons)                                                       | Scoped: list filtered by `environment`, create sends it                                                                                                                                                                                                                                                           |
| Routes (app tab), headers/CORS policies, queue bindings                                 | Scoped via the project environment workload routes/policies/queue-bindings                                                                                                                                                                                                                                        |
| Scaling (app settings)                                                                  | Scoped via `/scaling`                                                                                                                                                                                                                                                                                             |
| Postgres bindings (app)                                                                 | Scoped via `/postgres-bindings`                                                                                                                                                                                                                                                                                   |
| Environment config and shared secrets                                                   | Scoped via `/environments/{env}/config` and `/secrets` — likely a new "Environment settings" page in the project rail (builder decides placement)                                                                                                                                                                 |
| Feature flags, approvals, promotions, release sets                                      | Scoped (already environment routes)                                                                                                                                                                                                                                                                               |
| Env vars, app secrets (app tabs)                                                        | Scoped: `?scope=<env>`. The tab also lists what the app inherits from the environment's config and shared secrets, and says the app's own value wins                                                                                                                                                              |
| Upstreams                                                                               | Scoped via `deployment_scope`                                                                                                                                                                                                                                                                                     |
| Logs, metrics, analytics, alerts, webhooks, edge rules, instances, events, integrations | Production, with the banner                                                                                                                                                                                                                                                                                       |
| Domains, Postgres, Object storage                                                       | Account-wide, as today ("Account-wide" note), no environment banner                                                                                                                                                                                                                                               |

## Decided

- **Production keeps today's requests.** With no `?env=` every page sends
  exactly what it sends now (no environment / default scope), so production
  behaves as it does today. Only a non-production environment adds
  `environment=<slug>` / `scope=<slug>` / `deployment_scope=<slug>`. (Mine,
  from the builder check; avoids `environment=production`, which some routes
  treat differently — `/scaling` asks for an approval, `/routes` with no
  selector sums every scope.)
- **Protected non-production environments are read-only in the console.** A
  page in a protected stage shows its values with "Staging is protected:
  changes go through a promotion" and a link to the Environments tab; no
  approval flows are built in this project. (Mine; approval flows are a
  separate project.)
- **Apps follow the environment.** In a non-production environment the
  project's app lists (rail, Projects page columns, app pickers) show only the
  workloads in that environment's `state`. An app page opened for a workload
  the environment doesn't have says "<app> isn't in Staging yet" with the
  deploy command (`gregale deploy --environment staging`), never production's
  data. (Mine; the API itself refuses to inherit production here.)

- **Variant A** for the switcher, with the amber top line (Bahadir).
- Unscoped pages show production with a banner (Bahadir's default).
- `?env=` in the URL, production when absent (mine; matches `?project=`).
- Colours come from existing status tokens (`--status-good` for production,
  `--status-warning` for stages); any new token is defined in both `:root` and
  `.console` (repo theming rule). No literal hex.

## Left to the builder

- Component structure, file names, tests.
- Exact banner wording per page, within the rule above.
- Where environment config and shared secrets live in the rail.
- Slice order. Suggested: (1) `api:pull`, scope plumbing and the pill + line;
  (2) the Environments tab follows `?env=` and gets #390's plain "What's
  different" and readable details, ported onto #389's tab (then #390 is closed
  as superseded); (3) scoped pages one PR each; (4) banners on unscoped pages.
- What the dropdown shows while environments load or fail (never a guessed
  list).
