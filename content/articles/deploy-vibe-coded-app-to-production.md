**To take a vibe-coded backend built with Claude Code, Cursor, Codex, or Antigravity safely to production, deploy it on a platform whose API enforces production guardrails server-side — not inside a prompt file.** AI coding agents can ship a FastAPI, Express, Next.js, or Go app in minutes, but moving past `npm run dev` breaks in four predictable ways: infinite retry loops burning cloud bills, leaked keys or OWASP bugs, bad database migrations, and unguarded destructive CLI actions.

## Four "vibe DevOps" risks and how Gregale handles them

| Risk when deploying AI-generated code | What goes wrong on typical PaaS                                 | What Gregale enforces automatically                                                                                                                                    |
| ------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Agent retry loop burns bill**       | Uncapped usage or manual alerts hit days later                  | Default hard monthly spend caps (`$10`/`$50`/`$150` defaults) + `gregale scale --plan` cost preview + Free tier hard-stops at allowance                                |
| **Bad migration or buggy deploy**     | Broken container or unreversed Postgres schema stays live       | Every production release steps `1% → 10% → 50% → 100%` with automatic 5xx rollback (beta), and `gregale rollback --restore-databases` reverts code + Postgres together |
| **OWASP bugs & leaked keys**          | Secrets sit in plaintext env vars and scanners hit the live app | Deploy CVE + secret scanning, short-lived OIDC workload identity, zero-secret outbound relay (preview), and pre-wake OWASP WAF / browser challenge                     |
| **Agent runs destructive command**    | Personal CLI login has full delete/prod permissions             | Scoped `--agent` keys (`GREGALE_TOKEN`), human web approval links for risky production changes, and undo for non-code edits                                            |

## Recommended 3-minute production workflow

```sh
curl -fsSL https://get.gregale.dev | sh
gregale login
gregale key create vibe-agent --agent      # scoped key for the AI agent
gregale init --agents --name my-app        # writes deploy/check/rollback rules to AGENTS.md
```

Once initialized, ask your coding agent to preview before touching production:

```sh
gregale deploy --dry-run
gregale --non-interactive --json deploy --name my-app
gregale --non-interactive --json app health my-app --errors
```

You get isolated Firecracker microVMs, managed PostgreSQL (`DATABASE_URL` injected automatically as a secret), per-PR preview environments, built-in cron jobs/workflows, and OpenTelemetry request tracing with zero Kubernetes or Terraform boilerplate.

## Sources

- [Use Gregale from coding agents](/docs/agents)
- [Safe releases & database-synced rollbacks](/docs/releases)
- [Cost controls & spend caps](/docs/cost-controls)
