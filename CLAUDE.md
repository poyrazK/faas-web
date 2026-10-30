# Working in this repo

Read `README.md` first — architecture, conventions, and the theming rule live
there and are not repeated here. This file covers only what tends to trip up an
agent making changes.

## Verify with

```bash
npm run check      # typecheck + lint + format check
npm run build      # the real gate; `build` runs tsc first
```

`npm run lint` currently reports **4 warnings and 0 errors**. Those warnings are
known and deliberate (see the comment block in `eslint.config.js`) — a change
should not add to that count, and does not need to reduce it. The script now
enforces the ceiling (`--max-warnings 8`), so the soft ratchet fails loudly
instead of drifting. The theming rules (no literal hex, no `dark:` in console
components) are pinned by `src/lib/conventions.test.ts`, and the dev mock's
paths are checked against `api/openapi.yaml` by `src/lib/mock-spec-drift.test.ts`.

## Gotchas

- **`src/routeTree.gen.ts` is generated.** The Vite plugin rewrites it on every
  dev run and build. Never hand-edit it, and never fix a lint or format
  complaint inside it — it is in both ignore files already.
- **`src/lib/api/schema.d.ts` is generated too**, from `api/openapi.yaml` by
  `npm run api:types`. Never hand-edit it; it is in both ignore files. To take
  an upstream API change, run `npm run api:pull` and fix what stops compiling —
  that is the point of it.
- **The console talks to a real API.** `apid` is same-origin in production, and
  `npm run dev` proxies to it. Read `README.md` § The API layer before adding a
  call, and check `api/openapi.yaml` for the endpoint rather than guessing a
  REST-shaped URL — the surface is ~190 operations and not always predictable.
- **Branch on `ApiError.code`, not on status or message.** Every error is
  RFC 7807 with a stable `code`; the prose is for humans and can change.
- **Every console page is live.** `lib/mock-data.ts` is now only formatters and
  a couple of types; `lib/mock-resources.ts` is unused by routes. Do not add
  fixture data back — if an endpoint cannot answer something, say so in the UI
  rather than inventing a plausible number.
- **Projects are the way in; regions do not exist.** A project is one imported
  repository and its apps (`/v1/projects`). Apps do not report their project,
  so membership comes from project details via `useProjectMembership`, and
  apps outside every project are shown as standalone — never guessed. There
  are no regions (it is one box); do not reintroduce them.
- **Chart only real series.** `/v1/apps/{slug}/analytics/timeseries` returns
  hourly buckets and may be charted. `/v1/apps/{slug}/metrics`, `/slo` and
  `/usage` return scalars, so a line chart over them would be fabricated.
- **The workspace is an organization.** The breadcrumb switcher stores the
  choice per account (`lib/workspace.ts`) and the API client sends it as
  `X-Active-Org`, which org settings, members, and keys follow. `/v1/apps` and
  `/v1/projects` ignore it: they stay the signed-in account's, and the UI says
  so. Apps reach a shared workspace through its URL (ADR-061) — new apps are
  created with `POST /v1/orgs/{slug}/apps` and Projects shows that workspace's
  inventory from `GET /v1/orgs/{slug}/apps` (`lib/api/workspace-apps.ts`); the
  personal workspace keeps `POST /v1/apps`. Every `/v1/apps/{slug}/…` route is
  still creator-scoped, so never link a workspace app the account did not create.
- **Per-app resources need an app picker.** Secrets, env, alerts, webhooks,
  queues, upstreams, routes, and logs are all `/v1/apps/{slug}/…` with no
  account-wide read. Use `useSelectedApp` + `AppSelect`.
