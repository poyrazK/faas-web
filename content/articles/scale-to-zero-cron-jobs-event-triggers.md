**Run recurring cron jobs, one-shot delayed tasks, and app-to-app background events without keeping an idle server running or provisioning AWS EventBridge, SQS, and Cloud Scheduler.** Gregale wakes your microVM when work is due and scales it right back to zero afterward.

## Why scheduled work bloats serverless bills and stacks

On fixed-tier PaaS hosts, running a nightly report or hourly cleanup means paying for a 24/7 worker container—or deploying external GitHub Actions cron workflows that call public URLs without platform delivery guarantees. Adding delayed follow-ups ("send a reminder 30 minutes after signup") or async service events normally drags Redis, RabbitMQ, or SQS into your infrastructure before you ship your first feature.

## Scale-to-zero HTTP crons and command crons

On Hobby, Pro, and Scale, Gregale crons send an authenticated `POST` request (`X-Faas-Invocation-Source: cron`, `X-Faas-Invocation-Id`, stripping caller-forged `X-Faas-*` headers) to your app and let it park immediately after responding:

```bash
gregale cron create --app my-api --schedule "*/15 * * * *" --path /jobs/sync --timezone Europe/Istanbul
gregale cron next --app my-api
gregale cron run CRON_ID --wait
```

| Plan  | Crons per app | Crons per account |
| ----- | ------------: | ----------------: |
| Hobby |             5 |                10 |
| Pro   |            20 |                50 |
| Scale |           100 |               500 |

- **DST-safe timezones and policies:** Pass any IANA timezone (daylight-saving gaps and repeated hours handled cleanly), `--skip-if-running`, `--schedule-policy` (`allow`, `skip`, or `replace`, plus `coalesce_latest`), `--failure-rules`, and `--environment staging` for non-production schedules.
- **Declarative `triggers:` and preview command crons:** Declare schedules in `gregale.yaml` alongside your code, or use preview command crons (`--command bin/maintenance`) for tasks up to `10` minutes without adding an HTTP route.
- **Note on billing intervals:** Every cron run wakes the app, so choose the longest interval your workload allows—every-minute crons keep an app warm almost continuously.

## One-shot delayed tasks, durable inbox, and signed outbox

For deferred execution or service-to-service decoupling without operating message brokers, use Gregale's built-in durable queues:

```bash
# Schedule a durable one-shot call up to 365 days in the future
gregale delayed-task add --app billing --delay 30m \
  --path /internal/send-reminder --payload '{"invoice_id":"inv_123"}' \
  --idempotency-key reminder-inv-123

# Enqueue a CloudEvents 1.0 message directly to another app's inbox
gregale event send billing --type invoice.created --data '{"invoice_id":"inv_123"}'
```

- **Dead-letter recovery and retention:** Successful async/cron/inbox history stays queryable for `1` day on Free, `7` days on Hobby, `30` days on Pro, and `90` days on Scale, while **failed and dead-lettered runs (`gregale dlq list <app>`) are retained for at least `30` days across every plan**.
- **Signed webhook outbox:** Register customer webhook URLs once and fan out `gregale webhook deliver` events with automatic HMAC signing, retries, and backpressure (`1,000` deliveries on Free, `5,000` on Hobby, `25,000` on Pro, `50,000` on Scale).

## Tradeoffs vs dedicated streaming brokers

Gregale's application inbox, delayed tasks, and crons eliminate RabbitMQ, SQS, and external schedulers for typical API-to-worker, notification, and nightly batch workloads with at-least-once delivery (deduplicate by event ID). If you need multi-consumer log replay over partitioned streaming topics, keep Kafka and pair it with [Gregale Kafka-lag autoscaling](/articles/autoscale-from-zero-kafka-lag-custom-metrics).

See [Crons](/docs/crons), [Event-driven workloads](/docs/event-driven), [Jobs](/docs/jobs), [Where to host a FastAPI app with background jobs and Postgres](/articles/fastapi-background-jobs-postgres), and [Gregale pricing](/pricing).
