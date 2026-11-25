## Results

Across **8 verifiable operational safety controls** for AI coding agents (`2` = full built-in enforcement, `1` = partial / manual setup required, `0` = not provided; **16 points maximum**), **Gregale scores 16/16** (`8` full), followed by **Google Cloud Run (`8/16`)**, **Vercel (`6/16`)**, **Fly.io (`5/16`)**, **Northflank (`5/16`)**, **Render (`5/16`)**, **Koyeb (`3/16`)**, and **Railway (`3/16`)**.

Most cloud platforms already provide structured CLIs (`5/8` full) and scoped project or IAM credentials, and half ship an official MCP server (`4/8` full). The gap sits in runtime safeguards designed for autonomous write loops: **pre-mutation cost previews (`1/8` full)**, **server-side human approval gates (`1/8` full)**, **non-code mutation undo (`1/8` full)**, **default 5xx canary rollbacks (`1/8` full)**, and **coordinated code + Postgres rollback (`1/8` full)**.

This evaluation is a **published-documentation matrix checked on November 25, 2026**, not a measure of uptime, latency, or multi-region compute breadth (areas where Cloud Run, Fly.io, Koyeb, Northflank, and Vercel lead Gregale outside these 8 controls). Every score is computed deterministically by `analyze.py` from `criteria.json` and `vendors.json`.

| Platform       | Score | Full | Partial | None | Strengths outside agent-ops guardrails                                               |
| -------------- | ----: | ---: | ------: | ---: | ------------------------------------------------------------------------------------ |
| **Gregale**    | 16/16 |    8 |       0 |    0 | ~1s idle pause billing, Firecracker microVM isolation, free PR previews              |
| **Cloud Run**  |  8/16 |    3 |       2 |    3 | Global GCP regions, generous monthly free tier, VPC + Cloud SQL / BigQuery / Pub/Sub |
| **Vercel**     |  6/16 |    1 |       4 |    3 | Global edge CDN, Next.js RSC/ISR integration, collaborative frontend previews        |
| **Fly.io**     |  5/16 |    1 |       3 |    4 | Global edge microVM placement, regional NVMe volumes, low-cost always-on memory      |
| **Northflank** |  5/16 |    1 |       3 |    4 | Bring-Your-Own-Cloud (AWS/GCP/Azure K8s), always-on Free Sandbox, enterprise RBAC    |
| **Render**     |  5/16 |    1 |       3 |    4 | Mature fixed-price PaaS, $6/mo managed Postgres, zero seat fees on Hobby             |
| **Koyeb**      |  3/16 |    1 |       1 |    6 | Global Firecracker microVMs, Light Sleep scale-to-zero, serverless GPU nodes         |
| **Railway**    |  3/16 |    0 |       3 |    5 | One-click Postgres/Redis/MySQL/MongoDB canvas, pure usage-based pricing              |

## Criterion-by-criterion breakdown

| Criterion                           | Gregale | Cloud Run | Vercel  | Fly.io  | Northflank | Render  | Koyeb   | Railway |
| ----------------------------------- | ------- | --------- | ------- | ------- | ---------- | ------- | ------- | ------- |
| **Non-interactive JSON CLI**        | Full    | Full      | Partial | Full    | Full       | Partial | Full    | Partial |
| **Official MCP server**             | Full    | Full      | Full    | None    | None       | Full    | None    | Partial |
| **Scoped agent identity**           | Full    | Full      | Partial | Partial | Partial    | Partial | Partial | Partial |
| **Pre-mutation cost preview**       | Full    | None      | None    | None    | None       | None    | None    | None    |
| **Human approval gate**             | Full    | Partial   | Partial | None    | Partial    | None    | None    | None    |
| **Non-code mutation undo**          | Full    | None      | None    | None    | None       | None    | None    | None    |
| **Default canary w/ auto-rollback** | Full    | Partial   | Partial | Partial | Partial    | None    | None    | None    |
| **Code + Postgres rollback**        | Full    | None      | None    | Partial | None       | Partial | None    | None    |

