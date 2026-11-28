**On Fly.io, Google Cloud Run, Railway, Koyeb, Render and Gregale, an app that
has scaled to zero costs little or nothing in compute. The bill is decided by
how long each platform waits before it stops charging.** Cloud Run charges only
while a request is being handled. Gregale pauses an app about a second after
its last request. Koyeb waits 5 minutes on Standard instances, Fly.io several
minutes, Railway 5 to 10 minutes and Render Free 15 minutes. If requests arrive
more often than that, the app never sleeps and you pay for the whole month.

_Gregale publishes this page. Every price names its vendor and comes from that
vendor's own pricing page or docs, checked on November 28, 2026._

## At a glance: what an idle app costs

| Platform             | When compute billing stops                                                       | Still billed while asleep                                | Entry price                                                                       |
| -------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **Gregale**          | About a second after the last request, when the app pauses                       | Nothing                                                  | Gregale Free: $0 for 1 app; Gregale Hobby: $10 a month for 5 apps                 |
| **Google Cloud Run** | At the end of the last request in flight (request-based billing)                 | Nothing, unless you keep minimum instances (idle rate)   | $0.000024 per vCPU-second and $0.0000025 per GiB-second after a monthly free tier |
| **Fly.io**           | When Fly Proxy stops or suspends a Machine after several idle minutes            | Root filesystem at $0.15 per GB a month; volumes in full | $2.19 a month for a 256 MB shared-cpu-1x Machine, billed by the second            |
| **Railway**          | 5 to 10 minutes after the last outbound traffic (Serverless)                     | No compute; a sleeping database keeps its data           | Railway Free: $1 of usage a month; Hobby: $5 a month including $5 of usage        |
| **Koyeb**            | After 5 idle minutes on Standard instances; 1 hour on the Free Instance          | No compute                                               | nano (0.25 vCPU, 256 MB): $0.0036 an hour, billed by the second                   |
| **Render**           | Free web services after 15 minutes without inbound traffic; paid instances never | No compute on Free                                       | Render Free: 750 hours a month; Render Starter: $7 a month for 512 MB             |

## Three monthly bills, worked out

The same small API on each platform, no database, egress or build minutes
included. Each request takes 200 ms. Each cell is the lowest bill for a 30-day
month on that platform's own prices. Fly.io's $5 monthly Free plan credit for
personal organizations is left out.

| Workload                                                     | Gregale         | Cloud Run | Fly.io | Railway         | Koyeb (nano) | Render            |
| ------------------------------------------------------------ | --------------- | --------: | -----: | --------------- | -----------: | ----------------- |
| **A.** 1 API, one request a minute, all day                  | $0 on Free      |     $0.00 |  $2.19 | $5.00 on Hobby  |        $2.59 | $0 on Free        |
| **B.** 1 API, a request every second for 3 hours, then quiet | $10.00 on Hobby |     $0.00 |  $0.41 | $0 on Free      |        $0.33 | $0 on Free        |
| **C.** 5 APIs, each with one request a minute, all day       | $10.00 on Hobby |     $0.00 | $10.95 | $17.45 on Hobby |       $12.95 | $35.00 on Starter |

What is behind each cell:

- **A, one request a minute.** On Gregale the app is billed for about 1.75
  seconds per request, 21 hours in the month, which is 5.41 of Gregale Free's
  20 GB-RAM-hours. Cloud Run bills 8,640 seconds of request time, inside its
  free tier. On Fly.io, Railway, Koyeb and Render the app is never quiet for 5
  minutes, so it runs all 720 hours. Railway Free's $1 of monthly usage lasts
  about 9 days, so the app needs Hobby. Render Free's 750 instance hours cover
  one service running all month.
- **B, busy three hours a day.** Gregale runs the full 3 hours, 90 hours in the
  month. That is 23.2 GB-RAM-hours on Free, which stops at its 20 on about day
  26, so the bill is Gregale Hobby: $10 a month for 5 apps, using 45.7 of its 200
  GB-RAM-hours. Fly.io, Koyeb, Railway and Render stop the app a few minutes
  after the busy window ends, so it runs about 92 to 98 hours. Fly.io adds
  about $0.13 for the stopped root filesystem.
