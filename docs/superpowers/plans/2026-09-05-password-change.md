# Password Change in the Console — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **For a non-Claude executor (e.g. GPT):** work one task at a time, in order. Every task is test-first: write the test, watch it fail for the stated reason, write the smallest code that passes, run the full check, commit. Do not skip the "run it and watch it fail" step — it is how you know the test tests something.

**Goal:** Let a signed-in customer _change_ an existing password from the Account page — not just set one — against the server contract that landed in `poyrazK/faas#1281` (ADR-140), including the MFA step-up and rate-limit answers that contract can give.

**Architecture:** The console already has a three-step inline wizard (Choose → Confirm → Done) that posts to `apid`'s form route with a CSRF token. The server now decides, per account, which proof it needs: nothing (OAuth-only, no MFA), the current password (account has one), or a fresh TOTP step-up (MFA enrolled). The server does **not** tell the console up front which case applies — `GET /v1/account` has no `has_password` field — so the wizard learns it from the refusal: a `401 invalid_credentials` after submit opens a "current password" sub-step and resubmits; a `403 step_up_required` opens the existing MFA modal in verify mode and resubmits once verified; `429 rate_limited` is shown as-is. Nothing is invented client-side.

**Tech Stack:** React 19 + TypeScript, Vite 6, TanStack Router (file routes) + TanStack Query, `openapi-fetch` typed by `src/lib/api/schema.d.ts` (generated from the vendored `api/openapi.yaml`), Vitest + React Testing Library + `@testing-library/user-event`, Tailwind tokens from `src/index.css`, `motion/react`, Prettier, ESLint.

**Spec:** ADR-140 in the platform repo — `poyrazK/faas` `docs/adr/140-set-password-proof.md` (merged 2026-09-04). The parts the console needs are copied verbatim into "Server contract" below so this plan is self-contained.

## Global Constraints

Copied from `README.md` and `CLAUDE.md` of this repo (`poyrazK/faas-web`). Every task inherits them.

- Work in `~/GREGALE/faas-web` on branch `feat/password-change` (already pushed to `origin`, based on `main` at `45d8aa3`). Start from its tip; do not rebase onto `main` mid-plan.
- **Branch on `ApiError.code`, never on the HTTP status or the message text.** Every API failure is RFC 7807 with a stable `code`.
- **Never hand-edit** `src/lib/api/schema.d.ts` or `src/routeTree.gen.ts`. Types come from `npm run api:types` (from the vendored `api/openapi.yaml`); `npm run api:pull` refreshes the vendored spec from `poyrazK/faas` `main` and regenerates.
- **No fixture data in `src/`.** Populated states come from `mock/` under `npm run dev:mock` (`MOCK_API=1`). `mock/plugin.ts` is Vite-only middleware and is never imported by `src/`.
- **Do not invent API fields.** In particular there is no `has_password` on the account; do not add one client-side.
- **Theming:** no literal hex colours and no `dark:` variants in components; use tokens (`bg-card`, `text-muted-foreground`, `var(--status-critical)`, `var(--status-good)`, …). A missing colour means a new token in **both** `:root` and `.console` blocks of `src/index.css`.
- **Motion honours `prefers-reduced-motion`**: Framer components via `useReducedMotion()`, CSS via the blanket rule already in `index.css`. The wizard uses `AnimatePresence mode="wait"` with the shared `EASE` from `components/dashboard/motion.tsx`.
- **Colour is never the only signal** for status (icon + text as well).
- **Tests sit beside code as `*.test.ts(x)`** and run with `npm run test`. Vitest does **not** typecheck; run `npm run check` (typecheck + lint + format check + tests) before calling a task done. ESLint must stay at **7 warnings, 0 errors** (`--max-warnings 8` is enforced; do not add warnings).
- **Do not reformat files you did not otherwise change.** Run `npx prettier --write <files you touched>` only.
- Password rule is length only: `MIN_PASSWORD_LENGTH = 12` from `src/lib/auth.tsx`.
- Comments explain _why_, not _what_. Match the register of the existing comments.
- Commit messages: conventional style used in this repo (`feat(console): …`, `fix(console): …`, `test(console): …`, `chore(api): …`). No attribution lines.

## Orientation (read before Task 1)

Commands (from the repo root):

```bash
npm install                  # once
npm run dev:mock             # console at http://localhost:3000 with no backend (MOCK_API=1)
npm run test                 # vitest, once
npm run check                # typecheck + lint + format check + tests — the gate
npm run api:pull             # refresh api/openapi.yaml from upstream main, regenerate schema.d.ts
```

Signing in under `dev:mock`: any email containing `@`, any password of **12+ characters**. Then open `http://localhost:3000/dashboard/account`. (If you land on `/onboarding`, run `localStorage.setItem('gregale.onboarded','true')` in the browser console and reload.)

Files this plan touches (all exist unless marked _new_):

