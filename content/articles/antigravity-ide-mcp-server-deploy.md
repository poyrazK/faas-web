**Connect Google's Antigravity IDE (or its `agy` CLI) to Gregale's hosted MCP server in one command (`gregale mcp connect --client antigravity`) to deploy, inspect logs, and roll back apps with server-side approval gates.** You can also scaffold and host your own scale-to-zero Streamable HTTP MCP servers for Antigravity on Gregale in Node, Python, or Go.

## Connect Antigravity IDE to Gregale's MCP server

Gregale's hosted management MCP endpoint (`https://api.gregale.dev/mcp`, in preview) gives Antigravity direct tools to inspect apps, check health, stream logs, and trigger safe rollbacks without manually copy-pasting CLI output.

```sh
curl -fsSL https://get.gregale.dev | sh
gregale login
gregale mcp connect --client antigravity
```

This adds a `gregale` entry to `~/.gemini/config/mcp_config.json` (pass `--project` to write `.agents/mcp_config.json` in your repository instead):

```json
{
  "mcpServers": {
    "gregale": {
      "serverUrl": "https://api.gregale.dev/mcp"
    }
  }
}
```

To complete OAuth sign-in:

- **In the Antigravity IDE app:** open **Customizations → Installed** and select **Authenticate** next to `gregale` under **MCP Servers**.
- **In the `agy` terminal agent:** run `/mcp` and follow the single browser authentication prompt.

## Teach Antigravity how your repo deploys (`AGENTS.md` + `GEMINI.md`)

Antigravity reads `AGENTS.md` and `GEMINI.md` from your open workspace up to the repository root across every conversation. Initialize Gregale instructions in your repo root:

```sh
gregale init --agents --name my-api
```

For headless or automated pipelines where a human cannot click a browser OAuth prompt, give the agent a scoped `--agent` key in `GREGALE_TOKEN`:

```sh
gregale key create antigravity-ci --agent
export GREGALE_TOKEN="gp_agent_..."
gregale --non-interactive --json deploy --dry-run
gregale --non-interactive --json deploy --name my-api
```

Because production guardrails (dry-run validation, 1% → 10% → 50% → 100% canary rollouts with automatic 5xx rollback, risky-action approval links, and hard spend caps) are enforced server-side in Gregale's API, Antigravity cannot bypass them even in autonomous terminal sessions.

## Host your own remote MCP server for Antigravity IDE

If you are building custom tools for Antigravity rather than managing Gregale itself, scaffold a Streamable HTTP MCP server at `/mcp`:

```sh
gregale mcp server init --path ./my-mcp        # Node.js starter
gregale mcp server init --runtime python --path ./my-mcp
gregale mcp server init --runtime go --path ./my-mcp
```

Every tool must be listed under `auth.tool_scopes` in `gregale-mcp.json` (unlisted tools are hidden and refused with `403 tool_access_denied`), and Gregale parks your MCP server at `$0` idle compute between Antigravity sessions.

## Sources

- [Deploy with Antigravity](/docs/antigravity)
- [Host an MCP server](/docs/mcp-hosting)
- [Use Gregale from coding agents](/docs/agents)
