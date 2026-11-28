**On most scale-to-zero platforms, an open WebSocket keeps the instance
running and billed, so an app with connected but quiet users never scales to
zero.** Cloud Run treats an instance with any open WebSocket as active. Fly.io
stops the last running Machine only when it has no traffic. Railway's
Serverless setting waits for 5 to 10 minutes without outbound traffic, and
Vercel keeps an instance's memory billable until its connections close. Three designs avoid this: Cloudflare Durable Objects
with the WebSocket Hibernation API, Amazon API Gateway WebSocket APIs, and
Gregale managed realtime. Each holds the connection somewhere other than your
running code.

_Gregale publishes this page. Every limit and price names its vendor and comes
from that vendor's own docs or pricing page, checked on November 28, 2026._

## At a glance

| Platform                                     | Where the open connection lives                  | Cost while a client is connected but quiet                                  | Connection limits                                                   |
| -------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Gregale managed realtime**                 | Gregale's edge; your app is parked               | No app compute; delivered messages count toward the app's egress            | Hobby: 200 concurrent connections per account; messages up to 1 MiB |
| **Cloudflare Durable Objects (Hibernation)** | A Durable Object, evicted from memory while idle | No duration charge while it can hibernate; protocol pings are free          | Hibernation covers WebSocket servers only; timers keep it awake     |
| **Amazon API Gateway WebSocket APIs**        | API Gateway; Lambda runs once per message        | $0.25 per million connection minutes and $1.00 per million messages         | 2 hours per connection, closed after 10 idle minutes                |
| **Google Cloud Run**                         | Your container instance                          | The instance stays active and is billed with instance-based billing         | The request timeout: 5 minutes by default, up to 60                 |
| **Fly.io**                                   | Your Machine                                     | The Machine keeps running, billed by the second                             | Fly Proxy stops the last Machine only when it has no traffic        |
| **Vercel Functions** (beta)                  | A function instance                              | Provisioned Memory for the instance's lifetime; Active CPU only on messages | 300 seconds on Hobby; 800 on Pro, or 1,800 in the extended beta     |
| **Railway**                                  | Your service                                     | The service stays awake while it sends traffic, heartbeats included         | Sleeps 5 to 10 minutes after its last outbound traffic (Serverless) |

## One quiet client, connected all month

What a single client that stays connected for 30 days and sends nothing costs,
not counting a plan's base price:

- **Cloudflare Durable Objects:** with the Hibernation API, close to nothing.
  Connecting is one request, the runtime answers pings without waking the
  object, and an object that can hibernate is not billed for duration.
- **Amazon API Gateway:** 43,200 connection minutes is about a cent. The client
  reconnects at least every 2 hours, and sends a heartbeat at least every 10
  minutes to avoid the idle timeout.
- **Gregale:** no compute. The app stays parked, and the connection uses 1 of
  the 200 that Gregale Hobby ($10 a month for 5 apps) allows per account.
- **Fly.io:** the Machine never stops: $2.19 a month for a 256 MB
  shared-cpu-1x Machine.
- **Railway:** the service never sleeps: about $3.50 a month for one averaging
  256 MB and 0.05 vCPU.
- **Cloud Run:** one instance stays active all month, billed at instance-based
  rates, and the client reconnects at least every 60 minutes.
- **Vercel:** the connection closes at the function's maximum duration, so the
  client reconnects every 5 minutes on Hobby, and the instance's memory is
  billed the whole time.

At one connection, Cloudflare and API Gateway are the cheapest. The cost of the
other designs grows with the hours connected, not the messages sent.

## What each design asks of your code

- **Cloudflare Durable Objects** run on Workers. Accept the socket with
  `state.acceptWebSocket()` rather than `accept()`, which would bill duration
  for the whole connection. Keep per-connection state with
  `serializeAttachment()`, because in-memory state is reset when the object is
  evicted. Avoid `setTimeout` and `setInterval`, which stop it from
  hibernating. Incoming messages are billed as requests at a 20:1 ratio;
  outgoing messages are free.
