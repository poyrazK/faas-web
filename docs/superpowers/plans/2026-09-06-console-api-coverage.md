# Closing the console's API coverage gap

**Goal.** Every customer-facing endpoint `apid` serves is reachable from the
console, or is deliberately and explicitly not. Today the console calls **142 of
221** unique paths in `api/openapi.yaml`. Of the 79 it does not, **36 are real
gaps**;
the rest are operator-only, machine-facing, or intentionally excluded, and are
enumerated as non-goals at the bottom so nobody re-discovers them.

This is a brief, not a plan document: each workstream below is scoped to be
designed and approved on its own before implementation.

## How to check progress

Coverage is measurable, so measure it rather than estimating. From the repo root:

```bash
python3 - <<'PY'
import re, os
spec = open('api/openapi.yaml', encoding='utf-8').read()
paths = re.findall(r'^  (/[^\s:]+):', spec, re.M)
called = set()
for root, _, files in os.walk('src'):
    for f in files:
        if not f.endswith(('.ts', '.tsx')) or 'mock-resources' in f or '.test.' in f:
            continue
        t = open(os.path.join(root, f), encoding='utf-8').read()
        called |= set(re.findall(r"api\.(?:GET|POST|PUT|PATCH|DELETE)\(\s*['\"`]([^'\"`]+)['\"`]", t))
        called |= set(re.findall(r"['\"`](/v1/apps/\{slug\}/logs)", t))
