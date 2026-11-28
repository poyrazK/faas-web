**On Gregale, `gregale debug running my-api` says why an app is still
running instead of scaling to zero: the request, connection, minimum or
background task that stopped the scheduler from parking it, with a history of
what it saw.** The scheduler checks every instance every 10 seconds; the
debugger shows the reasons from those checks, in the same words every time.
The debugger is in beta on Hobby, Pro and Scale.

## Find out why

```bash
# What is keeping it up, and what it looked like recently
gregale debug running my-api
gregale debug running my-api --since 1h --limit 50

# Each instance, its state and the wake that started it
gregale app instances my-api
gregale app wake-timeline my-api <wake-id>

# The idle timeout and minimum the scheduler is using
gregale app get my-api
```

A typical answer:

```text
Why is my-api running?
Observed at 2026-11-28T15:30:43Z
Current observed causes:
  - min_instances: An effective minimum of 1 warm instance(s) is keeping 1 idle instance(s) resident.
Configuration: idle timeout 10s; configured minimum 1; effective minimum 1
```

## Match the reason to the fix

| Reason                | What it means                                                                | What to do                                                                                |
| --------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `request_activity`    | A request is still running, or one arrived before the idle timeout ran out   | Nothing, if the traffic is real. Long requests and streams count until they finish        |
| `open_connection`     | TCP connections were open when the scheduler checked                         | The debugger lists each remote address, port and direction; close the ones you don't need |
| `tail_tasks`          | `waitUntil()` work is still running after the response                       | Shorten or move that work to a job or queue                                               |
| `min_instances`       | Your minimum keeps idle instances warm                                       | `gregale app update my-api --min 0`                                                       |
| `prewarm_floor`       | A prewarm (`POST /v1/apps/{slug}/prewarm`) raised the minimum for a while    | It lifts by itself                                                                        |
| `scale_in_cooldown`   | The scaling policy's `scale_in_cooldown_s` hasn't passed since it scaled out | Wait, or lower the cooldown in your [scaling policy](/docs/scaling-policy)                |
| `workload_mode`       | Workers, services and jobs don't park on idle requests                       | That is by design; run request-driven code as an app or function                          |
| `startup_grace`       | The instance started recently and hasn't reached its idle timeout            | Wait one idle timeout                                                                     |
| `activity_unknown`    | The scheduler is missing activity timestamps, so it keeps the instance       | Wait for the next check; tell us if it persists                                           |
| `no_blocker_observed` | Nothing is holding the instance                                              | It parks or freezes at the next check                                                     |

## Check the idle timeout first

Most "it never scales down" reports are an idle timeout doing its job. An
instance parks once it has had no requests for its idle timeout: by default
1 minute on Free and Hobby, 5 on Pro and 10 on Scale. You can set anything
from 10 seconds up to twice your plan's default:

```bash
gregale app update my-api --idle 30
```

A running instance is not always a billed one. About a second after its last
request, an idle instance is paused in memory, and paused seconds aren't
billed. At the idle timeout it is frozen (`app instances` shows `frozen`,
the dashboard `◌ sleeping`): it holds no concurrency, isn't billed, and parks
to a snapshot after 10 minutes. A frozen instance's timers stop, so if your
app must keep a heartbeat running, declare `pause: never` in `gregale.yaml`
and expect to pay for its idle timeout. See
[Scale to zero](/docs/scale-to-zero#paused-between-requests).

## What we measured

We deployed a small Node.js app on Gregale on 2026-11-28 with a 10 s idle
timeout and kept it up in different ways:

- **One request:** the debugger showed `request_activity`, then
  `no_blocker_observed` 20 s later. The instance was frozen within 16 s of
  the request.
- **An open stream:** a server-sent events stream held open for 75 s showed
  as `request_activity: 1 request(s) are currently executing`. Eighteen
  seconds after the stream closed, the debugger reported nothing holding it.
- **Idle connections the app opened:** three idle outbound HTTPS
  connections, and a connection the app wrote to every 3 seconds, did not
  keep it running. It froze about 20 s after the last request, as it did
  with no connections.
- **A minimum:** with `--min 1`, the next check reported `min_instances`,
  as in the example above. `--min 0` released it.
- **Waking up:** the next request restored the app from its snapshot in
  104 ms, and the instance was running 149 ms into the wake.

## How other platforms compare

| Platform      | What keeps an instance running                                                                                                          |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Gregale**   | Requests, open connections, `waitUntil()` work, minimums, cooldowns; `gregale debug running` names the one that applies                 |
| **Cloud Run** | Idle instances can be kept for up to 15 minutes; minimum instances stay running                                                         |
| **Fly.io**    | Fly Proxy stops Machines when a region has excess capacity, in a loop that runs every few minutes; `min_machines_running` keeps some up |
| **Railway**   | Serverless sleeps a service after 5 minutes without outbound packets, sampled, so 5 to 10 minutes; database connections and NTP count   |
| **Koyeb**     | Scales to zero after an idle period, 5 minutes by default, with no traffic and no held WebSocket or HTTP/2 stream                       |

Checked against each vendor's public documentation on November 28, 2026:
[Cloud Run instance autoscaling](https://docs.cloud.google.com/run/docs/about-instance-autoscaling),
[Cloud Run minimum instances](https://docs.cloud.google.com/run/docs/configuring/min-instance),
[Fly.io autostop and autostart](https://fly.io/docs/launch/autostop-autostart/),
[Railway Serverless](https://docs.railway.com/reference/app-sleeping),
[Koyeb Scale-to-Zero](https://www.koyeb.com/docs/run-and-scale/scale-to-zero).

## Pricing

The debugger is free on Hobby ($10 a month), Pro ($30) and Scale ($99).
Running instances are billed per second for the app's memory, and paused
and frozen seconds aren't billed. Minimum instances (`--min`) are on Pro and
Scale and are billed while they run. See [Scale to zero](/docs/scale-to-zero)
and [Gregale pricing](/pricing).
