**To undo a bad migration, you have to roll back two things: the code and the
database.** Most platforms roll back only the code; the database is a
separate service with its own backups, and putting it back is a manual job.
On Gregale, `gregale rollback --restore-databases` does both in one command.
It restores the managed PostgreSQL database to the moment before the
release's migration ran, as a new database, moves the app to it together with
the earlier code, and leaves the original database, with every write,
untouched. It works within the database's 7-day restore window.

## Why rolling back the code is not enough

A migration changes the schema before the new code serves. If you then roll
back only the code, the old code runs against the new schema. That is fine
when the migration only added columns or tables. It breaks when the migration
dropped or renamed a column, changed a type or rewrote data.

Gregale checks this for you. A rollback to a release older than a migration
is refused unless you acknowledge it:

```text
This rollback crosses release commands that ran after its target last served:
  v42  succeeded  started 2026-10-15T10:02:13Z
A rollback does not undo them; the target would run against their changes.
To undo database changes first, restore each database to a new one and attach it:
  gregale postgres restore 4b1e… --name orders-before-v42 --point-in-time 2026-10-15T10:02:13Z
Pass --acknowledge-releases to roll back anyway.
```

Rolling back to the release that was serving when the migration ran is not
refused: that code kept serving against the migrated schema while the new
release rolled out. If that migration itself is the problem,
`--restore-databases` undoes it too. Automatic rollbacks never go further
back than that. If undoing a failing release would put code older than a
migration back in front of users, Gregale keeps the current release serving
and tells you, so you choose between a fix and a rollback that restores the
database.

## Roll back the code and the database together

```sh
gregale rollback my-api --to v41 --restore-databases
```

Gregale names the migrations it undoes and the restore point, asks you to type
the app's name, then works in phases:

1. **Restore.** The database the app's release commands migrate is restored
   to the start of the earliest migration being undone, as a new database
   named like `orders-before-v42`.
2. **Stage and verify.** Gregale issues credentials on the copy for each of
   the app's bindings and checks them over SQL.
3. **Fence and drain.** The app stops serving; running instances stop.
4. **Switch.** The earlier release goes live and, in one transaction, the
   app's database variables point at the copy, under the same names.
5. **Resume.** The first request boots the earlier code on the restored
   database.

The app keeps serving its current release on the original database until the
copy is ready and its credentials work. Any failure before the switch, or
`gregale release rollback status my-api <id> --cancel`, puts everything back
as it was.

When the code is fine and the data is not, for example a mistaken `DELETE`
or an import that ran twice, restore the database and switch the app without
changing its code:

```sh
gregale postgres restore orders --name orders-0900 --point-in-time 2026-10-30T09:00:00Z --switch my-api
```

## What to expect

- **Writes after the restore point stay in the original database.** They are
  not copied. The original is unchanged and no longer bound to the app, so
  you can compare it with the copy and move rows by hand.
- **A short outage.** The app is unavailable from the fence until the first
  request after the switch is served: usually under a minute, plus a cold
  start.
- **One database per switch.** If release commands migrate more than one
  managed database, restore each with `gregale postgres restore` and roll back
  with `--acknowledge-releases`.
- **The restore point must be inside the 7-day restore window.** Otherwise
  the request is refused before anything changes.
- **The copy needs room in your plan.** It becomes the app's database, so it
  counts toward the plan's database limit: 1 on Hobby, 3 on Pro, 10 on Scale.
  On a plan that is full, such as Hobby with its one database, restore with
  `gregale postgres restore` (one restore may go past the limit for 7 days),
  attach the copy, and roll back the code with `--acknowledge-releases`.

## Write migrations a rollback can survive

The release it replaces keeps serving while a migration runs and during the
rollout, so the old code always meets the new schema for a while. Add columns
and tables first, and remove what the old code uses only in a later release.
A rollback to the release that was serving when the migration ran then needs
nothing extra, and `--restore-databases` is for the cases that went wrong
anyway.

## How other platforms handle it

| Platform    | What a rollback restores                                                                                                        | Database recovery                                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Gregale** | Code and config, and with `--restore-databases` the managed PostgreSQL database, in one step (needs room for one more database) | Point-in-time restore to a new database within 7 days, on Hobby, Pro and Scale                                                       |
| Heroku      | The release's slug or image and config vars; "any state stored in add-ons or externally" is not rolled back                     | Separate: reconciling add-ons after a rollback is your responsibility                                                                |
| Render      | Code only; the docs for database recovery do not cover deploy rollbacks                                                         | Point-in-time recovery for paid databases (3 days on Hobby workspaces, 7 on Pro and higher), as a new database you point services at |

On these platforms you can still get to the same place: restore the database
to a point in time, point the app at the copy, and roll back the code, by
hand and in the right order. Gregale runs those steps as one operation that
checks the copy's credentials before it switches and undoes itself if a step
fails.

Sources, checked 2026-11-25:
[Heroku releases and rollback](https://devcenter.heroku.com/articles/releases),
[Render PostgreSQL recovery and backups](https://render.com/docs/postgresql-backups).

## Pricing

Managed PostgreSQL and its 7-day restore window are on Hobby, Pro and Scale;
the Free plan has no managed PostgreSQL. A rollback that restores the database
needs room for one more database, which Pro and Scale have; on Hobby, use the
restore-then-roll-back steps above. See
[Gregale pricing](/pricing), [Safe releases](/docs/releases) and
[Managed PostgreSQL](/docs/postgres) for every rule.
