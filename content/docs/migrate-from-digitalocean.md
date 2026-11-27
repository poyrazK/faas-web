# Migrate from DigitalOcean App Platform

A DigitalOcean App Platform web service or worker usually moves to Gregale without code changes: both deploy from Git repositories or Dockerfiles, bind `PORT`, and read configuration from environment variables. Gregale does not read `.do/app.yaml`; this page maps DigitalOcean App Spec fields to `gregale.yaml` and Compose and walks through a move.

## How DigitalOcean App Platform maps to Gregale

| DigitalOcean App Platform | Gregale |
| --- | --- |
| App / `services` component | App, deployed with `gregale deploy` |
| Container instance (always-on tier) | Firecracker microVM per instance. Idle apps pause after ~1s and park at $0 compute ([Scale to zero](/docs/scale-to-zero)). |
| Buildpacks (`environment_slug`) | Source builds detect Node, Bun, Python, and Go ([Deploy a web framework](/docs/frameworks)) |
| `dockerfile_path` | Your `Dockerfile` ([Container compatibility](/docs/container-compatibility)) |
| `http_port` | `PORT` set by Gregale; pin a fixed port with `hosting.port` in `gregale.yaml` |
| `health_check.http_path` | `hosting.health` in `gregale.yaml` ([Deployment overrides](/docs/deploy-overrides)) |
| `jobs` (`KIND: PRE_DEPLOY`) | Release command: `release.command` in `gregale.yaml` ([Releases that change the database](/docs/releases#releases-that-change-the-database)) |
| `jobs` (`KIND: POST_DEPLOY` / scheduled) | [Crons](/docs/crons) or [Jobs](/docs/jobs) |
| `workers` component | Background worker service in a [project](/docs/multi-service): a Compose service without `ports:` runs continuously |
| `envs` & Encrypted secrets | [Secrets](/docs/secrets) (`gregale env set`) and [environment variables](/docs/env) |
| Internal service routing | Project services call each other by name: `http://api.internal:10081` |
| DigitalOcean Managed PostgreSQL | [Managed PostgreSQL](/docs/postgres), bound as `DATABASE_URL` |
| DigitalOcean Spaces | [Object storage](/docs/object-storage) (S3-compatible) or keep Spaces over HTTPS |
| GitHub branch previews | [Preview environments](/docs/preview-environments) per pull request |
| Custom domains | [Custom domains](/docs/custom-domains) |
| `doctl apps logs` | `gregale logs my-api` ([Logs](/docs/logs)) |
| Rolling deployment | Automatic 1% → 10% → 50% → 100% canary [rollouts](/docs/rollouts) with auto 5xx rollback + `gregale rollback my-api --to v41 --restore-databases` |
| Usage notifications | Hard monthly spend caps on every paid plan ([Cost controls](/docs/cost-controls)) |

## Translate .do/app.yaml

An App Spec component like this:

```yaml
# .do/app.yaml
name: my-api
services:
  - name: web
    environment_slug: python
    run_command: gunicorn app:app
    http_port: 8000
    health_check:
      http_path: /healthz
jobs:
  - name: migrate
    kind: PRE_DEPLOY
    run_command: python manage.py migrate
```

becomes `gregale.yaml`:

```yaml
# gregale.yaml
hosting:
  start: gunicorn app:app --bind 0.0.0.0:$PORT
  health: /healthz
release:
  command: python manage.py migrate
```

App Platform does not expose `PORT` in every legacy run command unless configured; make sure your `hosting.start` binds `0.0.0.0:$PORT` (or pin `hosting.port: 8000`). Check detection locally:

```bash
gregale deploy --dry-run
```

## Copy the configuration and deploy

Export your App Spec with `doctl` and build a single-line `KEY=VALUE` secrets file from its `envs` entries (replacing App Platform's `${db.DATABASE_URL}` template syntax if switching to Gregale Managed PostgreSQL, and dropping unquoted wrappers):

```bash
doctl apps spec get <app-id> -o json | jq -r '.services[].envs[]? | "\(.key)=\(.value // "")"' > do.env
```

Fill in any encrypted secret values manually (one `KEY=VALUE` per line, no outer quotes; set multiline values afterward with `gregale env set`). Then deploy:

```bash
gregale deploy --name my-api --secrets-file do.env
rm do.env
```

If the deploy fails:

```bash
gregale app health my-api --errors
gregale logs my-api
```

## The database

- **Keep DigitalOcean Managed PostgreSQL for now.** Note that DigitalOcean Managed PostgreSQL commonly listens on port `25060` (not `5432`). Apps only reach ports `80` and `443` by default, so on Pro and Scale open port `25060` first: `gregale app egress-ports add my-api 25060` ([Networking](/docs/networking#outbound-connections)), and add your app's static egress IP ([Static egress IP](/docs/static-egress-ip)) or trusted source rules in DigitalOcean.
- **Move to managed PostgreSQL.** Create a Gregale database (included from Hobby up) and attach a migration role:

  ```bash
  gregale add postgres --app my-api
  gregale postgres attach my-api-postgres my-api --access migration --env MIGRATION_DATABASE_URL
  ```

  Take a `pg_dump` from your DigitalOcean cluster (port `25060` with `sslmode=require`) and restore it via [Connect from your laptop](/docs/postgres#connect-from-your-laptop) (needs app tasks on your plan). Point migrations at `MIGRATION_DATABASE_URL`; your app reads pooled `DATABASE_URL` ([Managed PostgreSQL](/docs/postgres#connect-an-app)).

## Several services, workers, and Spaces

- **Workers and internal APIs.** Convert multi-component `services` and `workers` sections from `.do/app.yaml` into a Compose file and deploy with `gregale deploy` ([Multi-service apps](/docs/multi-service)). Services without `ports:` run continuously as workers.
- **Scheduled jobs.** Replace scheduled App Platform jobs with HTTP [Crons](/docs/crons) or container [Jobs](/docs/jobs).
- **DigitalOcean Spaces.** Either keep using Spaces over HTTPS (`443`) or create a native S3-compatible bucket on Gregale ([Object storage](/docs/object-storage)).

## Switch traffic

Add and verify your custom domain ([Custom domains](/docs/custom-domains)), switch DNS, and destroy or scale down the App Platform app once traffic is clean.
