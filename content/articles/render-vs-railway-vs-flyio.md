**For a production API, Render is the simplest of the three: a fixed monthly
price per instance, managed Postgres with point-in-time recovery on paid
databases, and Git deploys with little to configure. Railway bills by the
second for the memory and CPU each service uses and adds Postgres, Redis or
MySQL in one click, which suits a team that wants to start fast and pay for
usage. Fly.io runs your container as Firecracker microVMs in many regions and
gives you the most control, at the cost of more setup.** None of the three
sends a new version to a small share of traffic and rolls it back on its own
when errors rise. If that matters to you, Gregale, the fourth option below,
does it by default.

_Gregale publishes this page. Every price names its vendor and comes from that
vendor's own pricing page or docs, checked on November 25, 2026._

## At a glance

| Platform    | Smallest always-on API                                    | How compute is billed                                           | Regions                                         | Managed Postgres                                                    | Releases                                                                    |
| ----------- | --------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **Render**  | Render Starter: $7 a month, 512 MB                        | Monthly price per instance, plus a workspace plan (Hobby is $0) | 5: Oregon, Ohio, Virginia, Frankfurt, Singapore | Render Postgres from $6 a month (256 MB); free databases expire     | A new deploy takes all traffic once healthy; rolling back is manual         |
| **Railway** | Usage on the Hobby plan: $5 minimum, includes $5 of usage | By the second: $10 per GB of memory and $20 per vCPU a month    | 4: California, Virginia, Amsterdam, Singapore   | One-click Postgres, billed on usage like any service                | A new deployment takes all traffic once healthy; rolling back is manual     |
| **Fly.io**  | Fly.io shared-cpu-1x Machine: $2.19 a month with 256 MB   | By the second while a Machine runs                              | Many regions worldwide                          | Fly.io Managed Postgres from $4 a month (Developer plan, 256 MB)    | Rolling by default; the canary strategy health-checks one new Machine first |
| **Gregale** | Gregale Hobby: $10 a month for 5 apps                     | By memory and time, CPU included, only while an instance runs   | 1: Beauharnois, Canada                          | Included from Hobby: 1 database, 1 GiB, 7-day point-in-time restore | 1% → 10% → 50% → 100% of traffic, with automatic rollback (beta)            |

## Render

Render is the closest to the classic Heroku model. A Render Starter instance is
$7 a month for 512 MB, always on, and the Hobby workspace adds nothing on top;
the Pro workspace is $25 a month plus compute. Render Postgres starts at $6 a
month for 256 MB plus $0.30 per GB of storage, with point-in-time recovery,
high availability and read replicas available. Persistent disks are $0.25 per
GB a month. Free web services spin down after 15 minutes without traffic and
free databases expire, so production needs paid instances.

- **Pick Render when:** you want a predictable price per instance, a mature
  managed Postgres, and a dashboard that needs little explanation.

## Railway

Railway bills each service by the second for the memory and CPU it uses: about
$10 per GB of memory and $20 per vCPU a month, against a monthly minimum of $5
on Hobby or $20 on Pro that is credited toward usage. Postgres, Redis, MySQL
and MongoDB are one-click services billed the same way, and volumes cost about
$0.16 per GB a month. A service runs, and bills, all the time unless you turn
on Railway's Serverless setting, which sleeps it after about 10 minutes
without outbound traffic.

- **Pick Railway when:** you want several databases next to your API in one
  project and are happy to pay for what each service uses.

## Fly.io

Fly.io runs your container as Firecracker microVMs, called Machines, in many
regions. A Fly.io shared-cpu-1x Machine is $2.19 a month with 256 MB, $3.69
with 512 MB or $6.70 with 1 GB in its lowest-priced regions, billed by the
second while it runs; stopped Machines bill only their root filesystem. Fly.io
Managed Postgres starts at $4 a month on the Developer plan (256 MB, storage
included); the Basic plan is $38 a month for 1 GB plus $0.28 per GB of
storage. Volumes are $0.15 per GB a month and attach to one Machine.

