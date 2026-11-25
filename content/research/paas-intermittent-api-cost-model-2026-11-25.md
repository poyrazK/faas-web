## Results

On a **5-service intermittent backend with managed PostgreSQL**, Gregale Hobby (**$10.00/month**) costs less than half of Fly Always-On (**$22.45**), a third of Railway Always-On (**$33.50**), and roughly a quarter of Heroku (**$40.00**) or Render (**$41.00**). On a **single 24/7 busy API with PostgreSQL**, always-on platforms cost less on raw compute: Fly.io is **$7.69**, Railway **$10.50**, Heroku **$12.00**, Render **$13.00**, and Gregale Hobby **$18.54**.

This study is a **deterministic published-pricing model** checked on **November 25, 2026**, not live competitor billing invoices. Scenario 1 uses the measured awake compute from [What it costs to run an intermittent FastAPI app on Gregale](/research/intermittent-fastapi-cost-2026-11-24), and every vendor cell is computed by `analyze.py` from official published pricing.

| Scenario                                          | Gregale Free | Gregale Hobby | Fly Auto-Stop | Fly Always-On | Railway Serverless | Railway Always-On | Render Free | Render Paid | Heroku Paid | Cloud Run (compute only) |
| ------------------------------------------------- | -----------: | ------------: | ------------: | ------------: | -----------------: | ----------------: | ----------: | ----------: | ----------: | -----------------------: |
| 1 intermittent API, no database (360 req/day)     |        $0.00 |        $10.00 |         $0.16 |         $2.19 |              $5.00 |             $5.00 |       $0.00 |       $7.00 |       $7.00 |                    $0.00 |
| 1 business-hours API + Postgres (8 h/day)         |            — |        $10.00 |         $5.33 |         $7.69 |              $7.00 |            $10.50 |           — |      $13.00 |      $12.00 |                  $0.00\* |
| 5 intermittent services + Postgres (2 h/day each) |            — |        $10.00 |         $6.22 |        $22.45 |              $7.25 |            $33.50 |           — |      $41.00 |      $40.00 |                  $0.00\* |
| 1 always-on API + Postgres (24/7)                 |            — |        $18.54 |         $7.69 |         $7.69 |             $10.50 |            $10.50 |           — |      $13.00 |      $12.00 |                  $0.48\* |

_\*Cloud Run figures cover request-based compute and requests only. Cloud Run does not include a bundled managed PostgreSQL database; Cloud SQL is billed separately._

## Where each platform is cheapest

- **1 intermittent API, no database (360 req/day, 5.25 active h/month):** **Gregale Free ($0.00)**, **Render Free ($0.00)**, and **Google Cloud Run ($0.00)** stay inside their free allowances; **Fly Auto-Stop** is **$0.16** ($0.02 active Machine time plus $0.15 for 1 GB stopped rootfs). Render Free sleeps after 15 minutes idle with a ~1 minute spin-up, whereas Gregale Free (1.354 of 20 GB-RAM-h) resumes from snapshot or pause.
- **1 business-hours API + Postgres (8 h/day, 243.33 h/month):** **Fly Auto-Stop ($5.33)** and **Railway Serverless ($7.00)** are cheapest on raw compute + small Postgres, followed by **Fly Always-On ($7.69)** and **Gregale Hobby ($10.00)**, which uses 123.566 of its 200 included GB-RAM-hours and includes 7-day point-in-time Postgres recovery, PR previews, and automatic canary rollbacks.
- **5 intermittent services + Postgres (2 h/day each, 60.83 h/month per service):** **Fly Auto-Stop ($6.22)**, **Railway Serverless ($7.25)**, and **Gregale Hobby ($10.00)** keep all five services under $10.00, while always-on per-service plans multiply by five (**$22.45** Fly Always-On, **$33.50** Railway Always-On, **$40.00** Heroku, **$41.00** Render).
- **1 always-on API + Postgres (24/7, 730 h/month):** **Fly.io ($7.69)**, **Railway ($10.50)**, **Heroku ($12.00)**, and **Render ($13.00)** all beat **Gregale Hobby ($18.54)**, which uses 370.703 GB-RAM-hours (170.703 GB-RAM-hours overage at $0.05/GB-RAM-h).

