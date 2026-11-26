**Host Django with managed PostgreSQL on a platform that runs `manage.py
migrate` inside a pre-traffic release command with a separate migration role
and lets you roll back application code and database state together.** On
Gregale, Django apps auto-detect `manage.py` and `wsgi.py`, separate runtime
`DATABASE_URL` (no DDL privileges) from `MIGRATION_DATABASE_URL`, and recover from
bad schema changes with `gregale rollback --restore-databases`.

## Why Django migrations break standard rollbacks

Reverting Python code after a destructive `migrate` (`DROP COLUMN`, non-null
alterations, or backfills) leaves your database schema ahead of the old release.
Most PaaS platforms fix only half the problem:

- **Pre-traffic release commands (`release:`).** On Gregale, declared `release`
  commands run in a disposable one-off microVM before Gunicorn instances start
  receiving production traffic. If `python manage.py migrate --noinput` fails,
  traffic stays on the healthy release.
- **Least-privilege DB credentials.** `DATABASE_URL` connects through a
  transaction-mode pooler with data-only access; schema changes use a scoped
  `MIGRATION_DATABASE_URL` granted only during the release hook.
- **Coordinated code + PITR database recovery.** Paid plans maintain a 7-day
  continuous WAL window so `gregale rollback --restore-databases` clones Postgres
  to the timestamp immediately before the faulty migration and rebinds the rolled-back
  release cleanly.

## Configure Django for Gregale + Gunicorn

Add `gunicorn`, `dj-database-url`, and `psycopg[binary]` to `requirements.txt`,
and configure `Procfile` and `settings.py`:

```text
# Procfile
web: gunicorn mysite.wsgi:application --bind 0.0.0.0:$PORT --workers 2
release: python manage.py migrate --noinput
```

```python
# settings.py
import os
import dj_database_url

SECRET_KEY = os.environ["DJANGO_SECRET_KEY"]
DEBUG = os.environ.get("DJANGO_DEBUG") == "1"
ALLOWED_HOSTS = os.environ.get("DJANGO_ALLOWED_HOSTS", "").split(",")

DATABASES = {
    "default": dj_database_url.parse(
        os.environ.get("MIGRATION_DATABASE_URL") or os.environ["DATABASE_URL"],
        conn_max_age=0,
    )
}
DATABASES["default"]["DISABLE_SERVER_SIDE_CURSORS"] = True
```

Provision PostgreSQL with separated runtime and migration bindings:

```bash
gregale deploy --create-only --name my-django-app
gregale add postgres --app my-django-app --region <region>
gregale postgres attach my-django-app-postgres my-django-app --access migration --env MIGRATION_DATABASE_URL
gregale env set --app my-django-app DJANGO_SECRET_KEY="$(python -c 'import secrets; print(secrets.token_urlsafe(50))')" DJANGO_ALLOWED_HOSTS="my-django-app.gregale.app"
gregale deploy --name my-django-app
```

You can also inspect how coordinated code + database rollback behaves in a real
repository:

- [Deploy postgres-migration-rollback-demo on Gregale](/deploy?repo=https://github.com/gregale-dev/postgres-migration-rollback-demo)

## How Django hosting compares on migrations and rollbacks

| Platform    | Pre-traffic `migrate` hook   | Separate migration DB role      | Code rollback + DB PITR together       | Idle billing behavior         |
| ----------- | ---------------------------- | ------------------------------- | -------------------------------------- | ----------------------------- |
| **Gregale** | `release:` / release hook    | Built-in (`--access migration`) | Single command (`--restore-databases`) | Pauses ~1s after last request |
| **Heroku**  | `Procfile` `release:` phase  | Manual credentials              | Separate app + PG CLI steps            | Eco sleeps; Basic runs 24/7   |
| **Render**  | `preDeployCommand`           | Manual permissions              | Manual rollback + new DB restore       | Paid services run 24/7        |
| **Railway** | `preDeployCommand`           | Manual permissions              | Manual rollback + sibling restore      | Serverless sleeps when quiet  |
| **Fly.io**  | `fly.toml` `release_command` | Manual permissions              | Image redeploy + cluster restore       | Auto-stop/start on traffic    |

Stay on **Heroku** or **Render** when you depend on existing add-on ecosystems
or fixed monthly worker allocations. Choose **Gregale** when you want least-privilege
migration roles by default, automatic 1%→10%→50%→100% 5xx canary rollbacks,
and coordinated code + Postgres point-in-time recovery. See
[Deploy a Django app](/docs/deploy-django),
[Rollback code and database together](/articles/rollback-code-and-database), and
[PaaS rollback & recovery matrix](/research/paas-rollback-and-migration-recovery-matrix-2026-11-26).
