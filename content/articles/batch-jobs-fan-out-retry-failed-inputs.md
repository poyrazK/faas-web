**To process a list of files, shards or records in parallel and recover
cleanly when some of them fail, give every input its own task, keep that
input's identity across retries, and re-run only the inputs that failed.** On
Gregale, `gregale job run` with `--input`, or with a manifest of inputs in
object storage, creates one task per input, and each task runs in its own
microVM. A task finds its input in `GREGALE_INPUT_ID` and `GREGALE_INPUT_REF`.
Failed tasks retry within their budget under rules you set, and
`gregale job replay` starts a new run that contains only the inputs that
failed. Jobs are in beta, on the Hobby, Pro and Scale plans.

## The trouble with numbered tasks

When tasks only have numbers, task 7 of 400 handles "the seventh slice", and
your code maps the number to the work. When 12 of the 400 fail, someone has
to work out which items those were, and if the list changed between runs,
slice 7 is now a different item. Retries inside the run help with brief
failures; after that, you rerun everything or keep your own bookkeeping.

Gregale ties each task to a named input instead. The input's ID stays on the
task record through every retry and replay, so "which inputs failed?" is a
query, and "run them again" is one command.

## Create the job

```bash
gregale job create nightly --image registry.example/nightly@sha256:DIGEST --timeout 900 --retries 2
```

A job is an OCI image plus how to run it: here a 900-second timeout per task
and two retries. Pin the image by digest so every task, and every later
replay, runs the same code. Each task's microVM gets 256 MB unless you set
`ram_mb`, up to your plan's job limit: Hobby 512 MB, Pro 2048 MB, Scale
4096 MB.

## One task per input

For a handful of inputs, name them on the command line:

```bash
gregale job run nightly --parallelism 2 --input=shard-a=s3://my-bucket/a --input=shard-b=s3://my-bucket/b
```

For a longer list, put it in a JSON manifest in a Gregale object storage
bucket and pass its checksum:

```bash
gregale job run nightly --parallelism 2 --input-manifest-uri=obj://APP_ID/BUCKET_ID/inputs.json --input-manifest-sha256=sha256:DIGEST
```

Gregale checks the manifest's exact bytes against the SHA-256 you give, so a
file changed after you computed the digest is refused rather than run. A
manifest can be up to 16 MiB and within your plan's task limit, and the order
of its entries sets the task numbers. `--parallelism` caps how many tasks run
at once; the rest wait in the queue until a slot opens.

Inside the guest, each task reads its assignment from the environment:

| Variable                       | What it holds                             |
| ------------------------------ | ----------------------------------------- |
| `GREGALE_INPUT_ID`             | The input's ID, such as `shard-a`         |
| `GREGALE_INPUT_REF`            | Its reference, such as `s3://my-bucket/a` |
| `GREGALE_TASK_INDEX`           | The task's number, from zero              |
| `GREGALE_TASK_ATTEMPT`         | Which attempt this is, from one           |
| `GREGALE_TASK_COUNT`           | How many tasks the run has                |
| `GREGALE_OUTPUT_MANIFEST_PATH` | Where to write the task's result manifest |

Gregale treats the reference as an opaque string: your image needs its own
access to the bucket or service it points at.

## Decide what a failure means

Not every failure should be retried. A malformed record fails the same way
every time; a timeout from an upstream API may pass a minute later. Failure
rules tell Gregale which is which, by exit code or by an outcome code your
task reports:

```bash
gregale job update nightly --failure-rules \
  '{"version":1,"rules":[{"exit_codes":[65],"action":"fail_partition"},{"outcome_codes":["upstream_unavailable"],"action":"retry"}],"unmatched_failure":"retry","uncertain_outcome":"hold"}'
```

- `retry` leaves the input eligible for its remaining attempts.
  `fail_partition` records the outcome and stops retrying it.
