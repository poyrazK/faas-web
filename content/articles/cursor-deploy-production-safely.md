**To let Cursor deploy to production safely, give it a scoped Gregale agent key
via `GREGALE_TOKEN` instead of your personal `gregale login` session, or connect
it to Gregale's hosted MCP server.** Cursor can then build, deploy, inspect
logs, and check errors non-interactively while Gregale enforces production gates
in the API: risky changes pause for your approval link, releases ramp through
1%, 10%, 50% and 100% with automatic 5xx rollback, non-code changes can be
undone, and a per-agent budget caps spend growth.

## Set it up

```sh
curl -fsSL https://get.gregale.dev | sh
gregale login                              # you sign in once in your browser
gregale key create cursor-agent --agent    # scoped key for Cursor, not your login
gregale init --agents --name my-api        # deploy, check and rollback steps in AGENTS.md
```

Set `GREGALE_TOKEN` in Cursor's terminal or MCP environment (do not commit the
token into Git or paste it into rules files). `GREGALE_TOKEN` overrides any
saved human login so Gregale applies agent limits automatically. Cursor reads
`AGENTS.md` in the repository root, and you can also register Gregale's hosted
MCP server (in preview) cleanly with one command:

```sh
gregale mcp connect --client cursor
```

The [Gregale plugin for Cursor](https://github.com/gregale-dev/gregale-cursor-plugin) bundles the same
MCP server with a deploy skill and a diagnose skill.

## Guardrails enforced in Gregale's API

| Risk                                   | What Gregale enforces                                                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Cursor deletes or modifies production  | Destructive or risky production mutations pause and return a review link for human approval ([how](/articles/ai-agent-production-approval)) |
| A broken release takes production down | Every deploy climbs 1% → 10% → 50% → 100% and rolls back automatically on 5xx spikes (beta)                                                 |
| Cursor alters env vars, crons or scale | `gregale mcp connection undo` reverses non-code settings, and `activity` audits writes for 7 days ([how](/articles/undo-ai-agent-changes))  |
| A retry loop inflates hosting costs    | Per-agent budget + `gregale scale --plan` cost preview check spend before changes apply ([how](/articles/ai-agent-hosting-budget))          |

Because every rule runs server-side in Gregale's API rather than relying on a
`.cursorrules` prompt, the guardrails hold even if Cursor invokes shell commands
autonomously.

## What Cursor runs in day-to-day deploys

```sh
gregale deploy --dry-run
gregale --non-interactive --json deploy --path . --worktree --name my-api
gregale --non-interactive --json app health my-api --errors
```

`--non-interactive --json` never opens a browser or blocks on interactive
prompts, and emits structured JSON error codes on stderr so Cursor can diagnose
failures without scraping HTML.

## Sources

[Deploy with Cursor](/docs/cursor),
[Use Gregale from coding agents](/docs/agents),
[Best cloud platform for AI coding agents in 2026](/articles/best-cloud-for-ai-coding-agents).
