## Results

On **evenly distributed 24/7 traffic** (for example, one request every 30 seconds around the clock), minute-scale idle timeouts never fire once all month. Auto-stop and serverless sleep modes on **Fly.io** (5-minute assumption) and **Railway** (5–10 minutes) stay awake for all 730 hours, while **Gregale's** `between_requests` pause ladder stops billing roughly 1–2 seconds after each request and resumes in about a millisecond.

For **5 evenly distributed 24/7 services sharing one managed PostgreSQL database**, Gregale Hobby stays at **$10.00/month** (108.122 of 200 included GB-RAM-hours), compared with **$22.45** on Fly.io, **$33.50** on Railway, **$40.00** on Heroku, and **$41.00** on Render. Conversely, on a **single continuously busy 24/7 API** (2 req/s, where traffic arrives faster than ~2 seconds), Gregale never pauses and bills all 730 hours (**$18.54**), where Fly.io (**$7.69**), Railway (**$10.50**), Heroku (**$12.00**), and Render (**$13.00**) are cheaper.

This study is a **deterministic published-pricing model** checked on **November 25, 2026**, not live competitor billing invoices. Gregale's `1.75 s` billed awake duration per isolated request comes from [What it costs to run an intermittent FastAPI app on Gregale](/research/intermittent-fastapi-cost-2026-11-24), and every vendor cell is computed by `analyze.py` from official published pricing.

| Scenario                                                          | Gregale Free | Gregale Hobby | Fly Auto-Stop | Fly Always-On | Railway Serverless | Railway Always-On | Render Free | Render Paid | Heroku Paid | Cloud Run (compute only) |
| ----------------------------------------------------------------- | -----------: | ------------: | ------------: | ------------: | -----------------: | ----------------: | ----------: | ----------: | ----------: | -----------------------: |
| 1 intermittent API, no database (360 req/day, 90 spaced windows)  |        $0.00 |        $10.00 |         $0.16 |         $2.19 |              $5.00 |             $5.00 |       $0.00 |       $7.00 |       $7.00 |                    $0.00 |
| 1 evenly distributed 24/7 API + Postgres (1 req / 30 s)           |            — |        $10.00 |         $7.69 |         $7.69 |             $10.50 |            $10.50 |           — |      $13.00 |      $12.00 |                   $0.00* |
| 5 evenly distributed 24/7 services + Postgres (1 req / 30 s each) |            — |        $10.00 |        $22.45 |        $22.45 |             $33.50 |            $33.50 |           — |      $41.00 |      $40.00 |                   $0.00* |
| 1 continuously busy 24/7 API + Postgres (2 req/s, no idle gaps)   |            — |        $18.54 |         $7.69 |         $7.69 |             $10.50 |            $10.50 |           — |      $13.00 |      $12.00 |                  $22.63* |

_\*Cloud Run figures cover request-based compute and requests only. Cloud Run does not include a bundled managed PostgreSQL database; Cloud SQL is billed separately._

## Why evenly distributed traffic flips the bill

Most scale-to-zero platforms only suspend or stop an instance after **minutes** of complete silence:

- **Gregale (`between_requests` pause ladder):** Pauses the Firecracker microVM in memory ~1–2 seconds after its last in-flight request (stopping billing and resuming in ~1 ms with caches intact), then parks to a disk snapshot after 10 minutes idle (`0` resident RAM). At 1 request every 30 seconds, each app is billed for **42.58 hours/month** (`1.75 / 30 = 5.83%`). See [Scale to zero without slow cold starts](/articles/scale-to-zero-without-cold-starts).
- **Minute-scale sleep timers:** Railway Serverless sleeps after **5–10 minutes** without outbound traffic, Render Free spins down after **15 minutes**, Heroku Eco sleeps after **30 minutes**, and Fly.io auto-stop depends on proxy idle windows (modeled at **300 seconds**). Whenever requests arrive every 30 seconds—typical for webhook endpoints, health/polling traffic, or steady low-QPS SaaS APIs—none of those timers ever trip, so every service bills for all **730 hours**.

