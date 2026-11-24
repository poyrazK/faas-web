**A reliable setup for a Node.js API and a worker has four parts: both
processes deploy from one repository so they never run different versions, a
crash or memory leak in the worker cannot take down the API, the queue lives in
a managed database with backups, and a bad release rolls back before most
users see it. The
cheapest version of that keeps the worker small and lets the API stop costing
money while it is idle.** On Gregale you describe the API and the worker in a
Compose file and deploy them as one project with a managed PostgreSQL database.
The API pauses between requests and is not billed while paused, and every
production release reaches 1% of traffic first and rolls back on its own on
errors (in beta). On raw machine price alone, Fly.io's smallest Machines cost
less; the comparison below shows each option.

## The API and the worker on Gregale

```yaml
# compose.yaml
services:
  api:
    build: .
    command: node dist/server.js
    ports: ['3000:3000']
    depends_on:
      db:
        condition: service_healthy
  worker:
    build: .
    command: node dist/worker.js
    depends_on:
      api:
        condition: service_healthy
      db:
        condition: service_healthy
  db:
    image: postgres:17
```

`gregale deploy` reads this as one project:

- **`api`** becomes an app with a public URL. It pauses about a second after
  its last request and is not billed while paused.
- **`worker`** has no `ports:`, so it becomes a background service that runs
  all the time.
- **`db`** becomes a managed PostgreSQL database, and both services get its
  connection string as `DATABASE_URL`.
- **`depends_on` on `api`** holds each new worker release until the API's
  release from the same deploy is live. If the API's release fails, the
  worker's release fails too and the current one keeps serving, so the two
  never run mixed versions.

To run migrations before each release, add a Compose step that the API waits
for with `condition: service_completed_successfully`; Gregale runs it as the
API's release command. A project with two or more services needs Hobby or
higher. See [Deploy a multi-service app](/docs/multi-service) and
[Deploy an Express app](/docs/deploy-express).

## Where the worker gets its jobs

- **Postgres-backed,** such as pg-boss or Graphile Worker: jobs live in the
  database you already have, covered by its backups and point-in-time restore.
  One less system to run, which suits most small apps.
- **Redis-backed,** such as BullMQ: higher throughput, one more system to run.
  Gregale's managed Redis is not generally available yet, so point
  `REDIS_URL` at a Redis you run elsewhere.

Scheduled work does not need the worker either: a [cron](/docs/crons) calls a
path on your API on a schedule, and Gregale wakes the API for it.

## What two small always-on processes cost

The API and the worker each at the smallest paid size that stays on, before
any database. Prices are each vendor's own, checked on November 25, 2026:

| Platform                      | API + worker, smallest always-on size     | Notes                                                                       |
| ----------------------------- | ----------------------------------------- | --------------------------------------------------------------------------- |
| **Fly.io**                    | 2 × $2.19 = $4.38 a month (256 MB each)   | Lowest-priced regions; Fly.io Managed Postgres from $4 a month              |
| **Railway**                   | $5 a month minimum, credited toward usage | Two services holding 256 MB each use about $5 of memory a month, before CPU |
| **Gregale**                   | Gregale Hobby: $10 a month for 5 apps     | Includes 1 managed PostgreSQL database; the API is not billed while paused  |
| **DigitalOcean App Platform** | 2 × $5 = $10 a month (512 MiB each)       | The free tier covers static sites only                                      |
| **Render**                    | 2 × $7 = $14 a month (512 MB each)        | Workers have no free instance; Render Postgres from $6 a month              |
| **Heroku**                    | 2 × $7 = $14 a month (0.5 GB each, Basic) | Eco dynos are $5 a month but sleep after 30 minutes idle                    |

On Gregale, Hobby includes 200 GB-RAM-hours a month. A worker that runs all
month at 256 MB uses most of it; an API that serves requests some of the time
adds little, because paused time is not billed. Past the allowance, usage
costs $0.05 per GB-RAM-hour, up to a spend cap you set, so a bill never runs
past the limit you chose.

## Reliability is where the platforms differ

- **Releases:** Render, Railway and Heroku switch all traffic to a new version
  once it passes its health check, and rolling back is a manual step. Fly.io
  replaces Machines one at a time. Gregale sends 1% of the API's traffic first
  and rolls back on its own on a higher 5xx rate, crash loops or slower responses (in
  beta).
- **Version skew:** on any platform, deploying the API and the worker
  separately can leave them on different versions for a while. Gregale's
  `depends_on` gate keeps them in step.
- **Database recovery:** Gregale's managed PostgreSQL keeps a 7-day
  point-in-time restore window, and on paid plans a rollback can restore the
  database to the moment before a migration. A database runs in a single zone,
  with no high-availability promise.
- **Isolation:** each Gregale app instance runs in its own Firecracker
  microVM, so a runaway worker cannot take memory from the API.

## How to choose

- **Lowest price for two always-on processes, and you will configure
  Machines yourself:** Fly.io.
- **Pay only for what each service uses, with Redis one click away:** Railway.
- **A fixed price per instance on a familiar platform:** Render or
  DigitalOcean App Platform.
- **A small team that wants the API and worker to release together, roll back
  on their own and stop billing for the API while it is idle:** Gregale.

## Sources

Gregale figures come from the [plans](/docs/plans) and
[managed PostgreSQL](/docs/postgres) docs. Other platforms' figures were
checked against each vendor's own pages on November 25, 2026:
[Fly.io pricing](https://fly.io/docs/about/pricing/),
[Fly.io Managed Postgres](https://fly.io/docs/mpg/),
[Railway pricing](https://railway.com/pricing),
[DigitalOcean App Platform pricing](https://docs.digitalocean.com/products/app-platform/details/pricing/),
[Render pricing](https://render.com/pricing),
[Render free instances](https://render.com/docs/free),
[Heroku pricing](https://www.heroku.com/pricing/).
