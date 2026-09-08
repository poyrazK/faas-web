# Trigger Backend Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `faas` expose and enforce plan-aware trigger capabilities, choose legal defaults for every paid plan, and keep Kafka credentials sealed at rest and redacted on every customer read.

**Architecture:** Add plan-kind policy to `pkg/api`, place lossless Kafka secret envelope handling in a focused `pkg/triggerconfig` package, and make the HTTP layer seal/redact/merge at its trust boundary. The scheduler opens a copy of the stored config immediately before poller construction, while legacy plaintext remains readable during rollout. OpenAPI and generated SDKs are updated only after behavior is pinned by tests.

**Tech Stack:** Go 1.24, `filippo.io/age`, `pkg/secretbox`, `net/http`, PostgreSQL JSONB through the existing state store, OpenAPI 3, generated Node/Python SDKs, race-enabled Go tests.

**Spec:** [`docs/superpowers/specs/2026-09-09-trigger-console-contract-design.md`](../specs/2026-09-09-trigger-console-contract-design.md)

## Global Constraints

- Execute backend commands in `/home/bahadir/GREGALE/.worktrees/faas-trigger-contract`, branch `fix/trigger-contract`; do not modify `/home/bahadir/GREGALE/faas`.
- `pkg/api/limits.go` remains the source of truth for plan limits and allowed trigger kinds.
- Free allows no non-cron trigger kinds; Hobby allows only `sqs_compat` and `queue`; Pro and Scale allow `kafka`, `nats`, `redis_streams`, `sqs_compat`, and `queue`.
- Omitted delivery values resolve to `min(platform default, plan cap)`; explicit over-cap values still fail.
- Plaintext `sasl.password` and `tls.client_key` may enter an authenticated write request but must never reach PostgreSQL or a customer response.
- Stored sealed leaves are named `password_sealed` and `client_key_sealed`; response markers are `password_set` and `client_key_set`.
- Secret namespaces are exactly `trigger_kafka_sasl_password` and `trigger_kafka_tls_client_key`.
- Scheduler reads support both sealed values and legacy plaintext until a separate migration removes the fallback.
- Do not log plaintext or ciphertext secret material.
- Keep HTTP handler bodies at or below 50 lines by extracting helpers.
- Update `api/openapi.yaml`, then run generators; never edit `pkg/apid/openapi.yaml` or generated SDK files by hand.
- Every behavior change is test-first and every task ends in a focused conventional commit without attribution lines.
- Final gates are `make spec-check`, `make sdk-gen`, and `make test`.

## File Map

| File | Responsibility |
| --- | --- |
| `pkg/api/limits.go` | Canonical allowed trigger kinds and plan capability helpers. |
| `pkg/api/limits_test.go` | Closed plan × trigger-kind policy matrix. |
| `pkg/api/errors.go` | Stable `trigger_kind_not_allowed` and `secret_store_unavailable` problems. |
| `pkg/api/trigger.go` | Public Kafka credential size limits and existing request DTOs. |
| `pkg/api/dto.go` | Serialized trigger capability fields on `AccountLimits`. |
| `cmd/apid/handlers.go` | Projects canonical trigger limits into `GET /v1/account`. |
| `cmd/apid/handlers_account_test.go` | Pins the account capability wire shape. |
| `cmd/apid/handlers_triggers.go` | Plan gates, legal defaults, secret boundary, create/batch/update/read orchestration. |
| `cmd/apid/handlers_triggers_caps_test.go` | Plan-safe default, explicit-cap, and kind-gate regressions. |
| `cmd/apid/handlers_triggers_secrets_test.go` | Handler-level sealing, redaction, update-preservation, and fail-closed tests. |
| `pkg/state/memstore.go` | Faithful in-memory trigger config/delivery persistence for handler and scheduler tests. |
| `pkg/state/memstore_test.go` | Pins create/update trigger config and delivery persistence. |
| `pkg/triggerconfig/config.go` | Lossless seal/open/redact/merge operations over Kafka config JSON. |
| `pkg/triggerconfig/config_test.go` | Secret codec round-trip, redaction, unknown-field, legacy, and corrupt-envelope tests. |
| `pkg/sched/loop.go` | Holds rotation-aware trigger secret identities. |
| `pkg/sched/poller.go` | Preserves registered-factory construction errors. |
| `pkg/sched/dispatch_triggers.go` | Opens stored trigger secrets before poller creation. |
| `pkg/sched/poller_kafka_test.go` | Sealed and legacy Kafka runtime decoding tests. |
| `pkg/sched/dispatch_triggers_test.go` | Corrupt/missing identity and poller error propagation tests. |
| `cmd/schedd/main.go` | Loads host identities and injects them into the scheduler loop. |
| `cmd/schedd/main_test.go` | Pins rotation-aware host identity loading. |
| `docs/adr/100-triggers-event-source-mappings.md` | Security and plan-policy addendum. |
| `api/openapi.yaml` | Public account limits, redacted trigger config semantics, defaults, and typed errors. |
| `pkg/apid/openapi.yaml` | Generated embedded OpenAPI copy. |
| `sdk/node/src/generated/**` | Generated Node contract. |
| `sdk/python/faas_sdk/**` | Generated Python contract. |

