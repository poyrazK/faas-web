**What a small managed Postgres database costs depends first on whether it can
sleep.** Neon, Railway and Gregale stop the database's compute when it is idle,
so a database used a few hours a day costs little or nothing. Supabase, Render,
Fly.io, Heroku and DigitalOcean bill a running instance all month. For a
database that must stay on, the smallest paid plans start at $4 a month on
Fly.io, $5 on Heroku and $6.30 on Render.

_Gregale publishes this page. Every price names its vendor and comes from that
vendor's own pricing page or docs, checked on November 28, 2026._

## At a glance

| Provider         | Smallest paid database                                                          | When the database is idle                                                        | Point-in-time restore                                        | Free option                                           |
| ---------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------- |
| **Gregale**      | Gregale Hobby: $10 a month for 5 apps, with one managed database                | Compute suspends after 2 minutes by default (1 minute to 1 hour)                 | 7 days, 1 GiB of restore history included                    | None: Gregale Free has no managed Postgres            |
| **Neon**         | Launch: $0.106 per CU-hour and $0.35 per GB-month, billed on usage              | Scales to zero after 5 minutes; Launch can turn this off                         | Up to 7 days on Launch, history at $0.20 per GB-month        | 100 CU-hours and 1 GB per project, up to 100 projects |
| **Supabase**     | Pro: $25 a month, including one Micro instance (1 GB RAM) and 8 GB of disk      | Runs all the time; Free projects pause after a week of inactivity                | Add-on from $100 a month; Pro keeps daily backups for 7 days | 2 projects with 500 MB each, no backups               |
| **Render**       | Basic-256mb: $6 a month plus $0.30 per GB of storage                            | Runs all the time                                                                | 3 days on a Hobby workspace, 7 days on paid workspace plans  | 1 GB, expires 30 days after it is created             |
| **Railway**      | Usage: $10 per GB of memory, $20 per vCPU and $0.15 per GB of volume a month    | Runs all the time on Hobby by default; sleeps after 5 to 10 idle minutes on Free | Opt-in, about 4 weeks, archived to a Railway bucket          | Inside the Free plan's $1 of usage a month            |
| **Fly.io**       | Managed Postgres Developer: $4 a month with 256 MB, storage included up to 5 GB | Runs all the time                                                                | Backups on every plan                                        | The Developer plan fits in the Free plan's $5 a month |
| **Heroku**       | Essential-0: $5 a month with 1 GB of storage and 20 connections                 | Runs all the time                                                                | None on Essential; daily logical backups are free            | None                                                  |
| **DigitalOcean** | $15.15 a month for 1 GiB of RAM, 1 vCPU and 10 GiB of disk                      | Runs all the time                                                                | Any point in the previous 7 days                             | None                                                  |

## Two monthly bills, worked out

Each cell is the lowest bill for the database alone, for a 30-day month, on
that provider's own prices. Apps, egress and support plans are not included.

| Workload                                         | Gregale         | Neon             | Railway        | Fly.io | Heroku | Render | DigitalOcean | Supabase      |
| ------------------------------------------------ | --------------- | ---------------- | -------------- | -----: | -----: | -----: | -----------: | ------------- |
| **A.** 400 MB of data, awake about 3 hours a day | $10.00 on Hobby | $0 on Free       | $0 on Free     |  $4.00 |  $5.00 |  $6.30 |       $15.15 | $0 on Free    |
| **B.** 1 GB of data, always on                   | Not offered     | $19.43 on Launch | $5.00 on Hobby |  $4.00 |  $5.00 |  $6.30 |       $15.15 | $25.00 on Pro |

What is behind each cell:

- **A, a database used a few hours a day.** Neon, Railway and Gregale bill
  only the time the database is awake. On Neon, 90 hours at 0.25 CU is 22.5
  CU-hours, inside the Free plan's 100. On Railway Free, 90 hours at 256 MB and
  0.05 vCPU, plus the volume, comes to about $0.50 of the $1. On Gregale, 90
  hours at the development class's smallest size of 0.25 compute units is 22.5
  of Hobby's 25 CU-hours, so the bill is Hobby's $10, which also covers 5
  apps. Supabase Free covers 500 MB but pauses a project after a week without
  activity. The always-on providers bill the same as in workload B.
- **B, a database that must answer instantly at any hour.** The smallest
  always-on plans differ in memory: 256 MB on Fly.io and Render, 1 GB on
  Supabase and DigitalOcean, and about 1 GB on Neon at 0.25 CU. Railway's
  usage for a database averaging 256 MB and 0.05 vCPU is about $3.65 a month,
  inside the $5 that Hobby includes. Neon bills 180 CU-hours with scale to
  zero turned off. Gregale does not offer always-on compute on its plans:
  Hobby's 25 CU-hours keep a database awake about 100 hours a month at its
  smallest size.