- **Pick Fly.io when:** your users are on several continents, or you want to
  size and place each Machine yourself in `fly.toml`.

## Gregale

A backend platform for small teams without an ops person. Each app instance
runs in its own Firecracker microVM, like Fly.io Machines, but Gregale manages
the instances for you. Every production release goes to 1% of traffic first,
then 10%, 50% and 100%, and rolls back on its own if the new version returns
more 5xx errors, crash loops or slows down. An API instance pauses about a
second after its last request and is not billed while paused.

- **Pricing:** Hobby is $10 a month for 5 apps with 512 MB each and 200
  GB-RAM-hours, including 1 managed PostgreSQL database with a 7-day
  point-in-time restore window. Pro is $30 and Scale $99 a month. Usage past
  the allowance costs $0.05 per GB-RAM-hour, up to a spend cap you set.
- **Pick Gregale when:** you want releases that reach real traffic gradually
  and roll themselves back, previews for every pull request, and APIs that
  stop billing between requests.
- **Watch out for:** one region today; no durable local disk, so state goes in
  managed PostgreSQL or object storage; no managed MySQL or MongoDB, and
  managed Redis is not generally available yet. An API that is busy around the
  clock usually costs less on Fly.io or Railway. Progressive rollouts are in
  beta.

## What a small production API costs

One API instance that is always on, plus the smallest paid Postgres:

- **Render:** $7 for a Starter instance plus $6 for Render Postgres, so $13 a
  month on the Hobby workspace, plus storage.
- **Railway:** $5 a month minimum, credited toward usage. An API that holds
  512 MB all month uses about $5 of memory before CPU, and Postgres bills the
  same way.
- **Fly.io:** $3.69 for a 512 MB Machine plus $4 for Managed Postgres, so
  $7.69 a month in the lowest-priced regions.
- **Gregale:** $10 a month on Hobby, database included. An API that serves
  requests some of the time stays well inside the 200 GB-RAM-hours, because
  it is not billed while paused between requests.

## Releases and rollback

All four platforms build from Git and keep the previous version serving until
the new one passes its health check. They differ in what happens next:

- **Render and Railway** send all traffic to the new version once it is
  healthy. If it then starts failing, you roll back by hand.
- **Fly.io** replaces Machines one at a time by default. Its canary strategy
  starts one new Machine, health-checks it, then replaces the rest.
- **Gregale** sends 1% of real traffic to the new version, moves up only while
  the evidence is clean, and rolls back automatically on a higher 5xx rate,
  crash loops or a p95 latency regression. See
  [Canary deploys with automatic rollback](/articles/canary-deploys).

On Gregale, follow a release step by step, or go back by hand:

```bash
gregale deploy --name my-api
gregale release wait latest --app my-api --rollout --progress   # print each traffic step until 100%
gregale rollback my-api                                          # back to the previous release
```

## How to choose

- **Simplest fixed price and a mature managed Postgres:** Render.
- **Several databases in one project, paid by usage:** Railway.
- **Users on several continents, control over each Machine:** Fly.io.
- **A small team without an ops person that wants releases to roll themselves
  back and idle APIs to cost nothing:** Gregale.

For one platform in depth, see the comparisons
[Gregale vs Render](/vs/render), [Gregale vs Railway](/vs/railway) and
[Gregale vs Fly.io](/vs/fly).

## Sources

Checked against each vendor's own pages on November 25, 2026:
[Render pricing](https://render.com/pricing),
[Render free instances](https://render.com/docs/free),
[Render regions](https://render.com/docs/regions),
[Railway pricing](https://railway.com/pricing),
[Railway regions](https://docs.railway.com/reference/regions),
[Railway Serverless guide](https://railway.com/guides/cut-idle-costs-serverless),
[Fly.io pricing](https://fly.io/docs/about/pricing/),
[Fly.io Managed Postgres](https://fly.io/docs/mpg/),
[Fly.io deploys](https://fly.io/docs/launch/deploy/),
[Gregale pricing](/pricing).