---

### Task 1: Publish and enforce the plan-kind capability matrix

**Files:**

- Modify: `pkg/api/limits.go`
- Modify: `pkg/api/limits_test.go`
- Modify: `pkg/api/errors.go`
- Modify: `pkg/api/dto.go`
- Modify: `cmd/apid/handlers.go`
- Modify: `cmd/apid/handlers_account_test.go`
- Modify: `cmd/apid/handlers_triggers.go`
- Modify: `cmd/apid/handlers_triggers_caps_test.go`

**Interfaces:**

- Produces: `func (p Plan) AllowedTriggerKinds() []TriggerKind`
- Produces: `func (p Plan) AllowsTriggerKind(kind TriggerKind) bool`
- Produces: `const CodeTriggerKindNotAllowed = "trigger_kind_not_allowed"`
- Produces: `func ErrTriggerKindNotAllowed(plan Plan, kind TriggerKind) *Problem`
- Produces: `AccountLimits.TriggerKinds []TriggerKind` plus the eight scalar trigger capability fields from the approved spec.

- [ ] **Step 1: Write the failing plan-policy and error tests**

Add a table to `pkg/api/limits_test.go`:

```go
func TestAllowedTriggerKindsByPlan(t *testing.T) {
	want := map[Plan][]TriggerKind{
		PlanFree:  {},
		PlanHobby: {TriggerKindSQSCompat, TriggerKindQueue},
		PlanPro:   {TriggerKindKafka, TriggerKindNATS, TriggerKindRedisStreams, TriggerKindSQSCompat, TriggerKindQueue},
		PlanScale: {TriggerKindKafka, TriggerKindNATS, TriggerKindRedisStreams, TriggerKindSQSCompat, TriggerKindQueue},
	}
	for plan, kinds := range want {
		t.Run(string(plan), func(t *testing.T) {
			if got := plan.AllowedTriggerKinds(); !reflect.DeepEqual(got, kinds) {
				t.Fatalf("AllowedTriggerKinds() = %v, want %v", got, kinds)
			}
			for _, kind := range []TriggerKind{TriggerKindKafka, TriggerKindNATS, TriggerKindRedisStreams, TriggerKindSQSCompat, TriggerKindQueue} {
				if got := plan.AllowsTriggerKind(kind); got != slices.Contains(kinds, kind) {
					t.Errorf("AllowsTriggerKind(%s) = %v", kind, got)
				}
			}
		})
	}
}
```

Add `TestErrTriggerKindNotAllowedWireShape` to `cmd/apid/handlers_triggers_caps_test.go`; assert status 403, code `trigger_kind_not_allowed`, and detail containing both `hobby` and `kafka`.

- [ ] **Step 2: Run the focused tests and verify the missing-symbol failures**

```bash
go test ./pkg/api ./cmd/apid -run 'TestAllowedTriggerKindsByPlan|TestErrTriggerKindNotAllowedWireShape'
```

Expected: FAIL because the policy helpers and error constructor do not exist.

- [ ] **Step 3: Implement the canonical policy and typed error**

In `pkg/api/limits.go`, return copied slices so callers cannot mutate the policy:

```go
var paidExternalTriggerKinds = []TriggerKind{
	TriggerKindKafka, TriggerKindNATS, TriggerKindRedisStreams,
	TriggerKindSQSCompat, TriggerKindQueue,
}

func (p Plan) AllowedTriggerKinds() []TriggerKind {
	var kinds []TriggerKind
	switch p {
	case PlanHobby:
		kinds = []TriggerKind{TriggerKindSQSCompat, TriggerKindQueue}
	case PlanPro, PlanScale:
		kinds = paidExternalTriggerKinds
	}
	return append([]TriggerKind(nil), kinds...)
}

func (p Plan) AllowsTriggerKind(kind TriggerKind) bool {
	return slices.Contains(p.AllowedTriggerKinds(), kind)
}
```

In `pkg/api/errors.go`, add the stable 403 constructor:

```go
const CodeTriggerKindNotAllowed = "trigger_kind_not_allowed"

func ErrTriggerKindNotAllowed(plan Plan, kind TriggerKind) *Problem {
	return NewProblem(http.StatusForbidden, CodeTriggerKindNotAllowed,
		"Trigger kind not available",
		fmt.Sprintf("%s triggers are not available on the %s plan", kind, plan)).
		WithDocs(docsBase + "/plans#triggers")
}
```

- [ ] **Step 4: Add the account capability projection and its failing handler assertion**

Extend `api.AccountLimits` with the exact JSON fields:

```go
TriggersAllowed            bool          `json:"triggers_allowed"`
TriggerKinds               []TriggerKind `json:"trigger_kinds"`
TriggerLimitPerApp         int           `json:"trigger_limit_per_app"`
TriggerLimitPerAccount     int           `json:"trigger_limit_per_account"`
TriggerBatchSizeMax        int           `json:"trigger_batch_size_max"`
TriggerBatchWindowMaxMs    int           `json:"trigger_batch_window_max_ms"`
TriggerMaxAttemptsMax      int           `json:"trigger_max_attempts_max"`
TriggerPayloadMaxBytes     int           `json:"trigger_payload_max_bytes"`
TriggerTLSSkipVerifyAllowed bool          `json:"trigger_tls_skip_verify_allowed"`
```

In the existing account response test, assert Hobby serializes `sqs_compat,queue`, window `30000`, attempts `3`, payload `1048576`, and skip-verify `false`. Run that test and confirm it fails before wiring `accountResponse`.

- [ ] **Step 5: Wire `accountResponse` and create/batch kind gates**

Populate every field from `api.Limits` and `acct.Plan.AllowedTriggerKinds()`, converting `TriggerBatchWindowMaxSec * 1000` once at the response boundary.

In single-create, evaluate `TriggersAllowed` immediately after JSON decoding and required `app_id`, then call `AllowsTriggerKind(req.Kind)` after the existing enum validation but before `AppByID`. In batch-create, reject each non-cron manifest entry whose kind is not in the plan list before the store call.

- [ ] **Step 6: Run and commit the policy slice**

```bash
gofmt -w pkg/api/limits.go pkg/api/limits_test.go pkg/api/errors.go pkg/api/dto.go cmd/apid/handlers.go cmd/apid/handlers_account_test.go cmd/apid/handlers_triggers.go cmd/apid/handlers_triggers_caps_test.go
go test ./pkg/api ./cmd/apid -run 'TriggerKinds|TriggerKindNotAllowed|DashboardAccount|AccountResponse'
git add pkg/api/limits.go pkg/api/limits_test.go pkg/api/errors.go pkg/api/dto.go cmd/apid/handlers.go cmd/apid/handlers_account_test.go cmd/apid/handlers_triggers.go cmd/apid/handlers_triggers_caps_test.go
git commit -m "fix(api): enforce trigger capabilities by plan"
```

Expected: focused tests PASS.

---

### Task 2: Make omitted delivery settings legal on every enabled plan

**Files:**

- Modify: `cmd/apid/handlers_triggers.go`
- Modify: `cmd/apid/handlers_triggers_caps_test.go`
- Modify: `pkg/state/memstore.go`
- Modify: `pkg/state/memstore_test.go`

**Interfaces:**