- **C, five steady APIs.** Gregale Hobby covers all five apps with 53.3 of its
  200 GB-RAM-hours. The others charge per instance for five instances that
  never sleep, and Railway's usage passes the $5 that Hobby includes. Render
  Free's 750 hours cover only one of the five services.

Cloud Run costs nothing in all three cases. These workloads are small enough
to fit inside its free tier, and request-based billing does not charge for the
gaps between requests. For one app with a quiet daily pattern, Fly.io, Koyeb and
Railway Free cost cents. In workload C, Gregale is the cheapest after Cloud Run,
and its $10 also includes a managed Postgres database, which Cloud Run does not
bundle.

## Why the idle timer decides the bill

On most platforms an app has to be silent for minutes before it stops costing
money. Webhooks, polling clients, uptime checks and cron jobs often hit an app
every minute or two. That is enough to keep Fly.io, Railway, Koyeb or Render
Free awake for the whole month, even if the app does a few seconds of real work
an hour.

The two models that break this are request-based billing and pausing between
requests. Cloud Run bills only the time while at least one request is in
flight, plus instance start-up and shutdown. Gregale pauses the app's microVM
in memory about a second after its last request, and paused seconds are not
billed. The next request resumes the app in about a millisecond, with its
caches and connections intact.

## Platform by platform

### Google Cloud Run

Request-based billing charges $0.000024 per vCPU-second, $0.0000025 per
GiB-second and $0.40 per million requests in Tier 1 regions, rounded up to the
nearest 100 ms. Each month the first 180,000 vCPU-seconds, 360,000
GiB-seconds and 2 million requests are free. An idle instance costs nothing
unless it is one of your minimum instances, which bill at an idle rate.
Instance-based billing instead charges for an instance's whole lifetime.
Cloud Run does not bundle a database; Cloud SQL is billed separately.

### Fly.io

A shared-cpu-1x Machine is $2.19 a month with 256 MB or $3.69 with 512 MB,
billed by the second while it runs. With autostop, Fly Proxy stops or suspends
a Machine once the app has been idle for several minutes; its stop loop runs
every few minutes and stops at most one Machine per region per pass. A stopped
or suspended Machine is billed only for its root filesystem, at $0.15 per GB a
month, and a volume is billed in full whether its Machine runs or not. A stopped
Machine takes about 2 seconds or more to start and a suspended one a few hundred
milliseconds. On the Free plan, a personal organization gets $5 of usage a month
once a card is added; Managed Postgres starts at $4 a month.

### Railway

Services bill by the minute for the memory and CPU they use, at $10 per GB of
memory and $20 per vCPU a month. With Serverless on, a
service sleeps 5 to 10 minutes after its last outbound packet. Responses,
database connections and private-network traffic all count, so a service that
keeps a connection open stays awake. The Free plan is $0 with $1 of usage a
month and runs every service this way. Hobby is $5 a month with $5 of usage
included.

### Koyeb

Koyeb bills Instances by the second: nano (0.25 vCPU, 256 MB) is $0.0036 an
hour and micro (0.5 vCPU, 512 MB) $0.0072. Scale-to-zero works on Standard CPU
and GPU Instances with a minimum of zero, after a 5-minute idle period by
default; Pro and higher plans can change it. From deep sleep a Service takes 1
to 5 seconds to start. Light Sleep, in public preview, uses snapshots to start
in about 200 ms. Each organization gets one Free Instance with 512 MB and 0.1
vCPU, which sleeps after an hour without traffic and is meant for testing.
These are Instance prices only; plan fees are listed on Koyeb's pricing page.

### Render

Render Free web services spin down after 15 minutes without inbound traffic,
including WebSocket messages, and take about a minute to spin back up. A
workspace gets 750 Free instance hours a month, and a spun-down service uses
none. The local filesystem is lost on every spin-down. Paid instances, from
Render Starter at $7 a month for 512 MB, run all the time and never scale to
zero.