| File                                                | Responsibility                                                                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/api/password.ts`                           | The one form POST to `/dashboard/account/set-password`: mints the CSRF token, sends the fields, turns refusals into `ApiError`. |
| `src/lib/api/password.test.ts`                      | Its tests (fetch is stubbed; the CSRF minter is injected).                                                                      |
| `src/lib/api/client.ts`                             | `CSRFAction` union + `issueCSRF()`; `api` typed client.                                                                         |
| `src/components/dashboard/password-wizard.tsx`      | `PasswordWizard` (pure, deps injected as props) + `PasswordPanel` (wires `useAuth`, `useToast`, `useMfa`).                      |
| `src/components/dashboard/password-wizard.test.tsx` | RTL tests driving the wizard with stubbed deps.                                                                                 |
| `src/components/auth/mfa-provider.tsx`              | The MFA modal; `openMfa(mode)` today, gains completion callbacks.                                                               |
| `mock/plugin.ts`                                    | Dev mock; gains stateful password + step-up behaviour.                                                                          |
| `api/openapi.yaml`, `src/lib/api/schema.d.ts`       | Vendored spec + generated types (refreshed in Task 1).                                                                          |

How the wizard is built today (`password-wizard.tsx`): a `Step` union `'idle' | 'choose' | 'confirm' | 'done' | 'reset-sent'`, local state `chosen`, `retyped`, `touched`, `pending`, `error`; `submit()` calls the injected `setPassword(chosen)` and on success moves to `'done'` and calls `onSet?.()`; on `ApiError` with `code === 'password_too_weak'` it restates the length rule, otherwise it shows `errorMessage(err)` in a `<Refusal>` alert. `PasswordPanel` injects `setAccountPassword` from `lib/api/password.ts`, `requestPasswordReset` from `useAuth()`, and a toast.

## Server contract (ADR-140, as merged)

`POST /dashboard/account/set-password`, body `application/x-www-form-urlencoded`, session cookie auth:

| Field              | Required                                                                          | Meaning                                                                                                  |
| ------------------ | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `password`         | yes                                                                               | new password, 12–256 chars                                                                               |
| `csrf_token`       | yes                                                                               | from `GET /v1/auth/csrf?action=set_password`; that call also sets the `faas_csrf` cookie (double-submit) |
| `current_password` | only when the account already has a password and the session has no fresh step-up | verified with Argon2id                                                                                   |

Proof is decided server-side in this order: fresh TOTP step-up (≤ 5 min, written by `POST /v1/account/mfa/verify`) → accepted; MFA enrolled → `403 step_up_required`; account has a password → `current_password` required, missing **and** wrong both answer `401 invalid_credentials`; otherwise (OAuth-only, no MFA) → accepted.

Responses:

| Status                      | `code`                                                                                                                                        | When                                                                   |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 302 → `/dashboard/account/` | —                                                                                                                                             | success (`fetch` follows it; success is `res.redirected`)              |
| 400                         | `validation_failed`                                                                                                                           | CSRF token missing/mismatched — "please reload the page and try again" |
| 400                         | `password_too_weak`                                                                                                                           | new password under 12 chars                                            |
| 401                         | `invalid_credentials`                                                                                                                         | current password missing or wrong (or no session)                      |
| 403                         | `step_up_required`                                                                                                                            | MFA enrolled, no step-up in the last 5 min                             |
| 429                         | `rate_limited` (synthesised by `toApiError` from the limiter's plain-text body; `detail` = "Too many attempts. Wait a minute and try again.") | 10 failures/min/IP, shared with `/login`                               |

Step-up: `verifyMfa(totp)` in `src/lib/api/queries.ts` posts `/v1/account/mfa/verify`; success re-issues the session cookie with the stamp, so the _next_ set-password POST passes.

---

### Task 1: Take the merged spec and drop the CSRF cast

The vendored `api/openapi.yaml` predates #1281, so the generated `CSRFAction` enum does not know `set_password` and `password.ts` carries a cast. Refreshing the spec is the repo's sanctioned way; it also brings ~7k lines of unrelated upstream drift that breaks 12 type sites in fixtures and edge-rule types. Fix those minimally (add the newly-required fields with the schema's own values) — no behaviour changes elsewhere.

**Files:**

- Modify: `api/openapi.yaml` (regenerated), `src/lib/api/schema.d.ts` (regenerated)
- Modify: `src/lib/api/client.ts:78-84` (the `CSRFAction` union)
- Modify: `src/lib/api/password.ts:47-52` (delete `mintSetPasswordCSRF`, call `issueCSRF` directly)
- Modify: `mock/data.ts`, `mock/plugin.ts`, `src/components/dashboard/edge-rules/kinds.tsx`, `src/components/dashboard/edge-rules/dialog.tsx`, `src/routes/dashboard.alerts.tsx` (type drift only)

**Interfaces:**

- Produces: `CSRFAction` includes `'set_password'`; `issueCSRF('set_password')` typechecks; `setAccountPassword` signature unchanged.

- [ ] **Step 1: Refresh the spec and see what breaks**

```bash
npm run api:pull
npx tsc --noEmit --pretty false 2>&1 | grep "error TS"
```

Expected: 12 errors, in exactly these places (upstream may have moved on; if the list differs, fix what is there with the same method):

```
mock/data.ts(176)     DeploymentResponse fixture: missing rollback_on_5xx, first_5xx_count
mock/data.ts(288)     "No overload matches" — a fixture builder whose input type gained required fields
mock/data.ts(336)     same
mock/data.ts(488)     EdgeRule fixtures: missing validate_mode
mock/plugin.ts(198)   DeploymentResponse: missing rollback_on_5xx, first_5xx_count
mock/plugin.ts(248)   API-key create body: missing scope
mock/plugin.ts(328)   AlertResponse fixture: missing action
mock/plugin.ts(897)   EdgeRule create: missing validate_mode
edge-rules/kinds.tsx(396)  validate action: missing validate_mode
edge-rules/kinds.tsx(543)  limit action: missing key_by, max_keys_per_rule
edge-rules/dialog.tsx(197) CreateEdgeRuleRequest: missing validate_mode
dashboard.alerts.tsx(239)  CreateAlertRequest: missing action
```

- [ ] **Step 2: Fix each site with the schema's own values**

For every error, open the named schema in the _new_ `api/openapi.yaml` and use its `default:` if present, otherwise the first `enum` value. Find them with:

```bash
grep -n -A6 "        validate_mode:" api/openapi.yaml | head -20     # enum: [warn, enforce, observe] or similar
grep -n -A8 "        key_by:" api/openapi.yaml | head -20
grep -n -A4 "        max_keys_per_rule:" api/openapi.yaml | head -10
grep -n -B2 -A6 "        action:" api/openapi.yaml | grep -A6 "AlertResponse\|CreateAlertRequest" | head -20
grep -n -A6 "        rollback_on_5xx:\|        first_5xx_count:" api/openapi.yaml | head -20
grep -n -A6 "        scope:" api/openapi.yaml | head -30              # the API-key scope enum
```

Concrete edits:

- Deployment fixtures (`mock/data.ts:176`, `mock/plugin.ts:198`): add `rollback_on_5xx: false, first_5xx_count: 0`.
- Edge-rule fixtures and create paths (`mock/data.ts:488`, `mock/plugin.ts:897`, `dialog.tsx:197`): add `validate_mode` with the schema `default` (use the first enum value if there is none). In `dialog.tsx` add it to the request object built for `createEdgeRule` — do not add a UI control.
- `kinds.tsx:396`: the `validate` action's default now needs `validate_mode`; `kinds.tsx:543`: the `limit` action's default needs `key_by: 'none'` and `max_keys_per_rule` with the schema default.
- Alerts (`mock/plugin.ts:328`, `dashboard.alerts.tsx:239`): add `action` using the schema default; if there is none, use `'webhook'` — it is the delivery the alerts page already describes.
- `mock/plugin.ts:248`: the API-key create fixture needs `scope`; use the first value of the schema enum.
- `mock/data.ts:288/336`: rerun `npx tsc --noEmit` (pretty output) to see which property the overload wants; add it with the schema value as above.

Rule: only add the field the compiler names, with the value the schema names. Nothing else in these files changes.

- [ ] **Step 3: Drop the cast**

`src/lib/api/client.ts` — extend the union:

```ts
export type CSRFAction =
  | 'auth.logout'
  | 'auth.session.revoke'
  | 'auth.sessions.revoke_all'
  | 'mfa_confirm'
  | 'mfa_recover'
  | 'mfa_disable'
  | 'set_password';
