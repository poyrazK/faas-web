**To let Gemini CLI deploy to production safely, authenticate it with a scoped
`gregale key create --agent` token in `GREGALE_TOKEN` instead of your personal
session and point Gemini CLI to `AGENTS.md`.** Every deploy, diagnostic query,
and configuration change then runs non-interactively while Gregale's API
enforces human approval links for risky production changes, automatic 1%→100%
canary rollbacks, undo for non-code mutations, and per-agent spend limits.

## Set it up

```sh
curl -fsSL https://get.gregale.dev | sh
gregale login                               # you sign in once
gregale key create gemini-agent --agent     # dedicated key for Gemini CLI
gregale init --agents --name my-api         # updates AGENTS.md and .gemini/settings.json
```

Pass the key to Gemini CLI as `GREGALE_TOKEN` so Gregale tracks and limits agent
actions independently from your personal account. `gregale init --agents` also
writes `.gemini/settings.json` when `.gemini/` exists so Gemini CLI reads
`AGENTS.md` automatically alongside or in place of `GEMINI.md`. (Free and
Google AI Pro/Ultra individual users on Antigravity should see
[Deploy with Antigravity](/docs/antigravity); Standard/Enterprise and API-key
Gemini CLI users use `gregale mcp connect` or the CLI workflow here.)

## API-enforced safety controls

| Risk                                      | What Gregale enforces                                                                                                            |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Unintended production deletes or edits    | Risky production mutations return a review link and wait for human approval ([how](/articles/ai-agent-production-approval))      |
| Broken release or failed migration        | 1% → 10% → 50% → 100% canary auto-rollback (beta) + `rollback --restore-databases` ([how](/articles/rollback-code-and-database)) |
| Non-code setting changes outside Git      | `gregale mcp connection undo` reverses scaling, env, cron, and domain changes ([how](/articles/undo-ai-agent-changes))           |
| Unexpected scaling or plan cost increases | `gregale scale --plan` cost preview + per-agent budget ceiling ([how](/articles/ai-agent-hosting-budget))                        |

## Non-interactive CLI workflow

```sh
gregale deploy --dry-run
gregale --non-interactive --json deploy --path . --worktree --name my-api
gregale --non-interactive --json app health my-api --errors
```

All commands exit deterministically and return machine-readable JSON on stderr
on failure, avoiding browser loops or interactive confirmation hangs.

## Sources

[Deploy with Gemini CLI](/docs/gemini-cli),
[Use Gregale from coding agents](/docs/agents),
[Best cloud platform for AI coding agents in 2026](/articles/best-cloud-for-ai-coding-agents).
