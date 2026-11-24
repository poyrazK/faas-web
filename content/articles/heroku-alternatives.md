**The main Heroku alternatives in 2026 are Render, Railway, Fly.io, Northflank,
Google Cloud Run, DigitalOcean App Platform and Gregale.** Render is the
closest like-for-like move: Git deploys, managed Postgres, preview
environments and a fixed monthly price per instance. Railway suits teams that
want several databases in one click and usage-based billing. Fly.io suits
apps that need to run in many regions. Cloud Run is the natural pick for teams
already on Google Cloud. Gregale fits small teams without an ops person that
want a Heroku-style workflow (it reads your `Procfile`) plus releases that roll
out gradually and roll back on their own, apps that stop billing when idle,
and a microVM per app.

_Gregale publishes this page. Each entry says where that platform is the
better choice, and every price names its vendor and comes from that vendor's
own pricing page or docs, checked on November 24, 2026._

## Why teams look for a Heroku alternative

- **Heroku is in sustaining mode.** In February 2026 Heroku moved to a
  sustaining engineering model focused on stability, security, reliability and
  support, so teams planning years ahead are weighing where new features will
  come from.
- **There is no free plan.** Heroku Eco dynos are $5 a month and sleep after
  30 minutes idle; a Basic dyno is $7 a month for 0.5 GB, always on.
- **Each process is a dyno with a monthly price.** Every web and worker
  process is billed as its own dyno, whether or not it is serving traffic.
- **Rolling back is manual.** Preboot (on Standard and Performance dynos)
  starts new dynos before stopping old ones, but there is no gradual
  percentage rollout, and `heroku releases:rollback` is a command you run.

## At a glance

| Platform                      | Free option                                                              | Cheapest paid option                                     | How compute is billed                                                     | Idle apps                                                               |
| ----------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **Gregale**                   | Gregale Free: 1 app with 256 MB and 20 GB-RAM-hours a month              | Gregale Hobby: $10 a month for 5 apps                    | By memory and time, CPU included, only while an instance runs             | Pauses about a second after its last request and stops billing          |
| **Render**                    | Free web services (512 MB) that spin down after 15 minutes idle          | Render Starter: $7 a month, 512 MB, always on            | Monthly price per instance, plus a workspace plan                         | Only free web services spin down; waking takes about a minute           |
| **Railway**                   | Railway Free: $1 of usage a month                                        | Railway Hobby: $5 a month, including $5 of usage         | By the second: $10 per GB of memory and $20 per vCPU a month              | Free services sleep; the Serverless setting sleeps a service when quiet |
| **Fly.io**                    | Fly.io Free plan: $5 of usage a month, up to 3 Machines                  | Fly.io shared-cpu-1x Machine: $2.19 a month with 256 MB  | By the second while a Machine runs                                        | Machines can stop or suspend when idle and start on the next request    |
| **Northflank**                | Northflank Sandbox: 2 services, 2 jobs and 1 database, always on         | Northflank 0.5 vCPU / 1 GB plan: $12 a month             | By the second: $0.01667 per vCPU-hour, $0.00833 per GB-hour               | Sandbox services are always on                                          |
| **Google Cloud Run**          | 180,000 vCPU-seconds, 360,000 GiB-seconds and 2 million requests a month | No plan: pay per use                                     | While starting, shutting down or handling a request, rounded up to 100 ms | Scales to zero; minimum instances are billed while idle                 |
| **DigitalOcean App Platform** | Static sites only (up to 3 apps)                                         | DigitalOcean service: $5 a month, 1 shared vCPU, 512 MiB | Monthly rate per service, prorated by the second                          | Services bill at their monthly rate; only jobs bill just while they run |

## The alternatives

### Gregale

A backend platform for small teams: APIs, services, background jobs, crons,
workflows and MCP servers, with managed PostgreSQL and object storage. Each app
instance runs in its own Firecracker microVM. Every production release goes to
1% of traffic first, then 10%, 50% and 100%, and rolls back on its own if the
new version starts returning 5xx errors. A preview environment comes with
every pull request, on every plan.

- **Pricing:** Gregale Free is $0 for 1 app with 256 MB and 20 GB-RAM-hours a
  month, and stops at the allowance rather than billing you. Paid plans are
  Hobby $10, Pro $30 and Scale $99 a month; Hobby covers 5 apps with 512 MB
  each and 200 GB-RAM-hours. Compute is billed by memory and time, CPU
  included, only while an instance runs, up to a spend cap you set.
- **Better than Heroku when:** you want to keep the Heroku workflow without
  the per-dyno bill. Gregale reads the same `Procfile`, including its release
  command, builds Node, Python and Go from source without a Dockerfile, turns
  Heroku Scheduler jobs into crons and worker dynos into background services,
  and adds gradual releases with automatic rollback.
- **Watch out for:** one region today; no add-on marketplace; no durable local
  disk, so state goes in managed PostgreSQL or object storage. An app busy
  around the clock can cost less on a $7 Heroku Basic dyno. Progressive
  rollouts, jobs, workflows and MCP hosting are in beta, and managed
  PostgreSQL and crons start on Hobby.