- Produces: `func triggerDeliveryDefaults(limits api.Limits) (batchSize, batchWindow, attempts, payload int32)`
- Consumes: `enforceCreateTriggerCaps` from the existing handler.
- Both `POST /v1/triggers` and `POST /v1/triggers:batch_create` consume the same default/cap path.

- [ ] **Step 1: Write failing default-boundary tests**

Add table-driven assertions:

```go
func TestEnforceCreateTriggerCapsUsesPlanSafeDefaults(t *testing.T) {
	for _, tc := range []struct {
		plan api.Plan
		want [4]int32
	}{
		{api.PlanHobby, [4]int32{50, 1000, 3, 1048576}},
		{api.PlanPro, [4]int32{64, 1000, 5, 6291456}},
		{api.PlanScale, [4]int32{64, 1000, 5, 6291456}},
	} {
		l := api.MustLimitsFor(tc.plan)
		bs, bw, ma, pb, _, problem := enforceCreateTriggerCaps(&api.CreateTriggerRequest{Kind: api.TriggerKindQueue}, tc.plan, l)
		if problem != nil || [4]int32{bs, bw, ma, pb} != tc.want {
			t.Fatalf("%s defaults = %v, problem=%v; want %v", tc.plan, [4]int32{bs, bw, ma, pb}, problem, tc.want)
		}
	}
}
```

Retain or add explicit over-cap cases for all four numerical fields so clamping applies only to omitted values.

- [ ] **Step 2: Run the focused test and verify Hobby fails on the old 64/5/6 MiB defaults**

```bash
go test ./cmd/apid -run 'TestEnforceCreateTriggerCapsUsesPlanSafeDefaults|TestEnforceCreateTriggerCaps.*Cap'
```

Expected: FAIL for Hobby.

- [ ] **Step 3: Implement a single plan-aware default function**

Use a positive minimum helper:

```go
func cappedTriggerDefault(platformDefault, planCap int) int32 {
	if planCap > 0 && planCap < platformDefault {
		return int32(planCap)
	}
	return int32(platformDefault)
}

func triggerDeliveryDefaults(l api.Limits) (int32, int32, int32, int32) {
	return cappedTriggerDefault(64, l.TriggerBatchSizeMax),
		cappedTriggerDefault(1000, l.TriggerBatchWindowMaxSec*1000),
		cappedTriggerDefault(5, l.TriggerMaxAttemptsMax),
		cappedTriggerDefault(6*1024*1024, l.TriggerPayloadMaxBytes)
}
```

Initialize `enforceCreateTriggerCaps` from this tuple, then overwrite only explicitly positive request fields.

- [ ] **Step 4: Route batch-create through the same cap helper**

For each manifest trigger, construct an `api.CreateTriggerRequest` with the marshaled config and optional delivery pointers, then call `enforceCreateTriggerCaps`. Append the returned problem detail to that entry's batch error and skip the store call when non-nil. This also adds the currently missing batch-window and TLS-skip-verify checks.

- [ ] **Step 5: Make MemStore persist the values its callers supply**

Add a regression in `pkg/state/memstore_test.go` that creates a trigger with config `{"mode":"delayed_task"}` and delivery values `12/345/2/8192`, reads it back, then updates config and each delivery field and asserts the replacements persisted. Change `CreateTriggerIfUnderQuota` and `UpdateTrigger` to copy non-nil config/filter byte slices and use the supplied numerical values instead of hard-coded defaults.

- [ ] **Step 6: Verify and commit legal defaults**

```bash
gofmt -w cmd/apid/handlers_triggers.go cmd/apid/handlers_triggers_caps_test.go pkg/state/memstore.go pkg/state/memstore_test.go
go test ./cmd/apid ./pkg/state -run 'TriggerCaps|TriggerBatch|TLSSkipVerify|MemStore.*Trigger'
git add cmd/apid/handlers_triggers.go cmd/apid/handlers_triggers_caps_test.go pkg/state/memstore.go pkg/state/memstore_test.go
git commit -m "fix(api): derive trigger defaults from plan caps"
```

Expected: Hobby defaults PASS and explicit over-cap requests remain rejected.

---

### Task 3: Build the lossless Kafka secret envelope

**Files:**

- Create: `pkg/triggerconfig/config.go`
- Create: `pkg/triggerconfig/config_test.go`
- Modify: `pkg/api/trigger.go`

