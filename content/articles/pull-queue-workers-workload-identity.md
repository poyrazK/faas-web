**Consume background job queues from long-running workers with no HTTP listener using pull queue leases, automatic lease heartbeats, `queue_depth` autoscaling, and zero-secret workload identity.** On Gregale, worker loops long-poll for batches, process jobs cleanly on `SIGTERM`, and block staging or PR preview code from touching production queues.

> **Maturity note:** Pull queue HTTP lease endpoints run on production queues today. SDK pull consumers live under preview paths (`@gregale/sdk-node/preview/queues/runtime`, `faas_sdk.preview.queue_consumer`, and Go `Client.ConsumeQueue`), and pull bindings are not yet supported on staging environments (use push on staging). Workload-identity queue auth requires platform workload identity to be enabled on your installation (otherwise pass an API key with `queues:consume`).

## Why push queues and DIY SQS consumers add friction

HTTP push queues require every ML, video-transcoding, or batch worker to run and secure an HTTP server just to receive deliveries. Moving to AWS SQS fixes that, but forces you to manage IAM credentials inside containers, build visibility-timeout renewal loops so slow jobs do not get redelivered mid-flight, and coordinate autoscaling scale-in so active jobs are not killed mid-batch.

## Lease, heartbeat, and drain with SDK or HTTP pull bindings

Create a pull queue binding on the worker app and pair it with a `queue_depth` scaling target:

```bash
curl -X POST "$GREGALE_API_URL/v1/apps/my-worker/queue-bindings" \
  -H "Authorization: Bearer $KEY" \
  -d '{"name":"jobs","queue_name":"jobs","mode":"pull","workload_class":"worker","max_concurrency":4}'
```

With the Node (`consumeQueue`), Python (`consume_queue`), or Go (`Client.ConsumeQueue`) consumers, Gregale long-polls up to `20` seconds per lease request, automatically extends each lease every third of its visibility timeout while the handler works, passes a cancellation signal (`AbortSignal` in Node, `message.lease_lost` in Python) if a lease drops, retries failed ack/nack calls, and stops leasing new messages on `SIGTERM` so in-flight work finishes inside the stop grace window:

```js
import { consumeQueue } from '@gregale/sdk-node/preview/queues/runtime';

consumeQueue({ app: 'my-worker', queue: 'jobs', concurrency: 4 }, async (message, { signal }) => {
  await resize(message.payload, { signal });
});
```

Direct HTTP clients can drive `leases` (`wait_seconds` up to `20`), `leases:ack`, `leases:nack` (with optional `delay_seconds`), and `leases:extend` directly.

## Zero-secret workload identity and scale-in protection

Inside a Gregale microVM, workers authenticate with a short-lived workload-identity token for audience `gregale:queues` from the guest's loopback token endpoint:

- **No API keys in images:** Production workers never embed long-lived queue tokens in `env` or Docker layers.
- **Strict production-only guard:** Only production deployments can lease with their workload token—staging or PR preview deployments receive `401`, guaranteeing unreviewed branch code cannot drain production queues.
- **Lease-aware scale-in:** Gregale tracks which worker instance holds each lease so pool scale-in avoids stopping busy instances mid-message. If an instance crashes or hits a network partition, its active leases terminate immediately for redelivery.

## Limits and operational tradeoffs

- **Batch and visibility bounds:** One call leases up to `100` messages or `8 MiB` of payloads and headers (`leases:ack`/`nack`/`extend` accept up to `100` receipts), with up to `64` concurrent waiting long-poll calls per API server per account. Default visibility timeout is `30` seconds, capped by the plan's async invocation deadline; leases exceeding their attempt budget move to dead letters with `queue_lease_attempts_exhausted`.
- **At-least-once semantics and staging:** Handlers must be idempotent, staging environments must use push bindings rather than pull today, and workers running outside Gregale still authenticate with a scoped `queues:consume` API key.

See [Pull queue leases](/docs/queue-pull-leases), [Event-driven workloads](/docs/event-driven), [Tune scaling](/docs/scaling-policy), [Running a Node.js API and a worker together](/articles/nodejs-api-and-worker), and [Gregale pricing](/pricing).
