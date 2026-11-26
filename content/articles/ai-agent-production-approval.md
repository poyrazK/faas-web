**On Gregale, an AI coding agent has to ask a person before it makes a risky
production change.** An agent key, or an agent connected to Gregale's hosted
MCP server, must get your approval before it deletes something, deploys or
rolls back a production app, creates or rotates credentials, or changes
billing. The request stops with a review link; you open it, see exactly what
the agent will send, and approve or deny. Reads and previews are not gated,
so the agent keeps working at full speed there.

## How Gregale enforces human approval before an AI agent changes production

1. **The agent makes the request against Gregale.** Gregale's control-plane API answers `428 approval_required` with a single-use review link instead of running the mutation.
2. **The agent shows you the Gregale review link.** `gregale` prints it with the error, while `gregale --wait-for-approval <command>` or the hosted MCP tool `gregale_wait_for_approval` pauses and waits for your decision.
3. **You decide, signed in to Gregale.** Gregale's dashboard review page shows the exact HTTP method, path, and request body. Only the member who connected the agent, or an owner or admin of its organization, can approve from a signed-in Gregale dashboard session (never with an API key); delete, production, credentials, or billing approvals require a sign-in within the last 15 minutes.
4. **The agent repeats the exact Gregale request once.** It cannot swap in a different payload, and the Gregale approval request expires after 30 minutes.
5. **A denial or timeout sticks.** If the agent retries a denied or expired action within 30 minutes, Gregale rejects it with `403 approval_denied` (with your reason) or `410 approval_expired` instead of issuing a new link, forcing the agent to stop and ask.

The agent can say why it is asking (the `Gregale-Agent-Reason` header, or
`--agent-reason` on the CLI). The reason shows on the review page, in the
approval email and in the agent's activity log. It is the agent's own words:
what you approve is still the exact request shown.

## What counts as risky

| Category      | Examples                                                                                           |
| ------------- | -------------------------------------------------------------------------------------------------- |
| `production`  | Deploying, promoting or rolling back a production app; changing its variables, secrets or settings |
| `delete`      | Deleting apps, databases, buckets, crons or domains                                                |
| `credentials` | Creating or rotating keys and secrets; attaching a debugger to a developer environment             |
| `billing`     | Plan and billing changes                                                                           |

Choose the categories when you create the key; the default is all of them:

```sh
gregale key create coding-agent --agent                         # every category asks
gregale key create ci-agent --scopes agent,deploy:write --approvals delete,billing
```

Only an agent key asks: a key without the `agent` scope does whatever its
scopes allow, so don't give a coding agent one. An organization can require
categories for every agent acting in it with
`gregale org agent policy set --approvals`.

## When nobody is watching

Subscribe an account webhook and send approval requests where your team
already works:

```sh
gregale webhook account add --target-url https://example.com/approvals \
  --event agent.approval.requested --event agent.approval.denied
```

Each event names the request, the key, the category, the method and path,
and, for a new request, its review link. It never includes the request body.

## How other setups compare

Most hosting platforms give an agent an API token or a CLI login, and the
token can do whatever the account can. The usual guardrails sit outside the
platform: the agent's own permission prompts, or a required reviewer on a CI
environment, so the agent can open a pull request but a pipeline deploys it.
Those protect the deploy pipeline. They don't cover the other calls the same
token can make, such as deleting a database or changing a secret.

On Gregale, the approval check lives inside the platform control-plane API, so it applies uniformly to every agent key across the CLI, REST API, and hosted MCP server (`gregale_wait_for_approval`):

| Setup                                   | Enforces every risky API call                     | Prevents payload swap after review           | Covers direct DB deletes & secrets                     | Setup required                          |
| --------------------------------------- | ------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------ | --------------------------------------- |
| **Gregale (`--agent` keys)**            | Yes, enforced by platform `428 approval_required` | Yes, signed exact request replay (`30m` TTL) | Yes (`production`, `delete`, `credentials`, `billing`) | Built in (`gregale key create --agent`) |
| **Agent local prompts**                 | No, relies on model/client discipline             | No                                           | Only if CLI wrappers forbid raw tokens                 | Per-developer config                    |
| **GitHub / CI environment reviewers**   | Pull requests and workflows only                  | N/A                                          | No, direct cloud API keys bypass CI                    | Custom YAML + IAM split                 |
| **Custom LangGraph / Temporal wrapper** | Only calls routed through custom middleware       | Custom implementation required               | Only tools wrapped by your code                        | Self-hosted state & UI                  |

## Related

- [Runnable starters, MCP servers & IDE plugins on Gregale](/templates)
- [Gregale plugin for Claude Code](https://github.com/gregale-dev/gregale-claude-code-plugin)
- [Gregale plugin for Antigravity IDE](https://github.com/gregale-dev/gregale-antigravity-plugin)
- [Undo what an AI agent changed](/articles/undo-ai-agent-changes)
- [Cap what an AI agent adds to your hosting bill](/articles/ai-agent-hosting-budget)
- [Let Claude Code deploy to production safely](/articles/claude-code-deploy-production-safely)
- [Hosting platforms with an MCP server that deploys, reads logs and rolls back](/articles/hosting-mcp-server-deploy-logs-rollback)
- Reference: [Approve an agent's risky requests](/docs/agents#approve-an-agents-risky-requests)
