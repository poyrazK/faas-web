**To deploy a Docker Compose app to production on Gregale, run `gregale deploy`
in the folder that holds your `compose.yaml`. Gregale reads the file, shows
every service it will create, and asks before it creates anything.** Each
service becomes its own app, a `postgres` container becomes a managed
PostgreSQL database, and a migration step runs before each release. You don't
rewrite the file into another config format. Any Compose key Gregale can't
apply is named in the plan with the reason, instead of being dropped silently.

## Deploy it

```bash
cd shop                  # the folder with compose.yaml or docker-compose.yml
gregale deploy --diff    # see the plan without changing anything
gregale deploy           # create or update every service, after you confirm
```

In CI, pass `--yes` instead of answering the prompt. Add `--only api,web` or
`--exclude worker` to deploy part of the project. A repository connected to
GitHub deploys the same way without a local checkout:

```bash
gregale deploy --repo octo/shop --ref main --project
```

Gregale reads `compose.yaml` or `docker-compose.yml`, plus
`compose.override.yaml` as `docker compose up` applies it.

## How your Compose file maps

| In `compose.yaml`                                                    | On Gregale                                                                                                                                |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| A service with `build:` or a stateless `image:`                      | Its own app, deployed in the same plan                                                                                                    |
| `ports:`                                                             | A public URL. The app listens on the container side of the first mapping: `"8080:3000"` sends requests to port 3000                       |
| No `ports:`, called by another service                               | An internal service with no public URL, reached at `http://<name>.internal:10081`; it parks when idle and wakes when called               |
| No `ports:`, called by no one                                        | A background worker that runs all the time                                                                                                |
| A `postgres` service                                                 | A managed PostgreSQL database named `<project>-<service>` (for example `shop-db`) on the image's PostgreSQL major, bound to your services |
| `redis`, `mysql`, `mongo`                                            | Not run as apps. The plan lists each variable that needs a value from an external provider, such as `api.REDIS_URL`                       |
| `depends_on` a step with `condition: service_completed_successfully` | The step runs as the waiting service's release command, before each release goes live                                                     |
| `environment`, `env_file`                                            | Names listed under **Needs a value**. Plain values are imported only with `x-gregale-env-import: true`                                    |
| `volumes`, `tmpfs`                                                   | A warning: no persistent volumes or bind mounts; each start gets a fresh filesystem                                                       |
| `restart`, `networks`, `configs`, `privileged`                       | A warning with the reason for each                                                                                                        |

Keep data in the managed database or in object storage, not in a volume.

## Run migrations before each release

A migration step that other services wait for keeps working:

```yaml
services:
  migrate:
    build: ./api
    command: npm run migrate
  api:
    build: ./api
    ports: ['3000:3000']
    depends_on:
      migrate:
        condition: service_completed_successfully
```

`npm run migrate` runs once before each `api` release goes live, in the `api`
image with its variables and secrets, and `migrate` is not deployed as a
service of its own.

## Set the values Compose kept in `.env`

The plan lists every variable without a value under **Needs a value**. Set them
before the first request:

```bash
gregale env set --app shop-api SMTP_HOST=smtp.example.com
gregale env set --app shop-api --interactive   # enter secret values without echoing them
```

A variable that points at the `postgres` service, such as
`DATABASE_URL: postgres://app:secret@db:5432/app`, is bound to the managed
database for you. Services call each other by name, so
`API_URL: http://api:8000` keeps working.

## How other platforms compare

| Platform    | Deploying an existing `docker-compose.yml`                                                                                                          |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Gregale** | `gregale deploy` reads it; each service becomes an app, `postgres` becomes managed PostgreSQL, migration steps become release commands              |
| **Railway** | Railway does not run `docker-compose.yml` files directly; you create a Railway service for each Compose service, and `depends_on` has no equivalent |
| **Fly.io**  | `[build.compose]` in `fly.toml` runs every service as a container inside one Machine; exactly one service can be built, and `volumes:` is ignored   |
| **Render**  | Blueprints use Render's own `render.yaml` format; we found no Compose import in Render's documentation, so you rewrite each service by hand         |

Checked against each vendor's public documentation and staff answers on
November 27, 2026:
[Railway Docker Compose guide](https://railway.com/guides/docker-compose),
[Fly.io multi-container Machines](https://docs.fly.io/machines/guides-examples/multi-container-machines/),
[Render Blueprint spec](https://render.com/docs/blueprint-spec).

## Pricing

Each Compose service counts toward your plan's app limit. Free supports a
project with one service; two or more services need Hobby ($10 a month) or
above. Managed PostgreSQL is on Hobby, Pro ($30) and Scale ($99). Web and
internal services scale to zero when idle, so you pay for the time they run;
a background worker runs, and is billed, all the time. See
[Gregale pricing](/pricing), [Deploy a multi-service app](/docs/multi-service)
and [container compatibility](/docs/container-compatibility).
