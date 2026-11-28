**On Gregale, `gregale app exec my-api -- <command>` runs a one-off command
against production, like `heroku run`: in a fresh VM built from the app's
live deployment, with its files, environment variables, secrets and
bindings.** The output streams back to your terminal and the CLI exits with
the command's exit code, so it works in scripts and CI. The VM never serves
traffic and is destroyed when the command ends. App tasks are in preview on
every plan, Free included.

## Run it

```bash
# A script from your repository
gregale app exec my-api -- node scripts/backfill.js --since 2026-11-01

# Framework commands
gregale app exec my-api -- python manage.py migrate
gregale app exec my-api -- bin/rails db:seed

# Pipes and variables need a shell
gregale app exec my-api --shell -- 'ls /app | wc -l'

# Stop a runaway command after five minutes
gregale app exec my-api --timeout-seconds 300 -- node scripts/reindex.js
```

| Flag                    | What it does                                                  |
| ----------------------- | ------------------------------------------------------------- |
| `--shell`               | Runs one command string through the app's shell               |
| `--timeout-seconds N`   | Stops the command after N seconds; the default is 3600        |
| `--max-output-bytes N`  | Caps the combined stdout and stderr tail that comes back      |
| `--detach`              | Returns as soon as the task is queued                         |
| `--idempotency-key KEY` | Gives a retried submission the same identity as the first one |

## What runs where

- **The same code and config as production.** The VM boots from the live
  deployment's image with its environment variables, secrets and database
  or bucket bindings, so `DATABASE_URL` points where the app's does.
- **Not on a serving instance.** The VM is never routed, parked or
  snapshotted, and it is destroyed when the command ends. A command that
  crashes takes no serving instance with it.
- **The exit code comes back.** A failing command fails the CLI with the
  same code; a timeout exits with `124`.
- **On a schedule.** For a command that runs every night, use a
  [command cron](/docs/crons#command-crons-preview): the same task, on a
  schedule, with a 10-minute timeout by default.

Interactive shells (`gregale app exec my-api -it`) are in preview and may not
be enabled for your account. The non-interactive commands on this page are
what we tested.

## What we measured

We ran commands against a Node.js test app on Gregale on 2026-11-28:

- **Time:** the first command returned in 5 s; the next three took 1.28,
  1.31 and 1.35 s from the CLI's start to its exit.
- **Configuration:** the command saw the app's environment, such as its
  `PORT`, and the deployment's files under `/app`.
- **Failures:** a command that exited with `3` made the CLI exit with `3`;
  one stopped by `--timeout-seconds 5` reported `timed_out` and exited with
  `124` after 6 s.

## How other platforms compare

| Platform    | Running a one-off command in production                                                                           |
| ----------- | ----------------------------------------------------------------------------------------------------------------- |
| **Gregale** | `gregale app exec` runs it in a fresh VM of the live deployment and returns its output and exit code              |
| **Heroku**  | `heroku run` starts a one-off dyno, billed like any dyno; detached one-off dynos run in the background            |
| **Render**  | One-off jobs are created through the API with a start command; they use the service's latest build and env vars   |
| **Railway** | `railway ssh` opens a shell in the service's container; `railway run` runs a command with the service's variables |
| **Fly.io**  | `fly ssh console -C` runs a command on a running Machine; `fly machine run --rm` starts a Machine and removes it  |

Checked against each vendor's public documentation on November 28, 2026:
[Heroku one-off dynos](https://devcenter.heroku.com/articles/one-off-dynos),
[Render one-off jobs](https://render.com/docs/one-off-jobs),
[Railway CLI](https://docs.railway.com/guides/cli),
[Fly.io ssh console](https://fly.io/docs/flyctl/ssh-console/),
[Fly.io machine run](https://fly.io/docs/flyctl/machine-run/).

## Pricing

A one-off command runs in its own VM at the app's memory and is billed like
a running instance, per second, from the moment the command starts until it
ends, under the app it belongs to. It counts toward your plan's included
GB-RAM-hours: Free, Hobby ($10 a month), Pro ($30) and Scale ($99). See
[Apps](/docs/apps#open-a-shell-in-a-fresh-app-vm),
[Billing](/docs/billing) and [Gregale pricing](/pricing).
