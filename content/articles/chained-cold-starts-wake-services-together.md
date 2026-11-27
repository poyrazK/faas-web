**When several services scale to zero, a request that crosses them pays one
cold start per service, one after another. Gregale's service wake-ahead
removes the stacking: as soon as one service starts waking, Gregale starts
waking the services it usually calls too, so the restores overlap.** It is on
by default for services in a Gregale project and learns from your real
traffic which services to wake. Service wake-ahead is generally available.

## The problem: cold starts add up

Take `public-api → auth → billing`, all parked. Without wake-ahead:

1. A request arrives; `public-api` restores.
2. `public-api` calls `auth`, which is parked, so the call waits while `auth`
   restores.
3. `auth` calls `billing`, which waits while `billing` restores.

The user waits for three restores in a row. With wake-ahead, all three start
restoring while `public-api` is still waking, so the waits overlap instead of
adding up.

## Turn it on or off

```bash
gregale wake-ahead public-api        # show the setting and what was measured
gregale wake-ahead public-api on
gregale wake-ahead public-api off
```

The API is `GET` and `PUT /v1/apps/{slug}/service-wake-ahead` with
`{"enabled": true}`. Changes take effect within 30 seconds.

It is **on by default** for services in a project under the `project` service
policy, the default for new project services. It is off by default for other
apps and for pull-request previews. Your own choice always wins.

## What gets woken

Gregale wakes the services your app declares until it has measured which
ones your app really calls, and from then on only those:

- **Calls between services count.** After each cold wake of the app, the calls
  it makes to other services over `<slug>.svc.gregale`, and the private TCP
  connections it opens (to a database or a queue it runs as a service), in the
  next 10 seconds are recorded.
- **Until the app has woken 20 times**, the services it lists in `depends_on`
  are woken ahead, in the order they are declared.
- **From the 20th wake**, a service is woken ahead only if the app called it
  after at least half of those wakes and found it parked on at least half of
  those calls, whether it is declared or not. A declared service the app rarely
  calls stops being woken ahead.
- **At most three services per wake**, and only ones that are not already
  running. A service woken ahead can wake its own services, two levels deep, if
  it has wake-ahead on too.

`gregale wake-ahead my-api` shows what was measured: each service your app
calls after a cold wake, how often it was parked, and over the last 24 hours
how many wake-aheads were started, used, unused or failed. Restores started by
wake-ahead show the trigger `service.wake_ahead` in `gregale wake-timeline`.

## What it costs

A service woken ahead runs, and is billed like any running instance, from the
moment it wakes. If your app doesn't call it, it parks again after its idle
timeout. Wake-ahead goes through the same admission as any wake: your plan's
concurrency limit and the platform's RAM ceiling apply. Gregale skips
wake-ahead while the platform is busy (60% or more of its RAM ceiling in use)
and never stops another app to make room.

Wake-ahead matters once you run two or more services, which takes Hobby
($10 a month) or above; Free runs one app.

## How other platforms compare

| Platform             | When a sleeping service calls another sleeping service                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Gregale**          | The services it usually calls start waking with it, learned from traffic (up to three per wake, two levels deep)                             |
| **Railway**          | A sleeping service wakes when private-network traffic reaches it, so each hop waits for its own wake; users report refused first connections |
| **Fly.io**           | Fly Proxy starts a stopped Machine when a request reaches it (private apps through Flycast), one hop at a time                               |
| **Google Cloud Run** | Each service scales from zero on its own requests; keep minimum instances warm to avoid it, billed while idle                                |
| **Render**           | Free web services spin down when idle and each spins up on its own incoming request                                                          |

Checked against each vendor's public documentation on November 27, 2026:
[Railway serverless](https://docs.railway.com/deployments/serverless),
[Railway: connection refused while a service wakes](https://station.railway.com/feedback/connection-refused-when-service-sends-re-a0a97135),
[Fly.io autostart for internal apps](https://fly.io/docs/blueprints/autostart-internal-apps/),
[Cloud Run minimum instances](https://docs.cloud.google.com/run/docs/configuring/min-instances),
[Render free instances](https://render.com/docs/free).

See [Multi-service apps](/docs/multi-service#cold-starts-and-tracing) and
[Gregale pricing](/pricing).
