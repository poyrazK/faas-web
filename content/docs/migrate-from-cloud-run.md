# Migrate from Google Cloud Run

A Google Cloud Run service usually moves to Gregale with the same container image or repository: both run standard Linux `amd64` containers listening on `0.0.0.0` and `PORT`, and pass secrets and configuration via environment variables. IAM service accounts, VPC connectors, and `service.yaml` settings do not carry over; this page maps Cloud Run concepts to Gregale and walks through a move.

## How Google Cloud Run maps to Gregale

| Google Cloud Run | Gregale |
| --- | --- |
| Cloud Run Service | App, deployed with `gregale deploy` |
| Container instance | Firecracker microVM per instance ([Container compatibility](/docs/container-compatibility)) |
| Artifact Registry image | Same container image (`gregale deploy --image ...`), or source build via `gregale deploy` ([Deploy from your repository](/docs/deploy-from-github)) |
| `--port` / `service.yaml` `containerPort` | `PORT` set automatically by Gregale; pin a non-`PORT` listener with `hosting.port` in `gregale.yaml` |
| Startup / liveness HTTP probes | `hosting.health` and `hosting.readiness_probe` in `gregale.yaml` ([Deployment overrides](/docs/deploy-overrides)) |
| Request-based idle scale to zero | Idle instances pause in memory ~1s after the last request and park cleanly without container cold teardown ([Scale to zero](/docs/scale-to-zero)) |
| `--min-instances` | `gregale app scale my-api --min 1` (Pro and Scale) |
| Cloud Run Jobs | [Jobs](/docs/jobs) (on-demand, manifest fan-out, and scheduled batch runs) |
| Cloud Scheduler HTTP targets | [Crons](/docs/crons) |
| Secret Manager env mounts | [Secrets](/docs/secrets) (`gregale env set`) and [environment variables](/docs/env) |
| Cloud SQL Auth Proxy / Direct VPC | [Managed PostgreSQL](/docs/postgres) bound as `DATABASE_URL`, or open outbound port `5432` (Pro/Scale) |
| Cloud Storage | [Object storage](/docs/object-storage) (S3-compatible) or keep GCS over HTTPS |
| Revision traffic splitting / Cloud Deploy | Default automatic canary [rollouts](/docs/rollouts) (1% → 10% → 50% → 100% with automatic 5xx rollback) and `gregale rollback my-api --to v41` ([Safe releases](/docs/releases)) |
| Cloud Logging | `gregale logs my-api` ([Logs](/docs/logs)) |
| Budget alerts (notifications only) | Hard monthly spend caps that enforce spending limits ([Cost controls](/docs/cost-controls)) |

## Deploy your existing image or source

If you already push images to Google Artifact Registry (`<region>-docker.pkg.dev`), you can deploy the exact digest without changing your CI build first. Check compatibility or deploy from a clean digest:

```bash
gregale deploy check --image us-central1-docker.pkg.dev/my-project/api/server@sha256:<digest>
```

For a private Artifact Registry repository, grant a GCP service account `roles/artifactregistry.reader`, base64-encode its JSON key, and store it on the Gregale app before deploying ([Registry credentials](/docs/registry-credentials)):

```bash
base64 -i gcp-reader-key.json | tr -d '\n' | \
  gregale registry set --app my-api \
    --registry us-central1-docker.pkg.dev \
    --user _json_key_base64 \
    --password-stdin
```

If you want Gregale to build from source instead of Artifact Registry, add `gregale.yaml` at your repo root to replace Knative/Cloud Run flags:

```yaml
# gregale.yaml
hosting:
  health: /healthz
release:
  command: alembic upgrade head
```

Preview source detection without uploading:

```bash
gregale deploy --dry-run
```

Ensure your container serves `linux/amd64`, listens on `0.0.0.0:$PORT`, and does not rely on Cloud Run metadata endpoints (`169.254.169.254`), which Gregale blocks by default ([Egress denylist](/docs/egress-denylist)).

## Copy the configuration and deploy

Export plain environment variables from your Cloud Run service and strip Cloud Run-injected variables (`K_SERVICE`, `K_REVISION`, `K_CONFIGURATION`), then add any Secret Manager values as single-line `KEY=VALUE` pairs:

```bash
gcloud run services describe my-api --region us-central1 --format=json \
  | jq -r '.spec.template.spec.containers[0].env[]? | select(.value != null) | "\(.name)=\(.value)"' \
  | grep -v -E '^(K_SERVICE|K_REVISION|K_CONFIGURATION|PORT)=' > cloudrun.env
```

Add secret values to `cloudrun.env` without quotes (or set multiline secrets with `gregale env set --app my-api KEY=...` after deploy), then deploy:

```bash
# Source build:
gregale deploy --name my-api --secrets-file cloudrun.env
# Or existing Artifact Registry image:
gregale deploy --name my-api \
  --image us-central1-docker.pkg.dev/my-project/api/server@sha256:<digest> \
  --secrets-file cloudrun.env
rm cloudrun.env
```

Check status or failures:

```bash
gregale app health my-api --errors
gregale logs my-api
```

## The database

- **Keep Cloud SQL temporarily.** Enable a public IP + SSL on Cloud SQL or connect over an allowlisted address: on Pro and Scale, open outbound port `5432` with `gregale app egress-ports add my-api 5432` ([Networking](/docs/networking#outbound-connections)) and keep `DATABASE_URL` in your secrets. Apps cannot use the local Cloud SQL Unix socket inside Gregale microVMs; connect over TCP with TLS instead.
- **Move to managed PostgreSQL.** Create and attach a Gregale database:

  ```bash
  gregale add postgres --app my-api
  gregale postgres attach my-api-postgres my-api --access migration --env MIGRATION_DATABASE_URL
  ```

  Export from Cloud SQL with `pg_dump` (via Cloud SQL Auth Proxy on your laptop) and restore through [Connect from your laptop](/docs/postgres#connect-from-your-laptop) (needs app tasks on your plan). Run migrations against `MIGRATION_DATABASE_URL`; app traffic uses pooled `DATABASE_URL` ([Managed PostgreSQL](/docs/postgres#connect-an-app)).

## Jobs, schedules, and multi-service workloads

- **Cloud Run Jobs & Cloud Scheduler.** HTTP-triggered Cloud Scheduler tasks become [Crons](/docs/crons). One-off, parallel input fan-out, and scheduled batch containers move to [Jobs](/docs/jobs) (`gregale job create nightly --image ... --schedule "0 3 * * *"`).
- **Multiple services.** Several Cloud Run services that call each other over private VPC URLs deploy together in one [project](/docs/multi-service) Compose file, communicating internally by service name (`http://worker.internal:10081`) without VPC peering or NAT gateways.

## Switch traffic

Add your domain and verify it ([Custom domains](/docs/custom-domains)), shift DNS, and remove the Cloud Run service once traffic has stabilized.
