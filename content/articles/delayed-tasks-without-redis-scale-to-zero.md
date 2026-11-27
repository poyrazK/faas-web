**Schedule one-off future HTTP callbacks and delayed background jobs up to a year ahead—and cancel them atomically by ID—without provisioning Redis, BullMQ, or EventBridge rules.** On Gregale, `POST /v1/apps/{slug}/delayed-tasks` (or `gregale cron create --at`) stores future tasks durably for scale-to-zero apps and wakes your handler only when the timestamp arrives. Delayed execution is in beta on the Hobby, Pro, and Scale plans.

## Why teams deploy Redis just for delayed jobs

Many applications need one-off delayed execution more than high-throughput queue streaming: trial-ending reminders in 14 days, webhook grace periods, invoice follow-ups, or unverified-account cleanups.

On typical clouds, each common approach comes with awkward limits:

- **AWS SQS `DelaySeconds`** caps queue delays at **15 minutes** (`900` seconds), forcing teams into AWS EventBridge Scheduler or DynamoDB TTL polling loops for multi-hour or multi-day delays.
- **BullMQ / Celery on Render or Railway** requires running and paying for an always-on Redis instance plus an always-on background worker container, even when zero jobs run overnight.
- **In-process timers (`setTimeout`, `BackgroundTasks`)** vanish silently whenever an app scales to zero, restarts, or deploys a new revision.

## Schedule, inspect, and cancel delayed tasks

Schedule a delayed task from the API by passing either a relative `delay_seconds` offset or an exact `scheduled_at` RFC 3339 timestamp (**supply exactly one**, bounded up to **one year** ahead):

```http
POST /v1/apps/my-api/delayed-tasks
Idempotency-Key: trial-reminder-user-42

{"delay_seconds": 1209600, "path": "/internal/trial-reminder", "payload": {"user_id": "42"}}
```

From the CLI, use `gregale cron create --at` (or the `gregale delayed-task add` alias), and pin a deployment with `Gregale-Revision` or `Gregale-Release` headers when needed:

```sh
gregale cron create --app my-api --at 2026-12-11T09:00:00Z --path /internal/trial-reminder
gregale cron list --app my-api --one-off
gregale cron get --one-off TASK_ID
gregale cron cancel --app my-api TASK_ID
```

Test delayed task handlers locally before deploying with `gregale dev`:

```sh
gregale dev trigger delayed-task --delay 5m --path /reminders
```

## Idempotent cancellation and at-least-once delivery

- **At-least-once execution:** Gregale delivers each delayed task to your app at least once. Use the delivered invocation ID as your idempotency key inside handlers that send emails or mutate state.
- **Honest atomic cancellation:** Calling `DELETE /v1/delayed-tasks/{id}` (or `gregale cron cancel`) atomically cancels a `pending` task and is safe to retry. If the task is already dispatching or finished, Gregale leaves it untouched and returns its actual state—never falsely claiming completed work was stopped.

## Plan limits and maturity

Delayed execution (`delayed-execution`) is in **beta** on paid plans (**not available on Free**):

| Plan  | Pending delayed tasks per app (`MaxDelayedTasksPerApp`) | Max schedule horizon |
| ----- | ------------------------------------------------------: | -------------------: |
| Free  |                                                       — |                    — |
| Hobby |                                                       5 |               1 year |
| Pro   |                                                      50 |               1 year |
| Scale |                                               1,000,000 |               1 year |

Accepted delayed tasks are grandfathered if your plan later changes.

## How other platforms compare

| Approach                          | Max delay horizon         | Always-on Redis / worker required?  | Built-in atomic cancel by ID             | Scale-to-zero target |
| --------------------------------- | ------------------------- | ----------------------------------- | ---------------------------------------- | -------------------- |
| **Gregale delayed tasks**         | Up to **1 year**          | **No**                              | Yes (`DELETE /v1/delayed-tasks/{id}`)    | Native microVM wake  |
| AWS SQS `DelaySeconds`            | **15 minutes** (`900`s)   | Consumer or Lambda trigger          | No (cannot cancel individual queued msg) | Lambda               |
| AWS EventBridge Scheduler         | One-time future timestamp | No (IAM + target config required)   | Delete schedule by name                  | Lambda / ECS / API   |
| Render / Railway + Redis + BullMQ | Unlimited                 | **Yes** (managed Redis + worker)    | Via Redis job ID                         | No (worker stays up) |
| Fly.io + BullMQ / cron            | Unlimited                 | **Yes** (Redis volume + process)    | Via Redis job ID                         | Worker kept active   |
| Upstash QStash                    | Plan-dependent HTTP delay | External service + signature verify | Yes (`DELETE /v2/messages/{id}`)         | Any HTTP endpoint    |

Sources, checked 2026-11-27:
[AWS SQS Delay Queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-delay-queues.html),
[Amazon EventBridge Scheduler](https://docs.aws.amazon.com/scheduler/latest/UserGuide/what-is-scheduler.html),
[Render Background Workers](https://render.com/docs/background-workers),
[Fly.io Background Job Queues](https://fly.io/docs/app-guides/background-jobs-celery-bullmq/),
[Upstash QStash Delay](https://upstash.com/docs/qstash/features/delay).

## Pricing and docs

Delayed tasks are included on Hobby, Pro, and Scale plans with zero idle compute billed while tasks wait. See [Gregale pricing](/pricing), [Scheduled tasks (crons)](/docs/crons), [Local development (`gregale dev`)](/docs/dev), and [Delayed tasks API](/docs/api/delayed-tasks).
