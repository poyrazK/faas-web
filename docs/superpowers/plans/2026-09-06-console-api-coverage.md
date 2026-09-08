# Closing the console's API coverage gap

**Goal.** Every customer-facing endpoint `apid` serves is reachable from the
console, or is deliberately and explicitly not.

**Status.** With the workstream pull requests below merged, the console calls
**202 of 255** unique paths in `api/openapi.yaml`, and every one of the
remaining 53 appears in the non-goals table at the bottom with the reason it
is not a console surface. That number is measured on the tip of the branch
chain; the eleven pull requests are open and green as this lands.

When this brief was written the console called 142 of 221 paths and 36 of the
79 it did not were real gaps. Re-vendoring the spec (#46) moved the
denominator to 255 and added 30 paths the brief had not seen; those were
triaged into the same two piles. The work landed as ten pull requests, listed
below.

## How to check progress

Coverage is measurable, so measure it rather than estimating. From the repo
root:

```bash
python3 - <<'PY'
import re, os
spec = open('api/openapi.yaml', encoding='utf-8').read()
paths = set(re.findall(r'^  (/[^\s:]+):', spec, re.M))
called = set()
for root, _, files in os.walk('src'):
    for f in files:
        if not f.endswith(('.ts', '.tsx')) or 'mock-resources' in f or '.test.' in f:
            continue
        t = open(os.path.join(root, f), encoding='utf-8').read()
        called |= set(re.findall(r"api\.(?:GET|POST|PUT|PATCH|DELETE)\(\s*['\"`]([^'\"`]+)['\"`]", t))
        # Three paths the typed client cannot carry, matched on their own call sites:
        # two SSE streams (EventSource, lib/api/logs.ts) and one form POST
        # (lib/api/password.ts, apid's own form-encoded route).
        if re.search(r"/v1/apps/\$\{[^}]+\}/logs", t):
            called.add('/v1/apps/{slug}/logs')
        if re.search(r"/v1/deployments/\$\{[^}]+\}/logs", t):
            called.add('/v1/deployments/{id}/logs')
        if "'/dashboard/account/set-password'" in t:
            called.add('/dashboard/account/set-password')
