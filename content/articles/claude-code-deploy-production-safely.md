**To let Claude Code deploy to production safely, give it a Gregale agent key
instead of your own login or cloud credentials.** It can then deploy, read
logs and roll back on its own, while Gregale enforces the limits: risky
production changes wait for your approval, new releases go to a small share
of traffic before the rest, every change the agent makes is logged, and you
can undo them.

## Set it up

```sh
curl -fsSL https://get.gregale.dev | sh
gregale login                              # you sign in once
gregale key create coding-agent --agent    # a key for Claude Code, not your login
gregale init --agents --name my-api        # deploy, check and rollback steps in AGENTS.md
```

Put the key in Claude Code's environment as `GREGALE_TOKEN`; it overrides
your saved login for every `gregale` command. Don't paste it into a prompt or
a committed file. This step matters: if Claude Code runs the CLI on your own
login, Gregale treats it as you, and none of the guardrails below apply.
Then ask Claude Code to deploy. Or connect Claude Code to Gregale's hosted MCP server (in preview)
with `gregale mcp connect --client claude-code`, or install the Gregale
plugin, which adds `/gregale:deploy` and `/gregale:diagnose`:

```sh
claude plugin marketplace add poyrazK/faas-web
claude plugin install gregale@gregale
```

## The guardrails, and where they live

| Risk                                    | What Gregale does                                                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| The agent deletes or changes production | It must ask first: you get a review link and approve the exact request ([how](/articles/ai-agent-production-approval))          |
| A bad release reaches users             | The new version gets 1% of traffic first and rolls back on its own on errors (beta)                                             |
| The agent changed more than code        | `gregale mcp connection undo` reverses settings, variables, scaling, crons and domains ([how](/articles/undo-ai-agent-changes)) |
| The agent runs up the bill              | A per-agent budget prices always-on changes before they happen ([how](/articles/ai-agent-hosting-budget))                       |
| You need to know what it did            | `gregale mcp connection activity` lists every write for 7 days, with the reason the agent gave                                  |
| Secrets leak into the session           | The agent key is scoped; it never needs your login or a cloud provider's keys                                                   |

Because these checks are in Gregale's API, they hold for every request the
agent key makes, including commands you let Claude Code run without reading
closely.

## What Claude Code does on Gregale

The CLI is built for agents: `--non-interactive` never prompts or opens a
browser, and `--json` errors carry a stable `code`. A typical loop:

```sh
gregale deploy --dry-run                                     # what Gregale detects in this repo
gregale --non-interactive --json deploy --name my-api
gregale --non-interactive --json app health my-api --errors  # after a failed deploy
gregale --non-interactive --json rollback my-api
```

## How other setups compare

The usual advice for letting a coding agent near production is: give it
least-privilege credentials, put a human approval step in front of
production, and make rollback easy. On most platforms you assemble that
yourself from the agent's permission settings, a CI pipeline with a required
reviewer, and a separate deploy role. Gregale builds those controls into the
platform, so they apply to every request the agent's key makes.

## Related

- [Deploy with Claude Code](/docs/claude-code) (also: Codex, Cursor, Gemini CLI)
- [Use Gregale from coding agents](/docs/agents)
- [Canary deploys with automatic rollback](/articles/canary-deploys)
