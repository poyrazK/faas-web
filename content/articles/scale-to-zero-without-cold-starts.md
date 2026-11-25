**Scale to zero without slow cold starts by waking apps from a memory
snapshot instead of booting them.** On Gregale an idle app is not shut down
and started again. About a second after its last request it pauses in memory,
stops being billed, and resumes in about a millisecond. After 10 minutes idle
it parks as a snapshot on disk, using no memory at all, and the next request
restores that snapshot with the process already running. In Gregale's
published benchmark, 100 snapshot restores of a 256 MiB app took 95 ms at the
median and 138 ms at p95, measured inside the platform.

## Why scale to zero usually means cold starts

Scaling to zero saves money because nothing runs while nobody is using the
app. The cost is the first request after an idle period. On most platforms
that request waits for a full start: a container or VM boots, the runtime
loads, the framework imports its code, opens database connections and fills
its caches. For a typical web app that takes seconds, and for a JVM app
longer. So teams turn scale to zero off and pay for an always-on instance.

## The three idle states on Gregale

| State      | When                                                     | Memory                   | Next request                                  | Billed |
| ---------- | -------------------------------------------------------- | ------------------------ | --------------------------------------------- | ------ |
| **Paused** | About a second after the last request                    | Kept, paused             | Resumes in about a millisecond, caches intact | No     |
| **Frozen** | At the app's idle timeout, on nodes that enable it       | Kept, paused             | Resumes in a few milliseconds, caches intact  | No     |
| **Parked** | After 10 minutes idle, or when the node needs the memory | None: a snapshot on disk | Restores the snapshot of the running process  | No     |

Any packet addressed to a paused app resumes it, such as a reply on a
connection the app opened. An app whose timers or background threads
keep it busy is not paused: it keeps running, and is billed, while it works.
You can declare what your app tolerates in `gregale.yaml` (`lifecycle.pause`:
`between_requests`, `when_idle` or `never`).

## What a wake restores

Gregale takes the snapshot right after your app becomes ready on deploy.
Just before the capture it sends up to 20 requests to your health check or
a warm-up path you name, so the snapshot holds a runtime that has already
loaded, compiled and connected. Every wake starts from that state, not from
`main()`. JIT runtimes gain the most: in Gregale's benchmark the first request
after a wake was 0.5–0.8 s faster on Java and within noise on Go, Node and
Python.

On Pro and Scale you can opt in to a warm snapshot, taken after an instance
has served a few requests, so wakes also skip work your framework does on
first use. Because every woken instance starts from the same memory, Gregale
repairs the guest clock and kernel entropy on each restore, and your app can
run an `after_restore` hook (in beta) to reconnect or refresh its own state.

A full cold boot happens only when a node has no usable snapshot, for
example after it dropped one from its cache. Gregale then boots, primes and
snapshots a fresh instance in the background, unbilled, so later wakes
restore again.

## The numbers, and what they cover

[Firecracker snapshot restore on SSD](/research/firecracker-snapshot-restore-ssd-2026-09-09)
measured 100 sequential restores of a 256 MiB Go app on one SSD-backed node:
95 ms at the median, 138 ms at p95 and 149 ms at worst. That is the platform
interval, between the scheduler's wake-started and wake-completed events. A
public request also includes network transit and your app's own response
time, so it takes longer. The samples, the computed distributions and the
analysis script are published with the report.

## How other platforms handle idle apps

| Platform    | What happens when idle                                                                                | First request after idle                                                                            |
| ----------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Gregale** | Pauses about a second after each request; parks as a memory snapshot after 10 minutes; on every plan  | Resumes in about a millisecond when paused; restores a snapshot when parked                         |
| Render      | Free web services spin down after 15 minutes without inbound traffic; paid instances run all the time | Spinning back up "takes about one minute"                                                           |
| Fly.io      | Machines can be stopped or suspended when the app has excess capacity                                 | A suspended Machine resumes in "a few hundred milliseconds"; a cold start "about 2 seconds or more" |
| Railway     | Opt-in Serverless sleeps a service 5 to 10 minutes after its last outbound traffic                    | No stated wake time; the first request "may return a 502 Bad Gateway"                               |
| Heroku      | Eco dynos sleep after 30 minutes; Basic and larger dynos run all the time                             | Not compared here                                                                                   |

Fly.io's suspend is the closest to Gregale's approach: it also resumes a
Machine from memory. Gregale adds the pause between individual requests,
about a second after each one, which is also when billing stops.

Sources, checked 2026-11-25 unless noted:
[Render free instances](https://render.com/docs/free),
[Fly.io autostop and autostart](https://docs.fly.io/launch/autostop-autostart),
[Railway serverless](https://docs.railway.com/reference/app-sleeping),
[Render pricing](https://render.com/pricing) and
[Heroku pricing](https://www.heroku.com/pricing/) (checked 2026-11-24).

## When to keep an instance warm anyway

A restore is fast but not free. If your app answers a request every few
seconds all day, it rarely parks and the question does not arise. If every
millisecond of the first request matters, keep instances running with
`gregale app my-api --min 1` on Pro or Scale; each one is billed like any
running instance. See [How scaling to zero works](/docs/scale-to-zero) for
every setting, and [Gregale pricing](/pricing) for what running time costs.