### Gregale

Gregale bills each second an instance runs, at its plan's memory plus 8 MB,
with CPU included. A request-serving app pauses about a second after its last
request, and if it stays idle it later parks as a snapshot that uses no memory.
Neither state is billed. Gregale Free is $0 for 1 app with 256 MB and 20
GB-RAM-hours a month, and it stops at that allowance instead of charging.
Gregale Hobby: $10 a month for 5 apps with 512 MB each, 200 GB-RAM-hours and
one managed Postgres database. Paid plans bill $0.05 per GB-RAM-hour beyond
the allowance, up to a hard [spend cap](/articles/hard-cloud-spend-caps). An
app that runs timers or background threads keeps running, and is billed, while
it works.

## Which one to pick

- **The lowest bill for one small API, and you already use Google Cloud:**
  Cloud Run.
- **One app with a daily busy window and long quiet hours:** Fly.io, Koyeb or
  Railway Free cost cents. Gregale Free covers it if it stays within 20
  GB-RAM-hours.
- **Several services with steady light traffic, plus a database:** Gregale
  Hobby, because it bills only the seconds around each request and includes
  Postgres.
- **The fastest first request after a quiet period:** Gregale resumes a paused
  app in about a millisecond. See
  [Scale to zero without slow cold starts](/articles/scale-to-zero-without-cold-starts)
  for wake times on each platform.

## How the numbers were calculated

Every workload uses a 30-day month (720 hours) and 200 ms requests.

- **Gregale:** 1.75 billed seconds for each isolated request, measured in
  [What it costs to run an intermittent FastAPI app on Gregale](/research/intermittent-fastapi-cost-2026-11-24),
  at 264 MB on Free and 520 MB on Hobby (plan memory plus 8 MB). During a
  busy window with a request every second the app never pauses, so the window
  is billed in full.
- **Cloud Run:** request-based billing with Cloud Run's default 1 vCPU and 512
  MiB, Tier 1 prices and the monthly free tier, assuming an instance stays warm
  between requests. Start-up time would add to the bill.
- **Fly.io:** a 256 MB shared-cpu-1x Machine that stops about 5 minutes after
  the last request, a 1 GB root filesystem, and no Free plan credit.
- **Railway:** a service averaging 256 MB of memory and 0.05 vCPU while awake,
  sleeping 7.5 minutes after the last request, the middle of Railway's stated
  range.
- **Koyeb:** a nano Instance with the default 5-minute idle period.
- **Render:** Free while one service fits in 750 hours, Starter otherwise.

Busier traffic changes the picture. An API that never goes quiet for more than
a second or two bills all month on Gregale too. In
[the PaaS cost model](/research/paas-intermittent-api-cost-model-2026-11-25), a
continuously busy API with Postgres costs $18.54 a month on Gregale Hobby,
more than on Fly.io, Railway or Render.

## Sources

Checked against each vendor's own pages on November 28, 2026:
[Cloud Run pricing](https://cloud.google.com/run/pricing),
[Fly.io resource pricing](https://fly.io/docs/about/pricing/),
[Fly.io autostop and autostart](https://fly.io/docs/launch/autostop-autostart/),
[Railway plans](https://docs.railway.com/pricing/plans),
[Railway Free plan](https://docs.railway.com/pricing/free-plan),
[Railway Serverless](https://docs.railway.com/deployments/serverless),
[Koyeb Instances](https://www.koyeb.com/docs/reference/instances),
[Koyeb Scale-to-Zero](https://www.koyeb.com/docs/run-and-scale/scale-to-zero),
[Koyeb pricing](https://www.koyeb.com/pricing),
[Render free instances](https://render.com/docs/free),
[Render pricing](https://render.com/pricing),
[Gregale plans](/docs/plans),
[Gregale billing](/docs/billing) and
[paused between requests](/docs/scale-to-zero#paused-between-requests).
