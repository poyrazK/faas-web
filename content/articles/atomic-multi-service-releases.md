**Ship APIs, workers, configuration, and schema migrations as one atomic release unit instead of drifting across partial deploys.** When microservices deploy independently on different schedules, mismatched client/server contracts, uncoordinated environment edits, and stray background jobs create hard-to-debug version skew. Gregale solves this with multi-service projects, release graphs, and atomic project releases.

## Why independent service deploys drift

In a typical PaaS setup, updating an API service, a billing service, and a background queue worker requires separate builds and cutovers. If `shop-api` finishes deploying two minutes before `shop-billing`, live requests and queued background jobs straddle incompatible request schemas, environment variables, and database columns. Rollbacks become equally fragmented when reverting one service leaves another on newer code.

## Atomic project preflight and release graphs

Before uploading source or starting builds, validate readiness across the entire project in CI:

```sh
gregale deploy check --project --project-slug shop --json
gregale deploy check --project --project-slug shop --atomic --verify --config-file release.json
```

CI exits `0` for ready, `1` for blocked, and `2` for unknown or unavailable, collecting missing runtime keys, invalid dependencies, quota bounds, and worker restrictions in one pass. Save `state_hash` and pass `--expected-state HASH` to catch concurrent configuration changes before applying.

Once deployed, a project's **release graph** pins which exact deployment of every service a caller reaches:

```http
POST /v1/projects/shop/environments/production/release-sets
Content-Type: application/json

{"ttl_seconds":3600,"deployments":{"shop-api":"API_DEPLOYMENT_UUID","shop-billing":"BILLING_DEPLOYMENT_UUID"}}
```

- **Header and browser pinning:** Responses carry `X-Gregale-Revision` and `X-Gregale-Release`, while static SPAs and same-host WebSockets inherit a host-only `__Host-gregale_release` session cookie so browser clients never cross version boundaries mid-session (with `revision_pin_ttl_seconds` configurable up to `604800`).
- **Propagated downstream hops:** Forwarding `X-Gregale-Release` through `*.svc.gregale` keeps public HTTP, internal service calls, async invokes, delayed tasks, and queued messages pinned to the exact compatible graph. Expired pins fail cleanly instead of silently routing to incompatible newer code.

## Coordinated canaries, workers, and expand/contract schemas

For accounts enabled on atomic project workflows, Gregale extends atomic graph coordination across traffic shifting, queues, secrets, and migrations:

- **Progressive whole-graph canaries:** `gregale deploy --project --atomic --verify --progressive --config-file release.json` shifts unpinned traffic and new queue deliveries across the whole graph at `5%`, then `25%`, then `100%` (requiring two fresh healthy probe rounds per stage), and optionally watches critical routes for ten minutes afterward with `--stabilize`.
- **Release-pinned push-queue workers:** Adding `--workers --worker-health` boots the candidate push-queue worker alongside production, gates cutover on startup/delivery checks (`five` baseline attempts and `five` candidate attempts), and pins claimed jobs to their graph across retries and replays.
- **Guarded schema contracts:** Declare both `release.command` (expand) and `release.contract_command` (cleanup) in YAML so cleanup via `gregale release contract run ATTEMPT_ID` waits until retained graphs, pinned jobs, and old instances have finished draining.

## Tradeoffs and maturity boundaries

Several advanced atomic project primitives—including `--add-services`, push-worker cutovers (`--workers` / `--worker-health`), progressive whole-graph canaries (`--progressive`), schema cleanup contracts, release secret snapshots (`--release-secrets-file`), and release-set staging leases—are opt-in capabilities not yet enabled on every account; contact support to enable them. Workloads calling outside `*.svc.gregale` must forward release-context headers themselves.

See [Atomic project releases](/docs/project-releases), [Service release graphs](/docs/service-release-graphs), [Multi-service apps](/docs/multi-service), [Roll back a bad migration: code and database together](/articles/rollback-code-and-database), and [Promote tested staging artifacts to production without rebuilding](/articles/promote-staging-to-production-without-rebuilding).