```

`src/lib/api/password.ts` — replace the default minter and delete `mintSetPasswordCSRF` and its comment at the bottom of the file:

```ts
export async function setAccountPassword(
  password: string,
  { mintCSRF = issueCSRF }: { mintCSRF?: (action: 'set_password') => Promise<string> } = {}
): Promise<void> {
```

and change the import to `import { issueCSRF } from './client';` (drop `type CSRFAction`). Also delete the doc-comment sentence "Accounts that already have a password will also be asked for `current_password` — that step is a follow-up once `GET /v1/account` reports `has_password`." (Task 2 replaces it).

- [ ] **Step 4: Verify**

```bash
npx prettier --write src/lib/api/client.ts src/lib/api/password.ts mock/data.ts mock/plugin.ts src/components/dashboard/edge-rules/kinds.tsx src/components/dashboard/edge-rules/dialog.tsx src/routes/dashboard.alerts.tsx
npm run check
```

Expected: 0 type errors, `7 problems (0 errors, 7 warnings)`, Prettier clean, `27 passed (27)` test files. Then start `npm run dev:mock`, open `/dashboard/edge-rules` and `/dashboard/alerts` once each and confirm they still render a populated list (the fixtures you touched).

- [ ] **Step 5: Commit**

```bash
git add api/openapi.yaml src/lib/api/schema.d.ts src/lib/api/client.ts src/lib/api/password.ts mock/data.ts mock/plugin.ts src/components/dashboard/edge-rules src/routes/dashboard.alerts.tsx
git commit -m "chore(api): vendor the spec at poyrazK/faas main (ADR-140 set_password CSRF action)

Fixtures and edge-rule/alert request builders gain the fields the
newer schema requires; no behaviour change. Drops the CSRF cast in
lib/api/password.ts now the generated enum knows set_password."
```

---

### Task 2: `setAccountPassword` sends `current_password` when given

**Files:**

- Modify: `src/lib/api/password.ts`
- Test: `src/lib/api/password.test.ts`

**Interfaces:**

- Produces: `setAccountPassword(password: string, opts?: { currentPassword?: string; mintCSRF?: (action: 'set_password') => Promise<string> }): Promise<void>`. When `currentPassword` is a non-empty string the form carries `current_password`; otherwise the field is absent (not empty). Rejections are `ApiError` with the server's `code`.

- [ ] **Step 1: Write the failing tests**

Append inside the `describe('setAccountPassword', …)` block in `src/lib/api/password.test.ts`:

```ts
it('sends current_password when the caller supplies one', async () => {
  const fetchMock = stubFetch(answer({ status: 200, redirected: true }));

  await setAccountPassword('correct-horse-battery', {
    mintCSRF,
    currentPassword: 'the-old-password-1',
  });

  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(String(init.body)).toBe(
    'password=correct-horse-battery&csrf_token=tok-1&current_password=the-old-password-1'
  );
});

it('omits current_password entirely when it is not supplied or empty', async () => {
  const fetchMock = stubFetch(answer({ status: 200, redirected: true }));

  await setAccountPassword('correct-horse-battery', { mintCSRF, currentPassword: '' });

  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(String(init.body)).not.toContain('current_password');
});

it('surfaces step_up_required and rate_limited with their codes', async () => {
  stubFetch(
    answer({
      status: 403,
      type: 'application/problem+json',
      body: JSON.stringify({ status: 403, code: 'step_up_required', title: 'Step-up required' }),
    })
  );
  await expect(setAccountPassword('correct-horse-battery', { mintCSRF })).rejects.toMatchObject({
    status: 403,
    code: 'step_up_required',
  });

  // The auth limiter answers plain text; toApiError synthesises the code.
  stubFetch(answer({ status: 429, type: 'text/plain', body: 'rate limited' }));
  await expect(setAccountPassword('correct-horse-battery', { mintCSRF })).rejects.toMatchObject({
    status: 429,
    code: 'rate_limited',
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npx vitest run src/lib/api/password.test.ts
```

Expected: the first test fails (body has no `current_password`; also a type error on `currentPassword` under `npm run typecheck`), the second passes trivially, the third passes (behaviour already there) — keep it, it pins the codes Tasks 3–5 branch on.

- [ ] **Step 3: Implement**

In `src/lib/api/password.ts` replace the signature and body construction:

```ts
export async function setAccountPassword(
  password: string,
  {
    currentPassword,
    mintCSRF = issueCSRF,
  }: {
    /** Sent only when non-empty: the server treats a present-but-wrong value
     *  and an absent one identically (401), so an empty string buys nothing. */
    currentPassword?: string;
    mintCSRF?: (action: 'set_password') => Promise<string>;
  } = {}
): Promise<void> {
  const csrf_token = await mintCSRF('set_password');
  const form = new URLSearchParams({ password, csrf_token });
  if (currentPassword) form.set('current_password', currentPassword);
  const res = await fetch('/dashboard/account/set-password', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
    redirect: 'follow',
  });
```

Replace the doc-comment paragraph that began "The route is a same-site form POST…" with:

```ts
 * The route is a same-site form POST, so apid (ADR-140) demands a `csrf_token`
 * bound to the `set_password` action; it is minted from `/v1/auth/csrf` and
 * double-submitted with the form. Which further proof the server wants is not
 * knowable up front — the account object carries no `has_password` — so the
 * caller learns it from the refusal: `invalid_credentials` means send
 * `current_password`, `step_up_required` means verify TOTP first and retry.
```

- [ ] **Step 4: Run tests and the gate**

```bash
npx vitest run src/lib/api/password.test.ts
npx prettier --write src/lib/api/password.ts src/lib/api/password.test.ts
npm run check
```

Expected: 6 tests pass in the file; check green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api/password.ts src/lib/api/password.test.ts
git commit -m "feat(console): setAccountPassword can carry current_password (ADR-140)"
```

---

### Task 3: Wizard asks for the current password after a 401 and retries

The account has a password when — and only when — the server says `invalid_credentials`. The wizard keeps the chosen password, shows a "Current password" sub-step under the Confirm stage (the step rail stays on 2), resubmits with `current_password`, and treats a second `invalid_credentials` as "that password is incorrect". A "Forgot it? Email me a reset link" escape hatch reuses the existing `requestReset`.

**Files:**

- Modify: `src/components/dashboard/password-wizard.tsx`
- Test: `src/components/dashboard/password-wizard.test.tsx`

**Interfaces:**

- Consumes: `setPassword` prop now typed `(password: string, opts?: { currentPassword?: string }) => Promise<void>` (matches Task 2's `setAccountPassword` minus `mintCSRF`).
- Produces: new `Step` value `'verify-password'`; state `current: string`.

- [ ] **Step 1: Write the failing tests**

In `password-wizard.test.tsx`, first widen the `setup()` type so `setPassword` accepts the options argument — change the two `vi.fn<…>()` lines to:

```ts
const setPassword = vi
  .fn<(password: string, opts?: { currentPassword?: string }) => Promise<void>>()
  .mockResolvedValue();
```

Then add these tests inside `describe('PasswordWizard', …)`:

```ts
it('asks for the current password after invalid_credentials and retries with it', async () => {
  const denied = new ApiError({
    status: 401,
    code: 'invalid_credentials',
    title: 'Invalid credentials',
  });
  const setPassword = vi
    .fn<(password: string, opts?: { currentPassword?: string }) => Promise<void>>()
    .mockRejectedValueOnce(denied)
    .mockResolvedValueOnce();
  const { user } = setup({ setPassword });
  const confirm = await reachConfirm(user);
  await user.type(confirm, STRONG);
  await user.click(screen.getByRole('button', { name: /set password/i }));

  const current = await screen.findByLabelText(/current password/i);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument(); // a question, not an error
  await user.type(current, 'the-old-password-1');
  await user.click(screen.getByRole('button', { name: /change password/i }));

  expect(await screen.findByText(/email sign-in is on/i)).toBeInTheDocument();
  expect(setPassword).toHaveBeenCalledTimes(2);
  expect(setPassword).toHaveBeenNthCalledWith(1, STRONG, { currentPassword: undefined });
  expect(setPassword).toHaveBeenNthCalledWith(2, STRONG, {
    currentPassword: 'the-old-password-1',
  });
});

it('says the current password is wrong when the retry is refused again', async () => {
  const denied = new ApiError({
    status: 401,
    code: 'invalid_credentials',
    title: 'Invalid credentials',
  });
  const { user } = setup({ setPassword: vi.fn().mockRejectedValue(denied) });
  const confirm = await reachConfirm(user);
  await user.type(confirm, STRONG);
  await user.click(screen.getByRole('button', { name: /set password/i }));
  await user.type(await screen.findByLabelText(/current password/i), 'wrong-guess-here');
  await user.click(screen.getByRole('button', { name: /change password/i }));

  expect(await screen.findByRole('alert')).toHaveTextContent(/current password is incorrect/i);
  expect(screen.getByLabelText(/current password/i)).toHaveValue(''); // cleared, like login
});

it('offers the reset link from the current-password step', async () => {
  const denied = new ApiError({
    status: 401,
    code: 'invalid_credentials',
    title: 'Invalid credentials',
  });
  const { user, requestReset } = setup({ setPassword: vi.fn().mockRejectedValue(denied) });
  const confirm = await reachConfirm(user);
  await user.type(confirm, STRONG);
  await user.click(screen.getByRole('button', { name: /set password/i }));
  await screen.findByLabelText(/current password/i);
  await user.click(screen.getByRole('button', { name: /reset link/i }));

  await waitFor(() => expect(requestReset).toHaveBeenCalledWith(EMAIL));
  expect(await screen.findByText(/is registered/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
npx vitest run src/components/dashboard/password-wizard.test.tsx
```

Expected: the three new tests fail — "Unable to find a label with the text: /current password/i" (the wizard shows the server message as an alert instead).

- [ ] **Step 3: Implement in `password-wizard.tsx`**

1. Extend the step union and add state:

```ts
type Step = 'idle' | 'choose' | 'confirm' | 'verify-password' | 'done' | 'reset-sent';
```

```ts
const [current, setCurrent] = useState('');
```

2. Change the prop type:

```ts
/** Rejects with an `ApiError`; the wizard branches on its `code`. */
setPassword: (password: string, opts?: { currentPassword?: string }) => Promise<void>;
```

3. Replace `submit` with a version that carries the current password when the wizard has one and routes the refusal codes. Keep `reset()` clearing `current` too (add `setCurrent('')` inside `reset`):

```ts
const submit = async () => {
  if (!matches || !longEnough || pending) return;
  setPending(true);
  setError(null);
  try {
    await setPassword(chosen, { currentPassword: current || undefined });
    setChosen('');
    setRetyped('');
    setCurrent('');
    setTouched(false);
    setStep('done');
    onSet?.();
  } catch (err) {
    if (err instanceof ApiError && err.code === 'invalid_credentials') {
      // The server only says this when the account already has a password.
      // First time: ask for it (no error — it is a question). After that:
      // the one they typed was wrong.
      if (step === 'verify-password') {
        setCurrent('');
        setError('Current password is incorrect.');
      } else {
        setStep('verify-password');
      }
    } else if (err instanceof ApiError && err.code === 'password_too_weak') {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    } else {
      setError(errorMessage(err));
    }
  } finally {
    setPending(false);
  }
};
```

4. Add the sub-step's markup inside the `<AnimatePresence>` (between the `'confirm'` and `'done'` blocks). It stays on rail step 2:

```tsx
{
  step === 'verify-password' && (
    <motion.form
      key="verify-password"
      {...slide}
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <StepRail current="confirm" />
      <p className="max-w-sm text-sm text-muted-foreground">
        This account already has a password. Enter it to replace it.
      </p>
      <PasswordField
        id="password-current"
        label="Current password"
        value={current}
        onChange={setCurrent}
        autoComplete="current-password"
        invalid={Boolean(error)}
      />
      {error && <Refusal message={error} />}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          size="sm"
          variant="cta"
          className="gap-1.5"
          disabled={current.length === 0}
          busy={pending}
        >
          Change password
          <Check className="h-3.5 w-3.5" />
        </Button>
        <button
          type="button"
          onClick={() => void sendReset()}
          disabled={pending}
          className="text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          Forgot it? Email me a reset link
        </button>
        <BackLink
          onClick={() => {
            setCurrent('');
            go('confirm');
          }}
        >
          Back
        </BackLink>
      </div>
    </motion.form>
  );
}
```

5. In the `'done'` block the copy currently says "Email sign-in is on." Keep it — the test matches it — but make the second line honest for both cases:

```tsx
<p className="mt-1 text-xs text-muted-foreground">
  Sign in as <span className="text-foreground">{email}</span> with this password from now on. Google
  and GitHub still work too.
</p>
```

6. Update the panel copy at the top so it no longer claims only OAuth accounts use it. In `<Panel title="Email sign-in" description=…>` use:

```
Set a password to sign in with email, or replace the one you have. Google and GitHub keep working either way.
```

and the idle button label stays "Set a password" (the server decides whether it is a change).

- [ ] **Step 4: Run tests, format, gate**

```bash
npx vitest run src/components/dashboard/password-wizard.test.tsx
npx prettier --write src/components/dashboard/password-wizard.tsx src/components/dashboard/password-wizard.test.tsx
npm run check
```

Expected: all wizard tests pass (previous 6 + 3 new); check green.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/password-wizard.tsx src/components/dashboard/password-wizard.test.tsx
git commit -m "feat(console): password wizard asks for the current password when the server requires it"
```

---

### Task 4: MFA step-up — `openMfa` reports completion, wizard retries after a 403

`403 step_up_required` means the account has TOTP and the session needs a fresh verification. The console already owns the modal for that (`MfaProvider`, mode `'verify'`), but `openMfa()` fires and forgets. Give it completion callbacks, then let the wizard open it and resubmit once verified. The wizard receives this as an injected `stepUp: () => Promise<boolean>` so tests need no provider.

**Files:**

- Modify: `src/components/auth/mfa-provider.tsx`
- Modify: `src/components/dashboard/password-wizard.tsx`
- Test: `src/components/dashboard/password-wizard.test.tsx`
- Test (new): `src/components/auth/mfa-provider.test.tsx`

**Interfaces:**

- Produces (provider): `openMfa(mode?: MfaMode, opts?: { onVerified?: () => void; onDismissed?: () => void }): void`. `onVerified` fires after a successful `confirm`/`verify`/`recover` submit (after the query invalidation); `onDismissed` fires if the modal is closed without success. Each callback fires at most once per `openMfa` call.
- Produces (wizard): optional prop `stepUp?: () => Promise<boolean>` — resolves `true` when a fresh step-up exists, `false` if the user backed out.

- [ ] **Step 1: Failing provider test**

Create `src/components/auth/mfa-provider.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MfaProvider, useMfa } from './mfa-provider';

vi.mock('@/lib/api/queries', () => ({
  confirmMfa: vi.fn(),
  enrollMfa: vi.fn(),
  recoverMfa: vi.fn(),
  verifyMfa: vi.fn().mockResolvedValue({}),
}));

function Opener({ onVerified, onDismissed }: { onVerified: () => void; onDismissed: () => void }) {
  const { openMfa } = useMfa();
  return (
    <button type="button" onClick={() => openMfa('verify', { onVerified, onDismissed })}>
      step up
    </button>
  );
}

function renderWith(ui: React.ReactNode) {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MfaProvider>{ui}</MfaProvider>
    </QueryClientProvider>
  );
}

describe('openMfa completion callbacks', () => {
  it('calls onVerified once after a successful verify', async () => {
    const onVerified = vi.fn();
    const onDismissed = vi.fn();
    renderWith(<Opener onVerified={onVerified} onDismissed={onDismissed} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /step up/i }));

    const code = await screen.findByRole('textbox');
    await user.type(code, '123456');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(onVerified).toHaveBeenCalledTimes(1));
    expect(onDismissed).not.toHaveBeenCalled();
  });

  it('calls onDismissed when the modal is closed without verifying', async () => {
    const onVerified = vi.fn();
    const onDismissed = vi.fn();
    renderWith(<Opener onVerified={onVerified} onDismissed={onDismissed} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /step up/i }));
    await screen.findByRole('textbox');
    await user.keyboard('{Escape}');

    await waitFor(() => expect(onDismissed).toHaveBeenCalledTimes(1));
    expect(onVerified).not.toHaveBeenCalled();
  });
});
```

If the modal's code input is not a `textbox` role or Escape does not close it, read `src/components/ui/modal.tsx` and the JSX at the bottom of `mfa-provider.tsx` and adjust the two queries (`findByRole('textbox')`, `{Escape}`) to what the markup actually exposes — the assertion (callbacks) is what matters, not the selector.

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run src/components/auth/mfa-provider.test.tsx
```

