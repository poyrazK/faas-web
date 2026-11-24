## Results

The same eight FastAPI requests used **42.9% less billable compute** when sent in bursts. At 40 requests per day, repeating the measured patterns for 30 days would use an estimated **0.150 GB-RAM-hours for spread traffic** or **0.086 GB-RAM-hours for bursts**. Both fit within Gregale's 20 GB-RAM-hour Free allowance if the fixture is the only app using it.

| Pattern | Requests | Measured windows | Billable MB-seconds | GB-RAM-hours | Billed awake seconds |
| ------- | -------: | ---------------: | ------------------: | -----------: | -------------------: |
| Spread  |        8 |        2 × 120 s |               3,696 |     0.001003 |                   14 |
| Burst   |        8 |        2 × 120 s |               2,112 |     0.000573 |                    8 |

All 16 requests returned HTTP 200, and the ledger counted four requests in each window. Both spread windows billed 1,848 MB-seconds. Both burst windows billed 1,056 MB-seconds. The control window recorded zero requests and zero billable compute.

| Pattern | Instance observations | No resident instance | Running | Frozen in memory |
| ------- | --------------------: | -------------------: | ------: | ---------------: |
| Spread  |                    24 |                    2 |      16 |                6 |
| Burst   |                    24 |                    2 |       4 |               18 |

Both patterns began parked, with the first request sent about 5 seconds into each window. After the first request, every sample showed a resident VM. Burst windows were observed frozen more often. The state counts cover 10-second samples, while the billed awake seconds come from the compute ledger.

## Test environment

| Component     | Configuration                                                                   |
| ------------- | ------------------------------------------------------------------------------- |
| Platform      | Gregale hosted Firecracker app on a Scale account                               |
| Instance      | 256 MB RAM, 500 millicores, one instance maximum, zero minimum                  |
| Workload      | Python 3.13, FastAPI 0.165.0, Uvicorn 0.54.0, one small JSON response           |
| Lifecycle     | Request execution, `between_requests` pause, 15-second idle timeout             |
| Traffic       | One client, one request at a time, caching disabled for the fixture response    |
| Meter         | Per-app billable MB-seconds returned by the route activity report               |
| Host hardware | CPU model, host memory, and storage model unavailable in the customer telemetry |

## Methodology

We verified the fixture response and parked the app before collection. We then recorded a one-minute control window with zero test requests. We ran four two-minute windows in spread, burst, burst, spread order. Each started on a UTC minute boundary with no resident instance. Between measured windows, we left a minute to park the fixture and verify that the reset had finished.

- **Spread.** Four sequential requests scheduled 30 seconds apart, starting 5 seconds into the window.
- **Burst.** Four sequential requests scheduled half a second apart, starting 5 seconds into the window. Each waited for the previous response if it was still in flight.

The traffic script made one attempt per scheduled request and verified each successful response body. It recorded when each request was sent and the gateway wake classification. The publicly routed requests drove the experiment. The results use Gregale's per-app ledger and instance history, so the benchmark measures compute consumption and park events.

The route activity report sums billable compute in whole-minute buckets. We queried the same aligned windows twice after traffic ended to check for late records. We converted MB-seconds to GB-RAM-hours by dividing by `1024 × 3600`. This includes the platform's billable memory overhead. [Billing units](/docs/billing).

Every 10 seconds, a read-only instance query sampled whether a VM was resident and what state it was in. The first sample completed before the first request. These observations show when the app was seen with no resident instance and when its VM was frozen in memory. They have 10-second sampling resolution. The ledger separately reports how much time was billed. [Scale-to-zero lifecycle](/docs/scale-to-zero).

## 30-day compute estimates

The estimates repeat the measured average compute per window for 30 days, with enough idle time for the fixture to park at each boundary. They assume this is the only app consuming the account's included compute. Free includes 20 GB-RAM-hours per month and stops serving when the allowance is exhausted. Hobby starts at $10 per month and includes 200 GB-RAM-hours. Paid plans charge $0.05 per GB-RAM-hour above their allowance up to the account's spend cap. Prices are in USD before tax. [Public pricing feed](/pricing.json) and [billing limits](/docs/billing).

| Daily traffic            | Pattern | Estimated GB-RAM-hours | Free compute and subscription | Hobby compute and subscription |
| ------------------------ | ------- | ---------------------: | ----------------------------: | -----------------------------: |
| 40 requests, 10 windows  | Spread  |                  0.150 |                            $0 |                            $10 |
| 40 requests, 10 windows  | Burst   |                  0.086 |                            $0 |                            $10 |
| 360 requests, 90 windows | Spread  |                  1.354 |                            $0 |                            $10 |
| 360 requests, 90 windows | Burst   |                  0.773 |                            $0 |                            $10 |

For example, a Hobby account that uses 250 GB-RAM-hours and has enough room under its spend cap would pay $2.50 for the 50 hours above its allowance, plus the $10 subscription.

## Data and reproduction

- [All request observations (CSV)](/research/intermittent-fastapi-cost-2026-11-24/traffic.csv)
- [Two usage ledger captures (JSON)](/research/intermittent-fastapi-cost-2026-11-24/ledger.json)
- [Instance state observations (CSV)](/research/intermittent-fastapi-cost-2026-11-24/states.csv)
- [Pricing feed snapshot (JSON)](/research/intermittent-fastapi-cost-2026-11-24/pricing.json)
- [Calculated results and estimates (JSON)](/research/intermittent-fastapi-cost-2026-11-24/summary.json)
- [Traffic and evidence collector (Python)](/research/intermittent-fastapi-cost-2026-11-24/run.py)
- [Offline analysis (Python)](/research/intermittent-fastapi-cost-2026-11-24/analyze.py)
- Fixture files [main.py](/research/intermittent-fastapi-cost-2026-11-24/fixture/main.py), [requirements.txt](/research/intermittent-fastapi-cost-2026-11-24/fixture/requirements.txt), and [gregale.yaml](/research/intermittent-fastapi-cost-2026-11-24/fixture/gregale.yaml)

Download the observations, pricing snapshot, and analysis script into one directory. The scripts use Python 3.11 or later and the standard library.

```sh
python3 analyze.py . pricing.json
```

To collect a fresh sample, place the fixture files in `fixture/` and set `fixture/.python-version` to `3.13`. Use a uniquely named disposable app and an authenticated CLI with access to the [route activity report](/docs/api/apps#getRouteAwake). Set `BENCHMARK_APP` to the unused slug.

```sh
gregale deploy --path fixture --source worktree --name "$BENCHMARK_APP" \
  --size small --execution-mode request --yes --wait
gregale app scale "$BENCHMARK_APP" --ram 256 --idle 15 --min 0 \
  --max-concurrency 1 --crawler-policy block --no-health-path-wakes --no-require-authn
gregale app park "$BENCHMARK_APP"
python3 run.py "$BENCHMARK_APP" evidence
python3 analyze.py evidence pricing.json
```

## Limits

The run covers one hosted app, one fixture, one explicit idle setting, and two observations per traffic pattern. Monthly totals are extrapolations from this short run on Scale. A Free deployment, other idle settings and traffic patterns, longer requests, or background processing may yield different compute usage. The estimates cover the subscription and compute only. They exclude builds, egress, databases, storage, and taxes.
