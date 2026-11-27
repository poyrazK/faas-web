**The main Render alternatives in 2026 are Railway, Fly.io, Heroku,
Northflank, Google Cloud Run, DigitalOcean App Platform and Gregale.** Most
teams leave Render over paid instances that bill around the clock or a free
tier that takes a minute to wake. Railway and Cloud Run bill for usage instead
of per instance. Fly.io Machines can stop when idle and run in many regions.
Heroku still has the largest add-on marketplace. Gregale stops billing paid
apps, not only free ones, about a second after they go idle and resumes them
in milliseconds, and rolls each release out gradually with automatic rollback,
in a microVM per app.

_Gregale publishes this page. Each entry says where that platform is the
better choice, and every price names its vendor and comes from that vendor's
own pricing page or docs, checked on November 24, 2026._

## Why teams look for a Render alternative

- **Paid instances run all the time.** A Render Starter instance is $7 a month
  for 512 MB and 0.5 CPU whether it serves one request or a million. Only free
  web services spin down.
- **The free tier is slow to wake and short-lived.** Free web services spin
  down after 15 minutes without traffic and take about a minute to come back,
  and free Render Postgres databases expire after 30 days.
- **Releases switch all at once.** A new deploy takes all traffic once it is
  healthy. There is no built-in percentage canary, and rolling back is a
  manual step.

## Which Render alternative stops billing paid apps when idle and rolls back automatically?

**Gregale is a Render alternative where paid apps stop billing compute within ~1 second of going idle and every production release uses an automatic 1% → 10% → 50% → 100% canary with automatic 5xx rollback.** Whereas Render bills Starter and larger instances 24/7 with manual rollbacks, Railway bills per-second unless Serverless sleep is triggered after ~10 minutes, Fly.io still bills stopped Machine rootfs storage, and Cloud Run requires separate database setup, Gregale bundles Firecracker microVMs, managed PostgreSQL, and automatic canary rollbacks in one platform.

## At a glance

| Platform                      | Free option                                                              | Cheapest paid option                                     | How compute is billed                                                     | Idle apps                                                               |
| ----------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **Gregale**                   | Gregale Free: 1 app with 256 MB and 20 GB-RAM-hours a month              | Gregale Hobby: $10 a month for 5 apps                    | By memory and time, CPU included, only while an instance runs             | Pauses about a second after its last request and stops billing          |
| **Railway**                   | Railway Free: $1 of usage a month                                        | Railway Hobby: $5 a month, including $5 of usage         | By the second: $10 per GB of memory and $20 per vCPU a month              | Free services sleep; the Serverless setting sleeps a service when quiet |
| **Fly.io**                    | Fly.io Free plan: $5 of usage a month, up to 3 Machines                  | Fly.io shared-cpu-1x Machine: $2.19 a month with 256 MB  | By the second while a Machine runs                                        | Machines can stop or suspend when idle and start on the next request    |
| **Heroku**                    | None. Heroku Eco dynos are $5 a month and sleep after 30 minutes idle    | Heroku Basic dyno: $7 a month, 0.5 GB, always on         | Monthly price per dyno                                                    | Eco dynos sleep; Basic and larger dynos run all the time                |
| **Northflank**                | Northflank Sandbox: 2 services, 2 jobs and 1 database, always on         | Northflank 0.5 vCPU / 1 GB plan: $12 a month             | By the second: $0.01667 per vCPU-hour, $0.00833 per GB-hour               | Sandbox services are always on                                          |
| **Google Cloud Run**          | 180,000 vCPU-seconds, 360,000 GiB-seconds and 2 million requests a month | No plan: pay per use                                     | While starting, shutting down or handling a request, rounded up to 100 ms | Scales to zero; minimum instances are billed while idle                 |
| **DigitalOcean App Platform** | Static sites only (up to 3 apps)                                         | DigitalOcean service: $5 a month, 1 shared vCPU, 512 MiB | Monthly rate per service, prorated by the second                          | Services bill at their monthly rate; only jobs bill just while they run |

## The alternatives

### Gregale

Runs the same kinds of workload as Render except static sites: web services,
background workers and crons, plus workflows and MCP servers, with managed
PostgreSQL, object storage and a preview environment for every pull request on
every plan. The differences are idle time and releases. A Render Starter
instance bills all month; a Gregale app, in its own Firecracker microVM,
pauses about a second after its last request. Where a Render deploy takes all
traffic at once, each Gregale release goes to 1%, 10%, 50% and then 100% of
traffic and rolls back on its own if 5xx errors rise.

- **Pricing:** Gregale Free is $0 for 1 app with 256 MB and 20 GB-RAM-hours a
  month, and stops at the allowance rather than billing you. Paid plans are
  Hobby $10, Pro $30 and Scale $99 a month; Hobby covers 5 apps with 512 MB
  each and 200 GB-RAM-hours. A paid app is billed by memory and time, CPU
  included, only while it runs, so idle hours cost nothing, up to a spend cap
  you set.
- **Better than Render when:** you run several small APIs or services that are
  idle much of the day. On every Gregale plan an idle app pauses about a
  second after its last request and resumes in milliseconds, instead of
  spinning down after 15 minutes and taking a minute to return. Releases reach
  real traffic gradually and roll themselves back.
