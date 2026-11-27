**The main Google Cloud Run alternatives in 2026 are Gregale, Fly.io, Render,
Railway, Northflank, DigitalOcean App Platform and Heroku.** Cloud Run is hard
to beat when your team already uses Google Cloud IAM, VPC Service Controls and
Cloud SQL, or when your traffic fits comfortably inside its monthly free tier.
Outside Google Cloud, many teams look for an alternative to avoid wiring
Cloud SQL, Artifact Registry, Load Balancing and IAM by hand for a standard API
and database. Gregale fits teams that want per-second billing that stops when
idle alongside built-in managed PostgreSQL, preview environments and canary
releases with automatic rollback.

_Gregale publishes this page. Each entry says where that platform is the
better choice, and every price names its vendor and comes from that vendor's
own pricing page or docs, checked on November 25, 2026._

## Why teams look for a Google Cloud Run alternative

- **Infrastructure assembly tax.** Cloud Run runs the container, while Cloud SQL,
  Artifact Registry, custom-domain load balancers, secrets and CI/CD triggers are
  separate Google Cloud products configured with IAM bindings.
- **Minimum instances cost all month.** Scaling to zero stops request billing,
  but keeping one container warm or attaching Cloud SQL leaves baseline
  charges running around the clock.
- **No built-in progressive error rollback.** Cloud Run supports manual traffic
  splitting across revisions; automated percentage canaries with error-based
  rollback require adding Cloud Deploy.

## At a glance

| Platform                      | Free option                                                               | Cheapest paid option                                     | How compute is billed                                         | Idle apps                                                               |
| ----------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **Gregale**                   | Gregale Free: 1 app with 256 MB and 20 GB-RAM-hours a month               | Gregale Hobby: $10 a month for 5 apps                    | By memory and time, CPU included, only while an instance runs | Pauses about a second after its last request and stops billing          |
| **Fly.io**                    | Fly.io Free plan: $5 of usage a month, up to 3 Machines                   | Fly.io shared-cpu-1x Machine: $2.19 a month with 256 MB  | By the second while a Machine runs                            | Machines can stop or suspend when idle and start on the next request    |
| **Render**                    | Render Free: 750 hours, 512 MB, 0.1 CPU; spins down after 15 minutes idle | Render Starter: $7 a month for 512 MB, 0.5 CPU           | Monthly price per instance, prorated by the second            | Free spins down after 15 minutes; paid instances run all the time       |
| **Railway**                   | Railway Free: $1 of usage a month                                         | Railway Hobby: $5 a month, including $5 of usage         | By the second: $10 per GB of memory and $20 per vCPU a month  | Free services sleep; Serverless sleeps when quiet                       |
| **Northflank**                | Northflank Sandbox: 2 services, 2 jobs and 1 database, always on          | Northflank 0.5 vCPU / 1 GB plan: $12 a month             | By the second: $0.01667 per vCPU-hour, $0.00833 per GB-hour   | Sandbox services are always on                                          |
| **DigitalOcean App Platform** | Static sites only (up to 3 apps)                                          | DigitalOcean service: $5 a month, 1 shared vCPU, 512 MiB | Monthly rate per service, prorated by the second              | Services bill at their monthly rate; only jobs bill just while they run |
| **Heroku**                    | None. Heroku Eco dynos are $5 a month and sleep after 30 minutes idle     | Heroku Basic dyno: $7 a month, 0.5 GB, always on         | Monthly price per dyno                                        | Eco dynos sleep; Basic and larger dynos run all the time                |

## The alternatives

### Gregale

A backend platform for small teams: APIs, services, background jobs, crons,
workflows and MCP servers, with managed PostgreSQL and object storage bundled in
one CLI (`gregale deploy`). Each app instance runs in its own Firecracker
microVM. Every production release goes to 1% of traffic first, then 10%, 50% and
100%, and rolls back automatically if the new version returns 5xx errors (in
beta). Preview environments come with every pull request.

- **Pricing:** Gregale Free is $0 for 1 app with 256 MB and 20 GB-RAM-hours a
  month, and stops at the allowance rather than billing you. Paid plans are
  Hobby $10, Pro $30 and Scale $99 a month; Hobby covers 5 apps with 512 MB
  each and 200 GB-RAM-hours. Compute is billed by memory and time, CPU
  included, only while an instance runs, up to a spend cap you set.