- **Amazon API Gateway** turns `$connect`, `$disconnect` and each message into
  an integration call, usually to Lambda. Your backend sends to a client
  through API Gateway's `@connections` API, so it has to keep each client's
  connection ID. Frames are at most 32 KB and messages 128 KB.
- **Gregale managed realtime** keeps your app an ordinary HTTP service: connect,
  message and disconnect arrive as signed `POST` callbacks, and the app
  publishes to channels with the CLI, the API or an SDK, then parks again. It
  is in beta on every paid plan.
- **Cloud Run, Fly.io, Railway and Vercel** run a normal WebSocket server, such
  as `ws` or Socket.IO, inside your instance. Clients need reconnect logic, and
  several instances need a shared channel such as Redis Pub/Sub to reach each
  other's clients. Cloud Run gives best-effort session affinity and up to
  1,000 concurrent connections per container.

## Server-Sent Events

SSE is a long HTTP response, so on Cloud Run, Fly.io, Railway and Vercel it
keeps an instance busy as a WebSocket does, and Cloud Run's request timeout and
Vercel's maximum duration end it the same way. Browsers reconnect an `EventSource` on their own and send
`Last-Event-ID`, so the reconnects are easier than with WebSockets. Durable
Objects hibernate only as WebSocket servers. Gregale's realtime edge holds
SSE connections the same way as WebSockets, with the app parked.

## Which one to pick

- **Already on Cloudflare Workers:** Durable Objects with the Hibernation API.
  It is the cheapest way to keep many quiet sockets open.
- **Already on AWS:** API Gateway WebSocket APIs with Lambda, if your clients
  can reconnect every 2 hours and send heartbeats.
- **An existing container app that should keep scaling to zero:** Gregale
  managed realtime. The app stays an HTTP service in any language, and the
  sockets live at the edge.
- **Constant, high-frequency streams, such as game state:** an always-on
  instance on Fly.io, Railway or Cloud Run. The instance would be busy anyway,
  so scale to zero saves nothing.
- **Short streams, such as AI responses:** Vercel Functions or Cloud Run. Their
  time limits matter less when each stream ends in minutes.

## Gregale managed realtime

Gregale's realtime service holds the client's WebSocket or SSE connection
instead of your app. It answers heartbeats while the app is parked, turns each
client frame into a `POST` to your `/realtime/message` callback, and delivers
what your backend publishes. Realtime has no separate charge: delivered
messages count toward the app's monthly egress.

| Plan  | Endpoints per app / account | Concurrent connections per account |
| ----- | --------------------------: | ---------------------------------: |
| Hobby |                      2 / 10 |                                200 |
| Pro   |                     10 / 50 |                              1,000 |
| Scale |                    25 / 250 |                              5,000 |

Managed realtime is not on Gregale Free. An app can also serve WebSockets
itself with `gregale app <slug> --websocket-enabled`, and then it stays running,
and billed, while any connection is open. See
[Hold WebSocket and SSE connections while your backend scales to zero](/articles/websockets-sse-scale-to-zero)
for the setup.

## Sources

Checked against each vendor's own pages on November 28, 2026:
[Cloudflare Durable Objects WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/),
[Cloudflare Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/),
[Amazon API Gateway pricing](https://aws.amazon.com/api-gateway/pricing/),
[API Gateway WebSocket quotas](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-execution-service-websocket-limits-table.html),
[Cloud Run WebSockets](https://cloud.google.com/run/docs/triggering/websockets),
[Fly.io autostop and autostart](https://fly.io/docs/launch/autostop-autostart/),
[Fly Proxy autostop](https://fly.io/docs/reference/fly-proxy-autostop-autostart/),
[Fly.io resource pricing](https://fly.io/docs/about/pricing/),
[WebSockets on Vercel Functions](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections),
[Railway Free plan](https://docs.railway.com/pricing/free-plan),
[Railway plans](https://docs.railway.com/pricing/plans),
[Gregale managed realtime](/docs/realtime) and
[Gregale plans](/docs/plans).