Where each platform is cheapest:

- **1 intermittent API, no database (360 req/day across 90 spaced windows):** **Gregale Free ($0.00)**, **Render Free ($0.00)**, and **Google Cloud Run ($0.00)** fit inside free allowances; **Fly Auto-Stop** is **$0.16**. Render Free sleeps after 15 minutes idle with a ~1 minute spin-up, whereas Gregale Free (1.354 of 20 GB-RAM-h) resumes from pause or snapshot.
- **1 evenly distributed 24/7 API + Postgres (1 req / 30 s):** **Fly.io ($7.69)** is lowest on raw compute + Developer Postgres; **Gregale Hobby ($10.00)** uses 21.624 of 200 GB-RAM-h and undercuts Railway ($10.50), Heroku ($12.00), and Render ($13.00).
- **5 evenly distributed 24/7 services + Postgres (1 req / 30 s each):** **Gregale Hobby ($10.00)** covers all 5 services (108.122 of 200 GB-RAM-h) plus 1 Postgres database, whereas Fly.io ($22.45), Railway ($33.50), Heroku ($40.00), and Render ($41.00) pay always-on rates for all 5 services.
- **1 continuously busy 24/7 API + Postgres (2 req/s, no gaps > 2 s):** **Fly.io ($7.69)**, **Railway ($10.50)**, **Heroku ($12.00)**, and **Render ($13.00)** all beat **Gregale Hobby ($18.54)** (370.703 GB-RAM-h, 170.703 overage) and **Cloud Run ($22.63 compute only)**.

## Release safety included at these prices

Dollar totals alone leave out release safety. On every Gregale plan (including Free and Hobby), `gregale deploy` uses a health-gated canary ladder (`1% → 10% → 50% → 100%`, in beta) with automatic rollback and 7-day point-in-time database rollback on paid plans:

| Platform      | Default production rollout                           | Automatic rollback on 5xx / latency                | Code + database PITR rollback       |
| ------------- | ---------------------------------------------------- | -------------------------------------------------- | ----------------------------------- |
| **Gregale**   | `1% → 10% → 50% → 100%` evidence-gated ladder (beta) | Yes (5xx, crash loops, 30-min post-100% p95 watch) | Yes (`--restore-databases`, Hobby+) |
| **Fly.io**    | Rolling restart (optional 1-Machine canary check)    | Manual                                             | Manual / snapshots                  |
| **Railway**   | All traffic once healthy                             | Manual                                             | Manual                              |
| **Render**    | All traffic once healthy                             | Manual                                             | Manual / PITR on paid DB            |
| **Heroku**    | All traffic (Preboot on Standard+)                   | Manual                                             | Manual                              |
| **Cloud Run** | 100% by default (manual traffic splitting available) | Manual                                             | Not bundled                         |

See [Canary deploys with automatic rollback](/articles/canary-deploys) for the exact rollout and probe rules.

## Methodology and vendor inputs

All calculations run in `decimal.Decimal` (`ROUND_HALF_UP` to $0.01) over a 730-hour, 30-day month (`vendors.json` and `scenarios.json`).