- **`npm run dev:mock` runs the console without a backend.** `mock/` is a
  Vite-only middleware (`MOCK_API=1`) that answers the operations the console
  calls with seeded, schema-typed fixtures; it never ships and `src/` never
  imports it. It is the sanctioned way to see populated console states while
  `apid` is down — the "no fixture data" rule above is about `src/`, and still
  holds. An unmocked path answers `404 not_mocked` and logs to the dev server.
  `MOCK_EMPTY=1` boots the same account with nothing in it, and `MOCK_LATENCY`
  slows responses — between them every read state can be seen on demand.
  `MOCK_HAS_PASSWORD=1` boots with a password already set
  (`mock-current-password`); `MOCK_MFA=1` boots MFA-enrolled so set-password
  demands a step-up (any six digits verify); `MOCK_MFA=required` boots with the
  policy on and nothing enrolled, so it demands enrolment first.
  `MOCK_EMPTY=1` also starts with GitHub disconnected; the "Connect GitHub" form
  post marks it connected and 303s back to the form's `return_to` with
  `?github=connected`, after which the repo picker lists seeded repos.
  Deployments created through the mock (deploy, redeploy, retry, image) walk
  `pending → building → imaging → snapshotting → live` over ~10 s, computed from
  their age on each request (`mock/deploy-lifecycle.ts`); seeded rows never move.
  `MOCK_BUILD_FAIL=1` makes new source builds fail installing dependencies
  (`dep_install_failed`) after ~4.5 s, for first-deployment recovery.
  `MOCK_HIDDEN_CAPABILITIES=<id,id>` lists catalog capabilities as hidden for
  the account (`hidden_capabilities`), so gated tabs, nav items and pages can be
  seen in their off state.
- **`npm run tour` walks the console and fails on what a unit test cannot see** —
  an error boundary, a spinner nothing resolves, a path the mock does not
  answer, a page that threw. Point it at a running dev server
  (`BASE_URL=http://localhost:3000`), optionally with `SHOTS=<dir>` for
  screenshots. Playwright is deliberately not a dependency — the script prints
  the one-line install when it is missing.
- **Loading, empty, error, and unreachable are four different states.** Get the
  precedence from `queryPhase()` in `dashboard/primitives.tsx` rather than
  writing the ternary again, and never pass a _disabled_ query's `isPending` as
  `loading` — TanStack reports a query that never ran as pending forever, which
  is a spinner nothing resolves. Per-app pages gate on `<AppScope>` for exactly
  this reason.
- **Logs are SSE, not JSON.** They use `EventSource` in `lib/api/logs.ts`, not
  the `openapi-fetch` client and not TanStack Query.
- **`content/docs/*.md` is vendored**, pulled by `npm run docs:pull` from
  `poyrazK/faas`. Never hand-edit it — fix it upstream and re-pull. It is
  Prettier-ignored for the same reason `api/openapi.yaml` is.
- **The docs are a curated subset, and the curation is a security boundary.**
  Runbooks, ADRs, and `docs/ops/*` stay unpublished; the reasoning is in
  `src/lib/docs-manifest.ts` and a test enforces it. Adding a page means adding
  a manifest entry, not dropping a file into `content/docs/`.
- **Tests are Vitest + React Testing Library**, in `*.test.ts(x)` beside the
  code. `npm run test`. Vitest does not typecheck, so a green test run does
  not mean `npm run check` passes — run the latter before claiming done.
- **Sign in with a real email and password.** The `123456` demo code is gone —
  the API has no one-time-code flow. Signup enforces a 12-character minimum.
- **Do not add `dark:` variants or literal hex to components.** The two
  polarities are token-driven in `index.css`; a component that needs a new
  colour needs a new token defined in _both_ `:root` and `.console`.
- **Do not reformat files you did not otherwise change.** Prettier was adopted
  late and applied in one isolated commit; drive-by reformatting buries real
  diffs.
- **A new route needs a `head`.** Use `consoleHead('<segment>')` for console
  pages or `pageHead({ title })` elsewhere (`src/lib/seo.ts`), or the page
  inherits the bare brand title. See the Page titles section in `README.md`.
- **Adding a console page means touching `nav-config.ts` too**, or the page
  exists but is unreachable from the sidebar, breadcrumb, and ⌘K palette.
