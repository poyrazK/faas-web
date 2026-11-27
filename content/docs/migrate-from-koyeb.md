# Migrate from Koyeb

A Koyeb app usually moves to Gregale without code changes: both run standard Dockerfiles or Git source builds inside Firecracker microVMs, set `PORT`, and configure services through environment variables. `koyeb.yaml` and Koyeb service specs do not carry over; this page maps Koyeb's primitives to Gregale and walks through a move.

## How Koyeb maps to Gregale

| Koyeb | Gregale |
| --- | --- |
| App / Service | App, deployed with `gregale deploy` |
| Instance (Firecracker microVM) | Firecracker microVM per instance ([Scale to zero](/docs/scale-to-zero)) |
| Light Sleep / Deep Sleep idle timers | Idle instances pause in memory ~1s after the last request and park cleanly without custom sleep tuning |
| `min_scale: 1+` | `gregale app scale my-api --min 1` (Pro and Scale) |
| Git builder / Buildpack | Source builds for Node, Bun, Python, and Go ([Deploy a web framework](/docs/frameworks)) |
| `Dockerfile` / prebuilt image | `Dockerfile` or `gregale deploy --image ...` ([Container compatibility](/docs/container-compatibility)) |
| Health check path | `hosting.health` in `gregale.yaml` ([Deployment overrides](/docs/deploy-overrides)) |
| Private mesh (`*.koyeb.internal`) | Services in a [project](/docs/multi-service) reach each other at `http://<service>.internal:10081` |
| Workers (no public ports) | Compose service without `ports:` in a [project](/docs/multi-service) |
| Environment variables & Secrets | [Secrets](/docs/secrets) (`gregale env set`) and [environment variables](/docs/env) |
| Koyeb Managed Postgres | [Managed PostgreSQL](/docs/postgres), bound as `DATABASE_URL` |
| Persistent Volumes | No local persistent disk: keep state in [managed PostgreSQL](/docs/postgres) or [object storage](/docs/object-storage) |
| WebSockets | `gregale app my-api --websocket-enabled`, or keep sockets open at $0 app idle cost with [managed realtime](/docs/realtime) (beta) |
| GitHub branch previews | [Preview environments](/docs/preview-environments) for every pull request (Free plan included) |
| Custom domains | [Custom domains](/docs/custom-domains) |
| `koyeb service logs` | `gregale logs my-api` ([Logs](/docs/logs)) |
| Redeploy previous revision | Default 1% → 10% → 50% → 100% canary [rollouts](/docs/rollouts) with auto 5xx rollback, plus `gregale rollback my-api --to v41 --restore-databases` ([Safe releases](/docs/releases)) |
| Budget limits | Hard monthly spend caps enabled on every paid plan ([Cost controls](/docs/cost-controls)) |

## Translate Koyeb service settings

If your Koyeb service exposes port `8000`, runs `/healthz` checks, and executes migrations before traffic, capture that in `gregale.yaml` at your repository root:

```yaml
# gregale.yaml
hosting:
  port: 8000
  health: /healthz
release:
  command: alembic upgrade head
```

If your app reads `PORT` dynamically and binds `0.0.0.0`, you can omit `hosting.port`. Scale-to-zero is automatic on Gregale and does not need Koyeb's Light Sleep or Deep Sleep thresholds.

Preview detection from your repository root:

```bash
gregale deploy --dry-run
```

## Copy the configuration and deploy

Export environment variables from Koyeb into a `KEY=VALUE` file, dropping Koyeb-injected variables (`KOYEB_APP_NAME`, `KOYEB_SERVICE_NAME`, `KOYEB_REGION`, `KOYEB_PUBLIC_DOMAIN`, `KOYEB_INSTANCE_ID`). `--secrets-file` expects exact, unquoted single-line entries (set multiline secrets with `gregale env set` after deploy):

```bash
koyeb service describe my-service --app my-app -o json \
  | jq -r '.latest_deployment.definition.env[]? | select(.value != null) | "\(.key)=\(.value)"' \
  | grep -v '^KOYEB_' > koyeb.env
```

Append any encrypted Koyeb secret values you kept outside the JSON response, remove `DATABASE_URL` if moving to Gregale Managed PostgreSQL, then deploy:

```bash
gregale deploy --name my-api --secrets-file koyeb.env
rm koyeb.env
```

If you deploy an image from a private registry rather than building from source, store pull credentials with `gregale registry set` first ([Registry credentials](/docs/registry-credentials)). Check failures with:

```bash
gregale app health my-api --errors
gregale logs my-api
```

## The database

- **Keep Koyeb Postgres for now.** Use its public connection string in `koyeb.env`; on Pro and Scale, open PostgreSQL's outbound port first with `gregale app egress-ports add my-api 5432` ([Networking](/docs/networking#outbound-connections)).
- **Move to managed PostgreSQL.** Provision a bundled database and attach a schema migration binding:

  ```bash
  gregale add postgres --app my-api
  gregale postgres attach my-api-postgres my-api --access migration --env MIGRATION_DATABASE_URL
  ```

  Take a `pg_dump` from Koyeb's external database host and restore it via [Connect from your laptop](/docs/postgres#connect-from-your-laptop) (needs app tasks on your plan). Run migrations via `MIGRATION_DATABASE_URL`, while your runtime app uses pooled `DATABASE_URL` ([Managed PostgreSQL](/docs/postgres#connect-an-app)).

## Several services, workers, and scheduled tasks

- **Multi-service meshes.** Replace `<service>.<app>.koyeb.internal` calls with `http://<service>.internal:10081` across services defined together in a Compose [project](/docs/multi-service).
- **Workers and scheduled tasks.** A Compose service without `ports:` runs continuously as a background worker. Scheduled tasks map to HTTP [Crons](/docs/crons) or container [Jobs](/docs/jobs) (`gregale job create ... --schedule "0 3 * * *"`).

## Switch traffic

Add your domain and verify it ([Custom domains](/docs/custom-domains)), switch DNS, and pause or delete the Koyeb service after verifying live traffic.
