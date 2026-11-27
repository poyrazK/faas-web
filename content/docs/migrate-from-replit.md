# Migrate from Replit

An app or API built in Replit moves to Gregale as soon as its code lives in a Git repository or clean local folder: Gregale builds Node, Bun, Python, and Go from source (or runs a `Dockerfile`) inside isolated Firecracker microVMs with Git-native workflows, PR previews, and hard monthly spend caps. `.replit` and `replit.nix` settings do not carry over; this page maps Replit concepts to Gregale and walks through a move.

## How Replit maps to Gregale

| Replit | Gregale |
| --- | --- |
| Replit Repl / Workspace | Local or Git-owned repository deployed with `gregale deploy`, or cloud workspace via `gregale dev` ([Remote dev](/docs/dev)) |
| Autoscale / Reserved VM Deployment | Firecracker microVM per instance. Idle apps pause after ~1s and park at $0 compute ([Scale to zero](/docs/scale-to-zero)); hold minimum instances with `--min 1` (Pro/Scale) |
| `.replit` `run` command | Detected from framework (`package.json`, `requirements.txt`, `pyproject.toml`, `go.mod`) or pinned via `hosting.start` in `gregale.yaml` ([Deployment overrides](/docs/deploy-overrides)) |
| `replit.nix` system packages | Language toolchain detection (Node, Bun, Python, Go) or a `Dockerfile` for custom system binaries ([Container compatibility](/docs/container-compatibility)) |
| Replit Secrets | [Secrets](/docs/secrets) (`gregale env set`) and [environment variables](/docs/env) |
| Replit SQL / Neon Postgres | [Managed PostgreSQL](/docs/postgres), bound as `DATABASE_URL` |
| Replit Key-Value DB / local files | No persistent local disk or Replit DB client: keep persistent state in [managed PostgreSQL](/docs/postgres) or [object storage](/docs/object-storage) |
| Replit Object Storage | [Object storage](/docs/object-storage) (S3-compatible) |
| Scheduled Deployments | [Crons](/docs/crons) (HTTP schedules) or [Jobs](/docs/jobs) (container schedules) |
| One-click Republish | Git push / CLI deploys with automatic 1% → 10% → 50% → 100% canary [rollouts](/docs/rollouts), auto 5xx rollback, and [PR previews](/docs/preview-environments) |
| Replit Agent deployments | Scoped `--agent` keys, human approvals, and `gregale undo` for coding agents ([Use Gregale from coding agents](/docs/agents)) |
| Usage billing alerts | Hard monthly spend caps enabled on every paid plan ([Cost controls](/docs/cost-controls)) |

## Prepare the repository for Git-native deploys

First push your Replit project to GitHub (via Replit's Git pane or `git push`), clone it locally, and make three checks before deploying:

1. **Listen on `0.0.0.0` and `PORT`.** Replit apps often bind `0.0.0.0:5000` or `127.0.0.1:8080`. Read `process.env.PORT` / `os.environ["PORT"]` and bind `0.0.0.0`, or pin a fixed port with `hosting.port` in `gregale.yaml` ([Deployment overrides](/docs/deploy-overrides)).
2. **Use a production server.** Replace `next dev`, `flask run`, or `uvicorn --reload` with `next start`, `gunicorn`, or `uvicorn app:main --host 0.0.0.0 --port $PORT`.
3. **Remove Replit-only SDK dependencies.** Replace `@replit/database` or `@replit/object-storage` calls with standard PostgreSQL (`DATABASE_URL`) or S3 SDK calls (`BUCKET_*` credentials from [Object storage](/docs/object-storage)). If your app depended on apt/system packages from `replit.nix` (such as `ffmpeg` or Playwright browsers), add a minimal `Dockerfile` installing them.

Create `gregale.yaml` if you need an explicit start command, health check, or migration step:

```yaml
# gregale.yaml
hosting:
  health: /healthz
release:
  command: alembic upgrade head
```

Test detection locally before deploying:

```bash
gregale deploy --dry-run
```

## Copy Replit Secrets and deploy

Copy your Replit Secrets from the Secrets tool (omit `REPL_ID`, `REPL_SLUG`, `REPL_OWNER`, and `REPLIT_*` variables) into a local `KEY=VALUE` file, one pair per line without surrounding quotes. Set multiline secrets afterward with `gregale env set`. Then deploy:

```bash
gregale deploy --name my-api --secrets-file replit.env
rm replit.env
```

Or launch directly from GitHub with the browser [Deploy button](/deploy) (`/deploy?repo=https://github.com/OWNER/REPO`). If a coding agent drives your deploys, issue a scoped `--agent` key so destructive actions require human approval and changes can be undone ([Use Gregale from coding agents](/docs/agents)). Check deploy health or logs:

```bash
gregale app health my-api --errors
gregale logs my-api
```

## The database and files

Gregale instances have ephemeral disks that reset when an app parks ([What breaks when scaling to zero](/docs/scale-to-zero)). Move any SQLite files, uploaded media, or Replit Key-Value entries into managed services:

- **Move to Gregale Managed PostgreSQL:**

  ```bash
  gregale add postgres --app my-api
  gregale postgres attach my-api-postgres my-api --access migration --env MIGRATION_DATABASE_URL
  ```

  Export your Replit Postgres database using `pg_dump` and restore it through [Connect from your laptop](/docs/postgres#connect-from-your-laptop) (requires app tasks on your plan). Run schema migrations on `MIGRATION_DATABASE_URL`; your serving app connects via pooled `DATABASE_URL` ([Managed PostgreSQL](/docs/postgres#connect-an-app)).
- **Object storage.** Replace local upload folders or Replit Object Storage with a Gregale bucket ([Object storage](/docs/object-storage)).

## Switch traffic

Connect your domain and verify DNS ([Custom domains](/docs/custom-domains)), shift traffic over, and shut down your Replit deployment once live requests succeed.
