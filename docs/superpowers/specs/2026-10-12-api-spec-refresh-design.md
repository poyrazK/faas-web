# API spec refresh: design

**Status:** approved in conversation on 2026-10-12, awaiting review of this written spec.
**Branch:** `fix/api-spec-refresh`, off `main` at c0d8b7f. One PR.

## Why

The console's vendored `api/openapi.yaml` describes **371** operations. Upstream `poyrazK/faas` main describes **1,216**. The console has been compiling against a contract that apid no longer serves. At least one feature is broken in production because of it (see "Live bug"). The canvas work (PR #170) and anything else that needs newer endpoints is blocked behind this refresh.

## What the measurement found

The refresh was trial-run on a throwaway worktree off `main`:

- `npm run api:pull` with today's generator settings produces **99** type errors: 42 in the dev mock, 26 in tests, 31 in production code.
- Most "newly required" request fields are not required. They carry a `default` and are absent from the schema's `required` list (for example, cron `command_shell: { type: boolean, default: false }`). openapi-typescript's `defaultNonNullable`, on by default in v7.13, types them as required anyway. With `--default-non-nullable=false`, production errors drop to **22** and nothing new breaks (90 errors in total).

### Live bugs

**1. Rotating an alert's or a webhook's secret fails in production.**

- **What apid does now:** both rotate handlers decode a request body and require `webhook_secret`. `rotateAppWebhookSecret` "seals a caller-supplied replacement". The alert handler answers "webhook_secret is required" when the body lacks it.
- **What the console sends:** `useRotateAlertSecret` and `useRotateWebhookSecret` POST with no body.
- **What the user sees:** both "Rotate secret" buttons return 400. The confirm dialogs also still say a new secret "is minted server-side", which is no longer true.

**2. Exporting environment variables has never worked against apid.**

- **How it happened:** `POST /v1/apps/{slug}/env-export` was added by hand to faas-web's vendored spec on 2026-10-01 (8ff3025, "feat(env): add explicit export requests and partial import reporting"). It has never existed in `poyrazK/faas`: the server has no route, the faas history has no trace of it, and the upstream spec does not have it.
- **What the user sees:** the Export action in "Import and export environment variables" calls a path apid does not serve.
- **Why it can't be rebuilt in the browser:** `GET /v1/apps/{slug}/env` never returns plaintext values ("value NEVER appears in the response").
- **Decision:** pending Poyraz (see "Questions for Poyraz"). Until he answers, the pull cannot compile `fetchEnvExport`, so this PR does not merge before that answer.

### Checked and not bugs

- **Invitation revoke:** the route is now `DELETE /v1/orgs/{slug}/invitations/{invitation_id}` (it was `{token}`). No page calls `useRevokeInvitation`; only a test imports it.
- **Webhook events:** the spec's app-webhook event enum lacks events apid accepts. All 16 events the console offers (for example `app.created`) are in apid's `state.AllAppWebhookEvents`. The console is right and the upstream spec is stale.

## Design

### Commit order

Each commit leaves the tree compiling and green, so each one can be reviewed alone.

1. **Generator setting.** `api:types` gains `--default-non-nullable=false`. Regenerate `schema.d.ts` from the _current_ spec and fix any fallout. This isolates the setting's effect from the contract change.
2. **Pull.** Run `npm run api:pull`. Commit `api/openapi.yaml` and the regenerated `schema.d.ts`, plus only the minimal compile fixes for these two generated files. The fixes may be type-only or stubs, but no stub may hide a real behaviour change; anything that changes behaviour belongs in the commits that follow.
3. **Secret rotation:** the live bug, below.
4. **Type fixes**, grouped by area, below.
5. **Mock and tests**, updated to the new shapes.

The setting is a deliberate, documented change. A field with a server-side default stays optional in our types, and the server stays the owner of the default. The setting also makes defaulted _response_ fields optional; any fallout from that is fixed honestly in commit 1.

### Secret rotation

A shared `RotateSecretDialog`, used by `dashboard.alerts.tsx` and `dashboard.webhooks.tsx`, replaces each page's confirm dialog.

- **Title:** `Rotate the secret for <name>?`
- **Body:**
  - A **New secret** field, filled in on open with a generated secret: 32 random bytes from `crypto.getRandomValues`, base64url-encoded (43 characters).
  - **Copy** and **Generate another** buttons. The field is editable, so a person can paste their own.
  - Validation of 1–256 characters, the same rule and copy as the create forms. This matches apid's `AppWebhookSecretMaxBytes` and `AlertRuleWebhookSecretMaxBytes` (256).
  - The warning: "Deliveries signed with the old secret stop verifying immediately. Install the new one on your receiver first." Then "The secret is sealed on save and can't be shown again."
