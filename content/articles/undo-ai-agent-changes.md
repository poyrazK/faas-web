**Gregale can reverse what an AI agent changed with one command.** It keeps
every write an agent makes for 7 days, and `gregale mcp connection undo`
lists the agent's changes newest first, says what undoing each will do, and
reverses them once you confirm. That covers more than code: settings,
scaling, variables, traffic splits, and the apps, crons, domains and
databases the agent created or deleted.

## Undo an agent's changes

```sh
gregale mcp connection list                        # find the agent's id
gregale mcp connection undo <id> --plan            # show what undo would do, change nothing
gregale mcp connection undo <id>                   # the last 24 hours
gregale mcp connection undo <id> --since 2h
gregale mcp connection undo <id> --entry <activity-id>
```

## What undo puts back

- **Deploys and rollbacks.** A deployment the agent started is cancelled
  while it builds; once it serves, the app goes back to the deployment that
  served before it.
- **Promotions and traffic changes.** Live deployments get back the exact
  traffic split they had.
- **App settings and scaling**, such as `min_instances`, `ram_mb`,
  `idle_timeout_s`, egress and CORS settings.
- **Variables** of the app and of its project's environments.
- **Things the agent created**, such as apps, crons, domains and Postgres
  databases, are removed. An app is parked and can be restored for 7 days; a
  database can be undeleted for 7 days.
- **Things the agent deleted come back**: an app or database within its
  7-day restore window, a cron or custom domain created again as it was.

Undo runs through the same API as any other change, with your access, so it
is validated the same way.

## What it can't undo

The plan says so, and why, before anything changes: a secret the agent set or
removed (Gregale keeps no copy of a replaced secret, so set it again), an
app's first deploy, an individual canary step, and a deleted bucket. If a
person changed a resource after the agent did, undo leaves it alone unless
you pass `--force`, so it never overwrites someone's later fix.

## See what an agent did first

```sh
gregale mcp connection status              # every agent: pending approvals, cost, what undo can reverse
gregale mcp connection activity <id>       # each write: when, method, path, status, approval, reason
```

The activity log keeps each write request for 7 days with the approval it
went through and the reason the agent gave. Request bodies are never kept.

## How other setups compare

Redeploying the last good version restores your code, but not the rest of
what an agent may have touched: an environment variable, a scaling setting, a
cron, a domain or a deleted database. On most platforms you rebuild that by
hand from an audit log, if there is one. Coding agents' own undo (rewinding a
session, reverting file edits) covers your working copy, not what is already
live.

Gregale records each agent's changes as it makes them, so it can reverse them
for you.

## Related

- [Human approval before an AI agent changes production](/articles/ai-agent-production-approval)
- [Canary deploys with automatic rollback](/articles/canary-deploys)
- Reference: [Undo what an agent changed](/docs/agents#undo-what-an-agent-changed)
