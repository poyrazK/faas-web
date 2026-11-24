**Gregale is a backend platform where every production release is a canary by
default.** When you deploy a new version of an app that already serves
traffic, Gregale sends 1% of requests to it first, then 10%, 50% and 100%,
moving up only while the new version is as healthy as the one it replaces. If
it returns more 5xx errors, crash-loops, or gets slower after it reaches 100%,
Gregale rolls it back on its own and records why. There is no pipeline,
service mesh, load balancer or monitoring tool to set up: it is how
`gregale deploy` works out of the box, on every plan. Progressive rollouts are
in beta.

## How a release rolls out

1. **1% → 10% → 50% → 100%.** The new version gets a growing share of real
   traffic. The previous version keeps serving the rest.
2. **Each stage advances on evidence, not on a timer.** A stage lasts at least
   a minute and moves on once both versions have answered at least 20
   requests in it with no 5xx regression, no out-of-memory kills and no
   liveness restarts. A typical release reaches 100% in 3 to 5 minutes.
3. **Quiet apps still get a real comparison.** If an app doesn't get enough
   traffic to compare, Gregale sends `GET /` twenty times a minute to both
   versions while the rollout runs. You can point these probes at up to three
   routes that matter, such as `/healthz` or `/api/orders`.
4. **A watch after 100%.** For 30 minutes after a release takes all traffic,
   Gregale keeps comparing it with the previous release. A clear rise in 5xx
   errors or in p95 latency rolls it back automatically.

The deploy command follows the rollout live and prints each stage and why it
advanced:

```text
Rollout: 10% traffic · step 2/4 · rolling_out · advanced on synthetic probes: this release 0/30 probe 5xx, the current one 0/30
```

## What rolls a release back automatically

| Signal                         | When Gregale rolls back                                                                                                                         |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 5xx errors during the rollout  | The new version returns 5xx more often than the version it replaces                                                                             |
| 5xx errors right after release | In the first 5 minutes of traffic, at least 5 responses are 5xx and they are at least half of the release's requests (checked every 15 seconds) |
| Crash loop                     | Its liveness probe restarts the new version twice, and more than twice as often as the previous version, even with no traffic                   |
| Regression after 100%          | A clear 5xx or p95 latency regression within 30 minutes of reaching 100%                                                                        |

A route that was already failing does not count against a release: if the
previous version returned the same 5xx for the same method and route in the
last 24 hours, it is left out. Old bugs don't block new releases.

Every decision is recorded with its evidence (request, 5xx, probe, latency,
out-of-memory and restart counts for both versions). `gregale release summary`
shows it, the API returns it on the deployment, and the `rollout.completed` and
`rollout.aborted` webhooks carry it.

## Commands

```bash
gregale deploy                          # production release: safe rollout by default
gregale deploy --rollout fast           # 5% -> 50% -> 100%, a minute each
gregale deploy --rollout immediate      # all traffic at once
gregale release canary simulate my-api --canary-preset balanced   # preview a ladder against recent traffic
gregale app my-api --release-probe-paths /healthz,/api/orders     # what quiet-app probes request
gregale release summary <id>            # why the rollout advanced, waited or rolled back
gregale rollback my-api                 # back to the previous release; no rebuild
```

Ladders: `adaptive` (1/10/50/100, the default), `aggressive` (5/50/100, a
minute each), `balanced` (1/10/50/100, 2 minutes each), `slow` (1/10/100,
5 minutes each), or your own stages, for example `5@1m,25@5m,100@0s`. See
[Progressive rollouts](/docs/rollouts) for every rule.

Safe rollouts apply to production releases of apps that already serve
traffic, whether they come from the CLI, the GitHub App, `gregale project
apply`, the API or Terraform. First deploys and pull-request previews go out
directly, and worker, job and service apps keep their own rollout behavior.

## The rest of the release toolkit

