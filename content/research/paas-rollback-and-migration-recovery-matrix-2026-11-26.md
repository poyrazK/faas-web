## Results

Across **8 verifiable release-safety and PostgreSQL recovery controls** (`2` = full built-in enforcement, `1` = partial or separate manual tooling required, `0` = not provided; **16 points maximum**), **Gregale scores 16/16** (`8` full), followed by **Heroku (`11/16`)**, **Google Cloud Run (`10/16`)**, **Render (`8/16`)**, **Railway (`8/16`)**, **DigitalOcean App Platform (`7/16`)**, **Fly.io (`7/16`)**, and **AWS App Runner (`5/16`)**.

Most modern PaaS platforms now ship **managed PostgreSQL point-in-time recovery (`8/8` full)** and **pre-traffic migration commands (`6/8` full, `1/8` partial)**, as well as **immutable build rollbacks (`5/8` full, `3/8` partial)**. Where platforms diverge sharply is what happens after a broken release or destructive schema migration reaches live traffic: **default 5xx canary auto-rollback (`1/8` full)**, **coordinated code + Postgres rollback in one step (`1/8` full)**, **release freezes & approval gates (`1/8` full)**, and **immutable staging-to-production digest promotion (`2/8` full)**.

This evaluation is a **published-documentation matrix checked on November 26, 2026**, not a benchmark of uptime, query throughput, or global edge placement (areas where Google Cloud Run, Fly.io, Heroku, Render, Railway, DigitalOcean, and AWS App Runner lead Gregale outside these 8 controls). Every score is computed deterministically by `analyze.py` from `criteria.json` and `vendors.json`.

| Platform                      | Score | Full | Partial | None | Strengths outside rollback & recovery controls                                             |
| ----------------------------- | ----: | ---: | ------: | ---: | ------------------------------------------------------------------------------------------ |
| **Gregale**                   | 16/16 |    8 |       0 |    0 | ~1s idle pause billing, Firecracker microVM isolation, scoped agent keys, free PR previews |
| **Heroku**                    | 11/16 |    5 |       1 |    2 | Mature buildpack/add-on ecosystem, integrated release-var slugs and Pipelines              |
| **Google Cloud Run**          | 10/16 |    3 |       4 |    1 | Global GCP regions, generous monthly free tier, VPC, IAM, Cloud SQL and BigQuery           |
| **Render**                    |  8/16 |    3 |       2 |    3 | Flat monthly instance pricing, $6/mo entry managed Postgres, zero seat fees on Hobby       |
| **Railway**                   |  8/16 |    3 |       2 |    3 | Multi-database canvas (Postgres/Redis/MySQL/MongoDB), usage-based billing and Serverless   |
| **DigitalOcean App Platform** |  7/16 |    3 |       1 |    4 | Native integration with DigitalOcean Droplets, Spaces buckets and flat component tiers     |
| **Fly.io**                    |  7/16 |    2 |       3 |    3 | Multi-region Firecracker Machines, regional NVMe volumes and WireGuard private networking  |
| **AWS App Runner**            |  5/16 |    1 |       3 |    4 | Direct AWS VPC/IAM integration alongside Amazon RDS, Aurora, SQS and PrivateLink           |

## Criterion-by-criterion breakdown

| Criterion                               | Gregale | Heroku  | Cloud Run | Render  | Railway | DigitalOcean | Fly.io  | AWS App Runner |
| --------------------------------------- | ------- | ------- | --------- | ------- | ------- | ------------ | ------- | -------------- |
| **Immutable code rollback**             | Full    | Full    | Full      | Full    | Full    | Full         | Partial | Partial        |
| **Pre-traffic migration command**       | Full    | Full    | Partial   | Full    | Full    | Full         | Full    | None           |
| **Default canary w/ 5xx auto-rollback** | Full    | None    | Partial   | None    | None    | None         | Partial | Partial        |
| **Managed PostgreSQL PITR**             | Full    | Full    | Full      | Full    | Full    | Full         | Full    | Full           |
| **Code + Postgres rollback together**   | Full    | Partial | None      | Partial | Partial | Partial      | Partial | Partial        |
| **Config/env tied to release**          | Full    | Full    | Full      | Partial | Partial | None         | None    | None           |
| **Release freezes & approval gates**    | Full    | None    | Partial   | None    | None    | None         | None    | None           |
| **Immutable staging -> prod promote**   | Full    | Full    | Partial   | None    | None    | None         | None    | None           |

Key architectural distinctions observed in vendor documentation:

- **Heroku (`11/16`):** Has the strongest traditional release model among peers: `heroku releases` bundles slug + config vars together, `release` phase runs migrations pre-traffic, `heroku pipelines:promote` promotes compiled slugs cleanly, and `heroku pg:backups` / Rollback supports PostgreSQL recovery (`5` full, `1` partial). Code rollback and Postgres restore remain separate commands without default 5xx canary auto-rollbacks.
- **Google Cloud Run (`10/16`):** Couples immutable traffic-splitting revisions with Cloud SQL WAL PITR clones (`gcloud sql instances clone --point-in-time`), and gains canary stages plus approvals when wrapped in Cloud Deploy (`3` full, `4` partial), though Cloud Run traffic switches and Cloud SQL database clones stay uncoordinated.
- **Render (`8/16`) & Railway (`8/16`):** Both pair one-click service rollbacks and native `preDeployCommand` migration hooks with managed PostgreSQL PITR restores into a new/sibling database (`3` full, `2` partial). Operators still swap `DATABASE_URL` and roll back code manually when a release regresses after health checks pass.
- **Gregale (`16/16`):** Ties every release revision, config snapshot, pre-traffic migration, default 1%→10%→50%→100% 5xx canary rollback (beta), scheduled release freezes/approvals, and managed PostgreSQL PITR timestamp together so `gregale rollback --restore-databases` recovers application code and database state in one coordinated step.

## Try coordinated code + Postgres rollback

Read the full walkthrough in [Rollback code and database together](/articles/rollback-code-and-database) and [Safe releases](/docs/releases), or test a live migration-regression scenario using the public [postgres-migration-rollback-demo](/deploy?repo=https://github.com/gregale-dev/postgres-migration-rollback-demo) starter repository.

## Methodology and reproduction

1. All 8 platforms were scored exclusively from public vendor documentation checked on November 26, 2026 (`Full = 2`, `Partial = 1`, `None = 0`).
2. `Partial` indicates a control is documented only via separate sibling services, manual multi-step CLI workflows (such as spinning up a restored DB clone and manually updating `DATABASE_URL`), or opt-in external orchestrators rather than built-in default enforcement.
3. Download the dataset and verify every score deterministically:
   - [Complete reproduction kit (`tar.gz`)](/research/paas-rollback-and-migration-recovery-matrix-2026-11-26/reproduction.tar.gz)
   - [Scoring criteria (`criteria.json`)](/research/paas-rollback-and-migration-recovery-matrix-2026-11-26/criteria.json)
   - [Vendor evidence & sources (`vendors.json`)](/research/paas-rollback-and-migration-recovery-matrix-2026-11-26/vendors.json)
   - [Computed leaderboard (`summary.json`)](/research/paas-rollback-and-migration-recovery-matrix-2026-11-26/summary.json)
   - [Scorer script (`analyze.py`)](/research/paas-rollback-and-migration-recovery-matrix-2026-11-26/analyze.py)
   - [Kit README (`README.md`)](/research/paas-rollback-and-migration-recovery-matrix-2026-11-26/README.md)

```sh
tar -xzf reproduction.tar.gz
cd paas-rollback-and-migration-recovery-matrix-2026-11-26
python3 analyze.py --verify
```

## Sources

Checked against primary documentation on November 26, 2026:
[Gregale releases](/docs/releases), [Gregale progressive rollouts](/docs/rollouts), [Gregale managed PostgreSQL](/docs/postgres), [Gregale release controls](/docs/release-controls),
[Heroku releases](https://devcenter.heroku.com/articles/releases), [Heroku release phase](https://devcenter.heroku.com/articles/release-phase) and [Heroku Postgres rollback](https://devcenter.heroku.com/articles/heroku-postgres-rollback),
[Cloud Run traffic migration & rollbacks](https://docs.cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration), [Cloud SQL PostgreSQL PITR](https://docs.cloud.google.com/sql/docs/postgres/backup-recovery/pitr) and [Cloud Deploy overview](https://docs.cloud.google.com/deploy/docs/overview),
[Render deploys](https://render.com/docs/deploys), [Render rollbacks](https://render.com/docs/rollbacks) and [Render PostgreSQL backups](https://render.com/docs/postgresql-backups),
[Railway deployments](https://docs.railway.com/guides/deployments), [Railway pre-deploy command](https://docs.railway.com/guides/pre-deploy-command) and [Railway backups](https://docs.railway.com/reference/backups),
[DigitalOcean App Platform deployments](https://docs.digitalocean.com/products/app-platform/how-to/manage-deployments/), [App Platform jobs](https://docs.digitalocean.com/products/app-platform/how-to/manage-jobs/) and [DigitalOcean Managed PostgreSQL features](https://docs.digitalocean.com/products/databases/postgresql/details/features/),
[Fly.io deploy docs](https://fly.io/docs/launch/deploy/) and [Fly Managed Postgres overview](https://fly.io/docs/mpg/overview/),
[AWS App Runner deployments](https://docs.aws.amazon.com/apprunner/latest/dg/manage-deploy.html), [App Runner auto scaling](https://docs.aws.amazon.com/apprunner/latest/dg/manage-autoscaling.html) and [Amazon RDS PITR](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_PITR.html).
