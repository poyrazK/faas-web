**A remote MCP server written with the official TypeScript SDK can check
OAuth 2.1 access tokens itself: the SDK publishes the protected resource
metadata MCP clients look for, and rejects calls without a valid token, while
your authorization server handles sign-in. On Gregale the server pauses
between calls, so idle time is not billed.** In our test, an authenticated
tool call to a server that had been parked returned its first byte in 368 ms,
and the server used 112 MB of memory.

## What the MCP spec asks of the server

The [MCP authorization spec](https://modelcontextprotocol.io/specification/latest/basic/authorization)
splits the work. Your authorization server signs users in, registers
clients and issues tokens. The MCP server is an OAuth resource server, and
it must:

- **Publish protected resource metadata** (RFC 9728), naming the
  authorization server that issues its tokens. Clients read it to find where
  to sign in.
- **Answer a call without a valid token with `401`** and a
  `WWW-Authenticate` header that points to that metadata.
- **Accept only tokens issued for itself.** The token's audience must be
  the server's own URL (RFC 8707), so a token meant for another service is
  rejected.
- **Answer `403 insufficient_scope`** when the token is valid but lacks a
  scope the call needs.

The spec says authorization servers and clients should support OAuth Client
ID Metadata Documents for client registration. Dynamic Client Registration
is deprecated and kept for older authorization servers. Check which your
provider supports.

## The server

The complete project, with tests that run it against a stand-in
authorization server, is on GitHub as
[gregale-dev/mcp-server-typescript-oauth](https://github.com/gregale-dev/mcp-server-typescript-oauth).

`package.json`:

```json
{
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "tsc",
    "start": "node dist/server.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "1.32.2",
    "express": "5.2.1",
    "jose": "6.2.12",
    "zod": "4.6.6"
  },
  "devDependencies": {
    "@types/express": "5.0.6",
    "@types/node": "24.10.1",
    "typescript": "5.9.3"
  }
}
```

A `tsconfig.json` with `"module": "nodenext"`, `"outDir": "dist"` and
`"rootDir": "src"` compiles `src/server.ts`:

```ts
import express from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import {
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthMetadataRouter,
} from '@modelcontextprotocol/sdk/server/auth/router.js';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';

const issuer = process.env.OAUTH_ISSUER!; // your authorization server
const resource = new URL(process.env.MCP_RESOURCE!); // this server's public /mcp URL
const scopes = ['mcp:tools'];

// The authorization server's own discovery document: its endpoints and keys.
const asMetadata = await fetch(new URL('/.well-known/oauth-authorization-server', issuer)).then(
  (r) => r.json()
);
const jwks = createRemoteJWKSet(new URL(asMetadata.jwks_uri));

// Accept only signed JWTs from that issuer, issued for this server.
const verifier: OAuthTokenVerifier = {
  async verifyAccessToken(token) {
    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer,
        audience: resource.href,
        algorithms: ['ES256', 'RS256'],
        requiredClaims: ['exp', 'sub'],
      });
      return {
        token,
        clientId: String(payload.client_id ?? payload.azp ?? payload.sub),
        scopes: typeof payload.scope === 'string' ? payload.scope.split(' ') : [],
        expiresAt: payload.exp,
        resource,
        extra: { sub: payload.sub },
      };
    } catch (err) {
      throw new InvalidTokenError((err as Error).message);
    }
  },
};

function buildServer() {
  const server = new McpServer({ name: 'notes-mcp', version: '1.0.0' });
  server.registerTool(
    'whoami',
    { description: 'Who the access token belongs to, and its scopes.', inputSchema: {} },
    async (_args, { authInfo }) => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify({ sub: authInfo?.extra?.sub, scopes: authInfo?.scopes }),
        },
      ],
    })
  );
  server.registerTool(
    'add',
    { description: 'Add two numbers.', inputSchema: { a: z.number(), b: z.number() } },
    async ({ a, b }) => ({ content: [{ type: 'text', text: String(a + b) }] })
  );
  return server;
}

const app = express();
app.use(express.json());
app.get('/healthz', (_req, res) => res.json({ ok: true }));

// Serves /.well-known/oauth-protected-resource/mcp (RFC 9728), which tells
// clients which authorization server issues tokens for this server.
app.use(
  mcpAuthMetadataRouter({
    oauthMetadata: asMetadata,
    resourceServerUrl: resource,
    scopesSupported: scopes,
  })
);

const auth = requireBearerAuth({
  verifier,
  requiredScopes: scopes,
  resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resource),
  expectedResource: resource,
});

// Stateless Streamable HTTP: a fresh server and transport per request, so
// any instance can answer any call, including one just woken from a snapshot.
app.post('/mcp', auth, async (req, res) => {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.listen(Number(process.env.PORT ?? 8080), '0.0.0.0');
```

What the pieces do:

- **`mcpAuthMetadataRouter`** serves the protected resource metadata at
  `/.well-known/oauth-protected-resource/mcp`.
- **`requireBearerAuth`** sends the `401` and `403` answers, with the
  `WWW-Authenticate` header the spec asks for, and passes the token's
  details to your tools as `authInfo`.
- **The verifier** uses jose to check the signature against the
  authorization server's published keys, the issuer, the expiry and the
  audience. `MCP_RESOURCE` must be the exact public URL of `/mcp`, because
  that is the audience your authorization server writes into tokens for
  this server.
- **No sessions.** With `sessionIdGenerator: undefined`, each call is
  complete on its own, so nothing is lost when an instance parks, and a
  second instance can answer the next call.

The metadata lookup assumes an issuer URL with no path. If yours has one,
such as Keycloak's `/realms/<name>`, fetch the metadata URL your provider
documents instead.

In version 2 of the TypeScript SDK, `requireBearerAuth`,
`mcpAuthMetadataRouter` and `getOAuthProtectedResourceMetadataUrl` are in the
`@modelcontextprotocol/express` package.

## Deploy

`gregale.yaml`:

```yaml
access: public
hosting:
  health: /healthz
```

`access: public` matters here. Callers present your OAuth tokens, not
Gregale API keys, and on Hobby and above an app without it asks every
caller for a Gregale API key before the request reaches your code.

```bash
gregale deploy --create-only --name notes-mcp
gregale env set --app notes-mcp OAUTH_ISSUER=https://auth.example.com MCP_RESOURCE=https://notes-mcp.gregale.app/mcp
gregale deploy
```

Gregale installs dependencies from the lockfile, runs the `build` script
and starts the app with the `start` script. Then check what an unauthenticated
client sees:

```bash
curl -si -X POST https://notes-mcp.gregale.app/mcp | grep -i www-authenticate
curl -s https://notes-mcp.gregale.app/.well-known/oauth-protected-resource/mcp
```

A tool call must finish within the app's request timeout. It is 30 seconds
for an app deployed with `gregale deploy`; Hobby allows up to 60 and Scale
up to 900:

```bash
gregale app update notes-mcp --request-timeout 60
```

Gregale's own Node starter,
`gregale mcp server init --auth external-oauth`, checks tokens the same way,
and `gregale mcp server deploy` adds a catalog check before each new version
takes traffic. See [Host an MCP server](/docs/mcp-hosting).

## What we measured

We deployed this server on Gregale on 2026-11-27. The authorization server
was a stand-in app that published RFC 8414 metadata and an ES256 key set,
and we signed the test tokens ourselves.

- **No token:** `401` with
  `WWW-Authenticate: Bearer error="invalid_token", error_description="Missing Authorization header", scope="mcp:tools", resource_metadata="https://…/.well-known/oauth-protected-resource/mcp"`.
- **A valid token issued for another resource:** `401`.
- **A valid token without `mcp:tools`:** `403` with
  `error="insufficient_scope"`.
- **A valid token:** `tools/call` for `whoami` returned the token's subject
  and scopes.
- **The metadata document:**
  `{"resource":"https://…/mcp","authorization_servers":["https://…"],"scopes_supported":["mcp:tools"]}`.
- **Memory:** 112 MB while serving.
- **Waking up:** the snapshot restore took 65 ms and the instance was
  running 115 ms into the wake. An authenticated `tools/call` returned its
  first byte at 368 ms. That includes fetching the authorization server's
  keys: jose loads them on first use, and each wake restores a snapshot
  taken before any call arrived.

## How other platforms handle MCP authorization

| Platform                          | How the server is deployed                                                      | Authorization                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **Gregale**                       | Any Node, Python or Go server, or a Dockerfile, that serves Streamable HTTP     | Your server checks tokens from your authorization server, as above              |
| **Cloudflare Workers**            | Scaffold a Worker from Cloudflare's MCP template and deploy it to `workers.dev` | Build an authorization server with Cloudflare's Workers OAuth Provider library  |
| **Vercel**                        | Add an MCP route to a Next.js app with the `mcp-handler` package                | `withMcpAuth` checks bearer tokens; you bring the authorization server          |
| **Google Cloud Run**              | Deploy a container that serves Streamable HTTP; stdio servers are not supported | Private by default: callers need the Cloud Run Invoker role, an ID token or IAP |
| **AWS Bedrock AgentCore Runtime** | The AgentCore CLI, or an ARM64 container image pushed to Amazon ECR             | AWS IAM (SigV4) or OAuth                                                        |

Sources, checked 2026-11-24:
[Cloudflare remote MCP server guide](https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/),
[Cloudflare MCP authorization](https://developers.cloudflare.com/agents/model-context-protocol/authorization/),
[Deploy MCP servers to Vercel](https://vercel.com/docs/mcp/deploy-mcp-servers-to-vercel),
[Host MCP servers on Cloud Run](https://docs.cloud.google.com/run/docs/host-mcp-servers),
[Deploy MCP servers in AgentCore Runtime](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-mcp.html).
The MCP authorization spec was checked on 2026-11-27.

## Pricing

MCP hosting is available on the Hobby, Pro and Scale plans. Hobby costs $10
a month for 5 apps with 512 MB each and 200 GB-RAM-hours. Between calls the
server pauses, and paused seconds are not billed. See
[Gregale pricing](/pricing), [Host an MCP server](/docs/mcp-hosting) and
[How scaling to zero works](/docs/scale-to-zero).
