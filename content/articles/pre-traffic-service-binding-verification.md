**Verify database connectivity, object storage, private service routes, and queue readiness on your exact candidate deployment before shifting a single percent of live traffic.** Most CI pipelines only check unit tests and image builds, leaving broken `DATABASE_URL` credentials, missing S3 permissions, stale rotated secrets, or dead queue consumers to fail in production after deploy.

## Why CI passes while production breaks at cutover

Traditional PaaS deploys swap containers blindly once a process binds a port. If an environment secret points to a revoked Postgres password, an object storage key lacks bucket access, or a staging config drifted from production, requests start returning 500s the moment traffic switches. Runtime probes on an old revision also hide mistakes introduced on a newly staged candidate.

## Verify every dependency and gate promotion in one transaction

Gregale maintains a shared, metadata-safe binding inventory (`GET /v1/apps/{slug}/bindings`) and runs disposable verification canaries bound specifically to a candidate deployment (`v12`) before promotion:

```sh
gregale app binding verify public-api --release v12 --all
gregale app binding check public-api --release v12 --max-verification-age 10m --json
gregale release traffic promote --app public-api --release v12 --if-serving v11 --require-bindings --max-verification-age 10m
```

Under `--require-bindings`, `POST /v1/deployments/{id}/promote` repeats the check inside the traffic transaction using evidence no older than your `--max-verification-age` window (default ten minutes):

- **Private `.internal` services:** Verifies DNS alias resolution, gateway certificate trust against the workload CA bundle, caller authorization, and registered endpoint health without waking idle targets.
- **Managed PostgreSQL:** Starts a bounded task inside the candidate deployment, reads the injected URL, verifies configuration and connectivity, and runs `SELECT 1` without ever returning credentials or database output.
- **Object storage:** Checks all six injected S3 variables and executes one signed path-style `ListObjectsV2` (`MaxKeys=1`, 5-second deadline) so empty buckets pass while bad credentials block promotion.
- **Queues & outbound probes:** Requires active push-queue scheduler consumers to have polled within `30` seconds (`queue_consumer_*` checks), supports handler completion canaries (`GREGALE_QUEUE_CANARY_BINDINGS`), and validates declared outbound health paths (`gregale app binding probe-policy set`).

## Stored release enforcement and durable CI verification

Teams can store enforcement server-side so individual deploy flags can never weaken the gate, and can run large multi-binding checks as resumable server receipts:

```sh
gregale app binding release-policy set public-api --scope production --require-verification --max-age 10m --expected-revision 0
gregale app binding verify public-api --release v12 --release-policy --durable --concurrency 2 --json
```

Adding `--require-application-ack` (or `POST /v1/deployments/{id}/promote-with-application-ack`) goes a step further during secret rotations by requiring resident instances—including sidecar workloads—to acknowledge current secret generations before promotion completes. Durable verification runs (`--durable`, `1`–`8` concurrency, `10`-minute receipt lifetime, up to `128` steps) survive dropped CI runners and expose `status`, `resume`, `cancel`, and `diagnostics` commands.

## Tradeoffs and verification scope

Point-in-time binding verification proves connectivity, authorization, and freshness at promotion rather than full business-logic or SQL schema compatibility (for example, Postgres probes run `SELECT 1`, and object-storage probes perform read-only `ListObjectsV2` unless `--object-storage-write` is reviewed and consented). Push-queue completion canaries (`handler_completion`) apply to push consumers rather than external pull workers.

See [Service bindings](/docs/service-bindings), [Binding verification runs](/docs/binding-verification-runs), [Internal services](/docs/internal-services), [Rotate and revoke secrets without restarting containers or leaking snapshots](/articles/zero-restart-secret-rotation), and [Canary deploys with automatic rollback](/articles/canary-deploys).
