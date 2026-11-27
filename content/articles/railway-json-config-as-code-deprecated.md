**Railway has deprecated Config as Code: the `railway.json` and
`railway.toml` files that set a service's build and deploy settings. Existing
files keep working until January 1, 2027, a hard cutoff, and new services
can no longer use them.** The replacement is Infrastructure as Code, one
`.railway/railway.ts` file for the whole project. For most teams the simplest
fix is Railway's own `railway config migrate`, which writes that file for
you. This page walks through it and the steps that can go wrong, then shows
where the same settings go if you move the service to Gregale instead.

Earlier versions of Railway's docs gave December 1, 2026 as the cutoff. On
November 27, 2026, every Railway docs page that names the date says
2027-01-01.

## What changes at the cutoff

- **The file stops being read.** Today Railway reads `railway.json` or
  `railway.toml` at every deploy and lets it override the dashboard for that
  deployment. The dashboard itself is never updated from the file. After the
  cutoff, the next deploy ignores the file, so any setting that lives only
  there, such as a start command, a pre-deploy migration, a health check or
  a cron schedule, is gone from that deploy on.
- **Config moves from deploys to an apply step.** Railway does not read
  `.railway/` during deploys. The Railway CLI compares `.railway/railway.ts`
  with your project and applies the difference when you run
  `railway config apply`, on your machine or from CI. Editing the file in a
  pull request changes nothing until that step runs.
- **One file covers more.** `railway.json` described one service.
  `.railway/railway.ts` describes the project: services, databases, volumes,
  buckets, custom domains, variables and replicas. TypeScript is generally
  available; Python and Go files are in beta.

## Migrate on Railway

With a recent Railway CLI, from the repository that holds `railway.json`:

```bash
railway login
railway link                      # pick the project and environment
railway config migrate            # preview the generated file; writes nothing
railway config migrate --apply    # write .railway/railway.ts
railway config migrate cutover    # stop the service reading railway.json
railway config plan               # read this before applying
railway config apply
```

In a monorepo, `migrate` finds every `railway.json` and `railway.toml` and
writes them into one `.railway/railway.ts`. Cutover clears the service's
Config File path, which is what makes Railway stop reading the old file. It
does not redeploy: the current deployment keeps running, and the next deploy
is the first without the old file. Once the plan looks right and you have
applied it, delete `railway.json` and push.

What to watch for:

- **Cutover is per environment.** It clears the path only in the linked
  environment. Link production, staging and any other environment in turn,
  and run cutover in each.
- **Delete the old file last.** If you push the deletion while the path is
  still set, the next build fails because the config file is not found.
- **A file with no stored path is easy to miss.** When a service's settings
  show no config file path, Railway still reads a `railway.toml` or
  `railway.json` at the service root or the repository root. Cutover does
  not list that service, so copy those settings into `.railway/railway.ts`
  and apply them before you delete the file.
- **Read the plan.** Cutover never touches a volume, but in a file that
  manages the whole project, leaving a resource out means deleting it.
  `railway config apply` deletes a volume the generated file does not
  include. Non-interactive applies need `--confirm-destructive` for any
  delete.
- **One repository per service?** Run `migrate` in each one. It writes a
  named partial (`export const partial = "<service>"`), so each repository
  manages only its own services.
- **Secrets stay out of the file.** If you import the whole project with
  `railway config pull`, existing variable values are written as
  `preserve()`, so they stay on Railway instead of in your repository.

`railway config migrate undo` restores the old Config File paths in the
linked environment, from a snapshot cutover saves in
`.railway/.cac-migration.json`.

## The same service in three files

A service built with `npm run build`, started with `npm start`, migrated
with `npm run db:migrate` before each deploy and checked at `/health`:

`railway.json`, deprecated:

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": { "buildCommand": "npm run build" },
  "deploy": {
    "startCommand": "npm start",
    "preDeployCommand": ["npm run db:migrate"],
    "healthcheckPath": "/health"
  }
}
```

`.railway/railway.ts`, its replacement:

```ts
import { defineRailway, project, service } from 'railway/iac';