**Interfaces:**

- Produces: `func Seal(kind api.TriggerKind, raw json.RawMessage, recipient *age.X25519Recipient) (json.RawMessage, error)`
- Produces: `func Open(kind api.TriggerKind, raw json.RawMessage, identities []*age.X25519Identity) (json.RawMessage, error)`
- Produces: `func Redact(kind api.TriggerKind, raw json.RawMessage) json.RawMessage`
- Produces: `func MergeForUpdate(kind api.TriggerKind, stored, incoming json.RawMessage, identities []*age.X25519Identity) (json.RawMessage, error)`
- Produces: `var ErrRecipientUnavailable` and `var ErrIdentityUnavailable` for HTTP error mapping.
- Produces: `api.KafkaSASLPasswordMaxBytes = 4096` and `api.KafkaTLSClientKeyMaxBytes = 65536`.

- [ ] **Step 1: Write failing codec tests**

Create `pkg/triggerconfig/config_test.go` with an age identity and a Kafka blob containing both secrets plus `"future_field":{"kept":true}`. Assert:

```go
sealed, err := Seal(api.TriggerKindKafka, raw, ident.Recipient())
if err != nil { t.Fatal(err) }
for _, forbidden := range [][]byte{[]byte("sasl-secret"), []byte("PRIVATE KEY"), []byte(`"password"`), []byte(`"client_key"`)} {
	if bytes.Contains(sealed, forbidden) { t.Fatalf("sealed config leaked %q: %s", forbidden, sealed) }
}
if !bytes.Contains(sealed, []byte(`"password_sealed"`)) || !bytes.Contains(sealed, []byte(`"client_key_sealed"`)) {
	t.Fatalf("sealed fields missing: %s", sealed)
}
opened, err := Open(api.TriggerKindKafka, sealed, []*age.X25519Identity{ident})
if err != nil { t.Fatal(err) }
if !bytes.Contains(opened, []byte("sasl-secret")) || !bytes.Contains(opened, []byte("future_field")) {
	t.Fatalf("open lost plaintext or unknown field: %s", opened)
}
```

Add separate tests for non-Kafka pass-through, nil recipient with and without secret leaves, redaction markers, malformed JSON returning `{}`, wrong namespace, corrupt ciphertext, legacy plaintext open, update preservation, rotation, and whole-block removal.

- [ ] **Step 2: Run the package test and verify the missing-package failure**

```bash
go test ./pkg/triggerconfig
```

Expected: FAIL because the package implementation does not exist.

- [ ] **Step 3: Implement lossless nested-object helpers**

Use `map[string]json.RawMessage`, not `api.KafkaTriggerConfig`, so unknown fields survive. Implement private `decodeObject`, `encodeObject`, `secretString`, and `sealedBytes` helpers. JSON encoding of `[]byte` supplies the required base64 wire value.

`Seal` must delete plaintext leaves after `secretbox.SealBytes`; `Open` must validate the returned namespace before restoring the plaintext leaf; `Redact` must delete both plaintext and ciphertext and add a boolean marker when either existed. For malformed Kafka JSON, `Redact` returns exactly `json.RawMessage("{}")` to fail closed.

- [ ] **Step 4: Implement update merge semantics exactly**

For Kafka only, call `Open` on the stored config first. For each supplied `sasl`/`tls` object, preserve the opened stored secret only when the incoming secret leaf is absent. If the whole block is absent, leave it absent. Delete response-only marker leaves from the incoming object. Return a plaintext-shaped merged object for ordinary validation, followed by `Seal` at the HTTP boundary.

- [ ] **Step 5: Verify no secret bytes survive the sealed/redacted forms and commit**

```bash
gofmt -w pkg/triggerconfig/config.go pkg/triggerconfig/config_test.go pkg/api/trigger.go
go test ./pkg/triggerconfig ./pkg/api -run 'Trigger|Kafka'
git add pkg/triggerconfig/config.go pkg/triggerconfig/config_test.go pkg/api/trigger.go
git commit -m "feat(api): seal Kafka trigger credentials"
```

Expected: all codec tests PASS, including unknown-field preservation and corrupt-envelope failures.

---

### Task 4: Enforce the secret boundary on every trigger API path

**Files:**