## Methodology and vendor inputs

All calculations run in `decimal.Decimal` (`ROUND_HALF_UP` to $0.01) over a 730-hour, 30-day month (`vendors.json` and `scenarios.json`).

- **Gregale:** Bills `(plan_ram_mb + 8 MB) / 1024` per running hour (`264 MB` on Free 256 MB, `520 MB` on Hobby 512 MB), CPU included, pausing ~1 second after a request finishes. Free includes 1 app and 20 GB-RAM-h with a hard cap (no Postgres); Hobby is $10/month for up to 5 apps, 200 GB-RAM-h, 1 managed Postgres database (1 GiB, 7-day PITR), and $0.05/GB-RAM-h overage. Scenario 1 uses the exact `1.353515625` GB-RAM-h (`5.25` active hours/month) derived from the 90 windows/day spread FastAPI trace.
- **Fly.io:** Uses `shared-cpu-1x` Machine rates in lowest-priced regions ($2.19/month at 256 MB, $3.69/month at 512 MB), plus $0.15/GB-month for an assumed 1 GB rootfs while stopped, plus $4.00/month Developer Postgres (256 MB).
- **Railway:** Bills $10/GB-month RAM + $20/vCPU-month CPU against a $5.00/month Hobby minimum (credited toward usage). Managed Postgres is modeled as an always-on 0.25 GB / 0.05 vCPU service ($3.50/month). Because Railway's Serverless setting sleeps a service 5–10 minutes after its last outbound traffic, active hours are multiplied by an assumed `1.5×` sleep-tail factor (capped at 730 h).
- **Render:** Render Free covers 1 web service up to 750 hours/month with no durable Postgres (free databases expire after 30 days). Render Paid models $7/month Starter instances (512 MB, always-on) + $6/month Basic 256 MB Postgres on a $0 Hobby workspace.
- **Heroku:** Basic 512 MB dynos ($7/month per process, always-on) + Essential-0 Postgres ($5/month).
- **Google Cloud Run:** Tier 1 request-based billing ($0.00002400/vCPU-s, $0.00000250/GiB-s, $0.40/million requests) after applying the permanent monthly free tier (180,000 vCPU-s, 360,000 GiB-s, 2,000,000 requests), using `avg_request_duration_seconds` of `0.5 s` in Scenario 1 and `0.2 s` in Scenarios 2–4.

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

This is a **published-pricing model** checked on November 25, 2026, not live multi-vendor billing invoices. It excludes network egress, build minutes, custom domains, paid team workspace seats (such as Render Pro at $25/month or Railway Pro at $20/month), extra database storage, backups beyond included tiers, and sales tax or VAT. Railway's Serverless sleep tail (`1.5×`), active CPU averages (`0.05`–`0.10` vCPU), Fly's 1 GB rootfs size, and Cloud Run's request durations are explicit modeling assumptions editable in `scenarios.json` and `vendors.json`.

## Sources

- [Gregale pricing feed](/pricing.json) and [Plans and pricing](/docs/plans)
- [Render pricing](https://render.com/pricing) and [Render free instances](https://render.com/docs/free)
- [Railway pricing](https://railway.com/pricing), [Railway plans](https://docs.railway.com/reference/pricing/plans), and [Railway Serverless](https://docs.railway.com/reference/app-sleeping)
- [Fly.io pricing](https://fly.io/pricing/) and [Fly.io resource pricing](https://fly.io/docs/about/pricing/)
- [Google Cloud Run pricing](https://cloud.google.com/run/pricing)
- [Heroku pricing](https://www.heroku.com/pricing/)
