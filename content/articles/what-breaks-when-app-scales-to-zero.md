**When an app scales to zero, whatever it kept only on its own machine is
lost, such as files written to local disk or `/tmp` and sessions held in
memory, and timers or background loops meant to run between requests stop.**
Anything in a database, in object storage or in the platform's crons and
queues keeps working, because it lives outside the instance. On Gregale,
every wake starts from the same snapshot and parking discards the instance's
local state, so Gregale looks for the usual mistakes: it refuses stateful
base images and `VOLUME` directives when it accepts a deploy, and records an
audit row the first time an app writes to a database-shaped directory such
as `/data` or `/var/lib/postgresql`. These stateless contract checks are
generally available on every plan.

## What happens to an idle instance

1. **Paused.** About a second after the last request, with nothing in
   flight, Gregale pauses the VM in memory. Paused seconds are not billed.
   Memory, caches and open connections are intact, and the next request
   resumes the instance in about a millisecond. Timers do not run while it
   is paused. An app that declares no `pause` setting is paused only when
   that second was really idle; one that keeps itself busy keeps running and
   is billed.
2. **Parked.** If it stays idle, the instance parks: Gregale discards it, and
   the next request restores a fresh one from the app's snapshot.

By default the snapshot is taken from the deployment, right after the app
becomes ready, not from the instance that parked. So every wake starts from
the same state, whatever the last instance did, and two instances restored
at once start from the same memory. Two settings change what is in that
memory; see [What goes into the snapshot](#what-goes-into-the-snapshot).

## What breaks, and what to use instead

| What the app does                                           | What happens on Gregale                                                                                         | Use instead                                                                                        |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Saves uploads, a SQLite file or JSON to `./data` or `/data` | Gone at park; the next wake starts from the deploy's snapshot. Gregale records a `stateless.advisory` audit row | [Object storage](/docs/object-storage) for files, [managed PostgreSQL](/docs/postgres) for records |
| Writes scratch files to `/tmp`                              | `/tmp` is a tmpfs, also lost at park                                                                            | Fine within one request; anything that must last goes to storage                                   |
| Keeps login sessions in memory                              | Survive pauses, gone after a park; each instance has its own                                                    | Postgres or a hosted Redis such as Upstash. A cache you can rebuild is fine in memory              |
| Runs cleanup or heartbeats on `setInterval` or a thread     | A paused instance's timers stop; an app that keeps itself busy is not paused, and is billed while it works      | [Crons](/docs/crons)                                                                               |
| Opens a database connection at startup                      | The connection is captured in the snapshot and copied into every restored instance                              | Reopen it in an `after_restore` hook                                                               |
| Builds on a database image such as `postgres:16`            | Refused at deploy with `stateless_only_violation`                                                               | Managed PostgreSQL, or a provider you already use                                                  |

Only the first and last rows are things Gregale checks for you. The others
are design choices; the table is the list to review before you deploy.

## How Gregale catches it

**At deploy.** Gregale rejects a stateful base image when it accepts the
deployment, with `stateless_only_violation` and HTTP 422: `postgres:16`,
`mysql:8`, `redis:7`, `mongo:7`, `mariadb`, `cockroach`, `cassandra`,
`clickhouse` and the rest. A source tarball with a `VOLUME` directive, or with
top-level `data/` or `db/` directories, is rejected for the same reason.

**At runtime.** Gregale watches the state-shaped directories in every
instance: `data/` and `db/` under the app's working directory, plus `/data`,
`/db` and `/var/lib/postgresql`, `/var/lib/mysql`, `/var/lib/redis` and the
data directories of other databases. The first write to each file there
records one `stateless.advisory` audit row. The check is advisory: the app
keeps running, and the row is your signal that the data will not survive the
next park.

```bash
gregale audit list --kind-prefix stateless.advisory
gregale invocation watch --include-stateless
```

The first command lists recent rows; the second streams them live while you
exercise the app. Each file is reported once per instance, and an instance
reports at most 256 files.

**Before you sign up.** [Will it run here?](/will-it-run) reads a public
GitHub repository and says whether it would run on Gregale, without building
or deploying anything.

## What goes into the snapshot

**Priming.** Just before the snapshot is taken, Gregale sends up to 20 `GET`
requests to the app's health check path, or to `/` when it declares none, so
the snapshot holds a runtime that has already loaded and connected. Those
requests run your code. If that path writes data, sends mail or calls a paid
API, it does so up to 20 times per deploy. Declare a harmless warm-up path
instead:

```yaml
lifecycle:
  warmup:
    path: /internal/warmup
```

**Warm snapshots.** Pro and Scale apps can opt in to a second snapshot,
taken when an instance parks after it has served a few requests. It is
reused by every later wake and every instance until the next deploy, and it
carries whatever those first requests left in memory: sessions, caches,
rate-limit counters, per-user data and files under `/tmp`. An app that keeps
per-user state in memory must not use it. Apps created before 2026-11-10 on
Pro or Scale were opted in by default; turn it off with:

```bash
gregale app update my-api --no-warm-snapshot
```

## Reconnect after a restore

A connection opened at startup is captured in the snapshot, so a restored
instance must reopen it. Declare an `after_restore` hook in `gregale.yaml`:

```yaml
lifecycle:
  after_restore:
    path: /internal/after-restore
    timeout_ms: 500
```

After a restore, and after it has repaired the guest's clock and entropy,
Gregale sends one `POST` to that path on the app's loopback listener. A 2xx
answer lets the instance serve; a timeout or any other status discards it and
Gregale cold-boots a fresh one instead. The timeout is 500 ms by default and
at most 2 seconds. Check for a loopback peer and the `X-Faas-After-Restore: 1`
header in the handler: Gregale strips inbound `x-faas-*` headers at its
public proxy, so a public caller cannot fake that marker. To close the
connection before the snapshot is taken instead, add a `before_checkpoint`
hook the same way. Redeploy after changing either: existing snapshots keep
the configuration of the deployment that made them.

A Node or Python function declares the same thing as hooks in its handler
file: `init`, `beforeSnapshot` and `afterRestore` (`before_snapshot` and
`after_restore` in Python).

## Local disk is scratch space

The writable layer on each instance is real disk, bounded by your plan's
ephemeral disk ceiling, and writes to it are rate limited per plan:

| Plan          | Write rate | Operations per second |
| ------------- | ---------- | --------------------- |
| Free          | 50 MB/s    | 2,000                 |
| Hobby         | 100 MB/s   | 4,000                 |
| Pro and Scale | 200 MB/s   | 8,000                 |

Each applies after a one-time burst of 256 MiB and 20,000 operations. Use
the disk for work that ends with the request, such as unpacking an archive
or rendering a file before you upload it.

## How other platforms handle it

| Platform         | Files the app writes locally                                                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Gregale**      | Lost when the instance parks; `/tmp` is a tmpfs; stateful images are refused at deploy and writes to database-shaped directories are audited |
| Google Cloud Run | An in-memory filesystem that uses the instance's memory; data does not persist when the instance stops                                       |
| AWS Lambda       | `/tmp` of 512 MB to 10,240 MB, temporary and unique to each execution environment                                                            |
| Heroku           | An ephemeral filesystem per dyno; files are discarded when the dyno stops or restarts                                                        |

None of them keeps local files once the instance, execution environment or
dyno is gone, and neither does Gregale. What Gregale adds
is catching the mistake: at deploy for the clear cases, and with an audit
row the first time a running app writes where it looks like it expects data
to last.

Sources, checked 2026-11-27:
[Cloud Run container runtime contract](https://docs.cloud.google.com/run/docs/container-contract),
[Lambda ephemeral storage](https://docs.aws.amazon.com/lambda/latest/dg/configuration-ephemeral-storage.html),
[Heroku dynos](https://devcenter.heroku.com/articles/dynos).

## Pricing

Stateless contract checks are generally available on every plan, Free
included, and paused seconds are not billed on any plan. See
[Gregale pricing](/pricing), [Storage](/docs/storage) and
[How scaling to zero works](/docs/scale-to-zero).
