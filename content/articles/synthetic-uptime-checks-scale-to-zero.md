**Monitor low-traffic APIs from outside with Gregale's built-in synthetic checks—testing real DNS, TLS, edge routing, and cold wakes with consecutive-failure alerts and explicit wake-cost math so you never accidentally keep a scale-to-zero app pinned awake 24/7.**

## The hidden monitoring trap on scale-to-zero platforms

On any scale-to-zero cloud, pointing an external 1-minute uptime pinger at a quiet API destroys your idle savings. Worse, on plans with a 5- or 10-minute idle timeout, even a 5-minute external check silently keeps every instance running and billed for all 720 hours of the month.

## Built-in external checks and failure classification

Available on Hobby, Pro, and Scale (up to `5` checks per public app), synthetic checks probe your app's own public hostname through DNS, TLS, and the edge—waking parked apps and logging requests with `User-Agent: Gregale-Synthetics/1`:

```sh
gregale alert check create --app shop --name health --path /healthz
gregale alert check create --app shop --name home --path / --method HEAD \
  --expect-status 200 --every-minutes 15
gregale alert check status --app shop CHECK_ID
```

Each check supports `GET` or `HEAD`, intervals of `5`, `15`, or `60` minutes (`300`, `900`, or `3600` seconds), `timeout_ms` from `1,000` to `30,000` (default `10,000`, including any cold wake), and 7-day run retention, classifying failures cleanly into `status`, `timeout`, `dns`, `connect`, `tls`, or `other`.

Alert rules wire directly to `synthetic_check_consecutive_failures` (for example alerting only after `2` consecutive failures to ignore single blips) and `synthetic_check_latency_p95_ms`, automatically switching to `unknown` when paused or internal so stale failures stop paging.

## Exact wake-cost math per plan (with zero other traffic)

When an app is already busy, a synthetic check adds nothing. When an app has **zero other traffic** and uses its full plan RAM (+8 MB overhead) over a 30-day month, one check consumes roughly:

| Plan (RAM, idle timeout) | Every 5 min               | Every 15 min | Every 60 min | Included per month |
| ------------------------ | ------------------------- | ------------ | ------------ | -----------------: |
| Hobby (512 MB, 60 s)     | ~73 GB-h                  | ~24 GB-h     | ~6 GB-h      |           200 GB-h |
| Pro (1,024 MB, 300 s)    | ~726 GB-h (always warm)   | ~242 GB-h    | ~60 GB-h     |         1,000 GB-h |
| Scale (2,048 MB, 600 s)  | ~1,446 GB-h (always warm) | ~964 GB-h    | ~241 GB-h    |         3,000 GB-h |

The tradeoff jumps out immediately:

- On **Hobby (`60 s` idle)**, even a 5-minute check lets the app park for 4 minutes out of every 5 (`~73 GB-h` out of `200 GB-h`).
- On **Pro (`300 s` idle)** and **Scale (`600 s` idle)**, a 5-minute check matches or sits under the idle timeout—keeping the app continuously warm (`~726 GB-h` and `~1,446 GB-h`). Choose a `15`- or `60`-minute interval when you want the app to park between probes, or use `5` minutes intentionally when you want zero cold wakes during quiet periods.

Note also that `Gregale-Synthetics/1` probes count in request analytics (`ua_family`), `request_count`, and error-rate SLOs (apps moved back to Free or made internal pause checks automatically, returning `409` on internal-only apps).

## When an external monitoring vendor fits better

Built-in synthetic checks probe from Gregale's control plane to one path per check without following redirects or running browser scripts. If you need multi-region probes across 20+ global PoPs, multi-step Playwright click flows, or monitoring of internal-only services behind a private tunnel, use a dedicated external platform such as Checkly, Better Stack, or Datadog Synthetics.

See [Run synthetic checks](/docs/synthetic-checks), [Set up alerts](/docs/alerts), [How scaling to zero works](/docs/scale-to-zero), [Cost controls](/docs/cost-controls), and [Gregale pricing](/pricing).
