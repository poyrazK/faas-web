**Capture live memory snapshots automatically on your app's first production `5xx`—fork that crashed state into an isolated sandbox to inspect it—and diff CPU or heap flamegraphs across deployments.** On Gregale, crash snapshots (`Pro` and `Scale`) preserve crashed microVM memory for offline investigation without touching live traffic, while continuous profile diffs (`Hobby`, `Pro`, and `Scale`) rank CPU and heap growth across releases and canary stages. All capabilities described here are currently in **preview**.

## Why logs alone miss production 5xx regressions

When a production backend hits a deadlock, subtle heap leak, or edge-case `500` after a rollout, logs rarely show the in-memory state, goroutines/coroutines, or heap objects present at failure time—and attaching a live debugger to a serving container risks taking down real users or losing state when the container restarts.

Traditional PaaS providers force a manual workflow: add extra logging, redeploy, try to reproduce the bug in staging, or wire external APM agents and continuous profilers separately.

## Automatic 5xx crash snapshots and isolated forks

Enable automatic `5xx` memory capture on an app (`PUT /v1/apps/{slug}/crash-snapshots/settings`) or trigger a manual capture of the newest running instance at any time (`POST /v1/apps/{slug}/crash-snapshots`):

- **Low-overhead automatic capture:** When enabled, the first `5xx` answered by an app instance captures that instance's memory snapshot. Gregale limits captures to **at most one in flight** and **none within `10` minutes of the last**, protecting serving instances from snapshot storms.
- **Open a crash snapshot as a production fork:** Call `POST /v1/apps/{slug}/crash-snapshots/{id}/fork` (requires `deploy:write` and `secrets:read`; returns `409 crash_capture_not_ready` until the capture is ready and unexpired).
- **Safe offline inspection:** Gregale boots an isolated microVM restored directly from the captured crash memory (not the deployment's latest image) and returns a one-time `access_token` so engineers inspect the exact crashed state without affecting production traffic.

## Differential CPU, heap, and lock profiling

Compare any two captured profiles of the same app with `gregale debug capture diff` or `GET /v1/apps/{slug}/profiles/captures/{id}/diff?base=<uuid>&kind=heap`:

- **Five capture kinds:** `cpu`, `heap`, `stacks`, `block`, or `mutex`. Omitting `kind` selects a type present in both captures, preferring `heap`.
- **Growth-first call paths:** Gregale merges baseline and candidate captures and sorts every call path and function by largest growth first. Values are never rescaled silently—if captures differ in duration or deployment, the API returns an explicit warning alongside the diff.

## Automatic post-deploy and canary CPU checks

Configure automatic differential profiling after rollouts (`PUT /v1/apps/{slug}/profiles/deployment-policy`):

- **Equal-window baseline vs candidate comparison:** Compares an equal baseline window ending before candidate creation against a matching post-rollout + warm-up window on the new candidate, retrying up to `5` times if profiling samples arrive late.
- **Canary stage assessments & saved investigations:** Inspect per-stage canary CPU evidence (`GET /v1/apps/{slug}/profiles/canary-checks/{deployment}`), read `30`-day deployment check receipts (`GET /v1/apps/{slug}/profiles/deployment-checks`), and save up to `50` comparison investigations without blocking rollout activation (checks are advisory).

## Plans and maturity disclosure

| Capability                | Maturity | Included plans        | Key guardrails                                             |
| ------------------------- | -------- | --------------------- | ---------------------------------------------------------- |
| Automatic `5xx` snapshots | Preview  | **Pro, Scale**        | 1 capture in flight, max 1 every 10 minutes per app        |
| Crash snapshot forks      | Preview  | **Pro, Scale**        | Isolated microVM fork with one-time `access_token`         |
| Profile capture diffs     | Preview  | **Hobby, Pro, Scale** | `cpu`, `heap`, `stacks`, `block`, `mutex`; 30-day receipts |

## How other platforms compare

| Capability                           | Gregale                                                         | Render / Railway / Fly.io                           | Grafana Pyroscope / Datadog Continuous Profiler      |
| ------------------------------------ | --------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------- |
| Automatic `5xx` memory snapshot fork | Built-in (`crash-snapshots` + isolated fork, Pro/Scale preview) | Not built in (metrics, logs, or container SSH only) | Captures profiles, not forkable VM memory snapshots  |
| Differential CPU & heap flamegraphs  | Built-in (`debug capture diff` + post-deploy/canary CPU checks) | Not built in                                        | Built-in continuous flamegraph & release comparisons |
| Infra setup required                 | Zero-agent platform capture & API                               | Must self-host or wire external profiler agents     | Deploy collector/SDK sidecar & manage external SaaS  |

Sources, checked 2026-11-27:
[Grafana Pyroscope Documentation](https://grafana.com/docs/pyroscope/latest/),
[Datadog Continuous Profiler](https://docs.datadoghq.com/tracing/profiler/).

## Pricing and docs

Profile captures unlock on **Hobby**, while automatic `5xx` crash snapshots and crash-snapshot forks unlock on **Pro** and **Scale**. See [Gregale pricing](/pricing), [Tracing & observability](/docs/tracing), [Troubleshooting](/docs/troubleshooting), [Apps & diagnostics API](/docs/api/apps), and [Zero-code OpenTelemetry & SQL N+1 regression detection](/articles/zero-code-otel-sql-regression-tracing).
