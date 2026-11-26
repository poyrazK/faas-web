**Host a remote MCP server on a platform that serves Streamable HTTP over
HTTPS, lets you require OAuth tokens, and allows tool calls that run for
minutes.** On Gregale, `gregale mcp server init` creates a working server in
Node, Go or Python, and `gregale mcp server deploy` puts it at
`https://<name>.gregale.app/mcp`, ready for Claude, Cursor, VS Code and other
MCP clients. Before a new version takes traffic, Gregale connects to it as an
MCP client and lists its tools; if that fails, the version already serving
keeps serving. An idle server parks and the next call wakes it. MCP hosting
is in beta, on the Hobby, Pro and Scale plans.

## What an MCP server needs from a host

- **A Streamable HTTP endpoint.** Remote MCP clients connect over HTTPS. A
  server that only speaks stdio runs on the user's machine, not on a host.
- **A way to decide who may call it.** An open server lets anyone with the
  URL use every tool. Anything that touches private data needs access tokens
  from an identity provider, checked on every request.
- **Room for slow tools.** A tool that calls a model or searches a large
  dataset can take minutes, so the host's request timeout matters, and
  streaming progress keeps clients from giving up.
- **A check before each release.** A server that starts but cannot list its
  tools breaks every client connected to it.
- **Low cost when idle.** Most MCP servers are called in bursts, by people
  and agents, and sit idle in between.

## Hosting an MCP server on Gregale

```sh
gregale mcp server init --path ./my-mcp          # Node; add --runtime go or --runtime python
cd my-mcp && npm ci && npm start                 # run it locally
gregale mcp server doctor --url http://127.0.0.1:8080/mcp --legacy
gregale mcp server deploy --path . --name my-mcp --size small
claude mcp add --transport http my-mcp https://my-mcp.gregale.app/mcp
```

Each starter comes with sample tools, a resource and a prompt, so it works
before you change anything. The Node starter is on GitHub as
[gregale-dev/mcp-server-node](https://github.com/gregale-dev/mcp-server-node)
and runs as-is at `https://mcp-server-node.gregale.app/mcp`: add that URL to
a client to try it first. `doctor` checks discovery, origin rejection,
protocol compatibility and streaming, locally or against the live URL.

The deploy builds your source and starts the new version with no traffic.
Gregale then initializes it, pings it and lists its catalog, and promotes it
only if that works. The first deploy also turns streaming on and raises the
request timeout to 300 seconds (60 seconds on Hobby, the plan's maximum); on
Scale you can raise it to 900 seconds.

## Control who can call it

A new starter is open. Before adding tools that touch private data, put the
server behind your own OAuth provider:

```sh
gregale mcp server init --path ./private-mcp \
  --auth external-oauth \
  --issuer https://identity.example.com \
  --jwks-url https://identity.example.com/jwks \
  --resource https://private-mcp.gregale.app/mcp \
  --scopes mcp:tools
```

The server then accepts only JWT access tokens from that issuer, for that
resource, with the required scopes; your provider handles sign-in and consent.
Each tool, resource and prompt can require scopes of its own, and a caller
sees only what its token allows. A tool that is not listed in the scope map is
hidden and refused. Browser origins are refused unless you list them. Your
tool code still checks that the caller owns the records it asks for.

## Keeping it healthy

- **Idle servers.** When nobody calls the server, Gregale parks it. The first
  call after a park takes longer; the calls after it run at normal speed.
- **Readiness monitoring.** A readiness policy probes the live server every
  60 seconds or more, and an alert can tell you when it stops answering.
- **Catalog changes.** `gregale mcp server lock` saves the current tool
  definitions and `gregale mcp server watch` reports changes you didn't
  review.
- **Logs and status.** `gregale logs my-mcp --follow` and
  `gregale mcp server status --app my-mcp` show what every replica is doing.

## How other platforms compare

| Platform                          | How you deploy                                                                  | Who may call it                                                                 | Worth knowing                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Gregale**                       | `gregale mcp server deploy` from a starter or your own code                     | Open, or JWT access tokens from your OAuth provider with per-tool scopes        | Each release is checked as an MCP client before it takes traffic; idle servers park (beta, Hobby+) |
| **Cloudflare Workers**            | Scaffold a Worker from Cloudflare's MCP template and deploy it to `workers.dev` | Build an authorization server with Cloudflare's Workers OAuth Provider library  | Runs on Cloudflare's Workers runtime, so the server is written for Workers                         |
| **Vercel**                        | Add an MCP route to a Next.js app with the `mcp-handler` package                | `withMcpAuth` checks bearer tokens; you bring the authorization server          | Each tool call is bounded by the function's maximum duration: 300 seconds by default, 800 on Pro   |
| **Google Cloud Run**              | Deploy a container that serves Streamable HTTP; stdio servers are not supported | Private by default: callers need the Cloud Run Invoker role, an ID token or IAP | Fits teams already on Google Cloud                                                                 |
| **AWS Bedrock AgentCore Runtime** | The AgentCore CLI, or an ARM64 container image pushed to Amazon ECR             | AWS IAM (SigV4) or OAuth                                                        | The server listens on port 8000 and answers at `/mcp`                                              |

Checked against each vendor's own documentation on November 24, 2026:
[Cloudflare remote MCP server guide](https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/),
[Cloudflare MCP authorization](https://developers.cloudflare.com/agents/model-context-protocol/authorization/),
[Deploy MCP servers to Vercel](https://vercel.com/docs/mcp/deploy-mcp-servers-to-vercel),
[Host MCP servers on Cloud Run](https://docs.cloud.google.com/run/docs/host-mcp-servers),
[Deploy MCP servers in AgentCore Runtime](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-mcp.html),
[AgentCore MCP protocol contract](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-mcp-protocol-contract.html).

## Pricing

MCP hosting is included on Gregale's Hobby, Pro and Scale plans. An MCP server
is billed like any other app: by memory and time, and only while it runs, so a
parked server costs nothing. See [Gregale pricing](/pricing) and
[Host an MCP server](/docs/mcp-hosting) for the full guide.
