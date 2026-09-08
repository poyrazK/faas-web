# Trigger Console and Contract Design

**Status:** Direction approved in chat on 2026-09-09 after the PR #57 product and code review; written contract awaiting review.

## Goal

Ship the Triggers console as a complete, plan-aware event-source-mapping workflow: customers can create, inspect, pause, resume, edit, delete, and recover broker-backed triggers without exposing credentials or relying on frontend defaults that the API rejects.

This design spans `poyrazK/faas` and `poyrazK/faas-web`. The backend remains the source of truth for plan limits, accepted trigger kinds, validation, persistence, and secret handling. The console projects that contract into a progressive, keyboard-accessible workflow.

## Product model

A trigger binds one event source to one destination app. Five non-cron kinds use the trigger API:

- `kafka`
- `nats`
- `redis_streams`
- `sqs_compat`
- `queue`

Cron remains owned by `/v1/crons`. The Triggers creation flow links to the Crons page instead of sending `kind=cron` to `/v1/triggers`.

At runtime, an enabled trigger polls its source, filters records, closes a batch on size/window/payload bounds, wakes the destination app, and invokes:

```text
POST /_triggers/{kind}/{slug}
```

The function can report partial failures:

```json
{
  "batchItemFailures": [
    { "itemIdentifier": "record-id" }
  ]
}
```

Missing or empty failures mean full success. Failed items retry until `max_attempts`, then enter the dead-letter queue. Pause stops new polling on the next tick while in-flight work drains.

## Backend contract

### Plan capabilities

`AccountLimits` will expose the effective trigger capabilities already held in `pkg/api.Limits`:

```text
triggers_allowed
trigger_kinds
trigger_limit_per_app
trigger_limit_per_account
trigger_batch_size_max
trigger_batch_window_max_ms
trigger_max_attempts_max
trigger_payload_max_bytes
trigger_tls_skip_verify_allowed
```

The allowed kinds are:

| Plan | Kinds |
| --- | --- |
| Free | none |
| Hobby | `sqs_compat`, `queue` |
| Pro | all five non-cron kinds |
| Scale | all five non-cron kinds |

The API enforces the same list during create and returns a typed `403 trigger_kind_not_allowed` when the kind exists but is unavailable on the account plan. Unknown enum values continue through the existing request-validation response.

The UI never hard-codes numerical limits. It reads the account limits snapshot and filters kinds, constrains fields, explains quotas, and chooses defaults from those values.

### Legal defaults

Omitted create fields must be valid for every plan on which triggers are allowed. The API computes:

```text
batch_size_max  = min(64, plan.trigger_batch_size_max)
batch_window_ms = min(1000, plan.trigger_batch_window_max_ms)
max_attempts    = min(5, plan.trigger_max_attempts_max)
payload_bytes   = min(6 MiB, plan.trigger_payload_max_bytes)
poison strategy = commit
```

Explicit values still receive the existing plan-cap checks and typed errors. This preserves Pro/Scale defaults and makes an omitted Hobby request resolve to `50 / 1000 ms / 3 / 1 MiB`.

### Secret storage and reads

Kafka SASL passwords and TLS client private keys are write-only secrets.

The HTTP request keeps the documented plaintext shape so existing SDK and manifest callers remain compatible:

```json
{
  "sasl": {
    "mechanism": "SCRAM-SHA-256",
    "username": "service",
    "password": "plaintext-on-write"
  },
  "tls": {
    "client_cert": "PEM certificate",
    "client_key": "plaintext-on-write"
  }
}
```

After validation and before persistence, `apid` seals each sensitive value with the host X25519 recipient using `pkg/secretbox.SealBytes`. The JSONB row contains base64-encoded `password_sealed` and `client_key_sealed` fields and never the corresponding plaintext fields. The namespaces are fixed as `trigger_kafka_sasl_password` and `trigger_kafka_tls_client_key`.

The scheduler accepts both formats during rollout:

- sealed fields are decoded and opened with the host identity before the Kafka dialer is built;
- legacy plaintext fields remain readable by the scheduler until existing rows are recreated or migrated.

Customer API responses never return either plaintext or ciphertext. The response projection removes `password`, `password_sealed`, `client_key`, and `client_key_sealed`, then emits non-secret booleans `password_set` and `client_key_set`. This redaction applies to create, get, list, update, batch-create results, and account export wherever trigger config is included.

If the recipient is unavailable, a write containing secret material fails closed with `503 secret_store_unavailable`. If scheduler unsealing fails, the poll attempt reports a broker/config error without logging secret material.

### Updates

`kind`, `app_id`, and `slug` remain immutable. PATCH supports:

- enabled state through the existing pause/resume operations;
- source config replacement;
- batch size/window;
- maximum attempts;
- payload cap;
- Kafka poison strategy;
- filter criteria.

For Kafka config replacement, the server merges write-only fields against the stored config before validation and persistence:

- a supplied `password` or `client_key` rotates and reseals that value;
- an omitted secret leaf inside a supplied `sasl` or `tls` block preserves the stored sealed value;
- an omitted `sasl` or `tls` block removes that whole block, including its stored secret;
- response-only `password_set` and `client_key_set` markers are ignored if a client sends them back.

The server then validates the merged plaintext-shaped config, seals write-only values, and atomically replaces the stored JSONB document. The console initially edits delivery/filter settings and offers explicit credential rotation rather than attempting to reconstruct hidden values.

