# Migrating an existing project

Gregale reads the deployment manifests you already have. Point the scanner at a repository and it answers with a plan — the apps it would create, the managed services it will *not* provision, the crons it lifted — and nothing exists until you apply that plan.

## What the scanner understands

| Source | Detected from |
|---|---|
| Docker Compose | `compose.yaml` / `docker-compose.yml` services |
| Procfile | one workload per process line |
| Kubernetes | Deployments, CronJobs, Services in checked-in manifests |
| Render | `render.yaml` |
| Fly | `fly.toml` |
| Serverless | `serverless.yml` functions and schedules |

With none of those, the scanner falls back to workspace config, convention scan, or single-service mode.

## Scan first — it is a dry run

```
gregale scan --path . --project-slug acme-shop
```

In the console: **Import**, with a `.tar.gz` of the repo root. The plan shows each workload's class (`http`, `graphql`, `grpc`, `job`, `worker`, `server`), root directory, ports, and schedule, plus the env **keys** it references — never the values. Managed services the repo declares (Postgres, Redis, …) are listed as *not provisioned*, each with the env hint to wire your own.

The plan also states the quota verdict: observed apps and crons against your plan's limits, and whether it can be applied as-is.

## The blast radius, before it happens

The plan names every existing app it would touch, in three buckets: **will deploy** (created or updated), **unaffected**, and **skipped**. An app whose root directory moved is flagged. To leave a workload out, exclude it:

```
gregale scan --path . --exclude worker --show-affected
```

In the console: untick a workload and re-scan; the buckets update. Excluding workloads can bring an over-quota plan back under the limit — the plan says so when it does.

## Apply — one transaction

```
gregale deploy
```

after a scan, or **Apply plan** in the console, creates every app and cron in one transaction and enqueues the first builds. The scan's plan token rides along, so the server does not extract the archive twice, and the apply matches exactly the plan you previewed — same subset included.

## After the import

- Wire the *not provisioned* services: put each connection string in **Secrets** under the env hint the plan named.
- Pasting a whole `.env` file? The importer previews every key and runs the same [secret scan](/docs/rollouts) the CLI runs before packing.
- Routing, domains, and edge rules are configured per app after apply — ingress annotations and the like are deliberately ignored, and the plan's warnings say so.
