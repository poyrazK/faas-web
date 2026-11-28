**On Gregale, three commands narrow a bill down from your account to one
route: `gregale billing costs` ranks every app by usage this month,
`gregale app costs my-api` splits one app by deployment, and
`gregale metric resources my-api` shows which routes were running when its
memory peaked.** Compute is billed for the memory an app is given, so the
route that forces a bigger size is the one driving the bill. App costs and
metrics are on Hobby, Pro and Scale.

## Find it

```bash
# Every app and job, ranked by usage this month
gregale billing costs
gregale billing costs --month 2026-10

# One app, split by deployment, with compute and egress
gregale app costs my-api
gregale app costs my-api --month 2026-10 --json

# The routes behind memory and CPU peaks, up to 14 days back
gregale metric resources my-api --since 72h

# This month's bill at the current rate
gregale billing forecast
```

## Read the route table

`metric resources` lists each route with how often it was running when the
app's memory or CPU peaked:

| Column        | What it means                                                             |
| ------------- | ------------------------------------------------------------------------- |
| `MEM PEAKS`   | Share of memory peaks the route was in flight for                         |
| `SOLE`        | Peaks where it was the only route in flight                               |
| `RUNS IN`     | Share of minutes it ran in at all                                         |
| `P95 WITH`    | 95th-percentile memory peak in minutes when it ran                        |
| `P95 WITHOUT` | The same in minutes when it didn't: roughly what the app needs without it |
| `CPU PEAKS`   | Share of CPU peaks it was in flight for                                   |

A route with a high peak share that runs in few minutes is the one sizing
the app. A route that runs every minute shows up in every peak too, so look
at `RUNS IN` before you blame it.

## Bring it down

- **Give the app the memory it uses.** Compute is billed for the app's
  memory, not what it touches, so an app sized at 512 MB that peaks at
  310 MB pays for the rest. `gregale app update my-api --ram 384` applies
  to new instances; `gregale app restart my-api` applies it now.
- **Move the heavy route out.** A report or export that sizes the whole app
  can run as a [job](/docs/jobs) or a [one-off command](/articles/run-one-off-command-in-production)
  with its own memory.
- **Let it park.** Idle time is free once the app pauses or parks; see
  [why an app isn't scaling to zero](/articles/why-app-not-scaling-to-zero).
- **Cap it.** A [spend cap](/articles/hard-cloud-spend-caps) stops overage
  at a fixed amount each month.

`app costs` reports each meter's coverage, such as
`Coverage: complete, fresh`, and says what it leaves out: cost reports cover
compute and app egress, while subscription fees, tax and credits are on your
invoices. Costs within your plan's included GB-RAM-hours show as `USD 0.00`,
with the usage in GB-hours beside them.

## What we measured

We ran a Node.js app at 512 MB on Gregale on 2026-11-28 for 14 minutes:
`GET /` and `GET /health` every 3 seconds, and a `GET /report` that builds a
250 MB report in memory about every 2 minutes.

- **The report route sized the app:** `metric resources` put `GET /report`
  in flight for 100% of the 5 memory peaks while it ran in only 43% of
  minutes; the two light routes ran in every minute.
- **Memory stayed up:** between reports, memory held at 310 to 312 MB out
  of the 481 MB the app could use; Node.js didn't hand it back.
- **Usage:** `app costs` split the app's 0.0757 GB-hours across its two
  deployments, shown as `USD 0.00` because they were within the plan's
  included hours.
- **Sizing down:** at 384 MB, after a restart, the report route answered
  3 of 3 times, for 25% less compute per running second.

## How other platforms compare

| Platform    | Seeing what costs what                                                                              |
| ----------- | --------------------------------------------------------------------------------------------------- |
| **Gregale** | Costs by app, job and deployment, and the routes behind each app's memory and CPU peaks             |
| **Railway** | Usage is billed per project; the CLI's project view breaks usage down by service                    |
| **Vercel**  | The Usage page breaks usage down by project and region; `vercel billing usage --group-by project`   |
| **Fly.io**  | Billing is monthly per organization, with a breakdown of charges in the dashboard's Billing section |
| **Render**  | The dashboard's Billing page shows the month's accrued usage, past invoices and included usage      |

Checked against each vendor's public documentation on November 28, 2026:
[Railway project usage](https://docs.railway.com/projects/project-usage),
[Vercel: manage and optimize usage](https://vercel.com/docs/pricing/manage-and-optimize-usage),
[Fly.io billing](https://fly.io/docs/about/billing/),
[Render dashboard](https://render.com/docs/render-dashboard).

## Pricing

App costs and resource metrics cost nothing extra on Hobby ($10 a month),
Pro ($30) and Scale ($99). Compute is billed per second for an app's
memory while it runs; paused, frozen and parked time isn't billed. See
[Cost controls](/docs/cost-controls#see-where-the-money-goes) and
[Gregale pricing](/pricing).
