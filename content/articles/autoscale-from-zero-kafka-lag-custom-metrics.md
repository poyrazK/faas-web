**Scale backend apps and queue workers straight up from zero on external broker lag (`queue_lag`), pushed business `custom` metrics, or timezone-aware scheduled warm windows—without operating Kubernetes or KEDA.**

## Why HTTP-only autoscaling breaks for async backlogs

An app handling zero incoming HTTP requests can still sit behind a million-message Kafka topic or thousands of pending `orders_pending` rows in Postgres. If autoscaling only watches live HTTP requests or CPU, workers stay parked at zero until an external cron or manual intervention wakes them.

## Six independent scaling signals—and `queue_lag` vs `queue_depth`

Declare `scaling.targets` directly in `gregale.yaml` and Gregale evaluates every signal independently, provisioning for whichever target asks for the most instances:

| Signal                | What it measures                                                             |
| --------------------- | ---------------------------------------------------------------------------- |
| `concurrent_requests` | In-flight requests per instance (best proxy for tail latency)                |
| `rps`                 | Requests per second per instance                                             |
| `cpu`                 | Max CPU percent across instances                                             |
| `queue_depth`         | Backlog each worker should drain in Gregale's own queue                      |
| `queue_lag`           | Backlog still waiting upstream on Kafka, NATS, Redis Streams, or SQS brokers |
| `custom`              | Any fleet-total gauge metric pushed via API or OTLP (`delta` up-down/gauges) |

Watch the distinction between `queue_depth` and `queue_lag`: a broker trigger pulls at most one batch per tick, so a 1,000,000-message Kafka backlog with batch size `64` reports `queue_depth = 64`. For Kafka, `queue_lag` sums topic high-watermark minus committed consumer offsets across partitions so retries and stalled partitions surface immediately.

## Scaling up from zero on pushed `custom` metrics

On paid plans, an external cron, database trigger, or upstream service can push fleet-total backlog gauges even while your app is completely parked at zero:

```bash
curl -X PUT https://api.gregale.dev/v1/apps/$APP/custom-metrics/orders_pending \
  -H "Authorization: Bearer $GREGALE_TOKEN" \
  -d '{"value": 1284}'
```

Paired with a `target` of `100` in `gregale.yaml`, Gregale calculates `ceil(1284 / 100) = 13` instances cleanly from zero. Custom metrics support up to `20` names on Hobby, `50` on Pro, and `200` on Scale, expire automatically past their freshness window so a crashed metric pusher scales the fleet down rather than stranding replicas, and support 15-day history (`gregale metric --custom`) plus OTLP ingestion (`delta` temporality recommended) in preview.

## Scheduled warm windows and bounded warm queues

When traffic follows predictable business hours, skip cold wakes using cron + duration windows evaluated in any IANA timezone (daylight saving handled automatically):

```yaml
scaling:
  min_instances: 0
  timezone: Europe/Istanbul
  schedules:
    - cron: '0 8 * * 1-5'
      duration: 12h
      min_instances: 3
  concurrency_overflow: queue
```

Schedules only raise your warm floor during the declared window (`1m` to `7d`, billed like normal warm capacity) and park back to `0` overnight and on weekends. During sudden bursts past your concurrency cap, `concurrency_overflow: queue` buffers waiters cleanly (`32` waiters / `2s` on Hobby, `128` / `2s` on Pro, `512` / `2s` on Scale, `8` / `1s` on Free), adding `X-Gregale-Queue-Wait-Ms` and `Server-Timing: gregale_queue` headers before rejecting overflow with `429 concurrency_queue_full` or `503 concurrency_queue_timeout` plus `Retry-After`.

## Tradeoffs and scaling nuances

- **Conservative scale-down on non-RPS signals:** Apps scaling on `concurrent_requests`, `cpu`, `queue_depth`, `queue_lag`, or `custom` wait for each instance to cross its idle timeout (`30–600 s` by plan) before parking, avoiding flapping at the edge of a burst.
- **Preventing park/wake churn on `custom` metrics:** If a pushed gauge reflects background work that does not generate invocations to keep instances busy, instances can idle out and wake again every timeout cycle; tie that work to a queue binding or use a scheduled `min_instances` window instead.
- **No `p99_latency_ms` target:** Legacy `p99_latency_ms` targets return `422` pointing to `concurrent_requests`, which rises immediately when instances start queueing.

See [Tune scaling](/docs/scaling-policy), [How scaling to zero works](/docs/scale-to-zero), [Pull queue leases](/docs/queue-pull-leases), [Scale to zero without slow cold starts](/articles/scale-to-zero-without-cold-starts), and [Gregale pricing](/pricing).