- Modify: `pkg/api/errors.go`
- Modify: `cmd/apid/handlers_triggers.go`
- Create: `cmd/apid/handlers_triggers_secrets_test.go`

**Interfaces:**

- Produces: `const CodeSecretStoreUnavailable = "secret_store_unavailable"`
- Produces: `func ErrSecretStoreUnavailable() *Problem` with HTTP 503.
- Produces private handler helpers `sealTriggerConfig`, `mergeTriggerConfigForUpdate`, and `triggerConfigIdentities`.
- Consumes: all four `pkg/triggerconfig` functions from Task 3.

- [ ] **Step 1: Write failing handler-boundary tests**

In `handlers_triggers_secrets_test.go`, install `setSecretRecipient` and `mfaIdentities` from one generated age identity, then test:

```go
func TestTriggerResponseRedactsKafkaSecrets(t *testing.T) {
	triggerRowWithConfig := func(raw string) sqlc.Trigger {
		return sqlc.Trigger{Kind: string(api.TriggerKindKafka), Config: []byte(raw)}
	}
	row := triggerRowWithConfig(`{"brokers":["b:9092"],"topic":"orders","group":"g","sasl":{"mechanism":"PLAIN","username":"svc","password":"plain","password_sealed":"YQ=="},"tls":{"client_cert":"cert","client_key":"key","client_key_sealed":"Yg=="}}`)
	body, err := json.Marshal(triggerResponse(row))
	if err != nil { t.Fatal(err) }
	for _, forbidden := range []string{"plain", `"password_sealed"`, `"client_key"`, `"client_key_sealed"`} {
		if strings.Contains(string(body), forbidden) { t.Fatalf("response leaked %q: %s", forbidden, body) }
	}
	if !strings.Contains(string(body), `"password_set":true`) || !strings.Contains(string(body), `"client_key_set":true`) {
		t.Fatalf("response omitted set markers: %s", body)
	}
}
```

Add tests that the create helper returns sealed JSON, nil recipient maps to `secret_store_unavailable`, update preserves an old sealed password when the incoming SASL block omits it, supplied password rotates it, omitted SASL deletes it, and malformed stored ciphertext fails without placing ciphertext in the problem detail.

- [ ] **Step 2: Run the focused tests and verify plaintext leakage**

```bash
go test ./cmd/apid -run 'TriggerResponseRedacts|SealTrigger|MergeTrigger'
```

Expected: FAIL because `triggerResponse` currently emits raw `t.Config`.

- [ ] **Step 3: Add the typed 503 and handler helpers**

Implement:

```go
const CodeSecretStoreUnavailable = "secret_store_unavailable"

func ErrSecretStoreUnavailable() *Problem {
	return NewProblem(http.StatusServiceUnavailable, CodeSecretStoreUnavailable,
		"Secret storage unavailable", "Trigger credentials cannot be stored safely; retry after the host key is restored")
}
```

`sealTriggerConfig` calls `setSecretRecipient` only when non-nil and maps `triggerconfig.ErrRecipientUnavailable` to the typed 503. `triggerConfigIdentities` reads the rotation-aware `mfaIdentities` accessor and returns no secrets in errors.

- [ ] **Step 4: Wire create, batch-create, update, and response projection**

Single-create and every batch item validate plaintext first, seal next, and pass only sealed bytes to `CreateTriggerIfUnderQuota`. Update calls `MergeForUpdate(t.Kind, t.Config, req.Config, identities)`, validates that plaintext result, applies the TLS plan gate to it, seals it, then calls `UpdateTrigger`. `triggerResponse` always assigns `triggerconfig.Redact(api.TriggerKind(t.Kind), t.Config)`.

Keep pause/resume unchanged except that their returned DTO now passes through the redacting response projection.

- [ ] **Step 5: Run handler/package tests and commit**

```bash
gofmt -w pkg/api/errors.go cmd/apid/handlers_triggers.go cmd/apid/handlers_triggers_secrets_test.go
go test ./cmd/apid ./pkg/triggerconfig -run 'Trigger|SecretStore'
git add pkg/api/errors.go cmd/apid/handlers_triggers.go cmd/apid/handlers_triggers_secrets_test.go
git commit -m "fix(api): redact trigger credentials on every path"
```

