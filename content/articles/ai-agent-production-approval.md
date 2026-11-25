**On Gregale, an AI coding agent has to ask a person before it makes a risky
production change.** An agent key, or an agent connected to Gregale's hosted
MCP server, must get your approval before it deletes something, deploys or
rolls back a production app, creates or rotates credentials, or changes
billing. The request stops with a review link; you open it, see exactly what
the agent will send, and approve or deny. Reads and previews are not gated,
so the agent keeps working at full speed there.

## How an approval works

1. **The agent makes the request.** Gregale answers `428 approval_required`
   with a review link instead of carrying it out.
2. **The agent shows you the link.** The CLI prints it with the error.
   `gregale --wait-for-approval <command>` waits for your decision instead.
3. **You decide, signed in.** The review page shows the exact method, path
   and body. Only the member who connected the agent, or an owner or admin of
   its organization, can decide, from a signed-in dashboard session and never
   with an API key. A delete, production, credentials or billing approval
   also needs a sign-in from the last 15 minutes.
4. **The agent repeats the same request once.** It cannot swap in a
   different one. A request expires 30 minutes after it was made.
5. **A denial sticks.** If the agent tries a denied or expired request again
   within 30 minutes, it gets `403 approval_denied` with your reason, or
   `410 approval_expired`, instead of a new link, so it knows to stop and ask.

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

On Gregale the check is in the platform's API, so it applies to every
request an agent key makes, whichever tool the agent uses.

## Related

- [Undo what an AI agent changed](/articles/undo-ai-agent-changes)
- [Cap what an AI agent adds to your hosting bill](/articles/ai-agent-hosting-budget)
- [Let Claude Code deploy to production safely](/articles/claude-code-deploy-production-safely)
- [Hosting platforms with an MCP server that deploys, reads logs and rolls back](/articles/hosting-mcp-server-deploy-logs-rollback)
- Reference: [Approve an agent's risky requests](/docs/agents#approve-an-agents-risky-requests)