Expected: a type error / runtime error — `openMfa` takes one argument; callbacks never fire.

- [ ] **Step 3: Implement in `mfa-provider.tsx`**

Extend the context type and the callback:

```ts
interface MfaOpenOptions {
  /** After a successful confirm / verify / recover — the session now carries a fresh step-up. */
  onVerified?: () => void;
  /** The modal closed without success. */
  onDismissed?: () => void;
}

interface MfaContextValue {
  openMfa: (mode?: MfaMode, opts?: MfaOpenOptions) => void;
}
```

Inside `MfaProvider` add a ref to hold the pending callbacks (a ref, not state, so a re-render never re-fires them):

```ts
const pending = useRef<MfaOpenOptions | null>(null);
```

(`useRef` joins the existing `react` import.)

`openMfa` stores them:

```ts
const openMfa = useCallback(
  (nextMode: MfaMode = 'choose', opts?: MfaOpenOptions) => {
    resetTransient();
    setRequired(false);
    pending.current = opts ?? null;
    setMode(nextMode);
    setOpen(true);
  },
  [resetTransient]
);
```

`close` reports a dismissal (only if something is pending):

```ts
const close = useCallback(() => {
  if (busy) return;
  setOpen(false);
  const cb = pending.current;
  pending.current = null;
  cb?.onDismissed?.();
}, [busy]);
```