## Console information architecture

### List route

`/dashboard/triggers` remains the account-wide operational index. It contains:

- page heading and a primary “Create trigger” action;
- filters/search over app, kind, slug, and enabled state;
- rows showing kind, slug, destination app, status, batch/window, attempts, and update time;
- direct pause/resume controls with pending state disabled;
- links to URL-addressable trigger details;
- distinct loading, unreachable, error, empty-account, no-app, no-trigger, and Free-plan states.

The creation form is not permanently mounted beneath the table.

### Creation route

`/dashboard/triggers/new` is a progressive three-step flow:

1. **Destination:** app, allowed source kind, immutable slug.
2. **Source and delivery:** kind-specific connection fields plus delivery settings. Kafka security is an advanced section with TLS, mTLS, SASL mechanism, username, and password. Filtering is an advanced JSON editor validated locally for parseability and finally by the server.
3. **Review:** source summary, destination, limits, start behavior, handler path, and partial-batch response contract.

The form sends explicit plan-valid delivery values and an explicit `enabled` value. “Start consuming immediately” is visible and defaults on to preserve the API’s current behavior. Copy states that the platform validates configuration shape; it does not claim broker connectivity was tested.

On success, secret inputs and in-memory source state are cleared and the user navigates to `/dashboard/triggers/{triggerId}`. On failure, the flow stays populated and displays the stable `ApiError.code` outcome:

- `plan_triggers_not_allowed`: upgrade panel;
- `trigger_kind_not_allowed`: choose an allowed kind or upgrade;
- `trigger_quota_exceeded`: limit explanation;
- trigger batch/window/attempt/payload cap codes: field-level plan feedback;
- `trigger_invalid_config`: exact server detail;
- `secret_store_unavailable`: retry after operator repair;
- other errors: ordinary error summary with one retry action.

If no apps exist, the route shows “Create an app first” and links to the app wizard. It never renders a non-functional empty select.

### Detail route

`/dashboard/triggers/{triggerId}` contains:

- kind, slug, destination app, enabled/paused state;
- pause/resume, edit, and delete actions;
- aggregate state counters;
- records with state filtering and payload disclosure;
- dead-letter records with reason filtering, retry, and destructive drop;
- redacted source configuration;
- delivery/filter configuration;
- the handler path and `batchItemFailures` example.

Delete requires confirmation, invalidates trigger queries, and returns to the list. Edit locks immutable identity fields and constrains numerical values to the account limits.

## Frontend structure

The source form is decomposed so tests can exercise behavior without rendering the entire route:

- `trigger-form-model.ts`: discriminated form state, plan-derived defaults, validation, request construction, redacted-config normalization.
- `trigger-source-fields.tsx`: kind-specific connection and Kafka security inputs.
- `trigger-delivery-fields.tsx`: batching, retry, payload, poison strategy, enabled, and filter controls.
- `trigger-create.tsx`: step orchestration and mutation handling.
- `trigger-detail.tsx`: read projection, handler contract, edit and delete actions.
- route files: list, new, and detail composition only.

Generated `schema.d.ts` changes only through the vendored OpenAPI spec and `npm run api:types`.

## Testing strategy

### Backend

Tests are written before production changes and must prove:

- omitted Hobby settings resolve to legal values;
- explicit values above each plan cap still fail;
- Hobby rejects Kafka/NATS/Redis and accepts SQS/platform queue;
- Pro/Scale accept all five kinds;
- SASL mechanisms use the exact uppercase closed vocabulary;
- new Kafka writes persist no plaintext password/private key;
- trigger responses contain no plaintext or ciphertext secret;
- scheduler opens sealed secrets and builds the expected auth/TLS config;
- missing recipient and corrupt ciphertext fail closed without secret disclosure;
- legacy plaintext scheduler rows still work during rollout.

The full `make test` race-enabled suite is the backend completion gate.

### Console

Component and model tests must prove:

- Free renders the plan gate without submitting;
- Hobby offers only SQS and platform queue and sends Hobby-safe defaults;
- Pro/Scale offer every source;
- Kafka emits `PLAIN`, `SCRAM-SHA-256`, or `SCRAM-SHA-512` exactly;
- TLS/SASL fields shape the request correctly and secret fields clear after success;
- no-app state links to app creation;
- create success navigates to the new detail URL;
- typed API errors map to the correct recovery action;
- delete confirms, invalidates, and navigates;
- API-returned source configuration remains redacted in the UI.

The mock mirrors the complete account-limit and trigger response shapes. It does not copy a weaker approximation of server validation for security- or plan-critical behavior. A cross-contract fixture pins the plan defaults and accepted kind vocabulary shared with the vendored OpenAPI document.

`npm run check` and `npm run build` are the console completion gates.

## Rollout and compatibility

The backend lands before or together with the console because the console depends on new `AccountLimits` fields and secret-safe persistence. Added response fields are backward compatible. Existing clients can continue omitting optional delivery settings and benefit from legal plan defaults.

The scheduler keeps legacy plaintext-read compatibility for rollout, but every API response redacts legacy secret leaves immediately. New writes are sealed before the row reaches storage. Once production confirms no legacy plaintext rows remain, plaintext scheduler fallback can be removed in a separate security-hardening change.

No trigger creation flow claims a broker connection was tested. Broker connectivity remains observable through record state, broker errors, and dead-letter detail until a dedicated preflight endpoint is designed.