Expected: handler tests PASS and no response contains plaintext or ciphertext.

---

### Task 5: Open sealed credentials only at scheduler poller construction

**Files:**

- Modify: `pkg/sched/loop.go`
- Modify: `pkg/sched/poller.go`
- Modify: `pkg/sched/dispatch_triggers.go`
- Modify: `pkg/sched/poller_kafka_test.go`
- Modify: `pkg/sched/dispatch_triggers_test.go`
- Modify: `cmd/schedd/main.go`
- Modify: `cmd/schedd/main_test.go`

**Interfaces:**

- Produces: `func (l *Loop) WithTriggerSecretIdentities(identities []*age.X25519Identity) *Loop`
- Changes: `newPollerForTrigger(t sqlc.Trigger) (triggerSource, bool, error)`; `bool=false,nil` means unregistered kind, non-nil error means registered factory/configuration failure.
- Consumes: `triggerconfig.Open` and the existing `Config.HostAgeIdentityPath`.

- [ ] **Step 1: Write failing sealed/legacy/corrupt scheduler tests**

Seal a Kafka config using Task 3, attach identities through `WithTriggerSecretIdentities`, and assert the factory receives a copy containing plaintext SASL/TLS leaves. Retain a second fixture with legacy plaintext and assert it still builds. Add a wrong-identity fixture and assert `dispatchOneTrigger` returns an error containing `open kafka credentials` but neither the base64 ciphertext nor secret value.

Add a registry test with a factory returning `errors.New("bad poller config")` and assert `newPollerForTrigger` returns `(nil, true, err)` rather than `(nil, false)`.

- [ ] **Step 2: Run focused scheduler tests and verify sealed config cannot currently decode**

```bash
go test ./pkg/sched -run 'Kafka.*Sealed|Kafka.*Legacy|TriggerPoller.*Error|CorruptTriggerSecret'
```

Expected: FAIL because the loop has no identities and registry errors are swallowed.

- [ ] **Step 3: Preserve poller factory errors**

Change `newPollerForTrigger` to return three values. In `dispatchOneTrigger`, keep the existing debug-only path for an unregistered kind, but return `fmt.Errorf("construct %s trigger poller: %w", t.Kind, err)` for a registered factory failure.

- [ ] **Step 4: Inject identities and open only a trigger copy**

Add `triggerSecretIdentities []*age.X25519Identity` to `Loop`, copy the input slice in `WithTriggerSecretIdentities`, and before registry lookup call:

```go
pollerTrigger := t
opened, err := triggerconfig.Open(api.TriggerKind(t.Kind), t.Config, l.triggerSecretIdentities)
if err != nil {
	return fmt.Errorf("open %s trigger credentials: %w", t.Kind, err)
}
pollerTrigger.Config = opened
src, registered, err := newPollerForTrigger(pollerTrigger)
```

The original SQL row remains sealed in memory outside this short-lived copy.

- [ ] **Step 5: Wire and test production host identities**

In `cmd/schedd/main.go`, add `loadHostAgeIdentities(path string) ([]*age.X25519Identity, error)`: resolve an empty path to `secretbox.DefaultHostKeyPath`, then call `secretbox.LoadHostKeys(filepath.Dir(path))`. Add a temp-directory test in `cmd/schedd/main_test.go` proving the current and `.previous` identities load in rotation order. Production passes the returned slice to `WithTriggerSecretIdentities` and reuses it from `webhookDispatcher.IdentityLoader`; log only the path/error on failure.

- [ ] **Step 6: Verify scheduler behavior and commit**

```bash
gofmt -w pkg/sched/loop.go pkg/sched/poller.go pkg/sched/dispatch_triggers.go pkg/sched/poller_kafka_test.go pkg/sched/dispatch_triggers_test.go cmd/schedd/main.go cmd/schedd/main_test.go
go test ./pkg/sched ./cmd/schedd -run 'Trigger|Kafka|Identity|Poller'
git add pkg/sched/loop.go pkg/sched/poller.go pkg/sched/dispatch_triggers.go pkg/sched/poller_kafka_test.go pkg/sched/dispatch_triggers_test.go cmd/schedd/main.go cmd/schedd/main_test.go
git commit -m "fix(schedd): open sealed trigger credentials at runtime"
```

