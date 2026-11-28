**Free backend hosting in 2026 comes in three kinds.** Google Cloud Run and
AWS Lambda give a monthly allowance and bill you past it. Cloudflare Workers,
Render, Railway and Gregale give a quota and stop when you reach it. Oracle
Cloud, Fly.io and Koyeb give you a small machine of your own. Which one fits depends on
whether your app can sleep, how long its first request may wait, and whether
going over should cost money or switch the app off.

_Gregale publishes this page. Every limit names its vendor and comes from that
vendor's own pricing page or docs, checked on November 28, 2026._

## At a glance

| Free tier                    | Free each month                                                                                | When the app is idle                                                        | When you go past it                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Gregale Free**             | 1 app with 256 MB and 20 GB-RAM-hours, 10 GiB of egress                                        | Pauses about a second after each request; resumes in about a millisecond    | The app stops until the month ends or you upgrade; Free never bills                                 |
| **Google Cloud Run**         | 180,000 vCPU-seconds, 360,000 GiB-seconds and 2 million requests (request-based billing)       | Scales to zero; idle instances cost nothing unless they are minimums        | Billed at standard rates; sign-up needs a credit card or other payment method                       |
| **AWS Lambda**               | 1 million requests and 400,000 GB-seconds, on the AWS Free and Paid plans                      | Runs only per request                                                       | The Paid plan bills it; the Free plan spends credits and closes after 6 months or when they run out |
| **Cloudflare Workers**       | 100,000 requests a day, 10 ms of CPU time per request, 128 MB per isolate                      | No server to keep running                                                   | Error 1027 until midnight UTC, or the route bypasses the Worker                                     |
| **Oracle Cloud Always Free** | 2 AMD micro VMs (1/8 OCPU, 1 GB each) and 2 Arm OCPUs with 12 GB, plus 200 GB of block storage | Always on; Oracle may reclaim an instance idle for 7 days                   | Always Free resources stay free; anything more needs a paid account                                 |
| **Render Free**              | 750 instance hours for web services in a workspace                                             | Spins down after 15 minutes without inbound traffic; about a minute to wake | Free web services are suspended until the next month                                                |
| **Railway Free**             | $1 of usage, up to 3 services with 0.5 GB and 1 vCPU each                                      | Sleeps 5 to 10 minutes after its last outbound traffic                      | Services stop until the next billing cycle                                                          |
| **Fly.io Free plan**         | $5 of usage a month once a card is added ($1 once, for 7 days, without one), up to 3 Machines  | Machines can stop when idle, or run all the time                            | The account moves to Pay As You Go and the whole month is billed                                    |
| **Koyeb Free Instance**      | One web service with 512 MB and 0.1 vCPU, in Frankfurt or Washington, D.C.                     | Sleeps after an hour without traffic                                        | One per organization and meant for testing; anything more is a paid Instance                        |

## Free databases

| Free database               | What you get                                                               | The catch                                                          |
| --------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Neon Free**               | 100 projects, 100 CU-hours and 1 GB of storage per project, no credit card | Scales to zero after 5 minutes idle                                |
| **Render Free Postgres**    | 1 GB, one database per workspace                                           | Expires after 30 days, deleted 14 days later; no backups           |
| **Railway Free**            | Postgres, Redis, MySQL or MongoDB with a 0.5 GB volume                     | Draws from the same $1 as your services; sleeps until a connection |
| **Fly.io Managed Postgres** | The $4 Developer plan, covered by the Free plan's $5                       | Leaves about $1 for Machines                                       |
| **Gregale**                 | No managed Postgres on Free                                                | Gregale Hobby: $10 a month for 5 apps, with one managed database   |

## Which free tier fits your app

- **A bot or webhook that gets a few requests an hour.** Use something that
  bills per request or pauses between requests: Cloud Run, Lambda, Workers or
  Gregale Free. Discord, Telegram and Slack can all send events to an HTTPS
  endpoint, so the bot does not need an always-on connection; see the
  [Discord](/articles/discord-bot-interactions-endpoint-serverless),
  [Telegram](/articles/telegram-bot-webhook-scale-to-zero) and
  [Slack](/articles/slack-bolt-http-mode-scale-to-zero) guides.