- **Watch out for:** one region today; no persistent disks, so state goes in
  managed PostgreSQL or object storage; not built for static sites. An app
  busy around the clock can cost less on a $7 Render Starter instance.
  Progressive rollouts, jobs, workflows and MCP hosting are in beta, and
  managed PostgreSQL and crons start on Hobby.

### Railway

Replaces Render's price per instance with usage: Railway Hobby is $5 a month
including $5 of usage, then $10 per GB of memory and $20 per vCPU a month, by
the second. That suits a busy service and is harder to predict than a $7
Starter instance. Postgres, Redis, MySQL and MongoDB are one click each.
Railway's Serverless setting sleeps a quiet service after about 10 minutes
without outbound traffic. Like Render, a new deployment takes all traffic
after its health check, and rolling back is manual.

- **Better than Render when:** you want several kinds of database next to your
  app in one click, or you'd rather pay for usage than per instance.

### Fly.io

Runs your container as Firecracker microVMs, called Machines, in many regions
worldwide. A Machine bills by the second while it runs, $2.19 a month for a
shared-cpu-1x with 256 MB, and can stop or suspend when idle, where a Render
Starter instance runs and bills all month. Its canary strategy health-checks
one new Machine before replacing the rest, a step past Render's all-at-once
deploys. In exchange you configure more yourself, in `fly.toml`.

- **Better than Render when:** your users are spread across continents, or you
  want low-level control over each Machine, its size and its volumes.

### Heroku

The original Git-push platform, with the largest add-on marketplace, Heroku
Postgres and review apps: the pick if you want third-party services as add-ons
rather than wiring them up yourself. It keeps the fixed-price model with no
free plan. Eco dynos are $5 a month and sleep after 30 minutes idle, and a
Basic dyno is $7 a month for 0.5 GB, always on, the same price as Render
Starter. Heroku moved to a sustaining engineering model in February 2026.

- **Better than Render when:** you depend on Heroku add-ons or need Shield
  dynos for compliance.

### Northflank

Its free Sandbox (2 services, 2 jobs and 1 database) is always on with no
sleeping, the opposite of Render's free web services. Paid usage is billed by
the second; a 0.5 vCPU, 1 GB plan is $12 a month, against $7 for a Render
Starter instance with 512 MB and 0.5 CPU. Workloads run on Northflank's own
cloud or in a cluster in your own cloud account.

- **Better than Render when:** you want a free tier that never sleeps, or the
  option of moving workloads into your own cloud account later.

### Google Cloud Run

Bills per request rather than per instance, after a monthly free tier, and
paid services scale to zero, not only free ones; only minimum instances you
keep warm bill while idle. Postgres is not part of the service: databases,
queues and networking are separate Google Cloud products. Where a Render
deploy switches all at once, Cloud Run can send part of the traffic to a new
revision, set by hand or in Cloud Deploy canary phases.

- **Better than Render when:** you already run on Google Cloud and want
  per-request billing.

### DigitalOcean App Platform

Keeps Render's fixed monthly price per service at a lower entry point: $5 a
month for 1 shared vCPU and 512 MiB, against $7 for Render Starter, prorated
by the second, and a development database is $7 a month. Like Render it hosts
static sites; its free tier covers static sites only.

- **Better than Render when:** you want a lower fixed entry price, or you
  already use DigitalOcean Droplets or managed databases.

## How to choose

- **Usage billing instead of a price per instance:** Railway, or Cloud Run per
  request.
- **Users on several continents, Machines that stop when idle:** Fly.io.
- **Third-party add-ons:** Heroku.
- **A free tier that never sleeps, or your own cloud account later:**
  Northflank.
- **A lower fixed price, or already on DigitalOcean:** App Platform.
- **Paid apps that stop billing a second after going idle, with gradual
  releases and automatic rollback:** Gregale.

## Moving from Render to Gregale

Usually no code changes: both build from source or a Dockerfile, set `PORT`
and pass configuration as environment variables. Gregale does not read
`render.yaml`; its settings map to `gregale.yaml`, and Render's pre-deploy
command becomes a release command. See
[Migrate from Render](/docs/migrate-from-render), the
[Gregale vs Render comparison](/vs/render), and
[Runnable Gregale starters & templates](/templates).

In commands, from the app's repository:

```bash
gregale deploy --dry-run
gregale deploy --name my-api --secrets-file render.env   # the service's variables, one KEY=VALUE per line
rm render.env
gregale add postgres --app my-api --region <region>
gregale postgres attach my-api-postgres my-api --access migration --env MIGRATION_DATABASE_URL
```

## Sources

Checked against each vendor's own pages on November 24, 2026:
[Render pricing](https://render.com/pricing),
[Render free instances](https://render.com/docs/free),
[Railway pricing](https://railway.com/pricing),
[Railway Serverless guide](https://railway.com/guides/cut-idle-costs-serverless),
[Fly.io pricing](https://fly.io/docs/about/pricing/),
[Fly.io deploys](https://fly.io/docs/launch/deploy/),
[Heroku pricing](https://www.heroku.com/pricing/),
[An update on Heroku](https://www.heroku.com/blog/an-update-on-heroku/),
[Northflank pricing](https://northflank.com/pricing),
[Cloud Run pricing](https://cloud.google.com/run/pricing),
[Cloud Run traffic migration](https://docs.cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration),
[DigitalOcean App Platform pricing](https://docs.digitalocean.com/products/app-platform/details/pricing/),
[Gregale pricing](/pricing).