- To report an outcome code, the task writes it into the result manifest at
  `GREGALE_OUTPUT_MANIFEST_PATH` before it exits. A mapped outcome code
  decides even when the command exits zero, so the task can say "this record
  is invalid" without inventing exit codes.
- `uncertain_outcome: hold` keeps a task whose completion receipt was lost
  for you to reconcile, instead of running it again and possibly repeating a
  side effect.
- When an input classified `retry` runs out of attempts, its last attempt is
  recorded as `dead_letter` with the reason `retry_budget_exhausted`.

By default, the other tasks keep going when one fails for good. With
`--fail-fast`, the first permanent failure cancels the tasks that have not
started; tasks already running may finish.

## Re-run only what failed

```bash
gregale job retry nightly RUN_ID 0      # one task, while it has retries left
gregale job replay nightly RUN_ID       # every failed input, as a new run
```

Once a run has finished, a replay creates a new run, linked to it, that
contains only the inputs that failed, timed out, ran out of memory or were
cancelled, each with a fresh attempt budget. Every replayed task carries `source_task_index`, so
you can trace it back to the original. A replay also requires the job's
current image to match the one the first run used, digest included: it is
for failures that might pass on another try. If the failures were a bug,
ship a fixed image and start a new run.

Whatever the platform does, the tasks themselves should be safe to run twice.
A lost completion receipt cannot tell anyone whether the write it was about
to report actually committed.

## Collect results

A task that succeeds can list its artifacts in its result manifest, with a
size and SHA-256 for each. For an artifact in Gregale object storage,
Gregale checks the stored object against that size and checksum before it
hands out a five-minute signed URL:

```bash
gregale job artifact get nightly RUN_ID 0 result
gregale job logs nightly RUN_ID 0
```

Gregale keeps the last 1 MiB of each attempt's output for your plan's log
retention: 1 day on Free, 7 days on Hobby, 30 on Pro, 90 on Scale. Write
anything you need for longer to object storage from the task.

## Run it later, or on a schedule

`--flexible` with `--eligible-at` and `--latest-start-at` lets a run start
whenever capacity is free inside a window of at most 24 hours; tasks that
have not started by the end of the window are cancelled. Flexible runs
currently cost the same as standard runs. On `gregale job create`,
`--schedule "0 3 * * *" --timezone Europe/Istanbul` creates a single-task run
at each matching time.

## How other platforms handle it

| Platform              | Fan-out                                        | How a task knows its work                                     | Retries and re-runs                                                                                                  |
| --------------------- | ---------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Gregale**           | One task per named input, or a number of tasks | `GREGALE_INPUT_ID` and `GREGALE_INPUT_REF`, plus a task index | Per-input retries with exit-code and outcome rules; `gregale job replay` re-runs only the failed inputs as a new run |
| Google Cloud Run jobs | Up to 10,000 tasks per job                     | `CLOUD_RUN_TASK_INDEX` and `CLOUD_RUN_TASK_COUNT`             | `--max-retries` from 0 to 10 per task, 3 by default; its job docs do not describe re-running only the failed tasks   |
| AWS Batch array jobs  | An array of 2 to 10,000 child jobs             | `AWS_BATCH_JOB_ARRAY_INDEX`                                   | Children can be cancelled one by one; if any child fails, the parent array job fails once all children complete      |

With a task index, the mapping from number to work item is yours to keep
stable between runs. With named inputs, Gregale keeps it for you.

Sources, checked 2026-11-27:
[Cloud Run: create jobs](https://docs.cloud.google.com/run/docs/create-jobs),
[AWS Batch array jobs](https://docs.aws.amazon.com/batch/latest/userguide/array_jobs.html).

## Pricing

Jobs are in beta, on the Hobby, Pro and Scale plans; the Free plan has no
jobs. A task's memory is capped by your plan: 512 MB on Hobby, 2048 MB on
Pro and 4096 MB on Scale. See [Gregale pricing](/pricing) and
[Jobs](/docs/jobs) for every rule.
