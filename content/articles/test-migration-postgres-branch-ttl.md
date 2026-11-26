**To test a migration against real data without touching production, run it
on a branch: a copy of the database that shares the original's storage until
it is written to, and that deletes itself when you are done.** On Gregale,
`gregale postgres branch orders pr-42 --ttl 2h` creates the branch `pr-42`
of the managed PostgreSQL database `orders` from its latest point, a couple
of seconds before the request. You attach it to a test app, run the migration
and the tests, and two hours later Gregale removes its bindings and purges
it. The source database and the apps that use it are never changed. Branches
are on the Hobby, Pro and Scale plans.

## Why a seed database is not enough

A migration that passes against a seed file can still fail in production,
because the failure is in the data, not the schema:

- `ALTER TABLE ... SET NOT NULL` on a column that has a few old nulls.
- A unique index on a column with duplicates nobody knew about.
- A table rewrite that takes seconds on a thousand rows and most of an hour
  on forty million, holding a lock that blocks writes the whole time.

The usual fix is to `pg_dump` production into a staging database. For a
large database that takes a long time, the copy is out of date by the time
it is restored, and it is easy to forget: a forgotten copy of production is
a copy of your customers' data that nobody is watching.

## Branch, migrate, throw away

```sh
gregale postgres branch orders pr-42 --ttl 2h
gregale postgres attach pr-42 my-api-pr-42 --env DATABASE_URL
gregale postgres attach pr-42 my-api-pr-42 --access migration --env MIGRATION_DATABASE_URL
# run the migration on MIGRATION_DATABASE_URL, then the tests against pr-42
gregale postgres branch delete orders pr-42 --yes
```

1. **Branch.** `pr-42` is a new database. A branch's name is its database
   name, so it is unique in your account; with several databases, include the
   source, as in `orders-pr-42`.
2. **Attach it twice** to a test app, here `my-api-pr-42`. The default
   `read_write` access reads and writes rows but cannot `CREATE`, `ALTER` or
   `DROP` anything, so the migration tool needs a second binding with
   `--access migration`. Run it as the app's release task, as you would in
   production.
3. **Migrate and test** with the new code, against real rows. Time the
   migration too: on the same rows, it gives a first idea of how long
   production would hold its locks.
4. **Delete,** or let the TTL do it. `branch delete` purges the branch at
   once, and refuses a database that is not a branch of the one you name, so
   it cannot remove the source or an unrelated database by mistake.

A branch holds real production data, your customers' included. Give the test
app and its logs the same care as production, and keep the TTL short.

To try one destructive statement by hand, run it on the branch with
`gregale postgres sql pr-42 --write …` once the branch is attached to an app.
Without `--write`, a query runs in a read-only transaction that is always
rolled back.

## Branch from a point in the past

`--from live`, the default, takes the latest point. `--from` with a
timestamp branches from any time in the source's `restore_range`, the 7-day
restore window:

```sh
gregale postgres branch orders before-incident --from 2026-11-06T09:00:00Z --ttl 1d
```

Use it to reproduce a bug against the data as it was, or to see what a table
looked like before a bad import, without restoring or switching production.

## How a branch expires

- `--ttl` takes 5m to 30d, for example `90m`, `2h` or `7d`. `get` and `list`
  show the expiry as `expires_at`, and `gregale postgres branch list orders`
  lists the branches of `orders`.
- At that time the branch's bindings are removed and it is purged. There is
  no undo window: copy out anything you want to keep before then.
- A branch that has branches of its own is kept until they are gone. A source
  you delete while it has branches is kept until they are gone too.

## How many branches, and what they cost

A branch with a TTL of 7 days or less does not count toward your plan's
database limit. Each plan includes a number of these short-lived branches at
once; past that, branch creation is refused with
`managed_postgres_branch_limit` until you delete one or one expires.

| Plan  | Databases | Short-lived branches at once | Restore window |
| ----- | --------- | ---------------------------- | -------------- |
| Free  | —         | —                            | —              |
| Hobby | 1         | 2                            | 7 days         |
| Pro   | 3         | 5                            | 7 days         |
| Scale | 10        | 20                           | 7 days         |

The branch's compute and the data written to it count toward your plan's
usage like any database. A branch with a longer TTL, or none, is an ordinary
restore and counts toward the database limit.

## In a CI pipeline

In the API, a restore without `point_in_time` is a branch from the latest
point, and `ttl_seconds` sets its expiry. In a pull-request pipeline, create
a branch named after the pull request with a TTL a little longer than the
pipeline, run the migrations and tests, and delete it in the last step. If
the job dies halfway, the TTL still cleans up.

## How other platforms handle it

| Platform        | Copy of production data                                                                                | Cleanup                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| **Gregale**     | Branch from the latest point or any time in the 7-day restore window, on Hobby, Pro and Scale          | `--ttl` from 5 minutes to 30 days removes its bindings and purges it                                  |
| Neon            | Branches created from the parent branch's data                                                         | An expiration time of at most 30 days; branches made with the API or CLI have none unless you set one |
| Supabase        | Preview branches are data-less by default: schema from migrations, data from a seed file               | Preview branches are deleted when the pull request is merged or closed                                |
| Heroku Postgres | A fork: a snapshot at the current point, not on Essential tier; takes several minutes to several hours | Kept until you destroy it                                                                             |

Sources, checked 2026-11-27:
[Neon branch expiration](https://neon.com/docs/guides/branch-expiration),
[Supabase branching](https://supabase.com/docs/guides/deployment/branching),
[Heroku Postgres forks](https://devcenter.heroku.com/articles/heroku-postgres-fork).

## Pricing

Managed PostgreSQL, its 7-day restore window and branches are on Hobby, Pro
and Scale; the Free plan has no managed PostgreSQL. See
[Gregale pricing](/pricing) and [Managed PostgreSQL](/docs/postgres). When a
migration does reach production and goes wrong,
[Roll back a bad migration: code and database together](/articles/rollback-code-and-database)
covers the way back.
