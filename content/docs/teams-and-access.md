# Teams and access

Everything on Gregale belongs to an organisation. This page covers organisations and seats, roles, invitations, MFA, sessions, API keys, and the two audit trails.

## Organisations

Your account starts with a personal organisation; shared ones are created with a slug (the URL) and a name (the label):

```
gregale orgs create --slug acme-robotics --name "Acme Robotics"
```

The creator becomes the first owner. The plan lives on the organisation — apps created inside it are billed to it. Deleting one (`gregale orgs rm <slug>`) removes every member's access; personal organisations cannot be deleted. In the console: **Team**, with the org picker in the header.

## Seats and roles

Members hold one of four roles (plus `owner`, held by whoever the org was transferred to last — `gregale orgs transfer-ownership`):

| Role | What it can do |
|---|---|
| `admin` | Everything but transfer ownership. |
| `developer` | Deploy and configure apps. No billing, no members. |
| `viewer` | Read everything, change nothing. |
| `billing` | Invoices and the plan. Nothing else. |

`gregale orgs seat-usage` shows how many seats are in use; `gregale orgs members` lists them.

## Invitations

An invitation is minted for an email and a role, and its plaintext token is shown exactly once — the server keeps only a hash. It moves through `pending → consumed` (or `revoked`, or `expired` past its `expires_at`). The invitee runs:

```
gregale invitations accept <token>
```

In the console: **Team → Invite a member**, with the token reveal, and the invitations table for revoking.

## MFA, sessions, and the panic button

TOTP enrolment, recovery codes, step-up verification and disabling all live under `gregale mfa enroll|confirm|verify|recover|disable`. Signed-in browser sessions are listed on the console's **Security** page, and *Sign out everywhere* revokes all of them in one action — the control that matters when a laptop goes missing.

## API keys

Account keys (`gregale keys add|list|rm|rotate`) and organisation keys (`gregale orgs keys`) authenticate automation. Rotation supports a grace window (`gregale keys grace-window`) so the old key keeps working while deploys switch over. Keys are shown once at mint, like invitation tokens.

## The two audit trails

- **Audit events** (`gregale audit-events list|get`) — the security timeline: logins, key mints, secret writes, MFA changes, plan changes, and state transitions such as `stateless.advisory`. Filter by time, kind prefix, or app; each event's payload never carries a plaintext secret. In the console: **Security → Audit events**, click a row for the payload.
- **Audit log** (console: **Audit Log**) — the resource-write ledger: who changed which app, domain, rule, or secret, and when.

One is "who touched the account", the other is "who touched the infrastructure"; incidents usually need both.
