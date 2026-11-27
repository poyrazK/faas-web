# Migrate from Vercel

Next.js backends and standalone Node or Python APIs usually move from Vercel to Gregale without code changes: Gregale builds Next.js in standalone mode or any `Dockerfile`, sets `PORT`, and passes configuration as environment variables. `vercel.json` does not carry over; this page maps Vercel's primitives to Gregale and walks through a move.

## How Vercel maps to Gregale

| Vercel | Gregale |
| --- | --- |
| Project | App, deployed with `gregale deploy` |
| Serverless / Fluid Compute Function | Instance: a Firecracker microVM per instance. Idle apps pause after ~1s and park after the idle timeout ([Scale to zero](/docs/scale-to-zero)). |
| Next.js build (`next build`) | Source build reads `next build` + `next start` and packs `output: "standalone"` automatically when needed ([Deploy a Next.js app](/docs/deploy-nextjs)) |
| Framework API routes (`api/`) and Node/Python services | Server process listening on `0.0.0.0` and `PORT` ([Deploy a web framework](/docs/frameworks)) |
| Build & Output settings | `hosting.start`, `hosting.health`, and `release.command` in `gregale.yaml` ([Deployment overrides](/docs/deploy-overrides)) |
| Function duration caps | Long-running HTTP requests, streaming responses, and persistent workers run without serverless function cutoffs |
| Edge / Redirect / Header rules in `vercel.json` | [Edge rules](/docs/edge-rules) (`gregale` gateway rate limits, headers, and path checks) and [Edge caching](/docs/cache) |
| Environment Variables | [Secrets](/docs/secrets) (`gregale env set`) and [environment variables](/docs/env) |
| Vercel Postgres / Neon integration | [Managed PostgreSQL](/docs/postgres), bound to the app as `DATABASE_URL` |
| Vercel Blob | [Object storage](/docs/object-storage) (S3-compatible buckets with direct signed uploads) |
| Vercel Cron (`vercel.json` `crons`) | [Crons](/docs/crons), which call an HTTP path on your app on a five-field schedule |
| Queue / background workarounds | Background worker service in a [project](/docs/multi-service), or [Jobs](/docs/jobs) |
| Persistent WebSockets / SSE | Supported on instances (`gregale app my-api --websocket-enabled`) or held at the edge with [managed realtime](/docs/realtime) (beta) |
| Preview Deployments per PR | [Preview environments](/docs/preview-environments) |
| Custom domains | [Custom domains](/docs/custom-domains) |
| `vercel logs` | `gregale logs my-api` ([Logs](/docs/logs)) |
| Instant Rollback / Rolling Releases | Automatic 1% → 10% → 50% → 100% canary [rollouts](/docs/rollouts) with 5xx rollback, plus `gregale rollback my-api --to v41 --restore-databases` ([Safe releases](/docs/releases)) |
| Spend Management | Hard monthly spend caps enabled by default on every paid plan ([Cost controls](/docs/cost-controls)) |

## Translate vercel.json and framework settings

Keep the standard `scripts` in `package.json` (`build: "next build"`, `start: "next start"`). A Vercel setup with a cron and health check:

```json
// vercel.json
{
  "crons": [
    {
      "path": "/api/internal/cleanup",
      "schedule": "0 3 * * *"
    }
  ]
}
```

becomes `gregale.yaml`:

```yaml
# gregale.yaml
hosting:
  health: /api/health
triggers:
  - kind: cron
    app: my-api
    schedule: "0 3 * * *"
    path: /api/internal/cleanup
```

Or create the cron via CLI with `gregale cron create --app my-api --schedule "0 3 * * *" --path /api/internal/cleanup` (Hobby and up). If you have standalone `api/*.ts` or `api/*.py` serverless handlers with no HTTP server entrypoint, wrap them into an Express/Hono or FastAPI router listening on `0.0.0.0:$PORT`. Keep static marketing sites wherever you like if you only want to move your API and Next.js backend.

Check what Gregale detects from the repository root:

```bash
gregale deploy --dry-run
```

## Copy the configuration and deploy

Pull your Vercel environment variables for the target environment into a `KEY=VALUE` file, then drop Vercel-injected variables (`VERCEL`, `VERCEL_*`, `NX_*`) and any `POSTGRES_*` / `DATABASE_URL` values you are replacing with managed PostgreSQL:

```bash
vercel env pull vercel.env --environment=production
grep -v -E '^(VERCEL|VERCEL_|POSTGRES_PRISMA_URL)=' vercel.env > gregale.env
```

Inspect `gregale.env` to make sure values are single-line without extra surrounding quotes (set multiline private keys with `gregale env set --app my-api KEY=...` after the first deploy). Then deploy and remove the local file:

```bash
gregale deploy --name my-api --secrets-file gregale.env
rm vercel.env gregale.env
```

If the deploy fails:

```bash
gregale app health my-api --errors
gregale logs my-api
```

## The database and blob storage

Gregale has no one-step import from Vercel Marketplace Postgres providers:

- **Keep your external Postgres for now.** Leave `DATABASE_URL` in `gregale.env`. Apps reach external hosts on ports 80 and 443 by default; on Pro and Scale, open PostgreSQL's port first with `gregale app egress-ports add my-api 5432` (see [Networking](/docs/networking#outbound-connections)).
- **Move to managed PostgreSQL.** Create a database and bind it:

  ```bash
  gregale add postgres --app my-api
  gregale postgres attach my-api-postgres my-api --access migration --env MIGRATION_DATABASE_URL
  ```

  Take a `pg_dump` from your existing Postgres host and restore it through [Connect from your laptop](/docs/postgres#connect-from-your-laptop) (which needs app tasks on your plan). Run schema migrations using `MIGRATION_DATABASE_URL` as a `release.command` in `gregale.yaml`; `DATABASE_URL` uses a transaction-mode connection pooler ([Managed PostgreSQL](/docs/postgres#connect-an-app)).
- **Replace Vercel Blob.** Create an S3-compatible bucket with `gregale add bucket assets --app my-api --env production` and point uploads at signed URLs or zero-wake direct upload routes ([Object storage](/docs/object-storage)).

## Workers, crons, and multi-service apps

- **Crons.** Declared `triggers` entries (`kind: cron`) in `gregale.yaml` or `gregale cron create` call HTTP paths on your app at five-field cron schedules without keeping a VM warm ([Crons](/docs/crons)). Protect internal paths with a shared secret header.
- **Background workers.** Move long-running queue consumers or AI jobs that used to time out on serverless functions into a separate worker service inside a Compose file and deploy as a [project](/docs/multi-service). Services without `ports:` run continuously as workers.

## Switch traffic

Add your domain to the Gregale app and verify it as [Custom domains](/docs/custom-domains) describes, then update DNS. Once production traffic runs through Gregale with clean canary rollouts, remove the Vercel project or pause deployments.
