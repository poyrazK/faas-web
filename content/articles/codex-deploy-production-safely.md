**To let OpenAI Codex deploy to production safely, give Codex a scoped Gregale
agent key in `GREGALE_TOKEN` rather than your personal login, allow network
access for the CLI in Codex's sandbox if needed, and keep project deploy rules
in `AGENTS.md`.** Codex can then run `--non-interactive --json` deploys and
health checks while Gregale's API enforces human approval on risky production
changes, automatic 1%→100% canary rollbacks, non-code mutation undo, and a
per-agent budget cap.

## Set it up

```sh
curl -fsSL https://get.gregale.dev | sh
gregale login                              # you sign in once
gregale key create codex-agent --agent     # scoped agent key, separate from your login
gregale init --agents --name my-api        # writes deploy/check/rollback instructions to AGENTS.md
gregale mcp connect --client codex         # optional: connects hosted MCP server (in preview)
```

Export `GREGALE_TOKEN` in the environment Codex inherits instead of leaving it
only on your personal login; without a `--agent` key, Gregale treats CLI writes
as a human admin action and skips agent approvals and budget limits. If you run
Codex inside `workspace-write` sandbox mode without outbound network enabled, add
this to `~/.codex/config.toml` so the CLI can reach `api.gregale.dev`:

```toml
[sandbox_workspace_write]
network_access = true
```

## Guardrails enforced server-side

| Risk                                  | What Gregale enforces                                                                                                       |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Codex destroys or alters production   | Production creates, deletes and overrides pause for explicit human approval ([how](/articles/ai-agent-production-approval)) |
| A bad build breaks live users         | Releases step through 1% → 10% → 50% → 100% and roll back on 5xx errors (beta)                                              |
| Codex changes scaling, env or domains | `gregale mcp connection undo` reverts platform mutations logged in 7-day activity ([how](/articles/undo-ai-agent-changes))  |
| Unbounded scaling increases your bill | Per-agent budgets and `gregale scale --plan` dry-run previews cap spend ([how](/articles/ai-agent-hosting-budget))          |

## Recommended Codex command contract

```sh
gregale deploy --dry-run
gregale --non-interactive --json deploy --path . --worktree --name my-api
gregale --non-interactive --json app health my-api --errors
```

`--non-interactive --json` guarantees Codex never stalls on prompts or OAuth
tabs and always receives structured error codes on stderr.

## Sources

[Deploy with Codex](/docs/codex),
[Use Gregale from coding agents](/docs/agents),
[Best cloud platform for AI coding agents in 2026](/articles/best-cloud-for-ai-coding-agents).
