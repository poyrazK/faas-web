**A Rails 8 app generated with `rails new --database=postgresql` deploys on
Gregale from its own Dockerfile with four small changes: upload the
`vendor/` folder, start Puma directly, run `db:migrate` as a release command
with a separate migration credential, and give production one database
URL.** Rails used 257 MB of memory in our test, so it needs the Hobby plan's
512 MB; the Free plan's 256 MB is just too small, and Free has no managed
PostgreSQL anyway.

## Generate the app

```bash
rails new blog --database=postgresql --skip-solid --skip-kamal
```

- `--skip-solid` leaves out Solid Cache, Solid Queue and Solid Cable. With
  them, Rails 8 gives each its own production database next to the main one,
  and Gregale's attach gives the app a single `DATABASE_URL`.
- `--skip-kamal` leaves out Kamal's deploy configuration, which Gregale does
  not use.

Rails still writes its production `Dockerfile`, and Gregale builds from it.

## Change four things

**1. Upload `vendor/`.** Gregale leaves `vendor` folders out of every upload
by default, but the Rails Dockerfile runs `COPY vendor/* ./vendor/`, and the
build fails with `lstat /vendor: no such file or directory`. Add a
`.gregaleignore` at the project root:

```text
!vendor/
```

**2. Start Puma directly.** The Dockerfile's default command starts Thruster,
a proxy in front of Puma. Gregale already terminates HTTPS and proxies
requests to the app, so run Puma on its own, and point the health check at
Rails' built-in `/up`:

```yaml
# gregale.yaml
access: public
hosting:
  start: ./bin/rails server
  health: /up
```

Puma listens on the port in `PORT`, which Gregale sets. `access: public`
lets visitors in without a Gregale API key.

**3. Migrate in a release command.** `Procfile`:

```text
release: ./bin/rails db:migrate
```

The release command runs before a new version takes traffic. If it fails,
the previous version keeps serving.

**4. One database URL in production.** Replace the `production:` block in
`config/database.yml`:

```yaml
production:
  <<: *default
  # The release command receives MIGRATION_DATABASE_URL; serving instances do not.
  url: <%= ENV["MIGRATION_DATABASE_URL"] || ENV["DATABASE_URL"] %>
```

Gregale gives a database two kinds of credentials. `DATABASE_URL` reads and
writes rows but cannot `CREATE`, `ALTER` or `DROP` anything, and serving
instances get only that one. `MIGRATION_DATABASE_URL` can change the schema,
and only the release command receives it. So `db:migrate` runs with schema
rights, and the running app never has them.

The migration credential also connects to PostgreSQL directly, while
`DATABASE_URL` goes through a connection pooler in transaction mode. Rails
holds a session-level advisory lock while it migrates, which only a direct
connection can keep.

## Create the database and deploy

```bash
gregale deploy --create-only --name blog
gregale add postgres --app blog --region <region>
gregale postgres attach blog-postgres blog --access migration --env MIGRATION_DATABASE_URL
echo "RAILS_MASTER_KEY=$(cat config/master.key)" > ../blog.secrets
gregale deploy --name blog --secrets-file ../blog.secrets
```

`gregale add postgres` creates the database `blog-postgres` and attaches it
as `DATABASE_URL`. The attach adds the migration credential. Rails reads its
credentials with `RAILS_MASTER_KEY`, which the Dockerfile build leaves out on
purpose, so pass it to the deploy as a secret. Keep the secrets
file out of the repository.

## What we measured

We deployed a scaffolded `blog` app with a `Post` model on Gregale on
2026-11-27, with Rails 8.1.4.1 on Ruby 4.0.10:

- **It worked end to end.** The release command created the `posts` table,
  owned by the migration role. The app listed, created and showed posts
  through the read/write credential, which got
  `permission denied for schema public` when we tried to create a table
  with it.
- **Memory:** 257 MB while serving, with Puma's default 3 threads.
- **Waking up:** Gregale's wake timeline showed the instance running 130 ms
  into the wake. The first request then spent most of its time connecting to
  PostgreSQL: its first byte came at 511 ms with the database awake, and at
  1,213 ms when the database had also stopped its compute while idle.

## Things that work differently

- **Uploaded files.** Active Storage's default disk service writes to
  `storage/` on the instance. Gregale's filesystem is ephemeral, so those
  files do not survive a redeploy or reach other instances. Use an
  S3-compatible service; see
  [What breaks when your app scales to zero](/articles/what-breaks-when-app-scales-to-zero).
- **Scheduled work.** Without Solid Queue there is no recurring-job runner.
  A Gregale [cron](/docs/crons) sends an HTTP `POST` to a path on your app on
  a schedule, and wakes the app for it.
- **Logs.** Rails 8 logs to standard output in production, so
  `gregale logs blog` shows every request.

## How other platforms run Rails migrations

| Platform    | Migration step                                                                      | Credential                                             |
| ----------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **Gregale** | `release:` command, before the new version takes traffic                            | A separate migration credential the app never receives |
| Heroku      | `release:` in the Procfile, run in a one-off dyno for each new release              | The app's own database credential                      |
| Render      | Pre-deploy command `bin/rails db:migrate`; needs a paid plan, else the build script | The app's own database credential                      |
| Fly.io      | `release_command` in `fly.toml`, in a temporary Machine with the new image          | The app's own database credential                      |

Render's Free PostgreSQL databases expire 30 days after creation. A Gregale
database on Hobby has no expiry and includes a 7-day restore window.

Sources, checked 2026-11-27:
[Heroku release phase](https://devcenter.heroku.com/articles/release-phase),
[Render: deploy Rails 8](https://render.com/docs/deploy-rails-8),
[Render free instances](https://render.com/docs/free),
[Fly.io app configuration](https://fly.io/docs/reference/configuration/).

## Pricing

Hobby costs $10 a month and includes one managed PostgreSQL database, 512 MB
per app and 200 GB-RAM-hours. Between requests the app pauses, and paused
seconds are not billed. See [Gregale pricing](/pricing),
[Managed PostgreSQL](/docs/postgres) and
[Container compatibility](/docs/container-compatibility).
