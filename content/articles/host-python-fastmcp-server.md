**Host a Python FastMCP or Streamable HTTP MCP server on Gregale to keep full CPython 3.13 compatibility, native C packages, fail-closed tool allowlists, and `$0` idle scale-to-zero billing between agent sessions.** Many remote MCP guides force teams onto JavaScript/Pyodide edge isolates (128 MB memory caps and incomplete Python wheel support on Cloudflare Workers) or always-on containers (Render/Railway charging 24/7 even when Claude, Cursor, or Antigravity isn't calling a tool).

## Why Python FastMCP + Streamable HTTP struggles elsewhere

- **Edge isolates restrict native Python libraries:** Pyodide-based runtimes cannot run arbitrary compiled C/Rust wheels cleanly inside 128 MB isolates, whereas Gregale boots your Python 3.13 or Dockerfile service inside a dedicated Firecracker microVM.
- **Always-on containers waste budget on bursty agent traffic:** An internal MCP server used 20 times a day sits idle over 98% of the time. Gregale pauses idle instances roughly 1 second after a request finishes, parks them to disk snapshot, and wakes on the next `/mcp` call.
- **Per-tool access control shouldn't be boilerplate:** Remote MCP endpoints expose backend actions publicly over HTTPS unless locked down. Gregale verifies `gregale-mcp.json` allowlists so any tool absent from `auth.tool_scopes` stays hidden and returns `403 tool_access_denied`.

## Scaffold, lock down, and deploy a Python MCP server

```sh
# 1. Scaffold the official Python Streamable HTTP MCP starter
gregale mcp server init --runtime python --path ./my-python-mcp
cd my-python-mcp

# 2. Deploy to Gregale (runs MCP readiness verification before serving traffic)
gregale deploy --name my-python-mcp
```

Configure `auth.tool_scopes` in `gregale-mcp.json` to authorize every exposed FastMCP/Python tool explicitly:

```json
{
  "auth": {
    "tool_scopes": {
      "greet": [],
      "add": [],
      "search_records": ["records:read"]
    }
  }
}
```

## Production readiness for remote MCP

- **Protocol diagnostics & catalog monitoring:** Inspect verified tool discovery, client auth settings, and MCP readiness monitoring out of the box (available on Hobby, Pro, and Scale).
- **Secrets without code leaks:** Store database credentials or external SaaS tokens via `gregale env set` (`--restart` drains and cold-boots cleanly without snapshotting stale values) or Gregale's zero-secret outbound relay.
- **Long-running MCP Tasks (preview):** Optional PostgreSQL-backed durable MCP Tasks let heavy tool calls offload work cleanly to a Gregale worker app without timing out the HTTP client connection.

## Sources

- [Host an MCP server](/docs/mcp-hosting)
- [Python 3.13 runtime](/docs/runtime-python)
- [How scaling to zero works](/docs/scale-to-zero)
