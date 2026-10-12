# API spec refresh: design

**Status:** approved in conversation on 2026-10-12, awaiting review of this written spec.
**Branch:** `fix/api-spec-refresh`, off `main` at c0d8b7f. One PR.

## Why

The console's vendored `api/openapi.yaml` describes **371** operations. Upstream `poyrazK/faas` main describes **1,216**. The console has been compiling against a contract that apid no longer serves. At least one feature is broken in production because of it (see "Live bug"). The canvas work (PR #170) and anything else that needs newer endpoints is blocked behind this refresh.

## What the measurement found

The refresh was trial-run on a throwaway worktree off `main`:

- `npm run api:pull` with today's generator settings produces **99** type errors: 42 in the dev mock, 26 in tests, 31 in production code.
- Most "newly required" request fields are not required. They carry a `default` and are absent from the schema's `required` list (for example, cron `command_shell: { type: boolean, default: false }`). openapi-typescript's `defaultNonNullable`, on by default in v7.13, types them as required anyway. With `--default-non-nullable=false`, production errors drop to **22** and nothing new breaks (90 errors in total).

### Live bug

**Rotating an alert's or a webhook's secret fails in production.**

- **What apid does now:** both rotate handlers decode a request body and require `webhook_secret`. `rotateAppWebhookSecret` "seals a caller-supplied replacement". The alert handler answers "webhook_secret is required" when the body lacks it.
- **What the console sends:** `useRotateAlertSecret` and `useRotateWebhookSecret` POST with no body.
- **What the user sees:** both "Rotate secret" buttons return 400. The confirm dialogs also still say a new secret "is minted server-side", which is no longer true.

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
| `env-transfer.ts`                        | generic exceeds TS depth             | An explicit response type for the one call.                                                                                                                                                                                                        |

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

## Out of scope

- No behaviour changes beyond matching the API, and no new features from the 845 new operations.
- **Canvas:** `feat/canvas` (PR #170) is rebased onto this once it lands, as a separate follow-up.
- **For Poyraz,** in the PR description:
  - faas's spec has a stale app-webhook event enum;
  - the apid rotation change broke the console's rotate buttons;
  - the invitation revoke path parameter changed.