### Render

Git deploys for web services, workers, cron jobs and static sites, with managed
Postgres, preview environments and a fixed monthly price per instance. A
Render Starter instance is $7 a month for 512 MB and 0.5 CPU, always on. Free
web services spin down after 15 minutes without traffic and take about a
minute to come back, and free Render Postgres databases expire after 30 days.
A new deploy takes all traffic once it is healthy; rolling back is manual.

- **Better than Heroku when:** you want the closest match to Heroku's model,
  with a persistent disk option (Render charges $0.25 per GB a month) and free
  static sites.

### Railway

Usage-based hosting with one-click Postgres, Redis, MySQL and MongoDB. Railway
Hobby is $5 a month including $5 of usage; beyond that, Railway bills by the
second at $10 per GB of memory and $20 per vCPU a month. Free services sleep
when idle, and Railway's Serverless setting sleeps a service after about 10
minutes without outbound traffic. A new deployment takes over once its health
check passes; rolling back is manual.

- **Better than Heroku when:** you want several kinds of database next to your
  app in one click, or volumes for files that survive restarts (Railway
  charges $0.15 per GB a month).

### Fly.io

Runs your container as Firecracker microVMs, called Machines, in many regions
worldwide. A Fly.io shared-cpu-1x Machine is $2.19 a month with 256 MB or $6.70
with 1 GB, billed by the second while it runs, and Machines can stop or
suspend when idle. Deploys are rolling by default; the canary strategy
health-checks one new Machine and then replaces the rest.

- **Better than Heroku when:** your users are spread across continents, or you
  want low-level control over each Machine. You set up more of it yourself, in
  `fly.toml`, rather than in a `Procfile`.

### Northflank

A container platform for services, jobs and databases that runs on
Northflank's own cloud or in a cluster in your own cloud account. The free
Sandbox covers 2 services, 2 jobs and 1 database, always on with no sleeping.
Paid usage is billed by the second at $0.01667 per vCPU-hour and $0.00833 per
GB-hour; a 0.5 vCPU, 1 GB plan is $12 a month.

- **Better than Heroku when:** you want the option of moving workloads into
  your own cloud account later, with the same tool.

### Google Cloud Run

Google's managed platform for containers. With request-based billing, a Cloud
Run service is billed only while it starts, shuts down or handles a request,
rounded up to 100 ms: $0.000024 per vCPU-second, $0.0000025 per GiB-second and
$0.40 per million requests in us-central1, after a monthly free tier. It
scales to zero; minimum instances stay warm and are billed while idle. Traffic
can be split between revisions by hand, and Cloud Deploy adds canary phases.

- **Better than Heroku when:** you already run on Google Cloud. Databases,
  queues and networking are separate Google Cloud products that you connect
  yourself, rather than Heroku add-ons.

### DigitalOcean App Platform

DigitalOcean's platform for services, workers, jobs and static sites. Its free
tier covers static sites only. A DigitalOcean App Platform service starts at $5
a month for 1 shared vCPU and 512 MiB, billed at its monthly rate prorated by
the second, and a development database is $7 a month.

- **Better than Heroku when:** you want a similar fixed-price model at a lower
  entry price, or you already use DigitalOcean Droplets or managed databases.

## How to choose

- **Closest like-for-like move:** Render.
- **Several databases in one click:** Railway.
- **Many regions, close to users:** Fly.io or Google Cloud Run.
- **Your own cloud account later:** Northflank.
- **Already on Google Cloud or DigitalOcean:** Cloud Run or App Platform.
- **The Heroku workflow with gradual releases, automatic rollback and idle
  apps that cost nothing:** Gregale.

## Moving from Heroku to Gregale

Usually no code changes: Gregale reads your `Procfile` (`web:` is the start
command, `release:` runs before the new version takes traffic), takes config
vars as environment variables and secrets, and builds from source. See
[Migrate from Heroku](/docs/migrate-from-heroku) and the
[Gregale vs Heroku comparison](/vs/heroku).

## Sources

Checked against each vendor's own pages on November 24, 2026:
[Heroku pricing](https://www.heroku.com/pricing/),
[An update on Heroku](https://www.heroku.com/blog/an-update-on-heroku/),
[Heroku preboot](https://devcenter.heroku.com/articles/preboot),
[Heroku releases](https://devcenter.heroku.com/articles/releases),
[Render pricing](https://render.com/pricing),
[Render free instances](https://render.com/docs/free),
[Railway pricing](https://railway.com/pricing),
[Railway Serverless guide](https://railway.com/guides/cut-idle-costs-serverless),
[Fly.io pricing](https://fly.io/docs/about/pricing/),
[Fly.io deploys](https://fly.io/docs/launch/deploy/),
[Northflank pricing](https://northflank.com/pricing),
[Cloud Run pricing](https://cloud.google.com/run/pricing),
[Cloud Run traffic migration](https://docs.cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration),
[DigitalOcean App Platform pricing](https://docs.digitalocean.com/products/app-platform/details/pricing/),
[Gregale pricing](/pricing).
