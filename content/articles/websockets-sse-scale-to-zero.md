**Gregale is a scale-to-zero PaaS that holds persistent WebSocket and Server-Sent Events (SSE) connections at the edge via Managed Realtime without dropping clients or keeping your backend app awake.** On Gregale, Managed Realtime terminates client sockets and handles heartbeats at the edge while your backend microVM parks at zero billed compute, waking it only when a client sends a frame or your backend publishes a message.

> **Maturity:** Realtime endpoints, parked WebSocket and SSE connections, authentication and callbacks, the original protocol, live publish, direct and principal send, connection operations, and fair-use limits are in **Beta** on every paid plan. Resumable v2 (`gregale.realtime.v2`), retained history, presence, subscription tickets, `channel_rules`, and the `realtime:` section of `gregale.yaml` are in **Preview**, released per account.

## Why open sockets break scale-to-zero

On most platforms, a WebSocket or SSE connection terminates inside your application container. That keeps the process busy for hours even when nobody is sending messages. On Cloud Run, Fly.io, Render, Railway, or a self-managed WebSocket app on Gregale (`gregale app <slug> --websocket-enabled`), an open socket prevents the instance from idling down and keeps compute billing running—or forces you to pay separately for Pusher, Ably, or Liveblocks.

| Approach                           | Compute billing when idle                     | External service required                 | Starter / reference                                                                                                    |
| ---------------------------------- | --------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Gregale Managed Realtime**       | `$0` app compute while parked at the edge     | None (included on paid plans)             | [Scale-to-Zero WebSockets starter](https://github.com/gregale-dev/scale-to-zero-websockets) ([/templates](/templates)) |
| **Always-on container PaaS**       | Billed continuously while sockets remain open | None                                      | Self-managed socket server                                                                                             |
| **Stateless PaaS + Pusher / Ably** | `$0` app compute when stateless               | Separate Pusher, Ably, or Liveblocks bill | Two-vendor integration                                                                                                 |

## How Gregale separates sockets from compute

Gregale splits connection state from application execution:

- **Idle connections cost your app nothing.** Clients connect to `wss://<your-app-host>/__gregale/realtime/<endpoint-id>` (or SSE), and Gregale answers heartbeats while your microVM stays paused or parked.
- **Client frames wake the app only on activity.** On the original protocol, Gregale turns `connect`, `message`, and `disconnect` events into signed `POST` callbacks to `/realtime/connect`, `/realtime/message`, and `/realtime/disconnect` under your callback URL with `Authorization: Bearer <callback token>` (retrying timeouts, `408`, `429`, and `5xx` up to three times). Once handled, your app can idle and park again.
- **Backend publishes do not hold sockets.** Your app broadcasts with `gregale realtime publish` (or the REST API / SDK), or targets a single socket with `gregale realtime send`, and can park immediately afterward.
- **Watch out for 30-second re-auth callbacks on busy resumable channels.** For the resumable protocol (Preview), `/realtime/authorize-channel` is re-checked every 30 seconds while messages flow. Idle subscriptions call nothing, and Preview `channel_rules` authorize subscriptions directly from JWT claims without waking your app.

Use `gregale app <slug> --websocket-enabled` when your app sends high-frequency streams continuously and needs to stay awake anyway; use managed realtime when connections stay open for a long time and traffic is sparse.

## Creating an endpoint and rotating credentials

Create an endpoint with OIDC JWT verification (RS256/384/512 or ES256/384/512 against your JWKS URL) for browsers and multi-tenant apps, or `static_bearer` for trusted backend callers, piping the callback token over stdin so it stays out of shell history:

```bash
printf '%s\n' "$CALLBACK_TOKEN" | gregale realtime create my-app \
  --callback-url https://my-app.example.com \
  --callback-auth-token-stdin \
  --auth-mode oidc_jwt \
  --auth-issuer https://id.example.com \
  --auth-jwks-url https://id.example.com/.well-known/jwks.json \
  --auth-audience realtime \
  --auth-algorithm RS256 \
  --allowed-origin https://my-app.example.com
```

Once connected, inspect and push from your backend or CLI:

```bash
gregale realtime connections my-app EP_ID --principal user-123
gregale realtime subscribe my-app EP_ID CONNECTION_ID orders
gregale realtime publish my-app EP_ID orders --data '{"id":42}'
gregale realtime send my-app EP_ID CONNECTION_ID --data 'hi'
gregale realtime close my-app EP_ID CONNECTION_ID --reason "signed out"
```

Static bearer tokens rotate without downtime via `gregale realtime auth rotate`, keeping the previous token valid until a grace deadline or `gregale realtime auth finalize`. Any open connection whose token or origin is no longer valid is closed automatically with WebSocket code `1008`.

## Included limits across paid plans

Realtime has no separate per-connection or channel surcharge; delivered messages count only toward your app's monthly egress:

| Plan  | Endpoints per app / account | Concurrent connections per account |
| ----- | --------------------------: | ---------------------------------: |
| Hobby |                      2 / 10 |                                200 |
| Pro   |                     10 / 50 |                              1,000 |
| Scale |                    25 / 250 |                              5,000 |

Individual realtime nodes allow up to 512 open connections from one client IP address, and original-protocol clients can send 20 frames per second (bursts of 40) with messages up to 1 MiB.

## When another option fits better

- **High-frequency bidirectional streams:** Online games, collaborative audio/video signaling under constant load, or custom binary protocols that saturate connections every second are simpler on always-on sockets (`gregale app <slug> --websocket-enabled`) than callback hops.
- **Teams needing GA history and presence immediately:** Retained 24-hour message history, resumable cursors, presence, and channel rules are in per-account Preview on Gregale. If you need those features in production before Preview is enabled on your account, managed services such as Pusher or Ably cover them today.

See [Managed realtime](/docs/realtime), [How scaling to zero works](/docs/scale-to-zero), [Scale to zero without slow cold starts](/articles/scale-to-zero-without-cold-starts), and [Gregale pricing](/pricing) for the full configuration and limits.
