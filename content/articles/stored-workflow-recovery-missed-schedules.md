**Diagnose, preview, and safely resume failed multi-step workflows—and catch up on missed schedules cleanly—without re-running completed steps or writing ad-hoc backfill scripts.** When a downstream payment or webhook provider goes down for an hour, Gregale lets you inspect exact blockers, preserve completed steps, and drain controlled recovery batches.

## Why workflow failures turn into manual incident scripts

In simple queue setups, a transient third-party outage leaves hundreds of multi-step workflows half-finished in a dead-letter table. Re-running from the start risks charging cards or provisioning resources twice, while editing raw database state to skip completed steps risks corrupting production data. Meanwhile, missed cron schedules either get lost silently or trigger a thundering herd when systems recover.

## Inspect, verify safety, and resume failed workflow runs

Before mutating state, inspect any failed or dead workflow run and check exact recovery eligibility and reopened steps:

```sh
gregale workflow diagnose 00000000-0000-4000-8000-000000000001
gregale workflow resume 00000000-0000-4000-8000-000000000001 \
  --expected-resume-count 0 --idempotency-key invoice-batch-resume-1
```

- **Preserves completed work:** Successful steps keep their stored results and batch progress resumes at the failed item, up to `16` resumptions per run, pinned to the original handler deployment rather than new unreviewed code.
- **Safety fences before execution:** Compare-and-swap generation fencing (`expected_resume_count`) stops duplicate concurrent continuations, while typed diagnostic blockers (such as `unsafe_mutation`, `pinned_deployment_unavailable`, or `active_run_quota`) refuse resuming mutations without declared provider idempotency.

## Recover missed schedules and batch outages under rate limits

Avoid both lost nightly jobs and post-outage stampedes with bounded schedule catch-up and rate-limited server recovery jobs:

```yaml
trigger:
  type: schedule
  schedule: '0 7 * * *'
  timezone: Europe/Istanbul
  catch_up: latest # skip (default) or run only the newest missed fire
  catch_up_window: 2h # 1m to 24h (default 1h)
```

For large outages across many workflows or retained events, preview candidates and launch a durable server-managed recovery job that continues even after your terminal disconnects:

```sh
gregale workflow stored recovery-preview --app billing --name paid-invoice \
  --from 2026-10-01T00:00:00Z --until 2026-10-02T00:00:00Z
gregale workflow stored recover --app billing --name paid-invoice \
  --run RUN_UUID:2 --idempotency-key outage-batch-1 --plan-out recovery.json
gregale workflow stored recovery create --plan recovery.json --rate 2 --reason "incident recovery"
```

- **Pause, throttle, and retry failed recoveries:** Operators can `pause`, `resume`, `update --rate`, or `cancel` running recovery batches (`24`-hour execution window, `30`-day retention) and subscribe to `event_recovery.execution_finished`, `stored_workflow_failures`, and `stored_workflow_backlog` alerts on Hobby and higher plans.
- **Individual skipped schedule replay:** Preview and replay up to `20` missed occurrences explicitly via `gregale workflow schedule replay --app reports --occurrence-id ...`.

## Tradeoffs and preview status

Stored workflow execution and recovery workflows are currently preview capabilities on Hobby, Pro, and Scale plans, and recovery preserves original inputs and workflow definitions—so if a run failed due to a bug in the workflow definition itself, fix the definition and start a new run rather than resuming the broken snapshot.

See [Recover stored workflow runs](/docs/stored-workflows-recovery), [Build stored workflows in Gregale](/docs/stored-workflows), [Event-driven workloads](/docs/event-driven), [Write durable workflows that sleep for months without a running VM](/articles/durable-code-workflows-scale-to-zero), and [Gregale pricing](/pricing).