`complete` reports success **after** the invalidation, so the caller's retry sees fresh state:

```ts
const complete = useCallback(async () => {
  setBusy(false);
  setOpen(false);
  setRequired(false);
  resetTransient();
  await queryClient.invalidateQueries();
  const cb = pending.current;
  pending.current = null;
  cb?.onVerified?.();
}, [queryClient, resetTransient]);
```

`handleMfaRequired` (the global "MFA required" interception) must not inherit a stale callback: add `pending.current = null;` as its first line.

- [ ] **Step 4: Run the provider test**

```bash
npx vitest run src/components/auth/mfa-provider.test.tsx
```

Expected: 2 pass.

- [ ] **Step 5: Failing wizard tests**

Add to `password-wizard.test.tsx` (and add `stepUp` to the `setup()` overrides type — it is part of the wizard's props so `Partial<Parameters<typeof PasswordWizard>[0]>` already admits it):

```ts
it('runs the MFA step-up on step_up_required and retries once verified', async () => {
  const gated = new ApiError({ status: 403, code: 'step_up_required', title: 'Step-up' });
  const setPassword = vi
    .fn<(password: string, opts?: { currentPassword?: string }) => Promise<void>>()
    .mockRejectedValueOnce(gated)
    .mockResolvedValueOnce();
  const stepUp = vi.fn().mockResolvedValue(true);
  const { user } = setup({ setPassword, stepUp });
  const confirm = await reachConfirm(user);
  await user.type(confirm, STRONG);
  await user.click(screen.getByRole('button', { name: /set password/i }));

  expect(await screen.findByText(/email sign-in is on/i)).toBeInTheDocument();
  expect(stepUp).toHaveBeenCalledTimes(1);
  expect(setPassword).toHaveBeenCalledTimes(2);
});

it('stays on Confirm with a note when the step-up is dismissed', async () => {
  const gated = new ApiError({ status: 403, code: 'step_up_required', title: 'Step-up' });
  const setPassword = vi.fn().mockRejectedValue(gated);
  const stepUp = vi.fn().mockResolvedValue(false);
  const { user } = setup({ setPassword, stepUp });
  const confirm = await reachConfirm(user);
  await user.type(confirm, STRONG);
  await user.click(screen.getByRole('button', { name: /set password/i }));

  expect(await screen.findByRole('alert')).toHaveTextContent(/verify with your authenticator/i);
  expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
  expect(setPassword).toHaveBeenCalledTimes(1);
});

it('explains when no step-up is available', async () => {
  const gated = new ApiError({ status: 403, code: 'step_up_required', title: 'Step-up' });
  const { user } = setup({ setPassword: vi.fn().mockRejectedValue(gated) }); // no stepUp prop
  const confirm = await reachConfirm(user);
  await user.type(confirm, STRONG);
  await user.click(screen.getByRole('button', { name: /set password/i }));

  expect(await screen.findByRole('alert')).toHaveTextContent(/verify with your authenticator/i);
});
```

Run `npx vitest run src/components/dashboard/password-wizard.test.tsx` — expected: the first two fail (no `stepUp` handling; alert shows the raw server message).

- [ ] **Step 6: Implement in the wizard**

Add the prop:

```ts
  /** Opens the TOTP step-up; resolves true when the session now carries a
   *  fresh stamp, false if the person backed out. Absent when no MFA UI is
   *  mounted (tests), in which case the refusal is explained instead. */
  stepUp?: () => Promise<boolean>;
```

In `submit`'s `catch`, add a branch **before** the `password_too_weak` one:

```ts
      } else if (err instanceof ApiError && err.code === 'step_up_required') {
        if (stepUp && (await stepUp())) {
          // Fresh stamp on the cookie: the same form now passes. Re-enter
          // submit rather than duplicating it; pending is reset in finally.
          setPending(false);
          await submit();
          return;
        }
        setError('Verify with your authenticator to change the password.');
```

(`submit` is an `async` arrow; the recursive call is fine because `pending` is cleared first.)

In `PasswordPanel`, wire it through the provider:

```tsx
export function PasswordPanel() {
  const { account, user, requestPasswordReset } = useAuth();
  const { toast } = useToast();
  const { openMfa } = useMfa();
  const email = account?.email ?? user?.email ?? '';
  const stepUp = () =>
    new Promise<boolean>((resolve) => {
      openMfa('verify', { onVerified: () => resolve(true), onDismissed: () => resolve(false) });
    });
  return (
    <PasswordWizard
      email={email}
      setPassword={setAccountPassword}
      requestReset={requestPasswordReset}
      stepUp={stepUp}
      onSet={() =>
        toast({
          kind: 'success',
          title: 'Password set',
          description: 'Email sign-in now works too.',
        })
      }
    />
  );
}
```

with `import { useMfa } from '@/components/auth/mfa-provider';`. Check that `MfaProvider` wraps the console routes (grep `MfaProvider` in `src/routes/__root.tsx` or `dashboard.tsx`); it does today — the security page relies on it. If it did not, the panel would throw, and `useMfa` says so loudly.

- [ ] **Step 7: Run everything, format, gate**

```bash
npx vitest run src/components/dashboard/password-wizard.test.tsx src/components/auth/mfa-provider.test.tsx
npx prettier --write src/components/auth/mfa-provider.tsx src/components/auth/mfa-provider.test.tsx src/components/dashboard/password-wizard.tsx src/components/dashboard/password-wizard.test.tsx
npm run check
```

Expected: green; ESLint still 7 warnings.

- [ ] **Step 8: Commit**

```bash
git add src/components/auth/mfa-provider.tsx src/components/auth/mfa-provider.test.tsx src/components/dashboard/password-wizard.tsx src/components/dashboard/password-wizard.test.tsx
git commit -m "feat(console): password change runs the TOTP step-up when the server requires it

openMfa gains onVerified/onDismissed so a caller can resume after the
modal; the wizard uses it for 403 step_up_required and retries once."
```

---

### Task 5: Rate limit and stale-CSRF copy

Two refusals the wizard can now hit that deserve their own words rather than the raw server text.

**Files:**

- Modify: `src/components/dashboard/password-wizard.tsx`
- Test: `src/components/dashboard/password-wizard.test.tsx`

- [ ] **Step 1: Failing tests**

```ts
it('tells the user to wait when the limiter answers 429', async () => {
  const limited = new ApiError({
    status: 429,
    code: 'rate_limited',
    title: 'Too Many Requests',
    detail: 'Too many attempts. Wait a minute and try again.',
  });
  const { user } = setup({ setPassword: vi.fn().mockRejectedValue(limited) });
  const confirm = await reachConfirm(user);
  await user.type(confirm, STRONG);
  await user.click(screen.getByRole('button', { name: /set password/i }));

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(/too many attempts/i);
  expect(screen.getByRole('button', { name: /set password/i })).toBeDisabled();
});

it('asks for a reload when the CSRF token is stale', async () => {
  const stale = new ApiError({
    status: 400,
    code: 'validation_failed',
    title: 'Invalid CSRF token',
    detail: 'please reload the page and try again',
  });
  const { user } = setup({ setPassword: vi.fn().mockRejectedValue(stale) });
  const confirm = await reachConfirm(user);
  await user.type(confirm, STRONG);
  await user.click(screen.getByRole('button', { name: /set password/i }));

  expect(await screen.findByRole('alert')).toHaveTextContent(/reload/i);
});
```

Run: `npx vitest run src/components/dashboard/password-wizard.test.tsx` — expected: the 429 test fails on the disabled-button assertion (the second already passes via `errorMessage`; keep it as a pin).

- [ ] **Step 2: Implement**

State: `const [cooldown, setCooldown] = useState(false);`. In `submit`'s `catch`, before the generic branch:

```ts
      } else if (err instanceof ApiError && err.code === 'rate_limited') {
        setError(errorMessage(err));
        setCooldown(true);
        // The limiter's window is a minute; hold the button for it rather
        // than letting the person burn the next window immediately.
        window.setTimeout(() => setCooldown(false), 60_000);
```

Disable both submit buttons (`'confirm'` and `'verify-password'` forms) with `disabled={!matches || retyped.length === 0 || cooldown}` and `disabled={current.length === 0 || cooldown}` respectively. Clear `cooldown` in `reset()` as well. The timer must not set state after unmount: hold the id in a `useRef` and clear it in a `useEffect` cleanup:

```ts
const cooldownTimer = useRef<number | null>(null);
useEffect(
  () => () => {
    if (cooldownTimer.current) window.clearTimeout(cooldownTimer.current);
  },
  []
);
```

and assign `cooldownTimer.current = window.setTimeout(…)`. (`useEffect`, `useRef` join the `react` import.)

- [ ] **Step 3: Run, format, gate, commit**

```bash
npx vitest run src/components/dashboard/password-wizard.test.tsx
npx prettier --write src/components/dashboard/password-wizard.tsx src/components/dashboard/password-wizard.test.tsx
npm run check
git add src/components/dashboard/password-wizard.tsx src/components/dashboard/password-wizard.test.tsx
git commit -m "feat(console): password wizard holds the button through the limiter's window"
```

---

### Task 6: Mock — a stateful account so every branch can be seen

Under `npm run dev:mock` the account has no password and no MFA, so only the happy path is visible. Make the mock remember a set password (later changes need `current_password`), and add opt-in env flags for the other two cohorts.

**Files:**

- Modify: `mock/plugin.ts` (the `/dashboard/account/set-password` handler; add `/v1/account/mfa/verify`)
- Modify: `README.md` (the `dev:mock` paragraph) and `CLAUDE.md` (the `dev:mock` gotcha) — one sentence each for the new flags

**Interfaces:**

- `MOCK_HAS_PASSWORD=1` boots with the password `mock-current-password` already set.
- `MOCK_MFA=1` boots MFA-enrolled: set-password answers `403 step_up_required` until `POST /v1/account/mfa/verify` has been called (any six digits) within the last 5 minutes.

- [ ] **Step 1: Implement**

Near the existing `MOCK_CSRF_ACTIONS` in `mock/plugin.ts`:

```ts
// ADR-140 cohorts. The real server decides the proof from the account; the
// mock keeps just enough state to show each branch on demand.
const mockAuth = {
  password: process.env.MOCK_HAS_PASSWORD === '1' ? 'mock-current-password' : null,
  mfaEnrolled: process.env.MOCK_MFA === '1',
  steppedUpAt: 0,
};
const STEP_UP_TTL_MS = 5 * 60_000;

route('POST', '/v1/account/mfa/verify', ({ body }) => {
  if (!/^\d{6}$/.test(String(body.totp ?? '')))
    throw new Problem(401, 'mfa_invalid_code', 'the TOTP code did not match');
  mockAuth.steppedUpAt = Date.now();
  return { account_id: db.ACCOUNT_ID, mfa_pending: false };
});
```

Replace the set-password handler:

```ts
route('POST', '/dashboard/account/set-password', ({ body, res }) => {
  if (body.csrf_token !== 'mock-csrf')
    throw new Problem(400, 'validation_failed', 'Invalid CSRF token');
  const next = String(body.password ?? '');
  if (next.length < 12)
    throw new Problem(400, 'password_too_weak', 'Password must be at least 12 characters.');
  const fresh = Date.now() - mockAuth.steppedUpAt < STEP_UP_TTL_MS;
  if (!fresh) {
    if (mockAuth.mfaEnrolled)
      throw new Problem(403, 'step_up_required', 'verify your authenticator first');
    if (mockAuth.password !== null && body.current_password !== mockAuth.password)
      throw new Problem(401, 'invalid_credentials', 'Email or password is incorrect.');
  }
  mockAuth.password = next;
  res.statusCode = 302;
  res.setHeader('location', '/dashboard/account');
  return '';
});
```

Check `mock/plugin.ts`'s `Problem` class signature (`new Problem(status, code, detail?)`) matches these calls — it does today.

- [ ] **Step 2: Walk every branch in the browser**

```bash
npm run dev:mock                          # cohort 1: OAuth-only, no MFA
```

Set a password → Done. Set another → the "Current password" step appears (the mock now has one); wrong → "Current password is incorrect."; right → Done.

```bash
MOCK_HAS_PASSWORD=1 npm run dev:mock      # cohort 2: has a password from the start
```

First attempt asks for the current password; `mock-current-password` succeeds.

```bash
MOCK_MFA=1 npm run dev:mock               # cohort 3: MFA enrolled
```

Submit → the MFA modal opens in verify mode; enter any six digits → wizard lands on Done without another click. Escape instead → the Confirm step stays with "Verify with your authenticator…".

- [ ] **Step 3: Docs, format, gate, commit**

Add to `README.md` under "`npm run dev:mock`" and to the `dev:mock` bullet in `CLAUDE.md`: "`MOCK_HAS_PASSWORD=1` boots with a password already set (`mock-current-password`); `MOCK_MFA=1` boots MFA-enrolled so set-password demands a step-up (any six digits verify)."

```bash
npx prettier --write mock/plugin.ts README.md CLAUDE.md
npm run check
git add mock/plugin.ts README.md CLAUDE.md
git commit -m "chore(mock): stateful password and MFA cohorts for the set-password flow"
```

---

### Task 7: Final gate and the PR

**Files:** none new.

- [ ] **Step 1: Full verification**

```bash
npm run check          # typecheck + lint (7 warnings, 0 errors) + format + tests
npm run build          # the real gate; runs tsc first and prerenders
```

Then `npm run dev:mock` once more and repeat Task 6 Step 2's three cohorts end to end.

- [ ] **Step 2: Reduced-motion and a11y spot check**

In the browser's rendering settings emulate `prefers-reduced-motion: reduce`, walk Choose → Confirm → current-password → Done: no slides, content still appears. Tab through the current-password step: label is associated (`htmlFor`), the error is `role="alert"`, the reveal toggle has an `aria-label`.

- [ ] **Step 3: Open the PR**

```bash
git push
gh pr create --repo poyrazK/faas-web --base main --head feat/password-change \
  --title "Console: change an existing password (ADR-140)" \
  --body-file - <<'PR'
## What

The Account page's password panel becomes a real change-password flow against the ADR-140 contract that merged in poyrazK/faas#1281.

- Vendored spec refreshed from `main`; the `set_password` CSRF cast is gone. Fixtures and edge-rule/alert request builders gain the fields the newer schema requires (no behaviour change).
- `setAccountPassword` can carry `current_password`.
- The wizard learns which proof the server wants from the refusal, because the account object has no `has_password`: `401 invalid_credentials` opens a current-password step and retries; `403 step_up_required` opens the MFA modal in verify mode and retries once verified (`openMfa` gained `onVerified`/`onDismissed`); `429 rate_limited` holds the button for the limiter's minute; a stale CSRF token asks for a reload.
- The mock keeps a set password and has `MOCK_HAS_PASSWORD=1` / `MOCK_MFA=1` cohorts so every branch can be seen without a backend.

Also in this branch (earlier commits): the wizard itself, the fix that routes the set-password POST to apid in `vercel.json`/dev proxy/mock (it previously fell through to the SPA fallback and reported the `200 index.html` as success), and removal of the `fra-metal-1` sidebar card.

## Verification

- `npm run check` green (typecheck, ESLint at the 7-warning ceiling, Prettier, Vitest).
- `npm run build` green.
- Walked all three cohorts under `dev:mock` (OAuth-only → then has-password; `MOCK_HAS_PASSWORD=1`; `MOCK_MFA=1` verify and dismiss).

## Follow-ups (not here)

- `has_password` on `GET /v1/account` (server) so the console can show the current-password field up front instead of after a round trip.
PR
```

---

## Self-review notes (already applied)

- Spec coverage: every server answer in the contract table has a wizard branch and a test (302 → Task 3/4 success paths; 400 ×2, 401, 403, 429 → Tasks 3–5). The "no `has_password`" constraint is honoured by the refusal-driven design; the follow-up is named in the PR body.
- Names used across tasks: `setAccountPassword(password, { currentPassword, mintCSRF })` (Task 2) is what the wizard's `setPassword` prop mirrors minus `mintCSRF` (Tasks 3–5); `openMfa(mode, { onVerified, onDismissed })` (Task 4) is what `PasswordPanel` calls; `stepUp: () => Promise<boolean>` is the wizard prop; `Step` gains `'verify-password'` only.
- Mock state (`mockAuth`) exists only inside `mock/plugin.ts`; nothing in `src/` reads it.