So the cheapest choice is Neon Free for a database that sleeps, and Fly.io,
Heroku or Render for one that must stay on. Gregale costs more for a database
alone. It is cheapest when the $10 also replaces app hosting: Hobby runs 5
apps and their database, and both stop billing between requests.

## What you give up on the cheapest plans

- **Fly.io Developer** has no support and no connection pooling, and its
  storage stops at 5 GB. Basic, the next plan, is $38 a month with 1 GB of
  memory. Every Managed Postgres plan includes high availability and backups.
- **Heroku Essential** has no rollback, fork or follow, a 20-connection limit
  on Essential-0, no Postgres logs, and expected uptime of 99.5%. Heroku
  PGBackups takes free daily logical backups.
- **Render** sets storage at 1 GB or a multiple of 5 GB, and it can grow but
  never shrink. Free databases have no backups and are deleted 14 days after
  they expire.
- **Supabase** Pro includes $10 a month of compute credit, enough for one
  Micro instance. Each further project needs its own compute, from $10 a
  month. Pro has a spend cap on by default.
- **DigitalOcean** includes a 7-day restore window and 10 GiB of disk on its
  smallest plan, and more storage costs $0.215 per GiB a month. A single-node
  cluster is not highly available.
- **Neon** stops a Free project's compute for the rest of the month if it uses
  its 100 CU-hours or 5 GB of network transfer. A database waking from zero
  starts on the next query, typically within a few hundred milliseconds.
- **Railway** bills a Hobby database for the memory and CPU it uses all month.
  On the Free plan, a database sleeps after 5 to 10 minutes without outbound
  traffic and wakes on the next connection, but its usage draws from the same
  $1 as your services.

## Gregale's managed Postgres

Every Gregale plan above Free includes managed Postgres. Gregale Hobby: $10 a
month for 5 apps, with one managed database, 1 GiB of pooled storage, 25
CU-hours of compute a month, 1 GiB of restore history and a 7-day restore
window. Pro has 3 databases, 5 GiB and 75 CU-hours; Scale has 10, 20 GiB and 200.

A database's compute suspends after 2 minutes without activity by default,
and you can set it from 1 minute to 1 hour. Every wake bills at least that
long, and the first query after idle waits a few hundred milliseconds while
the database starts. With `app-wake` on, the database starts as soon as an
app bound to it starts waking.

Without overage, the plan is a limit: at the compute allowance, databases are
suspended until the month ends, and nothing past the plan is billed. With
overage on, compute past the allowance costs $0.2331 per CU-hour and storage
past the pool $0.50 per GiB-month, up to your spend cap. A database runs in
a single zone, and Gregale makes no high-availability promise for it;
point-in-time restore and the 7-day undo of a delete are the recovery paths.

## How the numbers were calculated

Every workload uses a 30-day month (720 hours).

- **Workload A:** the database is awake 90 hours in the month at its smallest
  size, with 400 MB of data.
- **Workload B:** the database runs all 720 hours with 1 GB of data.
- **Neon:** 0.25 CU, Neon's default Free size, at Launch prices when Free does
  not cover it.
- **Railway:** a database averaging 256 MB of memory and 0.05 vCPU while
  awake, with a volume the size of its data.
- **Render:** Basic-256mb with 1 GB of storage, Render's smallest size.
- **Fly.io, Heroku, DigitalOcean and Supabase:** each provider's smallest
  paid plan, which covers the data in both workloads.
- **Gregale:** the development class's smallest compute, 0.25 compute units.

## Sources

Checked against each vendor's own pages on November 28, 2026:
[Neon pricing](https://neon.com/pricing),
[Supabase pricing](https://supabase.com/pricing),
[Render pricing](https://render.com/pricing),
[Render Postgres storage](https://render.com/docs/postgresql-creating-connecting),
[Render Postgres recovery and backups](https://render.com/docs/postgresql-backups),
[Railway plans](https://docs.railway.com/pricing/plans),
[Railway Free plan](https://docs.railway.com/pricing/free-plan),
[Railway backups](https://docs.railway.com/volumes/backups),
[Railway point-in-time recovery](https://docs.railway.com/volumes/point-in-time-recovery),
[Fly.io Managed Postgres](https://fly.io/docs/mpg/),
[Heroku Postgres](https://elements.heroku.com/addons/heroku-postgresql),
[Heroku Postgres plans](https://devcenter.heroku.com/articles/heroku-postgres-plans),
[DigitalOcean Managed Databases pricing](https://www.digitalocean.com/pricing/managed-databases),
[DigitalOcean PostgreSQL pricing](https://docs.digitalocean.com/products/databases/postgresql/details/pricing/),
[DigitalOcean PostgreSQL features](https://docs.digitalocean.com/products/databases/postgresql/details/features/),
[Gregale managed PostgreSQL](/docs/postgres) and
[Gregale plans](/docs/plans).
