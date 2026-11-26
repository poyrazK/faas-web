**Gregale's outbound integrations relay (Preview) lets your backend call Stripe, Resend, OpenAI, and other third-party HTTPS APIs via `$GREGALE_OUTBOUND_URL` without putting API keys in application environment variables.** Gregale injects sealed credentials outside your microVM, enforces method and path allowlists, and applies rate limits and daily request budgets before requests reach the upstream provider.

> **Preview:** Outbound integrations are a preview capability on the **Hobby, Pro, and Scale** plans, released per account. Ask support to enable them on your account; behavior and limits can change before general availability.

## How Gregale calls third-party APIs without API keys in environment variables

| Setup                                   | Key inside app env / memory                                                | Per-route method & path lock                         | Rate limits & daily caps           |
| --------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------- |
| **Gregale outbound integrations relay** | Never injected (`$GREGALE_OUTBOUND_URL` authenticates by microVM identity) | Enforced by relay (`403 outbound_route_not_allowed`) | Built in per integration & binding |
| **Env-var secret manager**              | Plaintext key visible in `process.env` / memory                            | All paths & methods permitted by upstream key        | Requires separate API proxy        |

## Why API keys in environment variables widen blast radius

Traditional secrets managers encrypt secrets at rest, then inject them as plaintext environment variables inside your running container. Once an app holds raw `STRIPE_SECRET_KEY`, `RESEND_API_KEY`, or `OPENAI_API_KEY` values in `process.env`, any dependency supply-chain compromise, SSRF bug, accidentally logged environment dump, or over-privileged coding agent session can exfiltrate credentials that work from anywhere on the internet with full provider permissions.

## Seal the key once, call `$GREGALE_OUTBOUND_URL` with no secret

With outbound integrations, the secret never enters your microVM's environment or memory:

1. **Register the HTTPS provider once on your account** with an allowed route policy (`origin` must be HTTPS without a query/fragment and must resolve strictly to public IP addresses—private, link-local, and metadata IPs are refused; up to 25 enabled integrations per account):

```sh
curl -X POST https://api.gregale.dev/v1/outbound/integrations \
  -H "Authorization: Bearer $GREGALE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "email",
    "origin": "https://api.resend.com",
    "allowed_methods": ["POST"],
    "allowed_path_prefixes": ["/emails"]
  }'
```

2. **Upload the sealed credential** (`PUT /v1/outbound/integrations/$INTEGRATION_ID/credential` with `{"authorization": "Bearer re_..."}`). Gregale seals it at rest and never returns it through any API; rotating the provider key is a single `PUT`.
3. **Bind it to specific apps**, optionally narrowing methods or paths per app (`PATCH /v1/apps/my-app/outbound-bindings/$INTEGRATION_ID`; trying to widen past the account policy returns `400`):

```sh
curl -X PUT https://api.gregale.dev/v1/apps/my-app/outbound-bindings/$INTEGRATION_ID \
  -H "Authorization: Bearer $GREGALE_TOKEN"
```

4. **Call the provider from app code without credentials.** Gregale sets `GREGALE_OUTBOUND_URL` in bound apps and authenticates calls by the calling app's microVM identity:

```js
const res = await fetch(`${process.env.GREGALE_OUTBOUND_URL}/i/${INTEGRATION_ID}/emails`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ from, to, subject, html }),
});
```

If an unbound app tries to call an integration (`403 outbound_app_not_attached`) or calls an unapproved route (`403 outbound_route_not_allowed`), the relay refuses the request before it ever leaves Gregale.

## Built-in rate limits, circuit breakers, budgets, and release probes

Each integration can enforce an admission and resiliency policy without extra proxy infrastructure (`PUT /v1/outbound/integrations/$INTEGRATION_ID/request-policy`):

- **Rate and concurrency control:** `rate_per_second`, `burst`, `max_in_flight`, and `request_timeout_ms`.
- **Resilience:** `max_retries` (`0–2` on bodyless `GET`/`HEAD`), `retry_budget_per_minute`, opt-in `response_cache_ttl_seconds` (up to `300`), and consecutive-failure circuit breaking (`circuit_breaker_failure_threshold`, `circuit_breaker_open_seconds`).
- **Daily spend protection:** Set optional `daily_request_limit` caps both on the integration and individually per app binding, resetting on UTC day boundaries and inspectable at `/usage`.
- **Pre-release connectivity verification:** Opt into a safe read-only `GET`/`HEAD` probe (`gregale app binding probe-policy set $INTEGRATION_ID --path /domains --method GET --expect-status 200`) and verify a release candidate's outbound connectivity through the relay (`gregale app binding verify my-app --release v12 --outbound $INTEGRATION_ID`).

## Plan ceilings (Preview)

Policies exceeding your plan's ceiling are rejected with `400 validation_failed` rather than silently clamped:

| Plan  | Requests per day | Rate per second | Burst | In flight | Timeout | Retry budget per minute |
| ----- | ---------------: | --------------: | ----: | --------: | ------: | ----------------------: |
| Hobby |        1,000,000 |              20 |   100 |        50 |    60 s |                     120 |
| Pro   |       10,000,000 |             100 |   500 |       250 |   120 s |                     600 |
| Scale |      100,000,000 |             500 | 2,000 |     1,000 |   300 s |                   3,000 |

## Tradeoffs and when another option fits better

- **Preview availability:** Outbound integrations are currently released per account in Preview on Hobby, Pro, and Scale, and limits or API details can evolve before general availability.
- **Authorization-header providers:** The relay injects an `Authorization` header over HTTPS. Third-party SDKs that require non-standard request signing headers, client mTLS certificates, or hardcoded hosts that disallow base URL overrides still need secrets injected via [Manage secrets](/docs/secrets).

See [Outbound integrations](/docs/outbound-integrations), [Manage secrets](/docs/secrets), [Blocked outbound destinations](/docs/egress-denylist), [Security](/docs/security), and [Best cloud platform for AI coding agents](/articles/best-cloud-for-ai-coding-agents).
