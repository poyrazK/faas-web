**Host Next.js 16 with managed PostgreSQL outside Vercel on a platform that runs
your app as a real Node server inside an isolated Firecracker microVM and bundles
managed Postgres in the same plan.** On Gregale, `gregale deploy` automatically
builds plain `next start` apps with `output: "standalone"`, shrinks a ~530 MB
Next.js tree down to roughly 40 MB so it fits Free and Hobby, injects managed
PostgreSQL as `DATABASE_URL` on Hobby ($10 a month), pauses compute ~1 second
after idle requests, and rolls back 5xx releases automatically.

## Why run Next.js as a Node server with bundled Postgres

Serverless function hosts give you edge caching and zero-config Next.js builds,
but Server Components, Route Handlers, background work and database connections
often force extra adapters:

- **Full Next.js runtime parity.** Gregale runs `next build` and `next start`
  in a real Linux microVM, so Server Components, Route Handlers, Server Actions,
  Middleware and long-lived connections work without serverless wrappers.
- **Automatic standalone sizing.** When `package.json` uses a plain `next start`
  command, Gregale builds with `output: "standalone"` (`Applying modifyConfig
from gregale-standalone`) and ships `.next/standalone` with `.next/static` and
  `public` (~40 MB instead of ~530 MB with full `node_modules`). That keeps builds
  well under Free's 256 MB app-layer cap.
- **Bundled Postgres without add-on sprawl.** On Hobby ($10 a month for up to 5
  apps with 512 MB RAM and 200 GB-RAM-hours included), `gregale add postgres`
  provisions managed PostgreSQL in one network namespace and binds `DATABASE_URL`
  directly.

## Quick start and health checks

Keep the standard `create-next-app` scripts in `package.json`:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start"
  }
}
```

Add a lightweight health route and register it in `gregale.yaml`:

```ts
// app/healthz/route.ts
export function GET() {
  return Response.json({ ok: true });
}
```

```yaml
# gregale.yaml
hosting:
  health: /healthz
```

Then deploy directly or test our reference Next.js 16 + Postgres starter in one click:

- [Deploy nextjs-postgres-starter on Gregale](/deploy?repo=https://github.com/gregale-dev/nextjs-postgres-starter)
- CLI deploy from your own checkout:

```bash
gregale deploy --dry-run
gregale deploy --name my-next-app
gregale add postgres --app my-next-app
```

## How alternatives compare for Next.js + Postgres

| Platform    | Free backend / Next server         | Cheapest paid + Postgres   | Idle billing behavior                           | Releases & rollbacks                            |
| ----------- | ---------------------------------- | -------------------------- | ----------------------------------------------- | ----------------------------------------------- |
| **Gregale** | Free: 1 app, 256 MB, 20 GB-RAM-hrs | Hobby $10/mo + PG included | Pauses ~1s after last request                   | Default 1%→10%→50%→100% 5xx canary + DB PITR    |
| **Vercel**  | Hobby: non-commercial only         | Pro $20/seat/mo + PG addon | Fluid Compute scales functions between requests | Rolling releases & instant rollback (code only) |
| **Render**  | 750 hrs (spins down 15m idle)      | Starter $7/mo + PG $6/mo   | Paid web services bill continuously             | Cached-build rollback + manual DB restore       |
| **Railway** | $1 monthly usage credit            | Hobby $5/mo + metered DB   | Serverless sleeps after idle timeout            | Deployment rollback + sibling DB restore        |
| **Fly.io**  | $5/mo allowance (up to 3 VMs)      | ~$2.19/mo VM + Managed PG  | Machines auto-stop/start on traffic             | Image redeploy + separate DB cluster restore    |

Stay on **Vercel** when your workload is primarily static/ISR pages backed by
global edge middleware across 300+ PoPs. Move to **Gregale** when you run full-stack Next.js APIs and Server Actions closely coupled to PostgreSQL and want
predictable spend caps, free PR preview environments and automatic 5xx canary
rollbacks. See [Gregale vs Vercel](/vs/vercel),
[Deploy a Next.js app](/docs/deploy-nextjs), and
[starter templates](/templates).