- **Action:** `Rotate secret`. It sends `{ webhook_secret }` and keeps today's success toast and query refresh. While pending, the action is disabled and reads "Rotating…".
- **Errors:** the API's message appears in the dialog, which stays open with the secret intact so nothing is lost.
- **Hooks:** `useRotateAlertSecret` and `useRotateWebhookSecret` take `{ id, webhookSecret }`.
- **Accessibility:** the dialog follows the console's existing dialog primitive. Focus starts on the field, and Copy announces "Copied".

### Type fixes

| Area                                     | Change                               | Behaviour                                                                                                                                                                                                                                          |
| ---------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `debug-requests.tsx`, `debug-support.ts` | `status`, `latency_ms` optional      | Missing values render "—", with the reason in a `title`. Never 0, and never a fabricated status class.                                                                                                                                             |
| `status-page.tsx`                        | new `pre_release` status             | Gets its own label and tone in the status map.                                                                                                                                                                                                     |
| `jobs-scheduled.tsx`                     | cron `path` optional (command crons) | Without a path, the row shows the command (`command` joined, monospace).                                                                                                                                                                           |
| `edge-rules/kinds.tsx`                   | JWT `algorithms` include HS*         | Reads display every algorithm. The form keeps offering only RS*/ES*, because HS* needs a shared-secret field the form does not have; a comment says so. Optional `schema` and `missing_key_policy` defaults are handled without assuming presence. |
| `dashboard.webhooks.tsx`                 | event enum stale upstream            | A typed local `EVENTS` list matches apid's vocabulary, cast once at the API boundary, with a comment naming the upstream spec bug.                                                                                                                 |
| `queries.ts`                             | `useRevokeInvitation`                | Removed, since nothing uses it. Its test reference goes too.                                                                                                                                                                                       |
| `env-transfer.ts`                        | `env-export` path gone (live bug 2)  | Decided by Poyraz's answer: Export is removed from the panel (Import stays), or the call moves to the endpoint apid adds. Never re-added to the vendored spec by hand.                                                                             |

Anything else the pull surfaces is fixed the same way: behaviour first, types honest, no `as never` or `any`.

### Mock and tests

- `mock/data.ts` and `mock/plugin.ts` fixtures get the new shapes.
- `src/lib/mock-spec-drift.test.ts` stays green.
- Failing tests are updated to the new contract, not loosened.

## Verification

- `npm run check` and `npm run build` pass. Lint stays within the existing warning ceiling.
- `npm run tour` runs against `npm run dev:mock` with no new failures.
- A headless browser walk of both rotation dialogs on the mock covers:
  - the generated secret appears;
  - Copy works;
  - Generate another changes the secret;
  - an empty or over-length secret is refused;
  - a successful rotation sends `{ webhook_secret }`.
- **Real API:** one rotation, against a scratch alert or webhook, with the owner present and confirming the write. The PR says plainly whether this was done.

## Questions for Poyraz

These go in the PR description. Questions 1 and 2 block the merge; the rest shape the code but do not block it.

1. **Env export.** faas-web's spec had `POST /v1/apps/{slug}/env-export`, but apid has never served it. It was added on the console side only, on Oct 1. Is an env export endpoint planned? If yes, what shape and roughly when? If no, the console removes its Export action and keeps Import.
2. **Secret rotation contract.** `rotate-secret` for alerts and app webhooks now requires a caller-supplied `webhook_secret`, and the console's buttons broke when that changed. Is "the client generates and sends the new secret" the intended contract going forward? Should apid enforce a minimum length or entropy? Today it only caps at 256 bytes. The console will generate 32 random bytes (base64url) and let the person paste their own.
3. **Webhook event enum.** In `api/openapi.yaml`, the app-webhook `event_filter` enum is narrower than `state.AllAppWebhookEvents`; for example, `app.created` is missing. Which is the source of truth? Can the spec enum be generated from the Go list, so the two cannot drift?
4. **Defaults on omitted fields.** The console is switching its generator to treat fields that have a `default` as optional, and will omit them. Does apid apply the documented default when such a field is omitted? This covers cron `command_shell`, rate-limit `missing_key_policy`, alert `action`, rollout `profile_gate_rollback`, and app-create defaults.
5. **Invitation revoke.** The route moved from `{token}` to `{invitation_id}`. The console has no revoke UI today. Is revoking by id the long-term contract, so a future revoke button can rely on it?
6. **Spec drift.** faas-web was 845 operations behind. Could a faas release, or CI, flag when `api/openapi.yaml` changes, so the console pulls promptly instead of finding out in production?
7. **For canvas v3 (not this PR).** Does a failed deployment say which phase failed (build or deploy)? If not, would a `failed_phase` field be acceptable, so the console never has to guess?

## Out of scope

- No behaviour changes beyond matching the API, and no new features from the 845 new operations.
- **Canvas:** `feat/canvas` (PR #170) is rebased onto this once it lands, as a separate follow-up.
- **For Poyraz:** see "Questions for Poyraz" above. They go in the PR description.