- **Better than Cloud Run when:** you want managed PostgreSQL, preview
  environments, crons, custom domains and automatic canary rollbacks without
  configuring GCP IAM, Cloud SQL and Cloud Deploy.
- **Watch out for:** one region today; no durable local disk, so state goes in
  managed PostgreSQL or object storage. Cloud Run is stronger when you need GCP
  VPC integration, many global regions, or GCP's monthly free tier of 180,000
  vCPU-seconds and 360,000 GiB-seconds.

### Fly.io

Runs your container as Firecracker microVMs, called Machines, across many global
regions. A Fly.io shared-cpu-1x Machine is $2.19 a month with 256 MB or $6.70
with 1 GB, billed by the second while running, and Machines can auto-stop and
auto-start on requests.

- **Better than Cloud Run when:** you want regional Firecracker microVMs,
  persistent regional volumes or simple WireGuard private networking without
  learning Google Cloud VPC topology.

### Render

Fixed-price PaaS for web services, workers, crons and managed Postgres. A Render
Starter instance is $7 a month for 512 MB and 0.5 CPU, always on, and Starter
Postgres starts at $6 a month.

- **Better than Cloud Run when:** you prefer flat monthly bills per instance
  over per-100 ms usage metering.

### Railway

Usage-based hosting with one-click Postgres, Redis, MySQL and MongoDB. Railway
Hobby is $5 a month including $5 of usage; beyond that, Railway bills by the
second at $10 per GB of memory and $20 per vCPU a month, with a Serverless mode
to sleep idle containers.

- **Better than Cloud Run when:** you want multiple databases, visual service
  graphs and instant Git deploys without GCP setup.

### Northflank

Managed container platform running on Northflank's cloud or inside your own AWS,
GCP or Azure cluster (BYOC). Free Sandbox covers 2 services, 2 jobs and 1
database; paid usage is $0.01667 per vCPU-hour and $0.00833 per GB-hour.

- **Better than Cloud Run when:** you want multi-cloud portability or managed
  jobs and databases in your own GCP project with less boilerplate.

### DigitalOcean App Platform

PaaS on DigitalOcean starting at $5 a month for 1 shared vCPU and 512 MiB, with
managed databases available starting at $7 a month for a development database.

- **Better than Cloud Run when:** your data or Droplets already live on
  DigitalOcean and you want flat monthly pricing.

### Heroku

The classic Git-push PaaS with buildpacks and a large add-on catalog, with Eco
dynos at $5 a month and Basic dynos at $7 a month. In February 2026 Heroku moved
to a sustaining engineering model.

- **Better than Cloud Run when:** you rely on existing Heroku add-ons or
  compliance dynos.

## How to choose

- **Already on GCP, or need multi-region serverless with generous free request volume:** stay on Google Cloud Run.
- **Many regions with Firecracker VMs and volumes:** Fly.io.
- **Flat monthly instance billing and classic PaaS:** Render.
- **Multi-database projects with visual service wiring:** Railway.
- **Built-in Postgres, PR previews, idle billing stop after ~1s and automatic canary rollbacks:** Gregale.

## Moving from Cloud Run to Gregale

Standard Dockerfiles and HTTP servers listening on `PORT` run on Gregale without
code rewrites. Environment variables and secrets replace Secret Manager mounts,
and if you connect to Cloud SQL today you can move to bundled managed
PostgreSQL (`DATABASE_URL`). See [Migrate from Google Cloud Run](/docs/migrate-from-cloud-run),
[Container compatibility](/docs/container-compatibility)
and [Gregale vs Google Cloud Run](/vs/cloud-run).

To run the image Cloud Run already uses:

```bash
gregale deploy check --image registry.example.com/team/api@sha256:<digest>
gregale deploy --image registry.example.com/team/api@sha256:<digest>
```

## Sources

Checked against each vendor's own pages on November 25, 2026:
[Google Cloud Run pricing](https://cloud.google.com/run/pricing),
[Cloud Run traffic migration](https://docs.cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration),
[Fly.io pricing](https://fly.io/docs/about/pricing/),
[Render pricing](https://render.com/pricing),
[Railway pricing](https://railway.com/pricing),
[Northflank pricing](https://northflank.com/pricing),
[DigitalOcean App Platform pricing](https://docs.digitalocean.com/products/app-platform/details/pricing/),
[Heroku pricing](https://www.heroku.com/pricing/),
[Gregale pricing](/pricing).