export default defineRailway(() => {
  const web = service('web', {
    build: 'npm run build',
    start: 'npm start',
    preDeploy: 'npm run db:migrate',
    healthcheck: '/health',
  });

  return project('my-app', { resources: [web] });
});
```

`gregale.yaml`, if you move the service:

```yaml
access: public
hosting:
  start: npm start
  health: /health
release:
  command: npm run db:migrate
```

There is no build line: Gregale installs dependencies from the lockfile and
runs the `build` script in `package.json` when there is one. `access: public`
matters: a Railway service with a public domain is open to anyone, while a
Gregale app on Hobby and above needs a Gregale API key unless it declares
`access: public`. The file travels with your source, and Gregale applies it
on every deploy, with no separate apply step. It can also bind a managed
PostgreSQL database under `databases:`, and with `create` the deploy creates
the database when it is missing; the deploy never changes or deletes one.

## Moving the service instead

If you are rewriting the config anyway, here is where each Config as Code
setting goes on Gregale:

| `railway.json`              | Gregale                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| `build.builder`             | A `Dockerfile` at the source root is built as is; without one, Gregale detects Node, Python or Go |
| `build.dockerfilePath`      | `build.dockerfile` in `gregale.yaml`                                                              |
| `build.buildCommand`        | None needed: the Node `build` script runs; other build steps go in a `Dockerfile`                 |
| `build.watchPatterns`       | In a [project](/docs/multi-service), a push rebuilds only the services whose files changed        |
| `deploy.startCommand`       | `hosting.start`                                                                                   |
| `deploy.preDeployCommand`   | `release.command`: runs before the new version serves, while the previous one keeps serving       |
| `deploy.healthcheckPath`    | `hosting.health`                                                                                  |
| `deploy.cronSchedule`       | A [cron](/docs/crons) that calls a path on your app, or a scheduled [job](/docs/jobs)             |
| `deploy.restartPolicyType`  | None needed: an instance that stops answering three checks in a row restarts                      |
| `environments.pr` overrides | A [preview environment](/docs/preview-environments) for every pull request                        |

Then check what Gregale detects, copy the variables and deploy:

```bash
gregale deploy --dry-run
railway variables --kv | grep -v '^RAILWAY_' > railway.env
gregale deploy --name my-api --secrets-file railway.env
rm railway.env
```

Before you move, check what does not carry over. Gregale has no persistent
volumes, so state goes in [managed PostgreSQL](/docs/postgres) or
[object storage](/docs/object-storage), and it has no managed Redis, MySQL or
MongoDB. The [Railway migration guide](/docs/migrate-from-railway) covers the
database, several services and switching your domain.

## Config files compared

|                    | Railway Config as Code            | Railway Infrastructure as Code                                          | Gregale                                                      |
| ------------------ | --------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| File               | `railway.json` or `railway.toml`  | `.railway/railway.ts` (`.py` and `.go` in beta)                         | `gregale.yaml`                                               |
| Status             | Deprecated; read until 2027-01-01 | Generally available                                                     | Current                                                      |
| Scope              | One service's build and deploy    | A project environment: services, databases, volumes, domains, variables | One app and the databases it binds                           |
| When it takes hold | At each deploy                    | When `railway config apply` runs, locally or in CI                      | At each deploy                                               |
| Can it delete?     | No                                | Yes: in a whole-project file, a resource left out is deleted on apply   | No: a deploy can create a missing database, never delete one |

Sources, checked 2026-11-27:
[Railway: Config as Code](https://docs.railway.com/config-as-code),
[Railway: Config as Code reference](https://docs.railway.com/config-as-code/reference),
[Railway: Infrastructure as Code](https://docs.railway.com/infrastructure-as-code),
[Railway: Infrastructure as Code reference](https://docs.railway.com/infrastructure-as-code/reference),
[Railway CLI: railway config](https://docs.railway.com/cli/config).

## Pricing

Trying the move costs nothing: `gregale deploy --dry-run` shows what Gregale
detects before anything is uploaded. Gregale Free covers 1 app with 256 MB
and 20 GB-RAM-hours a month. Hobby costs $10 a month for 5 apps with 512 MB
each and 200 GB-RAM-hours, and includes one managed PostgreSQL database.
Compute is billed only while an instance runs. See
[Gregale pricing](/pricing) and
[Migrate from Railway](/docs/migrate-from-railway).
