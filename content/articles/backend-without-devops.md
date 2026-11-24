**A startup without a DevOps engineer should host its backend on a managed
platform that does the operations work itself: builds, safe releases and
rollbacks, database backups, TLS, scaling, isolation, alerts and cost limits.
Then the team only ships code.** Gregale is built for small teams in that
position. Run `gregale deploy` or push to GitHub, and every production release
reaches 1% of traffic first, moves up only while it is healthy, and rolls back
on its own if it starts failing. APIs, background jobs, crons, workflows,
managed PostgreSQL and object storage live on the same platform, and each app
runs in its own Firecracker microVM.

## What an ops person usually does, and what Gregale does instead

| Job                           | On Gregale                                                                                                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build and deploy              | `gregale deploy` or a push to GitHub. Gregale builds your Dockerfile, or Node, Python and Go source without one, in an isolated builder microVM                       |
| Release without breaking      | Each production release goes to 1%, 10%, 50% and then 100% of traffic and rolls back on its own on 5xx errors, crash loops or a latency regression (beta, every plan) |
| Undo a bad release            | `gregale rollback` to any earlier revision; on paid plans a rollback can also restore the managed database to that release's point in time                            |
| Databases and backups         | Managed PostgreSQL with point-in-time restore, from Hobby                                                                                                             |
| Files                         | S3-compatible object storage                                                                                                                                          |
| Domains and TLS               | Custom domains with managed certificates, on every plan                                                                                                               |
| Secrets                       | Sealed secrets, reloaded without a restart                                                                                                                            |
| Scaling                       | Idle apps pause about a second after their last request and wake in milliseconds; minimum instances and concurrency targets from Hobby                                |
| Background and scheduled work | Crons from Hobby; jobs and workflows with retries (beta, from Hobby)                                                                                                  |
| Isolation and security        | A Firecracker microVM per instance, filtered outbound traffic, and deploy scans for known vulnerabilities and leaked secrets (beta)                                   |
| Watching production           | Logs on every plan; metrics from Hobby; alerts to Slack, PagerDuty, email or webhooks (beta, from Hobby)                                                              |
| Reviewing changes             | A preview environment for every pull request, on every plan                                                                                                           |
| Keeping the bill in check     | Budgets with alerts on every plan, and a hard spend cap on paid plans                                                                                                 |

## What your team still owns

A platform takes the infrastructure off your plate, not the product:

- **Your code and its authorization.** Who may read which records is
  application logic.
- **Your data model and migrations.** Gregale runs your release command
  before a new version takes traffic and can restore a database, but the
  schema is yours.
- **Dependencies.** Deploy scans flag known vulnerabilities; upgrading them is
  your call.
- **Responding to alerts.** Automatic rollback handles a bad release. A bug
  that has been live for a week, or a slow query, still needs someone on the
  team to look.

## Other ways to run a backend without an ops team

- **Other managed platforms** such as Render, Railway, Heroku and Fly.io also
  build your code, terminate TLS and offer managed databases. Their releases
  switch all traffic to the new version once it is healthy, and rolling back
  is a manual step. See [Railway alternatives](/articles/railway-alternatives)
  and [Heroku alternatives](/articles/heroku-alternatives) for a side-by-side
  comparison.
- **A cloud provider's building blocks**, such as Google Cloud Run or AWS
  container services, give you more control. You assemble the database,
  networking, permissions, CI pipeline and monitoring yourself, and that
  assembly is the operations work a DevOps engineer would otherwise do.
- **A server or Kubernetes cluster of your own** has the cheapest raw compute,
  and makes your team responsible for patching, backups, certificate renewal,
  deploys and being on call for the machine itself.

## When Gregale is not the right fit

- You need several regions today: Gregale runs in one region.
- Your app needs a durable local disk: Gregale instances have none, so state
  belongs in managed PostgreSQL or object storage.
- Your service is busy around the clock: a fixed-price, always-on instance
  elsewhere can cost less than paying by the hour.
- You need privileged containers, Docker-in-Docker or host networking, which
  Gregale does not support.

## Pricing

Gregale's plans are Free, Hobby, Pro and Scale. Compute is billed by memory
and time, with CPU included, and only while an app is running; a paid plan
includes an allowance and stops at a spend cap you set. See
[Gregale pricing](/pricing), [Get started](/docs/quickstart), and
[Canary deploys with automatic rollback](/articles/canary-deploys) for how a
release is protected.
