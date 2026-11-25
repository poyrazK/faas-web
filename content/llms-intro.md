# Gregale

> Gregale is a backend platform for product teams without an ops team: APIs, background jobs, workflows, crons, webhooks and managed PostgreSQL in one place, with safe releases and rollbacks, every app in its own Firecracker microVM, and one command from a repository to production.

Gregale is CLI-first (`gregale deploy`), with a full web console for
everything the API can do. {{PLATFORM_AVAILABILITY}}

From a repository to a live URL, the way a coding agent does it:

```sh
{{INSTALL_COMMAND}}
gregale login        # a person signs in once; CI and agents set GREGALE_TOKEN instead
gregale guide        # task index written for agents
gregale deploy --dry-run   # what Gregale detects in this repository
gregale --non-interactive --json deploy --path . --worktree --name my-api
gregale --non-interactive --json app health my-api --errors   # after a failed deploy
gregale app update my-api --no-require-authn   # only if the owner wants it public
```

`--non-interactive` never prompts or opens a browser; errors arrive on stderr
as one JSON object with a stable `code` and exit code. The full contract,
scoped keys for agents and the Claude Code plugin are in
[Use Gregale from coding agents](https://gregale.dev/docs/agents.md).

Machine-readable entry points:

- Hosted MCP server (in preview): `https://api.gregale.dev/mcp`, with OAuth.
  `gregale mcp connect` adds it to Claude Code, Codex, Cursor, VS Code and
  other MCP clients.
- Plans and prices as JSON: [pricing.json](https://gregale.dev/pricing.json).
- HTTP API reference: [API reference](https://gregale.dev/docs/api).
- Every page in one file: [llms-full.txt](https://gregale.dev/llms-full.txt);
  the deploy-and-debug subset: [llms-small.txt](https://gregale.dev/llms-small.txt).
- New articles and research: [Atom feed](https://gregale.dev/feed.xml).

Key facts:

- The whole backend in one place: APIs and functions, background jobs,
  workflows, crons, delayed tasks, inbound webhooks, managed PostgreSQL and
  private S3-compatible object storage.
  A Compose file or a monorepo deploys as one project whose services call
  each other by name.
- Safe releases: every deploy is an immutable revision. Roll back to an
  earlier one, with managed databases restored to that release's point in
  time; release commands run migrations before traffic moves; progressive
  rollouts (beta) shift traffic in stages. See
  [Safe releases](https://gregale.dev/docs/releases.md).
- A VM per app: every instance is a Firecracker microVM, not a container in
  a shared kernel. Idle apps park and wake from a VM snapshot
  ({{RESTORE_TARGET}}). {{RESTORE_CONTEXT}}
- Runtimes: Node 22 and 24, Python 3.12 and 3.13, Go 1.24 (beta), or any
  OCI image. Builds use buildpacks (Railpack) or your Dockerfile, inside an
  isolated builder microVM.
- Included: custom domains, per-PR preview environments, edge rules, sealed
  secrets, outbound lockdown (deny-by-default egress) and structured logs.
  Queues and request tracing are in preview.
- Privacy: GDPR export and deletion are built into the product.
- Pricing: monthly plans with included compute and a spend cap you set; see
  [Plans and pricing](https://gregale.dev/docs/plans.md). Upgrade from Plans
  in the console.
