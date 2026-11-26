**Host a FastAPI app with background jobs on a platform that runs the API, a
worker and managed Postgres side by side and deploys them as one unit, so the
worker never runs a different version of your code than the API.** On Gregale
you describe the API and the worker in a Compose file, add a `postgres`
service, and `gregale deploy` creates both services and a managed PostgreSQL
database, runs your migrations before each release, and rolls a bad release
back on its own. Render, Railway, Fly.io and Heroku also run a web service, a
worker and Postgres together; the differences are in pricing, releases and
whether you need Redis.

## Pick the right place for each kind of background work

Not every background task needs a worker:

- **Short work after a response,** such as sending an email: FastAPI's
  `BackgroundTasks` run it in the same process once the response is sent. On
  Gregale the instance keeps running, and is billed, while the task works, then
  pauses. A crash or redeploy loses a task that has not finished, so keep this
  for work you can afford to lose.
- **Work on a schedule,** such as a nightly cleanup: a
  [cron](/docs/crons) sends a `POST` to a path on your app. Gregale wakes the
  app for it and lets it pause again afterwards.
- **Batch work,** such as reprocessing every upload: a
  [job](/docs/jobs) runs your container as many tasks in parallel, each in its
  own microVM, with retries, logs and results (in beta).
- **A steady stream of jobs from the API:** a worker service that takes jobs
  from a queue. This is the case the rest of this page covers.

Requests have a time limit (60 seconds on Hobby, 5 minutes on Pro), so
anything slower than that belongs in a worker or a job, not in the request.

## The API, the worker and Postgres on Gregale

```yaml
# compose.yaml
services:
  migrate:
    build: .
    command: alembic upgrade head
  api:
    build: .
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000
    ports: ['8000:8000']
    depends_on:
      db:
        condition: service_healthy
      migrate:
        condition: service_completed_successfully
  worker:
    build: .
    command: python -m app.worker
    depends_on: [db]
  db:
    image: postgres:17
```

`gregale deploy` reads this as one project:

- **`api`** becomes an app with a public URL. It pauses about a second after
  its last request and is not billed while paused.
- **`worker`** has no `ports:`, so it becomes a background service that runs
  all the time.
- **`db`** becomes a managed PostgreSQL database. Both services get its
  connection string as `DATABASE_URL`, delivered as a secret.
- **`migrate`** is not deployed. It runs `alembic upgrade head` once before
  each `api` release goes live, in the `api` image with its variables and
  secrets.

A project with two or more services needs Hobby or higher. See
[Deploy a multi-service app](/docs/multi-service) and
[Deploy a FastAPI app](/docs/deploy-fastapi).

## Where the worker gets its jobs

The worker needs a queue that survives restarts:

- **Postgres-backed,** such as Procrastinate: jobs live in the database you
  already have, with its backups and point-in-time restore. No extra service
  to run, which suits most small apps.
- **Redis-backed,** such as Celery, Dramatiq, RQ or ARQ: higher throughput,
  one more system to run. Gregale's managed Redis is not generally available
  yet, so point `REDIS_URL` at a Redis you run elsewhere.

If jobs arrive with requests and each one is short, you may not need a worker
at all.
[gregale-dev/fastapi-postgres-jobs](https://github.com/gregale-dev/fastapi-postgres-jobs)
is a complete FastAPI app that stores each job in Postgres, runs it in a
background task right after the request, retries failures with backoff, and
claims jobs with `FOR UPDATE SKIP LOCKED`. A cron sweep every few hours
recovers jobs that a crash interrupted. Nothing polls the database, so the
app and the database both stop when no requests arrive.

## Managed PostgreSQL on Gregale

Managed PostgreSQL starts on Hobby: 1 database with 1 GiB of storage and a
7-day point-in-time restore window, more on Pro and Scale. Its compute stops
while the database is idle. A database runs in a single zone, with no
high-availability promise; point-in-time restore is the recovery path. On
paid plans, a rollback can also restore the database to the moment before a
migration. See [Managed PostgreSQL](/docs/postgres).

## How other platforms run the same app

- **Render:** a web service and a background worker, from $7 a month each on
  Render Starter (workers have no free instance), Render Postgres from $6 a
  month, and Render Key Value from $10 a month if your queue needs Redis. New
  deploys take all traffic once healthy.
- **Railway:** the API, the worker, Postgres and Redis as services in one
  project, each billed by the second for the memory and CPU it uses.
- **Fly.io:** the API and the worker as process groups in one `fly.toml`, each
  on its own Machines from $2.19 a month, and Fly.io Managed Postgres from $4 a
  month. You configure more of it yourself.
- **Heroku:** `web` and `worker` dynos from your Procfile at $7 a month each
  on Basic, with Heroku Postgres and Heroku Key-Value Store (Redis) as
  add-ons.

Gregale's difference is in releases and idle time: every production release
reaches 1% of traffic first and rolls back on its own on errors (in beta), and
the API stops billing between requests. The worker runs all the time on every
platform here, Gregale included.

## What it costs

On Gregale, Hobby is $10 a month for up to 5 apps with 512 MB each and 200
GB-RAM-hours, and includes the managed PostgreSQL database. A worker that runs
all month at 256 MB uses most of that allowance, while an API that serves
requests some of the time uses little: in
[our measurement of an intermittent FastAPI app](/research/intermittent-fastapi-cost-2026-11-24),
40 requests a day for 30 days came to an estimated 0.15 GB-RAM-hours. Usage
past the allowance costs $0.05 per GB-RAM-hour, up to a spend cap you set.

## Sources

Gregale figures come from the [plans](/docs/plans) and
[managed PostgreSQL](/docs/postgres) docs. Other platforms' figures were
checked against each vendor's own pages on November 25, 2026:
[Render pricing](https://render.com/pricing),
[Render free instances](https://render.com/docs/free),
[Railway pricing](https://railway.com/pricing),
[Fly.io pricing](https://fly.io/docs/about/pricing/),
[Fly.io Managed Postgres](https://fly.io/docs/mpg/),
[Heroku pricing](https://www.heroku.com/pricing/).