- **Manual rollback in seconds.** `gregale rollback` reuses the previous
  build instead of rebuilding, waits until it actually serves again, and
  reports how long it took. Every rollback, automatic or manual, has a receipt.
- **Rollbacks that include the database.** On paid plans,
  `--restore-databases` rolls back the code and the managed Postgres database
  together, to the moment before the release's migrations ran.
- **Sticky users.** Send a `Gregale-Version-Key` header to keep one user on
  one version while a rollout runs.
- **Dark deploys.** `--no-traffic` stages a new version beside the live one
  without sending it any requests.
- **Approvals, freezes and schedules.** Require approvals before a release
  goes out, freeze releases for a window (or automatically after a rollback),
  and schedule a release for 02:00. See [Release controls](/docs/release-controls).
- **In preview:** release gates that abort or roll back a release on SLO burn
  rate, new error groups, a synthetic check, AI call cost or a business metric
  such as orders per minute; alert rules that hold or roll back a rollout; and,
  on Pro and Scale, mirroring a share of live requests to a dark version to
  compare its answers before it serves anyone.

## How other platforms compare

| Platform                          | Percentage canary built in                                                                       | Automatic rollback on errors                                                                                                                                                                   | What you set up                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **Gregale**                       | Yes, on by default for production releases (1% → 10% → 50% → 100%; beta)                         | Yes: 5xx rate, crash loops, p95 latency                                                                                                                                                        | Nothing; optional probe paths                          |
| **Heroku**                        | No. Preboot runs old and new dynos side by side for a few minutes before switching               | No; `heroku rollback` is manual                                                                                                                                                                | Enable preboot per app                                 |
| **Render**                        | No. Zero-downtime deploys with health checks                                                     | A failed health check keeps the old version live; after that, rollback is one-click or API. Render's own guide builds canaries with Cloudflare traffic weights and an external workflow engine | DNS-level traffic weights, a workflow tool, monitoring |
| **Railway**                       | No. Checks a health endpoint before switching                                                    | A failed health check aborts the deploy; no rollback on errors after it                                                                                                                        | Health check path                                      |
| **Fly.io**                        | Partly. `--strategy canary` boots one new Machine, health-checks it, then does a rolling restart | Health checks gate the deploy; no error-rate rollback after it                                                                                                                                 | Health checks in `fly.toml`                            |
| **Google Cloud Run**              | Manual percentage split between revisions; Cloud Deploy adds canary phases                       | Rollback is a manual traffic shift, or your own pipeline logic                                                                                                                                 | A Cloud Deploy pipeline and verify jobs, or scripts    |
| **AWS (ECS/Lambda + CodeDeploy)** | Yes, canary and linear deployment configurations                                                 | Yes, on CloudWatch alarms you define                                                                                                                                                           | CodeDeploy application, deployment groups, alarms      |

Checked against each vendor's public documentation on November 24, 2026:
[Heroku preboot](https://devcenter.heroku.com/articles/preboot),
[Heroku releases](https://devcenter.heroku.com/articles/releases),
[Render canary guide](https://render.com/blog/blue-green-deployments-on-render-with-canary-traffic-splitting),
[Railway feature request](https://station.railway.com/feedback/rolling-releases-canary-deployments-6c105072),
[Fly.io deploys](https://fly.io/docs/launch/deploy/),
[Cloud Run traffic migration](https://docs.cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration),
[Cloud Deploy canary](https://docs.cloud.google.com/deploy/docs/deployment-strategies/canary/cloud-run),
[AWS CodeDeploy deployment configurations](https://docs.aws.amazon.com/codedeploy/latest/userguide/deployment-configurations.html).

## Pricing

Canary rollouts and automatic rollback are included on every Gregale plan,
including Free. Gregale's plans are Free, Hobby, Pro and Scale; see
[Gregale pricing](/pricing). The quiet-app probes are ordinary requests and
count as running time: about 0.09 GB-RAM-hours for a quiet rollout of a
256 MB app.