- **Gregale:** Bills `(plan_ram_mb + 8 MB) / 1024` per running hour (`264 MB` on Free 256 MB, `520 MB` on Hobby 512 MB), CPU included, using the measured `1.75` awake seconds per isolated request (`1.75 / inter_arrival`, capped at `1.0`). Free includes 1 app and 20 GB-RAM-h with a hard cap (no Postgres); Hobby is $10/month for up to 5 apps, 200 GB-RAM-h, 1 managed Postgres database (1 GiB, 7-day PITR), and $0.05/GB-RAM-h overage. Scenario 1 uses the exact `5.25` h (`1.353515625` GB-RAM-h) from the 90 windows/day spread FastAPI trace.
- **Fly.io:** `shared-cpu-1x` Machines ($2.19/month at 256 MB, $3.69/month at 512 MB) in lowest-priced regions, $0.15/GB-month for an assumed 1 GB stopped rootfs, $4.00/month Developer Postgres (256 MB), and an assumed `300 s` auto-stop idle threshold.
- **Railway:** $10/GB-month RAM + $20/vCPU-month CPU against a $5.00/month Hobby minimum, with an assumed always-on 0.25 GB / 0.05 vCPU Postgres service ($3.50/month) and a `300 s` Serverless sleep threshold (`1.5×` window tail factor when idle gaps exist).
- **Render:** Render Free covers 1 web service up to 750 h/month with a 15-minute idle spin-down and no durable Postgres; Render Paid models $7/month Starter instances (512 MB, always-on) + $6/month Basic 256 MB Postgres on a $0 Hobby workspace.
- **Heroku:** Basic 512 MB dynos ($7/month per process, always-on) + Essential-0 Postgres ($5/month).
- **Google Cloud Run:** Tier 1 request-based billing ($0.00002400/vCPU-s, $0.00000250/GiB-s, $0.40/million requests) after applying the monthly free tier (180,000 vCPU-s, 360,000 GiB-s, 2,000,000 requests), using `avg_request_duration_seconds` of `0.5 s` in Scenario 1 and `0.2 s` in Scenarios 2–4.

## Data and reproduction

Download the [complete reproduction kit](/research/paas-intermittent-api-cost-model-2026-11-25/reproduction.tar.gz) and run this command in the extracted directory. It uses Python 3.11 or later and the standard library only.

```sh
python3 analyze.py --verify
```

- [Vendor pricing inputs (JSON)](/research/paas-intermittent-api-cost-model-2026-11-25/vendors.json)
- [Workload scenarios (JSON)](/research/paas-intermittent-api-cost-model-2026-11-25/scenarios.json)
- [Calculated comparison output (JSON)](/research/paas-intermittent-api-cost-model-2026-11-25/summary.json)
- [Deterministic Python calculator](/research/paas-intermittent-api-cost-model-2026-11-25/analyze.py)
- [Kit instructions (Markdown)](/research/paas-intermittent-api-cost-model-2026-11-25/README.md)

## Limits

This is a **published-pricing model** checked on November 25, 2026, not live multi-vendor billing invoices. It assumes uniformly spaced arrival intervals (`inter_arrival_seconds`) in Scenarios 2–4; real traffic is often burstier, which favors auto-stop on longer quiet windows and favors Gregale whenever bursts stay separated by >2 seconds. It excludes network egress, build minutes, custom domains, paid team workspace seats (such as Render Pro at $25/month or Railway Pro at $20/month), extra database storage, and sales tax or VAT. Modeling assumptions (`300 s` Fly/Railway sleep threshold, `0.05`–`0.10` vCPU averages, 1 GB rootfs, Cloud Run request durations) are explicit and editable in `scenarios.json` and `vendors.json`.

## Sources

- [Gregale pricing feed](/pricing.json), [Plans and pricing](/docs/plans), and [Scale to zero without slow cold starts](/articles/scale-to-zero-without-cold-starts)
- [Render pricing](https://render.com/pricing) and [Render free instances](https://render.com/docs/free)
- [Railway pricing](https://railway.com/pricing), [Railway plans](https://docs.railway.com/reference/pricing/plans), and [Railway Serverless](https://docs.railway.com/reference/app-sleeping)
- [Fly.io pricing](https://fly.io/pricing/), [Fly.io resource pricing](https://fly.io/docs/about/pricing/), and [Fly.io autostop/autostart](https://docs.fly.io/launch/autostop-autostart)
- [Google Cloud Run pricing](https://cloud.google.com/run/pricing)
- [Heroku pricing](https://www.heroku.com/pricing/)
