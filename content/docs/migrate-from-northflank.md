# Migrate from Northflank

A Northflank combined service, deployment service, or Dockerfile app usually moves to Gregale without code changes: Gregale builds from your Git repository or deploys your OCI image (`gregale deploy --image ...`), binds `PORT`, and injects secrets as environment variables. Northflank project templates and UI resource graphs do not carry over; this page maps them to Gregale and walks through a move.

## How Northflank maps to Gregale

| Northflank | Gregale |
| --- | --- |
| Project | [Project](/docs/multi-service) (multi-service Compose / workspace deploy) |
| Combined / Deployment service | App, deployed with `gregale deploy` |
| Container runtime | Firecracker microVM per instance ([Container compatibility](/docs/container-compatibility)) |
| Buildpack / Dockerfile build | Source builds for Node, Bun, Python, Go ([Deploy a web framework](/docs/frameworks)) or your `Dockerfile` |
| External Docker registry image | `gregale deploy --image ...` with `gregale registry set` ([Registry credentials](/docs/registry-credentials)) |
| Health probes (HTTP startup / liveness) | `hosting.health` and `hosting.readiness_probe` in `gregale.yaml` ([Deployment overrides](/docs/deploy-overrides)) |
| Always-on container billing / autoscaling | Idle apps pause after ~1s and scale to zero automatically ([Scale to zero](/docs/scale-to-zero)); hold minimum instances with `gregale app scale my-api --min 1` (Pro/Scale) |
| Private network service DNS | Project services call each other at `http://<service>.internal:10081` ([Multi-service apps](/docs/multi-service)) |
| Background worker / private deployment | Compose service without `ports:` in a [project](/docs/multi-service) |
| Manual / Cron Job | [Jobs](/docs/jobs) (`gregale job create --image ... --schedule ...`) or HTTP [Crons](/docs/crons) |
| Secret Group / runtime environment variables | [Secrets](/docs/secrets) (`gregale env set`) and [environment variables](/docs/env) |
| Northflank PostgreSQL addon | [Managed PostgreSQL](/docs/postgres), bound as `DATABASE_URL` |
| Persistent Volume addon | No local persistent disk: move state to [managed PostgreSQL](/docs/postgres) or [object storage](/docs/object-storage) |
| Release flow / manual rollback | Automatic 1% → 10% → 50% → 100% canary [rollouts](/docs/rollouts) with 5xx rollback + `gregale rollback my-api --to v41 --restore-databases` ([Safe releases](/docs/releases)) |
| Custom domains | [Custom domains](/docs/custom-domains) |
| Service logs | `gregale logs my-api` ([Logs](/docs/logs)) |
| Spend cap | Hard monthly spend caps on every paid plan ([Cost controls](/docs/cost-controls)) |

## Translate services, images, and jobs

If your Northflank service overrides its entrypoint, sets a custom port, or runs a pre-traffic migration, put those settings in `gregale.yaml`:

```yaml
# gregale.yaml
hosting:
  port: 8080
  health: /healthz
release:
  command: npm run migrate
```

Check source build detection without uploading:

```bash
gregale deploy --dry-run
```

If Northflank deploys an image from a private OCI registry (GHCR, Docker Hub, ECR, GAR, ACR), configure credentials first ([Registry credentials](/docs/registry-credentials)) and validate the image:

```bash
printf '%s\n' "$REGISTRY_TOKEN" | gregale registry set --app my-api --registry ghcr.io --user "$GITHUB_ACTOR" --password-stdin
gregale deploy check --image ghcr.io/acme/api@sha256:<digest>
```

## Copy Secret Groups and deploy

Export your Northflank Secret Group / service runtime variables into a single-line `KEY=VALUE` file without quotes, removing `NF_*` platform variables and any addon `POSTGRES_URI` you are replacing. Set multiline secrets (like PEM keys) afterward via `gregale env set`.

```bash
gregale deploy --name my-api --secrets-file northflank.env
rm northflank.env
```

Or deploy a prebuilt image directly:

```bash
gregale deploy --name my-api --image ghcr.io/acme/api@sha256:<digest> --secrets-file northflank.env
rm northflank.env
```

If the deploy fails:

```bash
gregale app health my-api --errors
gregale logs my-api
```

## Databases, Redis, and storage

- **Keep Northflank PostgreSQL or Redis temporarily.** Enable external TLS access on your Northflank addon, put its connection URI in `northflank.env`, and on Pro and Scale open its outbound port (e.g. `5432` or `6379`) with `gregale app egress-ports add my-api 5432` ([Networking](/docs/networking#outbound-connections)).
- **Move PostgreSQL to Gregale Managed PostgreSQL.** Provision and attach a migration credential:

  ```bash
  gregale add postgres --app my-api
  gregale postgres attach my-api-postgres my-api --access migration --env MIGRATION_DATABASE_URL
  ```

  Dump via Northflank's external connection string or `northflank forward addon`, then restore through [Connect from your laptop](/docs/postgres#connect-from-your-laptop) (needs app tasks on your plan). Run migrations via `MIGRATION_DATABASE_URL`; your app connects through pooled `DATABASE_URL` ([Managed PostgreSQL](/docs/postgres#connect-an-app)). Note: Gregale does not run managed Redis/MongoDB addons; keep those external if needed.

## Multi-service projects and scheduled jobs

- **Multi-service projects.** Put your API, internal services, and background workers into a single Compose file and deploy with `gregale deploy` ([Multi-service apps](/docs/multi-service)). Services without `ports:` run continuously as background workers.
- **Northflank Jobs.** Replace cron jobs with HTTP [Crons](/docs/crons) or scheduled container [Jobs](/docs/jobs) (`gregale job create nightly --image ... --schedule "0 3 * * *"`).

## Switch traffic

Verify your domain ([Custom domains](/docs/custom-domains)), move DNS, and pause or delete the Northflank services after confirming traffic on Gregale.