Key architectural distinctions observed in vendor documentation:

- **Google Cloud Run (`8/16`):** Combines `gcloud --format=json`, an official Cloud Run MCP server, and granular GCP IAM Service Accounts (`3` full), plus optional Cloud Deploy approval gates and canary phases (`2` partial). Cost previews, arbitrary non-code undo, and coupled Cloud SQL rollbacks remain separate tools (`3` none).
- **Vercel (`6/16`):** Ships a hosted official MCP server (`https://mcp.vercel.com`) plus Deployment Protection, Rolling Releases, scoped team tokens, and CLI automation (`1` full, `4` partial), focused on frontend/serverless workflows rather than bundled Postgres rollbacks.
- **Gregale (`16/16`):** Enforces scoped `--agent` identity checks server-side whenever a token created by `gregale key create --agent` is used: dry-run cost estimates (`--plan` / `Gregale-Agent-Preview: budget`), out-of-band human approval links on destructive or production mutations, `gregale mcp connection undo` for platform settings over a 7-day audit trail, default 1%→10%→50%→100% canary auto-rollbacks (beta), and `gregale rollback --restore-databases` on paid plans.

## Data and reproduction

Download the [complete reproduction kit](/research/agent-ops-guardrails-matrix-2026-11-25/reproduction.tar.gz) and run this command in the extracted directory. It uses Python 3.11 or later and the standard library only:

```sh
python3 analyze.py --verify
```

- [Guardrail scoring criteria (JSON)](/research/agent-ops-guardrails-matrix-2026-11-25/criteria.json)
- [Platform evaluations and sources (JSON)](/research/agent-ops-guardrails-matrix-2026-11-25/vendors.json)
- [Calculated matrix summary (JSON)](/research/agent-ops-guardrails-matrix-2026-11-25/summary.json)
- [Deterministic Python scorer](/research/agent-ops-guardrails-matrix-2026-11-25/analyze.py)
- [Kit instructions (Markdown)](/research/agent-ops-guardrails-matrix-2026-11-25/README.md)

## Limits

This evaluation is authored and published by **Gregale Engineering** and reflects capabilities documented by each vendor as of **November 25, 2026**. It intentionally scores only operational guardrails around AI coding agent mutations — it does **not** measure multi-region routing, BYOC Kubernetes orchestration, GPU availability, frontend edge CDN features, or unit compute rates (all of which give competitors clear advantages outside agent guardrails). Specific beta/preview notes apply on Gregale: progressive canary rollouts are in beta, and the hosted MCP server is in preview. Every cell in `vendors.json` carries a direct `https://` source link and rationale so readers can audit or adjust rubric weights locally in `criteria.json`.

## Sources

Checked against primary documentation on November 25, 2026:
[Gregale coding-agent guide](/docs/agents),
[Best cloud platform for AI coding agents in 2026](/articles/best-cloud-for-ai-coding-agents),
[Google Cloud Run docs](https://cloud.google.com/run/docs) and [Cloud Run traffic migration](https://docs.cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration),
[Vercel CLI](https://vercel.com/docs/cli), [Vercel MCP](https://vercel.com/docs/mcp/vercel-mcp) and [Vercel pricing](https://vercel.com/pricing),
[Northflank platform overview](https://northflank.com/docs/v1/application/getting-started/what-is-northflank),
[Render MCP server](https://render.com/docs/mcp-server) and [Render rollbacks](https://render.com/docs/rollbacks),
[Railway MCP server](https://docs.railway.com/reference/mcp-server),
[Fly.io deploy docs](https://fly.io/docs/launch/deploy/),
[Koyeb CLI](https://www.koyeb.com/docs/build-and-deploy/cli/reference) and [Koyeb deployments](https://www.koyeb.com/docs/run-and-scale/deployments).
