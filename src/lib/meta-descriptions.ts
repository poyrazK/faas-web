/**
 * Search snippets for public pages whose summary runs past
 * `META_DESCRIPTION_MAX` (160) characters, keyed by path.
 *
 * Bing Webmaster Tools reports a longer `<meta name="description">` as an
 * error, and Google cuts it off mid-sentence. The summary still opens the
 * page and feeds its structured data; only the description and
 * `og:description` tags read these.
 *
 * `meta-descriptions.test.ts` fails when a public page's summary is too long
 * and has no entry here, and when an entry outlives its page.
 */
export const META_DESCRIPTIONS: Readonly<Record<string, string>> = {
  '/features':
    'What sets Gregale apart: database-synced rollbacks, an edge WAF, scale-to-zero realtime, durable webhooks, snapshot restore, hosted MCP servers and spend caps.',
  '/features/durable-webhooks-and-workflows':
    'Verify and store inbound webhooks before responding, schedule delayed invocations, run crons and queue workers, and run multi-step workflows with retries.',
  '/features/edge-security':
    'An OWASP Core Rule Set WAF, proof-of-work browser challenges, edge caching and replayable trace tests that stop hostile traffic before it wakes your app.',
  '/features/firecracker-scale-to-zero':
    'Every workload runs in its own Firecracker microVM that snapshots to disk at zero RAM cost and pre-wakes the internal services it depends on.',
  '/features/mcp-hosting':
    'Scaffold Streamable HTTP MCP servers in Node, Go or Python, lock every tool behind an allowlist, and scale to zero between agent sessions.',
  '/features/realtime-scale-to-zero':
    'Gregale holds WebSocket and SSE connections and heartbeats at the edge while your backend is parked, and wakes it only when messages arrive.',
  '/features/strict-budgets':
    'Hard monthly overage ceilings on by default for every paid plan, budgets for orgs, projects and previews, live cost forecasts and FOCUS invoice exports.',
  '/features/zero-secret-outbound':
    'Inject API credentials at Gregale’s outbound relay, use short-lived OIDC workload tokens, scan deploys for CVEs and leaked secrets, reload without downtime.',
  '/research/agent-ops-guardrails-matrix-2026-11-25':
    '8 backend platforms tested on 8 safety controls for AI coding agents: JSON CLI, MCP server, scoped keys, cost previews, approvals, undo and auto-rollback.',
  '/research/paas-intermittent-api-cost-model-2026-11-25':
    'A 30-day cost model of an intermittent API: Gregale’s 1–2 s idle pause against minute-scale sleep timers on Fly.io, Railway, Render, Heroku and Cloud Run.',
  '/research/paas-rollback-and-migration-recovery-matrix-2026-11-26':
    '8 backend platforms tested on 8 recovery controls: rollbacks, pre-traffic migrations, 5xx canaries, Postgres PITR and coordinated code + database rollback.',
  '/solutions/ai-coding-agent-guardrails':
    'Replace prompt-only rules with enforced limits: scoped agent keys, human approval links, spend ceilings an agent can’t raise, 7-day undo and an MCP server.',
  '/solutions/backend-without-devops':
    'Replace an EC2, RDS, S3 and Datadog setup with git-push deploys, TLS, managed Postgres with PITR, PR previews, object storage and one-line tracing.',
  '/solutions/hard-cloud-cost-control':
    'A hard monthly overage cap on every paid plan, enforced with HTTP 402 instead of alerts, plus edge blocks that don’t wake VMs and preview budgets.',
  '/solutions/multi-service-networking':
    'Run isolated internal services over .internal DNS with no VPC: caller allowlists, atomic multi-service releases, SSRF denylists and static egress IPs.',
  '/solutions/safe-production-deploys':
    'Every production deploy starts at 1% of traffic, rolls back on 5xx errors or slowdowns, checks bindings first, and can restore code with Postgres.',
  '/solutions/scale-to-zero-apis':
    'Gregale pauses idle HTTP instances about a second after the last request and wakes them from memory snapshots in milliseconds, with crons still running.',
  '/vs/cloudflare-workers':
    'Gregale vs Cloudflare Workers: V8 isolates and Containers vs Firecracker microVMs, full CPython and Docker support, bundled Postgres and canary rollbacks.',
  '/vs/digitalocean':
    'Gregale vs DigitalOcean App Platform: always-on container rates and separate Postgres vs a ~1 s idle pause, PR previews and automatic canary rollbacks.',
  '/vs/replit':
    'Gregale vs Replit: moving production APIs and AI-built backends from browser workspaces to Git-based Firecracker microVMs with rollbacks and spend caps.',
  '/articles/ai-agent-hosting-budget':
    'Each AI agent on Gregale has a monthly budget. Every change is priced before it runs, and a change past the budget waits for your approval.',
  '/articles/ai-agent-production-approval':
    'On Gregale, an AI coding agent must ask a person before it deletes, deploys or rolls back production, rotates credentials or changes billing.',
  '/articles/antigravity-ide-mcp-server-deploy':
    'Connect Google Antigravity IDE to Gregale’s hosted MCP server in one command, teach repos with AGENTS.md, or host your own MCP server at $0 idle.',
  '/articles/atomic-multi-service-releases':
    'Preflight multi-service projects, pin compatible frontend, API, worker and queue versions together, and roll out whole-graph canaries on Gregale.',
  '/articles/autoscale-from-zero-kafka-lag-custom-metrics':
    'Scale Gregale apps up from zero on Kafka, NATS or SQS queue lag, custom backlog metrics or scheduled warm windows, without Kubernetes or KEDA.',
  '/articles/aws-app-runner-alternatives':
    'AWS App Runner alternatives: Gregale, Cloud Run, Render, Railway, Fly.io, DigitalOcean and Northflank compared on idle billing, Postgres and rollbacks.',
  '/articles/backend-without-devops':
    'What an ops person does (builds, releases, backups, TLS, scaling, alerts, cost limits), how Gregale covers it for a small team, and what you still own.',
  '/articles/best-cloud-for-ai-coding-agents':
    'What makes a cloud safe for Claude Code, Codex, Cursor and Gemini CLI: scoped keys, human approval, cost previews, undo and auto-rollback, across 6 clouds.',
  '/articles/canary-deploys':
    'Every Gregale release starts at 1% of traffic, moves up in stages, and rolls back by itself on 5xx errors, crash loops or a latency regression.',
  '/articles/claude-code-deploy-production-safely':
    'Give Claude Code a scoped Gregale agent key, not your login. It deploys, reads logs and rolls back; risky production changes wait for your approval.',
  '/articles/cloudflare-workers-alternatives':
    'Cloudflare Workers alternatives for full CPython and Docker: Gregale, Cloud Run, Fly.io, Railway and Render compared on Postgres and canary rollbacks.',
  '/articles/codex-deploy-production-safely':
    'Set up OpenAI Codex to deploy to Gregale with a scoped agent token, sandbox network access and AGENTS.md rules that Gregale’s API enforces.',
  '/articles/cursor-deploy-production-safely':
    'Give Cursor a scoped Gregale agent token and AGENTS.md rules, or connect it over MCP, with server-side approvals, budgets, undo and canary rollbacks.',
  '/articles/declarative-edge-response-cache':
    'Cache responses at Gregale’s gateway with stale-while-revalidate, stale-if-error and Cache-Tag purges, serving hits without waking your app.',
  '/articles/deploy-docker-container-scale-to-zero-no-rewrite':
    'Run any stateless Linux/amd64 container image that listens on $PORT in a Gregale microVM that scales to zero, with Compose and private registry pulls.',
  '/articles/deploy-freezes-release-approvals-schedules':
    'Require MFA-signed human approvals for releases, freeze deploys on weekends or after a rollback, and schedule releases to roll out in quiet windows.',
  '/articles/deploy-vibe-coded-app-to-production':
    'Take an AI-built backend from localhost to production with default spend caps, scoped agent tokens, secret and CVE scans, and 1% canary rollbacks.',
  '/articles/digitalocean-app-platform-alternatives':
    'DigitalOcean App Platform alternatives: Gregale, Render, Railway, Fly.io, Heroku, Koyeb and Northflank on free tiers, idle pause, Postgres and rollbacks.',
  '/articles/durable-code-workflows-scale-to-zero':
    'Write durable retries, multi-day sleeps and event waits as plain async functions in Node, Python or Go that use no running VM while they wait.',
  '/articles/durable-inbound-webhooks-scale-to-zero':
    'Gregale verifies Stripe and HMAC webhooks at the edge while your app is parked, stores them durably, answers 202 and delivers them with retries.',
  '/articles/edge-rules-rate-limiting-trace-testing':
    'Block scrapers, rate-limit routes, verify JWTs and validate request schemas at Gregale’s gateway without waking idle apps, then test rules with traces.',
  '/articles/fastapi-background-jobs-postgres':
    'Where FastAPI background work belongs (BackgroundTasks, crons, jobs or a worker) and a Compose setup running the API, worker and Postgres on Gregale.',
  '/articles/flyio-alternatives':
    'Fly.io alternatives: Render, Railway, Heroku, Northflank, Cloud Run, DigitalOcean and Gregale compared on free plans, prices, idle billing and releases.',
  '/articles/gemini-cli-deploy-production-safely':
    'Connect Gemini CLI to Gregale with a scoped agent key and AGENTS.md, while Gregale enforces approvals, budget previews, undo and canary rollbacks.',
  '/articles/hard-cloud-spend-caps':
    'Every paid Gregale plan has a hard monthly overage cap from day one that stops compute at the ceiling with HTTP 402, instead of alerting after the bill.',
  '/articles/heroku-alternatives':
    'Heroku alternatives: Render, Railway, Fly.io, Northflank, Cloud Run, DigitalOcean and Gregale compared on free plans, prices, idle billing and releases.',
  '/articles/host-go-api-scale-to-zero':
    'Host a Go API on Gregale: built from go.mod into a small binary, billing paused about a second after idle, with canary rollbacks and bundled Postgres.',
  '/articles/host-nextjs-postgres-outside-vercel':
    'Host Next.js Server Components, Route Handlers and Server Actions outside Vercel, with managed Postgres, PR previews and 5xx canary rollbacks.',
  '/articles/host-python-fastmcp-server':
    'Run a Python MCP server over Streamable HTTP in a full CPython Firecracker microVM, paying $0 while idle, with per-tool allowlists.',
  '/articles/hosting-mcp-server-deploy-logs-rollback':
    'Gregale, Vercel and Dokploy ship MCP servers that can deploy, read logs and roll back; Render, Railway, Fly.io and 4 more each lack one of those tools.',
  '/articles/koyeb-alternatives':
    'Koyeb alternatives: Gregale, Fly.io, Render, Railway, Northflank, Cloud Run and DigitalOcean compared on scale-to-zero, Postgres pricing and rollbacks.',
  '/articles/mcp-server-hosting':
    'Host a remote MCP server on Gregale: Streamable HTTP, each version checked by an MCP client before traffic, OAuth with per-tool scopes, idle servers parked.',
  '/articles/microvm-isolation':
    'Gregale runs every app instance in its own Firecracker microVM with its own kernel, network namespace and memory limit. Your Dockerfile works unchanged.',
  '/articles/nodejs-api-and-worker':
    'How to run a Node.js API and worker on one version with Compose on Gregale, and what two small always-on processes cost on six platforms.',
  '/articles/northflank-alternatives':
    'Northflank alternatives: Gregale, Railway, Render, Fly.io, Koyeb, Cloud Run and DigitalOcean compared on idle billing, Kubernetes complexity and rollbacks.',
  '/articles/openapi-breaking-change-deploy-gate':
    'Block deploys that break your OpenAPI contract: Gregale previews and diffs the spec, stops promotion on breaking changes and probes routes on the candidate.',
  '/articles/pre-traffic-service-binding-verification':
    'Check internal services, managed Postgres, object storage and queue consumers from the exact candidate release before it takes traffic, with gated promotion.',
  '/articles/preview-environments':
    'Gregale gives every pull request its own live copy of the app, rebuilt on each push and removed when it closes. No CI workflow, on every plan.',
  '/articles/private-microservice-networking-no-vpc':
    'Apps in one Gregale account call each other privately by name with no VPC setup, while caller allowlists and deadlines are enforced before targets wake.',
  '/articles/private-object-storage-without-s3-iam':
    'Create private S3-compatible buckets on Gregale with one command, sealed credentials in env vars, $0.03/GiB-month overage and direct uploads.',
  '/articles/promote-staging-to-production-without-rebuilding':
    'Promote the exact staging build and its non-secret config to production without rebuilding, keeping production secrets separate, on Gregale.',
  '/articles/pull-queue-workers-workload-identity':
    'Run queue workers on Gregale without an HTTP listener: lease, ack and extend messages, autoscale on queue depth, and keep preview code out with workload tokens.',
  '/articles/railway-alternatives':
    'Railway alternatives: Render, Fly.io, Northflank, Cloud Run, DigitalOcean, Heroku and Gregale compared on free plans, prices, idle billing and releases.',
  '/articles/remote-dev-environment-without-docker-desktop':
    'Run gregale dev for an isolated, auto-expiring cloud dev environment with hot reload, managed Postgres and production routing. No local Docker needed.',
  '/articles/render-alternatives':
    'Render alternatives: Railway, Fly.io, Heroku, Northflank, Cloud Run, DigitalOcean and Gregale compared on free plans, prices, idle billing and releases.',
  '/articles/render-vs-railway-vs-flyio':
    'Render vs Railway vs Fly.io for a production API: price, regions, managed Postgres and releases, where each fits, and where Gregale fits as a fourth option.',
  '/articles/replit-alternatives':
    'Replit alternatives for production: Gregale, Railway, Render, Fly.io, Vercel and DigitalOcean compared for Git-owned AI-built backends with spend caps.',
  '/articles/rollback-code-and-database':
    'Rolling back code after a migration runs old code on the new schema. Gregale can restore Postgres to before the migration together with the code.',
  '/articles/scale-to-zero-cron-jobs-event-triggers':
    'Run DST-safe HTTP crons, delayed tasks up to 365 days and CloudEvents inboxes with zero idle compute and 30+ days of dead-letter retention on Gregale.',
  '/articles/scale-to-zero-without-cold-starts':
    'Gregale pauses idle apps in memory about a second after the last request and resumes them in about a millisecond; parked apps wake from a snapshot.',
  '/articles/sidecar-companions-without-kubernetes':
    'Run OpenTelemetry, Sentry or Datadog sidecars, or your own pinned images, next to your app on Gregale, declared in gregale.yaml with no Kubernetes.',
  '/articles/ssrf-protection-egress-denylist-paas':
    'Every Gregale app blocks cloud metadata endpoints, private networks, NAT64 bypasses, SMTP spam ports, SSH/RDP and mining pools by default.',
  '/articles/static-egress-ip-scale-to-zero':
    'Give an app a dedicated static outbound IP per region so banks, payment processors and database allowlists see one IP, even while it scales to zero.',
  '/articles/stop-bot-traffic-cloud-bill-shock':
    'Spend caps alone turn bot floods into outages. Block hostile requests at the edge with an OWASP WAF and proof-of-work challenges before they wake compute.',
  '/articles/stored-workflow-recovery-missed-schedules':
    'Diagnose failed workflow steps, resume a run while keeping completed steps, catch up on missed schedules and run rate-limited recovery batches on Gregale.',
  '/articles/synthetic-uptime-checks-scale-to-zero':
    'External uptime and p95 latency checks every 5, 15 or 60 minutes on Gregale apps, with consecutive-failure alerts and the wake cost of each check.',
  '/articles/test-migration-postgres-branch-ttl':
    'Branch a managed Postgres database from any point in the 7-day restore window, test migrations on real rows, and let a TTL delete the branch.',
  '/articles/undo-ai-agent-changes':
    'Gregale logs every change an AI agent makes for 7 days and can undo it with one command: deploys, rollbacks, traffic, settings, scaling and resources.',
  '/articles/vercel-alternatives':
    'Vercel alternatives for backends: Gregale, Render, Railway, Fly.io, Cloud Run, Northflank and DigitalOcean on seat pricing, duration limits and Postgres.',
  '/articles/websockets-sse-scale-to-zero':
    'Gregale holds WebSocket and SSE connections and heartbeats at the edge while your backend is parked, waking it only for client messages or publishes.',
  '/articles/what-breaks-when-app-scales-to-zero':
    'Local files, /tmp, in-memory sessions, timers and startup connections don’t survive a park. Gregale refuses stateful images and flags writes that will be lost.',
  '/articles/zero-code-otel-sql-regression-tracing':
    'Turn on OpenTelemetry tracing for Node and Python with one line in gregale.yaml: SQL query spans, log redaction and deploy-to-deploy failure alerts.',
  '/articles/zero-restart-secret-rotation':
    'Rotate secrets on Gregale without restarts: snapshots never serve stale keys, --restart drains instances, and apps can hot-reload the new secret.',
  '/articles/zero-secret-outbound-api-relay':
    'Keep API keys out of your app: Gregale’s outbound relay adds sealed credentials outside the microVM, with path allowlists, circuit breakers and budgets.',
};

/** A page's search snippet: its entry above, else its own summary. */
export function metaDescriptionFor(path: string, summary: string | undefined): string | undefined {
  return META_DESCRIPTIONS[path] ?? summary;
}
