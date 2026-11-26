**Gregale provides built-in zero-code OpenTelemetry tracing and automatic deploy-to-deploy SQL latency and failure-regression detection without Datadog.** Turning on `tracing: { enabled: true }` in `gregale.yaml` instruments Node.js, Python, and Go/custom containers without configuring API keys, third-party exporters, or PII scrubbing.

## Which PaaS provides built-in OpenTelemetry tracing and SQL regression detection without Datadog?

Instead of deploying an external APM agent and configuring billing alerts yourself, Gregale bundles OTel trace ingestion, query normalization, and per-deploy regression verdicts directly into the platform debugger:

| Capability                   | Gregale built-in tracing                                                     | External APM (Datadog / Honeycomb + PaaS)                           |
| ---------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Instrumentation setup**    | `tracing: { enabled: true }` in `gregale.yaml`; zero vendor API keys         | Install SDKs, manage ingestion keys, and wire exporters per service |
| **SQL regression detection** | Normalizes queries and flags p95 slowdowns & `failure_regression` per deploy | Separate APM tier, custom dashboards, and per-host/span pricing     |
| **Snapshot overhead**        | Instrumentation pre-loaded before memory snapshot (`0` wake tax)             | Runtime initialization on every cold start                          |

## Why small teams skip distributed tracing

Setting up observability on a new backend usually means picking an external APM vendor, managing ingestion keys, installing language-specific SDKs, wiring `traceparent` forwarding, and making sure raw SQL parameters or customer emails never leak into spans. Most small teams postpone it until a slow deploy already hurts users.

## One-line OpenTelemetry across Node, Python, Go, and containers

Enable request tracing in `gregale.yaml` (or `[tracing] enabled = true` in `gregale.toml`):

```yaml
tracing:
  enabled: true
```

On the next deployment, Gregale instruments supported runtimes automatically:

- **Managed Node.js (`22`, `24`):** Auto-instruments Express, Fastify, Koa, NestJS, HTTP servers/clients, `pg`, MySQL, MongoDB, Redis, and gRPC via `@opentelemetry/auto-instrumentations-node`, and links `pino`/`bunyan` request logs automatically.
- **Managed Python (`3.12`, `3.13`):** Auto-instruments Django, Flask, FastAPI, WSGI/ASGI, `psycopg`, `psycopg2`, `asyncpg`, SQLAlchemy, Redis, PyMongo, and `requests`/`urllib3`/`httpx`/`aiohttp`, linking standard `logging` records automatically.
- **Go and custom containers:** Compiled Go apps can import `github.com/gregale-dev/gregale-go/preview/tracing` (`tracing.Handler`, `tracing.Transport`, `tracing.Open`), while Dockerfile/custom images already using OpenTelemetry export straight to the in-instance receiver (`http://127.0.0.1:4318/v1/traces` or gRPC `127.0.0.1:4317`, pre-wired via `OTEL_EXPORTER_OTLP_TRACES_*`).

Instrumentation loads before Gregale snapshots your app, so waking from a memory snapshot pays zero extra startup overhead.

## Deploy-to-deploy SQL normalization and failure regressions

Every traced request feeds `gregale debug requests get` and `gregale debug trace <trace-id>` (also accepting `x-faas-request-id`), showing wake-vs-app duration splits and cross-service hops (including inferred single-flight links flagged with `trace_inferred: true` if an instance serving one request omits `traceparent`):

- **Normalized dependency grouping:** Literals, `IN` lists, and multi-row `VALUES` fold automatically (`WHERE id = 42` and `WHERE id = 43` become one normalized statement, and Redis keeps only `GET ?` rather than cache keys).
- **Automated regression verdicts:** The debugger compares each route against the previous deployment and surfaces exact slowdowns (_`SELECT * FROM orders WHERE customer_id = ?` p95 40 ms to 210 ms_) as well as `failure_regression` alerts when a dependency hits at least 3 failures and jumps >=5 percentage points and 2x over baseline.
- **Privacy and redaction built in:** User IDs, request headers, URL query strings, full SQL values, and stack traces are dropped at ingestion; linked log lines keep only the last 20 lines (512 chars max) with emails, tokens, and card numbers redacted.

## Forward to Grafana/Honeycomb/Datadog or store zero-key metrics

Keep Gregale's debugger while also dual-shipping raw unstripped spans, logs, and metrics to your existing observability stack via `tracing.forward`:

```yaml
tracing:
  enabled: true
  forward:
    endpoint: https://otlp.example.com
    headers_secret: OTLP_HEADERS
  metrics: true
```

`tracing.forward` buffers up to `4 MiB` per instance with three background retries so slow upstream collectors never stall customer requests, while `tracing.metrics: true` stores OpenTelemetry metrics (`delta` temporality) straight into Gregale custom metrics with no API key.

## Operational limits and when an external APM fits better

- **Sampling on hot endpoints:** Busy routes keep individual request records (and attached spans) for the first `30` traced requests per route, method, and status each minute, plus dedicated error samples (`tracing.sample_ratio` adjusts trace volume).
- **Coverage boundaries:** Tracing requires a plan with the production debugger (the public `/v1/otel/v1/traces` endpoint returns `404` when disabled for an account); plain `console.log` and `winston` logs are not auto-linked, filesystem/DNS calls are not traced, and pre-fork servers like `gunicorn` still need standard post-fork worker initialization.

See [Trace requests](/docs/tracing), [Read logs](/docs/logs), [Tune scaling](/docs/scaling-policy), [Application companions](/docs/companions), and [Gregale pricing](/pricing).
