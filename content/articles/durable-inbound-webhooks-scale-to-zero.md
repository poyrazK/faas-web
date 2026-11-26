**Gregale accepts Stripe and generic HMAC-SHA256 webhooks durably at the edge while your backend is scaled to zero, without losing events or paying for an always-on receiver.** Gregale verifies the provider's signature while your app is parked, writes the event to the durable invocation queue, immediately answers `202 Accepted`, and wakes your app to deliver it with async retries and dead-letter replay. Available on the Hobby, Pro, and Scale plans.

## Why webhooks drop on scale-to-zero backends

Payment and billing webhooks are unforgiving. When a backend scales to zero, a slow cold start can push the provider past its timeout and trigger a failure storm. Worse, if the receiver restarts mid-deploy or returns a temporary `5xx`, the original `Stripe-Signature` timestamp can expire before a later retry arrives. Teams usually end up disabling scale-to-zero for a dedicated receiver service or adding an external webhook gateway such as Hookdeck.

## How Gregale verifies and queues Stripe and HMAC webhooks without cold-start timeouts

Gregale keeps signature verification and durability in front of your app for both `stripe` and `generic` HMAC-SHA256 webhook senders (see the runnable [Durable Stripe & HMAC Webhooks starter](https://github.com/gregale-dev/durable-stripe-webhooks) on [Gregale templates](/templates)):

```http
POST /v1/apps/my-api/inbound-webhooks
Authorization: Bearer fp_live_...
Content-Type: application/json

{
  "name": "stripe-primary",
  "provider": "stripe",
  "signing_secret": "whsec_...",
  "delivery_path": "/internal/stripe"
}
```

Gregale seals the `signing_secret` at rest (never returning it again) and issues a one-time `endpoint_url` such as `https://api.gregale.dev/v1/hooks/gwh_...` to paste into Stripe.

For non-Stripe senders (`generic`), endpoints require a signing secret of at least 32 bytes and four headers:

- `X-Gregale-Event-ID`: unique sender event identifier for deduplication
- `X-Gregale-Event-Type`: event type such as `order.paid`
- `X-Gregale-Timestamp`: Unix seconds within 5 minutes of Gregale's clock
- `X-Gregale-Signature`: `sha256=` plus hex HMAC-SHA256 of `timestamp + "\n" + event_id + "\n" + event_type + "\n"` followed by the raw request body

Functions can also declare a generic webhook directly with `gregale add function NAME --trigger webhook`, and `gregale deploy` prints the endpoint URL once.

## Deduplication and spoofing protection

As soon as the signature checks out and the event commits to the durable queue, the provider receives `202 Accepted` with a `receipt_id` and `"duplicate": false`. If Stripe or another sender retries the same event ID for that endpoint, Gregale returns the original receipt ID with `"duplicate": true` and does not enqueue a second delivery.

When Gregale wakes your app and POSTs the payload to `delivery_path`, it attaches platform-owned headers:

- `X-Faas-Invocation-Source: inbound_webhook`
- `X-Gregale-Webhook-Provider: stripe`
- `X-Gregale-Webhook-Event-Id: evt_...`
- `X-Gregale-Webhook-Endpoint-Id: ...`

Notice what is missing: Gregale deliberately does **not** forward `Stripe-Signature`, because that header may have aged out while sitting in a retry queue after a cold start or outage. Instead, Gregale strips `X-Gregale-Webhook-*` and `X-Gregale-Event-*` from public traffic and overwrites `X-Faas-Invocation-Source` after queued headers are applied, so verifying `X-Faas-Invocation-Source: inbound_webhook` inside your route proves the request came through a verified webhook receipt rather than a spoofed public call.

## Retries, dead letters, rotation, and workflow bindings

Because Stripe already received `202 Accepted`, Gregale owns delivery from that point forward:

- **Retries and dead letters:** If your handler throws or answers `408` or `429`, Gregale retries under the app's `retry_policy`. Exhausted attempts or other `4xx` refusals move to dead letters, where you can replay them after fixing your handler (`gregale dlq replay`).
- **24-hour zero-downtime secret rotation:** Updating `signing_secret` via `PATCH /v1/apps/{slug}/inbound-webhooks/{id}` keeps the endpoint URL unchanged and continues accepting the old secret for 24 hours while you update Stripe or your sender.
- **Queue backpressure and rate limits:** If your app queue hits its pending message or backlog byte limit, Gregale answers `429 inbound_webhook_backlog_full` with `Retry-After: 60` before accepting the event so the provider keeps retrying upstream. Verified deliveries are capped at `1,200` per minute on Hobby, `3,000` on Pro, and `6,000` on Scale (and `60` on Free, while inbound webhook endpoints are available on Hobby, Pro, and Scale); invalid signatures are rate-limited separately by IP.
- **Direct stored workflow triggers and callbacks:** Endpoints can start a stored workflow directly through `workflow-binding`, or complete a paused `wait_for_callback` step for a specific Stripe object (`PUT /v1/workflows/runs/RUN_ID/callbacks/CALLBACK_ID/webhook-binding`), without waking an extra relay handler.

## When another option fits better

- **Multi-cloud fan-out or complex payload transformations:** If one incoming webhook must branch into multiple external services outside Gregale, or be reshaped in flight before delivery, a dedicated webhook broker such as Hookdeck fits better.
- **Sub-second synchronous responses expected by the caller:** Because Gregale acknowledges valid webhooks immediately with `202 Accepted` and delivers asynchronously, senders that expect application-computed data in the synchronous HTTP response body should call an ordinary endpoint instead.

See [Receive webhooks](/docs/inbound-webhooks), [Event-driven workloads](/docs/event-driven), [Build stored workflows](/docs/stored-workflows), and [Gregale pricing](/pricing) for the full API specification.