hit = sorted(p for p in paths if p in called)
print(f"{len(hit)}/{len(paths)} paths called")
print("\n".join(sorted(paths - called)))
PY
```

Three things the number does not say. It counts **paths, not operations** — a
path with GET+POST+DELETE counts once, so method-level coverage is lower than
it looks. "Called" means the path is referenced, not that every response branch
is handled — though every branch listed in each pull request below was
exercised over HTTP against the mock. And the count depends on the vendored
spec: re-pull before comparing two numbers.

The duplicate `/v1/triggers` and `/v1/invocations` path keys this brief
reported have been fixed upstream; `POST` on both is typed here since #46.

## Status

| #   | Workstream                                                                                                                     | Paths | PR  |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ----: | --- |
| W0  | Spec re-pull and the type changes that followed                                                                                |     — | #46 |
| W1  | Jobs                                                                                                                           |     5 | #45 |
| W2  | Deployment control — stages, preview URL, audit, canary advance, reorder, clear obsolete                                       |     7 | #47 |
| W3  | Traffic mirroring                                                                                                              |     3 | #48 |
| W4  | Tenant surfaces                                                                                                                |     4 | #49 |
| W5  | OpenAPI import and per-deployment discovery                                                                                    |     3 | #50 |
| W6  | Wake timeline, per-app usage, env diff, static egress IP, streaming classification                                             |     5 | #51 |
| W7  | CORS presets, template catalog, auth-event detail, preview teardown                                                            |     4 | #52 |
| W8  | Analytics, request evidence, app lifecycle, upstream history, bucket access, rollout recovery, trigger config, archive deploys |    14 | #53 |
| W9  | Managed PostgreSQL                                                                                                             |     6 | #54 |
| W10 | A job's definition and a run's counts                                                                                          |     2 | #55 |

The two judgement calls this brief left open were both **implemented**:
`POST /v1/apps/{slug}/rollouts/recover` is a guarded advance/promote/abort in
the deployment drawer (#53), and `GET /v1/triggers/{id}` is a read-only
configuration panel on the Triggers page (#53). Editing a trigger still
belongs to `gregale.yaml` and the CLI.

## Standing constraints

These are not style preferences. Each one is enforced by a test, or was
learned by shipping the opposite. They held for all ten pull requests.

1. **Never invent data.** If an endpoint cannot answer something, the UI says
   so. No fixtures in `src/`; `mock/` is the sanctioned place for seeded data.
2. **Branch on `ApiError.code`, never on status or prose.** `402` is
   `plan_feature_gated`, `billing_past_due`, `jobs_not_allowed`,
   `admission_refused` and more. Status alone cannot tell them apart.
3. **Filter server-side when the endpoint offers it.**
4. **No charts without a real series.** Percentiles and per-state counts are
   scalars. The two charts added here — the hourly analytics buckets and the
   upstream probe history — draw series the API zero-fills or samples.
5. **A new page needs `nav-config.ts` and a `consoleHead`**, or it exists and
   is unreachable from the sidebar, breadcrumb and ⌘K palette. Per-app
   surfaces also need an `APP_TABS` entry and wiring into
   `dashboard.workflows.$workflowId.tsx`.
6. **Route files are not tested here.** Extract the body into
   `src/components/dashboard/` and test that; route files stay thin.
7. **Mock every new path.** `mock-spec-drift.test.ts` refuses a mocked path
   that is not in the spec, so the mock cannot drift into fiction.
8. **Do not ship above-the-fold content hidden.** `prerender.test.ts` guards
   inline `opacity:0` and transparent-gradient text.
9. **Verify error branches over HTTP**, not only in unit tests. Every page
   that earned trust did so through its 404/409/402 branch.
10. **When the spec is ambiguous, read the Go handler.** It settled the
    managed-PostgreSQL error codes, the canary stuck-check, and the preview
    slug convention while this work was being done.

## Non-goals

Every path the coverage script still reports, and why it is not a console
surface. This table is exhaustive: the script's output and this table match.

| Excluded                                                                                  | Count | Why                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/v1/admin/*`                                                                             |    20 | The operations console at `operations.gregale.dev` owns these: account credits and refunds, forced cold boots, the Paddle catalog and reconciliation, stuck-build sweeps, cluster config and its revisions and rollbacks, GitHub webhook secrets, forced instance park and restart, object-storage usage reports, the obs health probe, operator intents, and secret rekey progress. |
| `/v1/audit-log/all`, `/v1/invoices/{id}/consume-credits`                                  |     2 | Cross-account operator views, admin-only.                                                                                                                                                                                                                                                                                                                                            |
| `/v1/auth/*` and `/auth/reset`                                                            |    11 | OAuth starts and callbacks, password and magic-link sign-in, signup, email verification, OIDC exchange, and the capability probe. The browser performs these as navigations and form posts, not as typed fetches; the console links to them.                                                                                                                                         |
| `/dashboard/apps/{slug}/alert-presets/{name}/{enable,test}`                               |     2 | Form-POST siblings of the `/v1` endpoints the alerts surface already calls (#37).                                                                                                                                                                                                                                                                                                    |
| `/v1/uploads`, `/v1/uploads/{id}`, `/{id}/commit`, and the five `multipart-uploads` paths |     8 | Resumable upload protocols with offsets, parts and commits, driven by the CLI and the SDKs. The console deploys an archive in one request (#53) and uploads objects through signed URLs (#29).                                                                                                                                                                                       |
| `/v1/apps/{slug}/deployments/dev-source`, `/v1/dev/sessions/{project}`                    |     2 | The `gregale dev` loop: a local working tree synced to a remote environment. There is no browser half.                                                                                                                                                                                                                                                                               |
| `/v1/apps/{slug}/queues/receive`, `/queues/{id}/ack`                                      |     2 | Consumer-side operations for the customer's own app; acking from the console would silently discard a message.                                                                                                                                                                                                                                                                       |
| `POST /v1/apps/{slug}/deployments`                                                        |     1 | Prebuilt-image deploys. The browser should not hold registry credentials; the console deploys from a repository ref or an archive instead.                                                                                                                                                                                                                                           |
| `/v1/openapi.{json,yaml}`, `/v1/otel/v1/traces`                                           |     3 | Machine-facing: the spec itself, and the OTLP ingest endpoint.                                                                                                                                                                                                                                                                                                                       |
| `/v1/apps/{slug}/debug/requests/{req_id}/replay`                                          |     1 | Upstream stub — its response cannot report an outcome yet. Worth revisiting when it can.                                                                                                                                                                                                                                                                                             |
| `/v1/projects/{slug}/exclusions/{slug2}`                                                  |     1 | Projects were removed from the UI rather than faked.                                                                                                                                                                                                                                                                                                                                 |

## Done means

- The coverage script reports 202/255 on the chain's tip, and every remaining
  path appears above.
- Every new path is mocked, and each error branch was exercised over HTTP.
- `npm run check` green: 422 tests across 64 files.
