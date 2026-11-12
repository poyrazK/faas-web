# Customer Support in the console

This console adds the customer side of Gregale's native Support service: personal
and organization conversations, search, status filters, paginated messages,
replies, resolution, eligible reopening, resolution ratings, and personal unread
updates. The account sidebar, command palette and header link to Support. The
backend's `customer-support` capability controls access; rollout remains a preview.

## Product and architecture

Gregale turns source repositories, Dockerfiles, and OCI images into managed APIs,
functions, and background workloads. Its execution boundary is a Firecracker VM;
idle workloads park as snapshots, with cold boot retained as a fallback. Projects,
environments, deployment history, data services, observability, and usage-based
billing make this a developer platform rather than an isolated function runner.
The console follows the backend's ownership and capability contracts and presents
reported state in plain English.

The Go backend owns support records, authorization, revisions, durable submission
receipts, notifications, and reopening policy. The React console uses the shared
typed API client and TanStack Query. Staff inbox, assignments, policy management,
engineering reviews, and redaction remain in the backend's separately authorized
staff portal. Attachments and incoming email are not supported by the backend.

## Scope and delivery

The main Support entry follows the selected workspace. Personal conversations use
`/dashboard/support/{ticket}`; organization conversations use
`/dashboard/orgs/{org}/support/{ticket}`. These match backend email links. Explicit
links use the scope in the URL even if a different workspace is selected. The back
link from a personal conversation preserves personal scope. An explicitly named
personal organization stays separate from the account's personal collection.

Cache keys include account, scope, resource and filters. Conversation bodies stay
in memory and are not put in local or session storage. Forms explicitly collect
optional identifiers and never automatically attach logs, source or credentials.
Messages render as plain text; redacted content is replaced by a removal notice.

Every conversation write retains its UUID, exact decoded body, and expected
revision until a successful response. Transport failures allow only an explicit
replay of that submission. A revision conflict offers an explicit refresh and
keeps the draft for review before a new submission. Automatic mutation retries
are disabled. A page reload does not replay or restore an unfinished submission;
the customer should inspect conversation history before starting another one.

Notification and message sequences are independent. A notification boundary is
captured before fetching each message page. Only rendering the final page can
acknowledge that observed boundary. A later reply stays unread; reading updates
never changes the conversation revision. Read failures offer a manual retry.

## Source snapshot

Implementation began from `faas-web` commit `f7e616b4` and backend commit
`10034cea1a094876cedb5ef0f9a756afa72a47fe`. The primary checkouts contained existing
feature work and were preserved; this change lives in an isolated worktree.
Before opening the PR, the change was rebased onto `faas-web` main at `fefc0c95`
and integrated with its account and project navigation.

The backend's current full OpenAPI schema also removes the older Automations API
in favor of Workflows. The existing frontend still consumes those removed DTOs
and endpoints. Migrating that interface is separate from Support. A scoped,
reproducible vendor refresh copies only the upstream Support paths, schemas,
responses, capability and inventory row, and then regenerates the shared types:

```bash
node scripts/pull-support-api.mjs /absolute/path/to/current/faas
npm run api:types
```

`api/support-source.json` records the exact source commit. A later full API refresh
should include the Automations migration and can remove this temporary refresher.
The upstream customer-page catalog deliberately leaves the Support guide
unpublished until beta; this change does not publish the internal operator guide.

## Verification

Focused tests cover scope separation, pagination, byte limits, plain-text output,
reopening and survey eligibility, revision conflicts, exact receipt replay, and
observed-only read acknowledgements. The stateful dev mock implements all 22
customer operations. Run the browser journey against a mock server or build:

```bash
npm run dev:mock
BASE_URL=http://localhost:3000 node scripts/support-tour.mjs
```

Use `PLAYWRIGHT_MODULE` and `CHROMIUM_EXECUTABLE_PATH` for an external Playwright
installation and browser, and `SHOTS` for screenshots. The journey exercises a
committed request with a lost response, normal customer actions, organization and
personal email links, preview gating, denied and empty states, and mobile layout.
Production verification still requires an account enrolled in the preview.

Verified on November 12, 2026 after rebasing: `npm run check` passed all 6,195 tests in 604
files, plus type checking, formatting and lint (two existing landing-page
warnings). `npm run build` passed, including prerendering. The browser journey
passed against the built mock console on desktop and mobile, including checks
for browser errors, content-security-policy violations and horizontal overflow.