Expected: sealed and legacy Kafka fixtures PASS; corrupt ciphertext produces a sanitized configuration error.

---

### Task 6: Publish the corrected contract and regenerate clients

**Files:**

- Modify: `docs/adr/100-triggers-event-source-mappings.md`
- Modify: `api/openapi.yaml`
- Generate: `pkg/apid/openapi.yaml`
- Generate: `sdk/node/src/generated/**`
- Generate: `sdk/python/faas_sdk/**`
- Modify: `cmd/apid/handler_openapi_doc_test.go`

**Interfaces:**

- Publishes the nine trigger capability fields on `AccountLimits`.
- Documents plan-derived defaults, `trigger_kind_not_allowed`, `plan_triggers_not_allowed`, `plan_trigger_quota`, `secret_store_unavailable`, and redacted Kafka response markers.
- Keeps plaintext password/private key fields write-only in request sub-schemas; ciphertext fields are absent from the public schema.

- [ ] **Step 1: Add failing OpenAPI contract assertions**

Extend `handler_openapi_doc_test.go` to assert the embedded document contains `trigger_kinds`, `trigger_batch_window_max_ms`, `writeOnly: true` on Kafka `password` and `client_key`, response marker descriptions, and the exact stable error codes. Assert it does not expose `password_sealed` or `client_key_sealed`.

- [ ] **Step 2: Run the contract test and confirm the schema is stale**

```bash
go test ./cmd/apid -run 'OpenAPI.*Trigger'
```

Expected: FAIL on missing capability/redaction semantics.

- [ ] **Step 3: Update the source OpenAPI document and ADR addendum**

Add all capability properties to `AccountLimits.required`, correct the old Free-plan code from `triggers_not_allowed` to `plan_triggers_not_allowed`, correct `trigger_quota_exceeded` to the existing `plan_trigger_quota`, add a 403 description for `trigger_kind_not_allowed`, and state that omitted values are plan-derived. Mark `KafkaSASLConfig.password` and `KafkaTLSConfig.client_key` as `writeOnly: true`; document `password_set` and `client_key_set` as response-only booleans inside the opaque config semantics without publishing sealed field names.

Append an ADR addendum recording the at-rest envelope, rotation overlap, legacy-read window, response redaction, and Hobby kind restriction.

- [ ] **Step 4: Regenerate embedded spec and SDKs**

```bash
make spec-sync
make sdk-gen-node
make sdk-gen-python
```

Review generated diffs; generated clients may change only where the public schema changed.

- [ ] **Step 5: Run contract and drift gates**

```bash
make spec-check
make sdk-gen-node-check
make sdk-gen-python-check
go test ./cmd/apid -run 'OpenAPI.*Trigger'
```

Expected: all commands PASS with no generated drift.

- [ ] **Step 6: Commit the published contract**

```bash
git add docs/adr/100-triggers-event-source-mappings.md api/openapi.yaml pkg/apid/openapi.yaml sdk/node/src/generated sdk/python/faas_sdk cmd/apid/handler_openapi_doc_test.go
git commit -m "docs(api): publish secure trigger contract"
```

---

### Task 7: Run backend completion gates

**Files:**

- Verify only; modify a source or test file only if a gate reveals a real regression.

**Interfaces:**

- Produces a backend commit range ready to land before or together with the console plan.

- [ ] **Step 1: Scan the full diff for credential leakage and generated drift**

```bash
git diff origin/main...HEAD --check
git diff origin/main...HEAD | rg -n 'password_sealed|client_key_sealed|sasl-secret|PRIVATE KEY'
make pre-pr
```

Expected: `git diff --check` and `make pre-pr` PASS; sealed field names appear only in internal implementation/tests/ADR, never as response examples or generated public properties; literal test secrets appear only in tests.

- [ ] **Step 2: Run the complete race-enabled suite**

```bash
make test
```

Expected: all packages PASS under the repository's race-enabled test target.

- [ ] **Step 3: Confirm worktree scope and record the backend head**

```bash
git status --short
git log --oneline --decorate -8
```

Expected: clean worktree and six focused commits after the starting point, with no changes in `/home/bahadir/GREGALE/faas`.
