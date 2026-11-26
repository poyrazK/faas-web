**The main Render alternatives in 2026 are Railway, Fly.io, Heroku,
Northflank, Google Cloud Run, DigitalOcean App Platform and Gregale.** Railway
suits teams that want several databases in one click and usage-based billing.
Fly.io suits apps that need to run in many regions. Heroku still has the
largest add-on marketplace. Cloud Run is the natural pick for teams already on
Google Cloud that want to pay per request. Gregale fits small teams without an
ops person that want paid apps, not only free ones, to stop billing when idle,
releases that roll out gradually and roll back on their own, and a microVM per
app.

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

Usage-based hosting with one-click Postgres, Redis, MySQL and MongoDB. Railway
Hobby is $5 a month including $5 of usage; beyond that, Railway bills by the
second at $10 per GB of memory and $20 per vCPU a month. Free services sleep
when idle, and Railway's Serverless setting sleeps a service after about 10
minutes without outbound traffic. A new deployment takes over once its health
check passes; rolling back is manual.

- **Better than Render when:** you want several kinds of database next to your
  app in one click, or you'd rather pay for usage than per instance.

### Fly.io

Runs your container as Firecracker microVMs, called Machines, in many regions
worldwide. A Fly.io shared-cpu-1x Machine is $2.19 a month with 256 MB or $6.70
with 1 GB, billed by the second while it runs, and Machines can stop or
suspend when idle. Deploys are rolling by default; the canary strategy
health-checks one new Machine and then replaces the rest.

- **Better than Render when:** your users are spread across continents, or you
  want low-level control over each Machine, its size and its volumes. You set
  up more of it yourself, in `fly.toml`.

### Heroku

The original Git-push platform, with a large add-on marketplace, Heroku
Postgres and review apps. In February 2026 Heroku moved to a sustaining
engineering model focused on stability, security, reliability and support.
There is no free plan: Heroku Eco dynos are $5 a month and sleep after 30
minutes idle, and a Basic dyno is $7 a month for 0.5 GB, always on.

- **Better than Render when:** you depend on Heroku add-ons or need Shield
  dynos for compliance.

### Northflank

A container platform for services, jobs and databases that runs on
Northflank's own cloud or in a cluster in your own cloud account. The free
Sandbox covers 2 services, 2 jobs and 1 database, always on with no sleeping.
Paid usage is billed by the second at $0.01667 per vCPU-hour and $0.00833 per
GB-hour; a 0.5 vCPU, 1 GB plan is $12 a month.

- **Better than Render when:** you want a free tier that never sleeps, or the
  option of moving workloads into your own cloud account later.

### Google Cloud Run

Google's managed platform for containers. With request-based billing, a Cloud
Run service is billed only while it starts, shuts down or handles a request,
rounded up to 100 ms: $0.000024 per vCPU-second, $0.0000025 per GiB-second and
$0.40 per million requests in us-central1, after a monthly free tier. It
scales to zero; minimum instances stay warm and are billed while idle. Traffic
can be split between revisions by hand, and Cloud Deploy adds canary phases.

- **Better than Render when:** you already run on Google Cloud and want
  per-request billing. Databases, queues and networking are separate Google
  Cloud products that you connect yourself.

### DigitalOcean App Platform

DigitalOcean's platform for services, workers, jobs and static sites. Its free
tier covers static sites only. A DigitalOcean App Platform service starts at $5
a month for 1 shared vCPU and 512 MiB, billed at its monthly rate prorated by
the second, and a development database is $7 a month.

- **Better than Render when:** you want a lower fixed entry price, or you
  already use DigitalOcean Droplets or managed databases.

## How to choose

- **Several databases in one click, usage-based billing:** Railway.
- **Many regions, close to users:** Fly.io or Google Cloud Run.
- **Heroku add-ons or compliance dynos:** Heroku.
- **A free tier that never sleeps, or your own cloud account later:**
  Northflank.
- **Already on Google Cloud or DigitalOcean:** Cloud Run or App Platform.
- **Paid apps that cost nothing while idle, gradual releases with automatic
  rollback, and a fixed plan with a spend cap:** Gregale.

## Moving from Render to Gregale

Usually no code changes: both build from source or a Dockerfile, set `PORT`
and pass configuration as environment variables. Gregale does not read
`render.yaml`; its settings map to `gregale.yaml`, and Render's pre-deploy
command becomes a release command. See
[Migrate from Render](/docs/migrate-from-render) and the
[Gregale vs Render comparison](/vs/render).

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
