**Host a Bun and Hono API with managed PostgreSQL on a platform that detects
`bun.lock`, runs TypeScript directly without a build step, and stops compute
billing ~1 second after each request finishes.** On Gregale, a small Bun + Hono
service takes roughly 95 MB in its app layer—fitting comfortably inside the
256 MB Free plan—and pairs directly with bundled managed PostgreSQL on Hobby
($10 a month).

## How Bun + Hono runs on Gregale

When Gregale finds `bun.lock` at the project root, the builder installs the Bun
runtime, executes `bun install --frozen-lockfile`, and boots your app using
`bun run start`:

- **No Webpack/tsup compile step required.** Bun executes TypeScript natively on
  startup while keeping only the Bun runtime (~90 MB) beside your application
  code (~5 MB), leaving roughly 160 MB inside Free's 256 MB app-layer ceiling.
- **Keep start scripts pure Bun.** Ensure `package.json` invokes `bun` or `bunx`
  rather than `npm`, `npx`, `yarn`, `pnpm`, or wrapper runners like
  `concurrently` so Node's extra toolchain is trimmed from the deployed image.
- **Automatic `/healthz` gating.** Exposing `GET /healthz` in Hono gives
  deployments a readiness probe before traffic shifts from the 1% canary to
  10%, 50%, and 100%.

## Minimal Hono + Postgres server

```ts
// index.ts
import { Hono } from 'hono';

const app = new Hono();

app.get('/healthz', (c) => c.json({ ok: true }));
app.get('/', (c) => c.json({ message: 'ready' }));

Bun.serve({
  port: Number(process.env.PORT) || 3000,
  hostname: '0.0.0.0',
  fetch: app.fetch,
});
```

```json
{
  "scripts": {
    "dev": "bun --watch index.ts",
    "start": "bun index.ts"
  }
}
```

Deploy your own checkout or try the reference template right away:

- [Deploy bun-hono-postgres-starter on Gregale](/deploy?repo=https://github.com/gregale-dev/bun-hono-postgres-starter)
- Or push from the CLI:

```bash
gregale deploy --dry-run
gregale deploy --name bun-api
gregale add postgres --app bun-api
```

## How platforms compare for Bun APIs

| Platform               | Native `bun.lock` detection           | Free backend tier              | Managed Postgres bundle    | Idle compute billing          |
| ---------------------- | ------------------------------------- | ------------------------------ | -------------------------- | ----------------------------- |
| **Gregale**            | Yes (`bun install --frozen-lockfile`) | Free: 1 app, 256 MB, 20 GB-hrs | Included on Hobby ($10/mo) | Pauses ~1s after last request |
| **Railway**            | Yes (Railpack / Nixpacks)             | $1 monthly usage credit        | Separate metered service   | Serverless sleeps when idle   |
| **Render**             | Yes                                   | 750 hrs (spins down 15m idle)  | Separate ($6/mo Starter)   | Paid instances run 24/7       |
| **Fly.io**             | Dockerfile                            | $5/mo allowance (up to 3 VMs)  | Separate Managed PG        | Auto-stop/start on requests   |
| **Cloudflare Workers** | Bundle via Wrangler only              | 100k req/day (V8 isolates)     | External via Hyperdrive    | No idle charge (isolate only) |

Stay on **Cloudflare Workers** if your Hono routes use edge-only D1/KV bindings
without Node/Bun native modules or a full Linux runtime. Choose **Gregale** when
you want full Bun compatibility (`Bun.serve`, Postgres pools, standard Linux
libraries), millisecond scale-to-zero billing, PR previews, hard monthly spend
caps, and automatic 5xx canary rollbacks. See
[Deploy a Bun app](/docs/deploy-bun),
[Roll back releases and databases](/docs/releases), and
[starter templates](/templates).