hit = [p for p in paths if p in called]
print(f"{len(hit)}/{len(paths)} paths called")
PY
```

Three things the number does not say. It counts **paths, not operations** — a
path with GET+POST+DELETE counts once, so method-level coverage is lower than it
looks. "Called" means the path is referenced, not that every response branch is
handled. And the spec currently contains **two duplicate path keys**, so a naive
count reports 223 where only 221 are distinct — use a `set`, as the script above
does.

That duplication is a live bug, not a counting quirk. `/v1/triggers` is declared
twice (GET at line 6094, POST at 6158) and `/v1/invocations` twice (POST at
6395, GET at 8172). YAML mappings may not repeat a key, so a parser keeps one
and discards the other — and `openapi-typescript`, which generates
`src/lib/api/schema.d.ts`, ends up with **GET only** for both. The practical
consequence: `POST /v1/triggers` and `POST /v1/invocations` cannot be called
through the typed client at all, because their types do not exist. The Node and
Python SDK generators upstream handle the duplication and keep both operations,
so the loss is specific to this repo's client. Fixing it upstream is a
prerequisite for any work that needs to create a trigger or an invocation from
the console.

## Standing constraints

These are not style preferences. Each one is enforced by a test, or was learned
by shipping the opposite.

1. **Never invent data.** If an endpoint cannot answer something, the UI says so.
   No fixtures in `src/`; `mock/` is the sanctioned place for seeded data.
2. **Branch on `ApiError.code`, never on status or prose.** `402` is both
   `plan_feature_gated` and `billing_past_due` — one is an upgrade, the other is
   an unpaid invoice. Status alone cannot tell them apart.
3. **Filter server-side when the endpoint offers it.** Filtering rendered rows
   looks identical on seeded data and silently only ever searches the page the
   server happened to return.
4. **No charts without a real series.** Percentiles and per-state counts are
   scalars. A line drawn between two of them is a shape nobody measured.
5. **A new page needs `nav-config.ts` and a `consoleHead`**, or it exists and is
   unreachable from the sidebar, breadcrumb and ⌘K palette. Per-app surfaces
   also need an `APP_TABS` entry and wiring into
   `dashboard.workflows.$workflowId.tsx`.
6. **Route files are not tested here.** Extract the body into
   `src/components/dashboard/` and test that; route files stay thin.
7. **Mock every new path.** `mock-spec-drift.test.ts` refuses a mocked path that
   is not in the spec, so the mock cannot drift into fiction.
8. **Do not ship above-the-fold content hidden.** `prerender.test.ts` guards
   inline `opacity:0` and transparent-gradient text. Both have shipped before.
9. **Verify error branches over HTTP**, not only in unit tests. Every page that
   earned trust today did so through its 404/409/402 branch.
10. **When the spec is ambiguous, read the Go handler.** `api/openapi.yaml` has
    been wrong twice in one day: `DeploymentResponse.status` documented an
    `example: "active"` the API never emits, and the debug routes point at
    `PaymentRequired` when the handler returns `plan_feature_gated`. The
    handlers in `poyrazK/faas` `cmd/apid/` are the truth.

## Workstreams

Ordered by customer value per unit of work. Each is independently shippable.

### W1 · Jobs — 7 paths

`/v1/jobs` · `/{name}` · `/{name}/runs` · `/{name}/runs/{id}` ·
`/{name}/runs/{id}/cancel` · `/{name}/runs/{id}/tasks` ·
`/{name}/runs/{id}/tasks/{idx}/logs`

The Cloud Run Jobs equivalent (spec §14.A), entirely CLI-only. The largest whole
primitive still invisible in the browser.

Contract facts worth knowing before designing: `JobResponse.kind` is
`batch | recurring`; a run carries `trigger_kind` of `manual | scheduled |
triggered`; task status is a seven-value enum including `timeout` and `oom`,
which are the two a customer most needs to tell apart. `JobTaskLogResponse`
carries `truncated` and `max_bytes` — say when a log was cut rather than
presenting a truncated tail as complete.

Suggested split: list + detail + run history, then tasks and per-task logs, then
cancel. Model it on the Triggers page, which solved the same shape.

### W2 · Deployment control — 7 paths

`/v1/deployments/{id}/stages` · `/canary/advance` · `/reorder` · `/logs` ·
`/audit` · `/url` · `/v1/apps/{slug}/deployments/clear-obsolete`

The deployment drawer already has cancel and retry (#35). These complete it:
the closed-stage summary (ADR-117), the canary advance, the per-deployment
preview URL, the audit timeline, and a bulk clear of obsolete deployments.

`/logs` is **SSE**, so it belongs with `EventSource` in `lib/api/logs.ts`, not
the `openapi-fetch` client and not TanStack Query — the same exception app logs
already take.

### W3 · Traffic mirroring — 3 paths

`/v1/apps/{slug}/mirrors` · `/mirrors/{id}` · `/mirrors/{id}/summary`

`MirrorSummaryResponse` gives `total_invocations`, `status_diff_count`,
`schema_diff_count`, `body_diff_count` and a **signed** `mean_latency_diff_ms`
where positive means the mirror is slower. The sign carries the meaning, so
render it as a direction, not an absolute.

Pairs naturally with the debugger's Compare tab (#43), which answers the
adjacent question from telemetry rather than from mirrored traffic.

### W4 · Tenant surfaces — 4 paths

`/v1/apps/{slug}/tenant-surfaces` · `/{id}` · `/{id}/hostnames` ·
`/{id}/hostnames/{hostname}`

Customer-owned hostnames grouped into a surface. `TenantSurfaceResponse.status`
is a lifecycle enum and `cert_kind` is `per_host_san`; the interesting state is
certificate issuance, so this wants the same honesty the Domains doctor got in
#33 — say what the platform observes, and what to change when it fails.

### W5 · OpenAPI import — 3 paths

`/v1/apps/{slug}/openapi` (GET/POST/DELETE) · `/openapi/dry-run` ·
`/v1/apps/{slug}/deployments/{deployment}/openapi`

Import a spec, preview the edge rules it would suggest, then apply. `dry-run` is
explicitly read-only, which makes a genuine preview-then-confirm flow possible
rather than an apply-and-hope.

### W6 · Per-app singles — 5 paths

| Path                               | Gives the customer                                            |
| ---------------------------------- | ------------------------------------------------------------- |
| `/v1/apps/{slug}/wake-timeline`    | Where a wake spent its time — the platform's signature metric |
| `/v1/apps/{slug}/usage`            | Per-app billing usage, trailing 30d                           |
| `/v1/apps/{slug}/env-diff`         | Presence and value-equality across env scopes                 |
| `/v1/apps/{slug}/static-egress-ip` | The pinned egress IP (ADR-119), GET/PUT/DELETE                |
| `/v1/apps/{slug}/streaming-cap`    | Streaming classification probe (ADR-102)                      |

These are app-detail tab material rather than a page each. `wake-timeline` is
the highest value: it explains the one number the whole product is sold on.

### W7 · Small closures — 4 paths

`/v1/cors-presets` and `/{id}` — a catalog the CORS surface can offer instead of
hand-rolled rules. `/v1/templates` — the starter catalog the new-app wizard is
already shaped to render. `/v1/audit-events/{id}` — the detail view behind the
audit list. `/v1/preview/{slug}/destroy` — tear down a preview app.

## Non-goals

Excluded deliberately. Each is a decision, not an oversight.

| Excluded                                                    | Why                                                                                                           |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `/v1/admin/*` (19)                                          | The operations console at `operations.gregale.dev` owns these                                                 |
| `/v1/auth/*`, `/auth/reset` (10)                            | OAuth callbacks and non-UI flows                                                                              |
| `/dashboard/apps/{slug}/alert-presets/{name}/{enable,test}` | Form-POST siblings of `/v1` endpoints already called in #37                                                   |
| `/v1/audit-log/all`                                         | Cross-account operator view                                                                                   |
| `/v1/invoices/{id}/consume-credits`                         | Admin-only                                                                                                    |
| `/v1/projects/{slug}/exclusions/{slug2}`                    | Projects were removed from the UI rather than faked                                                           |
| `/v1/apps/{slug}/queues/receive`, `/queues/{id}/ack`        | Consumer-side operations for the customer's own app; acking from the console would silently discard a message |
| `/v1/openapi.{json,yaml}`, `/v1/otel/v1/traces`             | Machine-facing                                                                                                |
| `/v1/apps/{slug}/debug/requests/{req_id}/replay`            | Upstream stub — its response cannot report an outcome yet                                                     |
| `/v1/triggers/{id}` PATCH/DELETE                            | Trigger creation and editing stay in `gregale.yaml` and the CLI                                               |

Two judgement calls to make rather than inherit: `/v1/apps/{slug}/rollouts/recover`
is described as operator recovery but is per-app, and `/v1/triggers/{id}` GET
would give the Triggers page a real detail view even with editing excluded.

## Done means

- The coverage script reports the target, and every remaining path appears in
  the non-goals table with a reason.
- Every new path is mocked, and each error branch has been exercised over HTTP.
- `npm run check` green, and the new components tested — not the route files.