- **An API that must answer quickly after a quiet hour.** Render Free makes the
  first visitor wait about a minute and Koyeb's Free Instance sleeps after an
  hour. Gregale Free resumes a paused app in about a millisecond.
- **A process that must stay connected.** A bot holding a WebSocket or a worker
  polling a queue never goes quiet. Oracle Cloud's Always Free VMs and Fly.io's
  Free plan (a 256 MB Machine running all month is $2.19) keep it running.
  Railway Free also keeps a process awake while it sends traffic, but by
  Railway's own figures its $1 covers only 100 MB of memory running all month.
- **A database as well.** Neon Free pairs with any of these. Render's free
  Postgres expires after 30 days, so it suits a demo, not a product.
- **No bill, ever.** Pick a tier that stops instead of charging: Workers,
  Railway, Koyeb's Free Instance, Oracle's Always Free, Gregale Free, or Render
  without a payment method on file. Cloud Run, Lambda on the Paid plan and
  Fly.io past its $5 bill you instead.

## The fine print that decides it

- **Cloud Run and Lambda are allowances, not plans.** Usage past them is billed
  to the payment method on the account. Request-based billing on Cloud Run
  counts only the time requests are in flight, so a low-traffic API rarely
  leaves the free tier.
- **Workers counts CPU time, not wall time.** The Free plan allows 10 ms of CPU
  per request, which suits routing, auth checks and small JSON APIs. Work that
  waits on a database or an upstream API does not count against it.
- **Oracle's Arm allowance shrank.** Always Free now covers 1,500 OCPU-hours and
  9,000 GB-hours a month of Ampere A1, which is 2 OCPUs and 12 GB, in your home
  region only. Oracle may reclaim an instance whose 95th-percentile CPU, network
  and (on Arm) memory use all stay under 20% for 7 days. Creating one can also
  fail with "out of host capacity" until free shapes come back.
- **Fly.io bills the whole month once you pass $5.** The account moves to Pay
  As You Go and that month's usage is billed from the first cent.
- **Render's free web services lose their local files** on every spin-down.
  With a payment method on file, outbound bandwidth past the monthly amount is
  billed; without one, Render suspends Free services instead. Render may also
  suspend a Free web service that sends an uncommonly high volume of traffic.

## What Gregale Free covers

Gregale bills each second an app runs, at its plan's memory plus 8 MB, and a
request-serving app pauses about a second after its last request. In
[a measured FastAPI test](/research/intermittent-fastapi-cost-2026-11-24), an
isolated request kept the app billed for about 1.75 seconds. At 264 MB, Gregale
Free's 20 GB-RAM-hours are about 77.6 billed hours, or about 160,000
well-spaced requests a month. Requests that arrive together share the same
awake time, so bursty traffic stretches further.

Gregale Free is $0 for 1 app with 256 MB and 20 GB-RAM-hours a month, plus
10 GiB of egress, 1 GiB of object storage, one preview environment and a
request timeout of up to 30 seconds. It needs no payment method: your first paid plan starts with a checkout. When the
month's allowance runs out, the app stops until the next month instead of
billing. An app that runs timers or background threads keeps running, and uses
its allowance, while it works.

See [Scale-to-zero pricing in 2026](/articles/scale-to-zero-pricing-compared)
for what the same apps cost once they outgrow a free tier.

## Sources

Checked against each vendor's own pages on November 28, 2026:
[Cloud Run pricing](https://cloud.google.com/run/pricing),
[Google Cloud Free Program](https://cloud.google.com/free/docs/free-cloud-features),
[AWS Lambda pricing](https://aws.amazon.com/lambda/pricing/),
[AWS Free Tier](https://aws.amazon.com/free/),
[Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/),
[Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
[Oracle Cloud Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm),
[Render free instances](https://render.com/docs/free),
[Railway Free plan](https://docs.railway.com/pricing/free-plan),
[Fly.io Free plan](https://fly.io/docs/about/free-plan/),
[Fly.io resource pricing](https://fly.io/docs/about/pricing/),
[Koyeb Instances](https://www.koyeb.com/docs/reference/instances),
[Neon pricing](https://neon.com/pricing),
[Gregale plans](/docs/plans) and
[Gregale billing](/docs/billing).
