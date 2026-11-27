import type { FaqEntry } from './faq.ts';

/**
 * Plain-answer articles: one question a buyer asks, answered first, then how
 * Gregale does it and how other platforms compare. The body lives in
 * `content/articles/<slug>.md`; the questions live here so the visible FAQ and
 * its FAQPage structured data come from the same strings.
 *
 * Loaded by `scripts/prerender.mjs` with plain Node: no JSX, no `?raw`.
 */
export interface Article {
  slug: string;
  title: string;
  summary: string;
  publishedOn: string;
  updatedOn: string;
  faq: readonly FaqEntry[];
  /** For a roundup of one vendor's alternatives: that vendor's /vs slug. */
  alternativesTo?: string;
  /** For a head-to-head of other vendors: each vendor's /vs slug. */
  comparison?: readonly string[];
}

export interface ArticleTopic {
  id: string;
  title: string;
  description: string;
  solutionSlug?: string;
  slugs: readonly string[];
}

export const ARTICLES_TITLE = 'Articles';
export const ARTICLES_DESCRIPTION =
  'Plain answers about how Gregale works, with how other platforms compare.';

const CANARY_SLUG = 'canary-deploys';
const MICROVM_SLUG = 'microvm-isolation';
const FASTAPI_JOBS_SLUG = 'fastapi-background-jobs-postgres';
const NODE_WORKER_SLUG = 'nodejs-api-and-worker';
const CLAUDE_CODE_SLUG = 'claude-code-deploy-production-safely';
const APPROVAL_SLUG = 'ai-agent-production-approval';
const UNDO_SLUG = 'undo-ai-agent-changes';
const BUDGET_SLUG = 'ai-agent-hosting-budget';
const MCP_OPERATIONS_SLUG = 'hosting-mcp-server-deploy-logs-rollback';
const DATABASE_ROLLBACK_SLUG = 'rollback-code-and-database';
const COLD_START_SLUG = 'scale-to-zero-without-cold-starts';
const BEST_CLOUD_AGENTS_SLUG = 'best-cloud-for-ai-coding-agents';
const CURSOR_SLUG = 'cursor-deploy-production-safely';
const CODEX_SLUG = 'codex-deploy-production-safely';
const GEMINI_CLI_SLUG = 'gemini-cli-deploy-production-safely';
const REALTIME_SCALE_ZERO_SLUG = 'websockets-sse-scale-to-zero';
const INBOUND_WEBHOOKS_SLUG = 'durable-inbound-webhooks-scale-to-zero';
const EDGE_CACHE_SLUG = 'declarative-edge-response-cache';
const OUTBOUND_RELAY_SLUG = 'zero-secret-outbound-api-relay';
const OPENAPI_GATE_SLUG = 'openapi-breaking-change-deploy-gate';
const CODE_WORKFLOWS_SLUG = 'durable-code-workflows-scale-to-zero';
const SECRET_ROTATION_SLUG = 'zero-restart-secret-rotation';
const INTERNAL_SERVICES_SLUG = 'private-microservice-networking-no-vpc';
const COMPANIONS_SLUG = 'sidecar-companions-without-kubernetes';
const PULL_QUEUE_WORKERS_SLUG = 'pull-queue-workers-workload-identity';
const SPEND_CAPS_SLUG = 'hard-cloud-spend-caps';
const OTEL_TRACING_SLUG = 'zero-code-otel-sql-regression-tracing';
const AUTOSCALE_LAG_SLUG = 'autoscale-from-zero-kafka-lag-custom-metrics';
const ENV_PROMOTION_SLUG = 'promote-staging-to-production-without-rebuilding';
const SYNTHETIC_CHECKS_SLUG = 'synthetic-uptime-checks-scale-to-zero';
const STATIC_EGRESS_IP_SLUG = 'static-egress-ip-scale-to-zero';
const ATOMIC_RELEASES_SLUG = 'atomic-multi-service-releases';
const BINDING_VERIFICATION_SLUG = 'pre-traffic-service-binding-verification';
const RELEASE_CONTROLS_SLUG = 'deploy-freezes-release-approvals-schedules';
const EDGE_RULES_TRACE_SLUG = 'edge-rules-rate-limiting-trace-testing';
const CRONS_EVENTS_SLUG = 'scale-to-zero-cron-jobs-event-triggers';
const OBJECT_STORAGE_SLUG = 'private-object-storage-without-s3-iam';
const EGRESS_DENYLIST_SLUG = 'ssrf-protection-egress-denylist-paas';
const STORED_WORKFLOW_RECOVERY_SLUG = 'stored-workflow-recovery-missed-schedules';
const CONTAINER_COMPAT_SLUG = 'deploy-docker-container-scale-to-zero-no-rewrite';
const NEXTJS_POSTGRES_SLUG = 'host-nextjs-postgres-outside-vercel';
const BUN_HONO_SLUG = 'host-bun-hono-postgres-api';
const DJANGO_POSTGRES_SLUG = 'host-django-postgres-migrations-rollback';
const GO_API_SLUG = 'host-go-api-scale-to-zero';
const MIRRORING_SLUG = 'shadow-test-release-traffic-mirroring';
const PG_BRANCH_SLUG = 'test-migration-postgres-branch-ttl';
const BATCH_JOBS_SLUG = 'batch-jobs-fan-out-retry-failed-inputs';
const DEPLOY_GUARD_SLUG = 'block-insecure-deploys-security-policy';
const STATELESS_SLUG = 'what-breaks-when-app-scales-to-zero';
const TELEGRAM_SLUG = 'telegram-bot-webhook-scale-to-zero';
const DISCORD_SLUG = 'discord-bot-interactions-endpoint-serverless';
const SLACK_SLUG = 'slack-bolt-http-mode-scale-to-zero';
const RAILS_SLUG = 'deploy-rails-postgres';
const RAILWAY_CONFIG_SLUG = 'railway-json-config-as-code-deprecated';
const DIRECT_UPLOADS_SLUG = 'direct-browser-uploads-resumable-multipart-storage';
const DELAYED_TASKS_SLUG = 'delayed-tasks-without-redis-scale-to-zero';
const DEPLOY_DIFF_SLUG = 'preview-deploy-diff-and-environment-drift';
const CRASH_SNAPSHOTS_SLUG = 'debug-production-5xx-crash-snapshots-and-profile-diffs';

export const ARTICLES: readonly Article[] = [
  {
    slug: CANARY_SLUG,
    title: 'Canary deploys with automatic rollback',
    summary:
      'Every production release on Gregale goes to 1% of traffic first, moves up in stages on clean evidence, and rolls back on its own on 5xx errors, crash loops or a latency regression.',
    publishedOn: '2026-11-24',
    updatedOn: '2026-11-24',
    faq: [
      {
        question: 'Do I need to change my app to get canary deploys on Gregale?',
        answer:
          'No. Any HTTP app deployed with `gregale deploy` gets them. For better signal on a quiet app, name up to three cheap, read-only probe paths that answer without a login.',
      },
      {
        question: 'What happens to users who hit the new version before a rollback?',
        answer:
          'The new version keeps serving until the previous one is ready again, so there is no window with nothing serving. Send a `Gregale-Version-Key` header if a user must stay on one version for a whole session.',
      },
      {
        question: 'Can I turn it off for an urgent hotfix?',
        answer:
          'Yes: `gregale deploy --rollout immediate` for one deploy, or `gregale app my-api --release-policy immediate` for every deploy. `--rollback-on-5xx=false` turns off the automatic rollback.',
      },
      {
        question: 'What about database migrations?',
        answer:
          'Rolling back code does not undo a migration. Rolling back to the release that was serving when the migration ran needs nothing extra. A rollback that would put older code on a newer schema is refused unless you acknowledge it, and automatic rollbacks never cross a migration: they keep the current release serving and tell you. On paid plans, `gregale rollback --restore-databases` also restores the managed Postgres database to the moment before the migration, as a new database, and moves the app to it.',
      },
      {
        question: 'Does it work with GitHub pushes and Terraform?',
        answer:
          'Yes. Production releases from the GitHub App, `gregale project apply`, the API and Terraform use the same safe rollout.',
      },
    ],
  },
  {
    slug: MICROVM_SLUG,
    title: 'A microVM for every app',
    summary:
      'Gregale runs every app instance in its own Firecracker microVM, with its own kernel, network namespace, memory limit and jailed process. Your existing Dockerfile works unchanged.',
    publishedOn: '2026-11-24',
    updatedOn: '2026-11-24',
    faq: [
      {
        question: 'Does a VM per app make Gregale slow to start?',
        answer:
          'No. Firecracker microVMs boot in a fraction of a second, and an app that has been idle wakes from a memory snapshot of its running process rather than booting from scratch.',
      },
      {
        question: 'Is a microVM the same as a dedicated server?',
        answer:
          'No. Many microVMs share one physical host, but each has its own kernel, memory limit and jailed process, and the hypervisor keeps them apart. It is the isolation model AWS uses for Lambda and Fargate.',
      },
      {
        question: 'If I run several containers together, do they each get a VM?',
        answer:
          'Each deployed app gets its own microVM. Containers you run together as companions inside one deployment (in preview) have separate filesystems and resource limits but share that deployment’s guest kernel, so put workloads that must not trust each other in separate deployments.',
      },
      {
        question: 'Can I run privileged containers or Docker-in-Docker?',
        answer:
          'No. Privileged mode, host devices, host networking and the Docker socket are not supported. Builds run in their own short-lived microVMs, not on a shared Docker daemon.',
      },
      {
        question: 'Does isolation replace my own security work?',
        answer:
          'No. Gregale isolates workloads and filters network egress; you still own application authorization, dependency hygiene and data classification.',
      },
    ],
  },
  {
    slug: 'preview-environments',
    title: 'Preview environments for every pull request',
    summary:
      'Gregale gives every pull request its own live copy of the app, rebuilt on every push and torn down after the pull request closes, with no CI workflow to write. On every plan, including Free.',
    publishedOn: '2026-11-24',
    updatedOn: '2026-11-24',
    faq: [
      {
        question: 'Do I need a CI workflow for Gregale preview environments?',
        answer:
          'No. Connect the repository through the Gregale GitHub App and every pull request into the production branch gets a preview at `pr-<number>-<app>.gregale.dev`, with a status comment and a `gregale-preview` check on the pull request.',
      },
      {
        question: 'Do previews get production secrets or databases?',
        answer:
          "No. Production environment values are not copied into previews, and managed database and storage credentials are never given to them. Set test values in the production app's `pr-preview` scope instead.",
      },
      {
        question: 'Do previews work for pull requests from forks?',
        answer:
          'No. Pull requests from forks are skipped for security, so untrusted code from a fork never reaches a Gregale build. The `gregale-preview` check says the preview was skipped.',
      },
      {
        question: 'How long does a preview live?',
        answer:
          'Until 24 hours after the pull request closes, or until its time to live runs out: 7 days by default, settable from 1 hour to 30 days. Reopening the pull request within those 24 hours brings it back.',
      },
    ],
  },
  {
    slug: 'mcp-server-hosting',
    title: 'Where to host an MCP server',
    summary:
      'Gregale hosts remote MCP servers over Streamable HTTP, checks every new version as an MCP client before it takes traffic, supports OAuth with per-tool scopes, and parks idle servers. In beta on Hobby, Pro and Scale.',
    publishedOn: '2026-11-24',
    updatedOn: '2026-11-25',
    faq: [
      {
        question: 'Where should I host a remote MCP server?',
        answer:
          'On a platform that serves Streamable HTTP over HTTPS, lets you require OAuth access tokens, and allows long tool calls. Gregale does all three and checks each new version as an MCP client before it takes traffic. Cloudflare Workers, Vercel, Google Cloud Run and AWS Bedrock AgentCore Runtime also host remote MCP servers.',
      },
      {
        question: 'Can an MCP server scale to zero on Gregale?',
        answer:
          'Yes. When nobody calls the server, Gregale parks it and stops billing; the next call wakes it. The first call after a park takes longer, and the calls after it run at normal speed.',
      },
      {
        question: 'How do I keep an MCP server private?',
        answer:
          "Create it with `--auth external-oauth` and your provider's issuer and JWKS URL. The server then accepts only JWT access tokens from that issuer with the required scopes, and each tool can require scopes of its own.",
      },
    ],
  },
  {
    slug: 'backend-without-devops',
    title: 'Hosting a startup backend without a DevOps engineer',
    summary:
      'What an ops person usually does (builds, safe releases, backups, TLS, scaling, alerts, cost limits) and how Gregale does it for a small team, with what your team still owns and when another option fits better.',
    publishedOn: '2026-11-24',
    updatedOn: '2026-11-26',
    faq: [
      {
        question: 'Can a startup run production without a DevOps engineer?',
        answer:
          'Yes, if the platform does the operations work: builds, gradual releases with automatic rollback, database backups, TLS, scaling and alerts. Someone on the team still owns the code, the data model and responding to alerts about the app itself.',
      },
      {
        question: 'Do we need Kubernetes to run a startup backend?',
        answer:
          'Not to start. A managed platform runs your containers without a cluster to operate. Gregale runs each app in its own Firecracker microVM and handles releases, scaling and isolation for you.',
      },
      {
        question: 'What does Gregale not do for us?',
        answer:
          'It does not write your authorization rules, schema migrations or alert responses. It runs in one region, has no durable local disk, and does not support privileged containers or Docker-in-Docker.',
      },
    ],
  },
  {
    slug: FASTAPI_JOBS_SLUG,
    title: 'Where to host a FastAPI app with background jobs and Postgres',
    summary:
      'Which background work belongs in BackgroundTasks, crons, jobs or a worker, a Compose setup that runs the API, the worker and managed Postgres on Gregale, and how Render, Railway, Fly.io and Heroku compare.',
    publishedOn: '2026-11-25',
    updatedOn: '2026-11-25',
    faq: [
      {
        question: 'Where should I host a FastAPI app with background jobs and Postgres?',
        answer:
          'On a platform that runs the API, a worker and managed Postgres together and deploys them as one unit. Gregale does this from a Compose file on Hobby and up, runs migrations before each release and rolls a bad release back on its own (in beta). Render, Railway, Fly.io and Heroku also run a web service, a worker and Postgres side by side.',
      },
      {
        question: 'Do I need Redis for FastAPI background jobs?',
        answer:
          "No. FastAPI's `BackgroundTasks` run short work in the same process, and a Postgres-backed queue such as Procrastinate keeps jobs in the database you already have. Celery, Dramatiq, RQ and ARQ need Redis or another broker; on Gregale, point them at a Redis you run elsewhere, because managed Redis is not generally available yet.",
      },
      {
        question: 'Does a background worker scale to zero on Gregale?',
        answer:
          'No. A worker service runs, and is billed, all the time, as it does on other platforms. The API pauses between requests, crons wake the app on a schedule, and jobs (in beta) run only while they work, so move scheduled or batch work there if the worker would mostly wait.',
      },
    ],
  },
  {
    slug: NODE_WORKER_SLUG,
    title: 'Running a Node.js API and a worker together',
    summary:
      'What makes an API and worker setup reliable, a Compose setup for Gregale that keeps both on one version, and what two small always-on processes cost on Fly.io, Railway, Gregale, DigitalOcean, Render and Heroku.',
    publishedOn: '2026-11-25',
    updatedOn: '2026-11-25',
    faq: [
      {
        question: 'What is the cheapest reliable way to run a Node.js API and a worker?',
        answer:
          'Two small processes from one repository, a queue in a managed database, and releases that keep both on the same version. On raw machine price Fly.io is cheapest, at $2.19 a month per 256 MB Machine. Gregale Hobby is $10 a month for both plus a managed PostgreSQL database, with the API unbilled while idle and automatic rollback (in beta).',
      },
      {
        question: 'Do I need Redis for a Node.js job queue?',
        answer:
          'Only for Redis-based queues such as BullMQ. pg-boss and Graphile Worker keep jobs in Postgres, so the database you already have, and its backups, cover the queue too.',
      },
      {
        question: 'Can the API and the worker deploy together on Gregale?',
        answer:
          "Yes. Describe both in a Compose file and deploy them as one project on Hobby or higher. With `depends_on` and `condition: service_healthy`, the worker's new release waits for the API's and fails with it, so the two never run mixed versions.",
      },
    ],
  },
  {
    slug: CLAUDE_CODE_SLUG,
    title: 'Let Claude Code deploy to production safely',
    summary:
      'Give Claude Code a Gregale agent key instead of your login or cloud credentials. It can deploy, read logs and roll back; risky production changes wait for your approval, new releases go to a small share of traffic first, and you can undo what it changed.',
    publishedOn: '2026-11-25',
    updatedOn: '2026-11-25',
    faq: [
      {
        question: 'Does Claude Code need my cloud credentials?',
        answer:
          "No. It gets its own Gregale agent key, or connects to Gregale's hosted MCP server (in preview) with OAuth. You never paste your own login or a cloud provider's keys into the session.",
      },
      {
        question: 'What can Claude Code do without asking?',
        answer:
          'Inspect apps, read logs and metrics, and deploy previews. Deletes, production deploys and rollbacks, credentials and billing changes wait for your approval unless you choose otherwise.',
      },
      {
        question: 'What if a deploy breaks production?',
        answer:
          'A production release gets 1% of traffic first, then 10%, 50% and 100%, and Gregale stops it when its 5xx rate, latency, crashes or memory get worse (progressive rollouts are in beta). `gregale mcp connection undo` reverses everything else the agent changed.',
      },
      {
        question: 'Does this work with Codex, Cursor or Gemini CLI?',
        answer:
          'Yes. They use the same CLI and agent key, and any MCP client can connect to the hosted MCP server. Gregale has a setup guide for each.',
      },
    ],
  },
  {
    slug: APPROVAL_SLUG,
    title: 'Human approval before an AI agent changes production',
    summary:
      'On Gregale, an AI coding agent has to ask a person before it deletes something, deploys or rolls back a production app, creates or rotates credentials, or changes billing. You approve or deny from a review link; the agent repeats the exact request once.',
    publishedOn: '2026-11-25',
    updatedOn: '2026-11-26',
    faq: [
      {
        question: 'Can the agent approve its own request?',
        answer:
          'No. Only the member who connected the agent, or an owner or admin of its organization, can decide, and only from a signed-in dashboard session, never with an API key. Approving a delete, production, credentials or billing request also needs a sign-in from the last 15 minutes.',
      },
      {
        question: 'Does every change need approval?',
        answer:
          "No. Reads and previews are not gated, and changing variables or settings in a stage scope does not ask. You choose which categories ask (`delete`, `production`, `credentials`, `billing`, `all` or `none`) when you create the agent's key.",
      },
      {
        question: 'Which agents does it work with?',
        answer:
          "Any agent that runs the `gregale` CLI with an agent key, such as Claude Code, Codex, Cursor or Gemini CLI, and any MCP client connected to Gregale's hosted MCP server, which is in preview.",
      },
      {
        question: 'What if nobody is watching the agent?',
        answer:
          'Subscribe an account webhook to `agent.approval.requested`, `agent.approval.approved` and `agent.approval.denied`. A request expires 30 minutes after it was made.',
      },
      {
        question: 'What does the review page show?',
        answer:
          "The exact method, path and body the agent will send, and the reason the agent gave, if any. You approve the request itself, not the agent's description of it.",
      },
    ],
  },
  {
    slug: UNDO_SLUG,
    title: 'Undo what an AI agent changed in production',
    summary:
      'Gregale keeps a 7-day log of every change an AI agent makes and can reverse them with one command: deploys and rollbacks, traffic splits, settings, scaling, variables, and the apps, crons, domains and databases it created or deleted.',
    publishedOn: '2026-11-25',
    updatedOn: '2026-11-25',
    faq: [
      {
        question: 'Is undo the same as rolling back a deploy?',
        answer:
          'No. A rollback restores code. Undo also puts back the settings, scaling, variables, traffic split, crons, domains and databases the agent changed, created or deleted, newest first.',
      },
      {
        question: "What can't undo reverse?",
        answer:
          "A secret the agent set or removed (Gregale keeps no copy of a replaced secret), an app's first deploy, an individual canary step and a deleted bucket. The plan lists anything it cannot reverse and why before you confirm.",
      },
      {
        question: 'What if someone changed the same thing after the agent did?',
        answer:
          "Undo leaves that resource as it is, so it never overwrites a person's later change. Pass `--force` to undo it anyway.",
      },
      {
        question: 'Can the agent undo its own mistakes?',
        answer:
          "It can plan an undo of its own changes, never another key's, with the MCP tools `gregale_plan_undo` and `gregale_apply_undo`. Applying always waits for your approval.",
      },
      {
        question: 'How long are changes kept?',
        answer: 'Seven days. Each change can be undone once.',
      },
    ],
  },
  {
    slug: BUDGET_SLUG,
    title: 'Cap what an AI agent adds to your hosting bill',
    summary:
      'Each AI agent on Gregale has a monthly budget for the always-on capacity it adds. Gregale prices every change before it is made; a change past the budget waits for your approval, with its added monthly cost on the review page.',
    publishedOn: '2026-11-25',
    updatedOn: '2026-11-25',
    faq: [
      {
        question: 'What does the agent budget count?',
        answer:
          "The always-on cost the agent's changes keep running: warm instances, services and workers, more RAM on warm instances, and prewarming. Traffic-driven usage is not counted; your account's spend cap still bounds it.",
      },
      {
        question: 'What is the default budget?',
        answer:
          "Half of your plan's default spend cap. You can set a budget per agent, make it unlimited, or go back to the default with `gregale mcp connection budget`.",
      },
      {
        question: 'Does the budget reset every month?',
        answer:
          "No. It holds the total always-on cost the agent's changes keep running, so capacity it added last month still counts. Lowering cost never asks and gives the budget back.",
      },
      {
        question: 'Can the agent check the cost before it asks?',
        answer:
          'Yes. `gregale app <slug> scale --plan`, the MCP tool `gregale_plan_scale`, or the header `Gregale-Agent-Preview: budget` prices a change, shows the budget left and whether a person would be asked, and changes nothing.',
      },
      {
        question: 'Can an organization cap every agent?',
        answer:
          "Yes. `gregale org agent policy set --max-budget` sets a ceiling; the lower of the agent's budget and the ceiling applies.",
      },
    ],
  },
  {
    slug: MCP_OPERATIONS_SLUG,
    title: 'Hosting platforms with an MCP server that deploys, reads logs and rolls back',
    summary:
      "Gregale, Vercel and Dokploy ship official MCP servers whose tools let an AI agent deploy, read logs and roll back. Render, Railway, DigitalOcean, Heroku, Cloud Run and Netlify deploy over MCP but have no rollback tool, and Fly.io's hosted server has no deploy tool. Checked on November 26, 2026.",
    publishedOn: '2026-11-26',
    updatedOn: '2026-11-26',
    faq: [
      {
        question:
          'Which hosting platforms have an MCP server that lets an AI agent deploy, read logs and roll back?',
        answer:
          "Gregale, Vercel and Dokploy, as of November 26, 2026. Render, Railway, DigitalOcean App Platform, Heroku, Google Cloud Run and Netlify can deploy over MCP but their servers have no rollback tool. Fly.io's hosted MCP server manages Machines, volumes and secrets but has no deploy or app-log tool.",
      },
      {
        question: 'Can an AI agent roll back a Render or Railway app over MCP?',
        answer:
          'Not with a tool: neither MCP server has one as of November 26, 2026. Both platforms can roll back from the dashboard, so the agent has to fall back to another route or ask you.',
      },
      {
        question:
          "Does an agent need my approval to deploy or roll back over Gregale's MCP server?",
        answer:
          'For a production app, yes by default. The tool call returns a review link, and the change goes through only after a person approves it in a signed-in session. Reads and previews are not gated.',
      },
      {
        question: "Can I give an agent read-only access to Gregale's MCP server?",
        answer:
          'Yes. Choose "Inspect only" when you connect, and the agent can list apps and deployments and read logs, metrics and health, but cannot deploy or roll back.',
      },
    ],
  },
  {
    slug: DATABASE_ROLLBACK_SLUG,
    title: 'Roll back a bad migration: code and database together',
    summary:
      'Rolling back code after a migration runs old code on the new schema. On Gregale, `gregale rollback --restore-databases` restores the managed PostgreSQL database to the moment before the migration as a new database and switches the app to it with the earlier code, keeping the original and its writes.',
    publishedOn: '2026-11-25',
    updatedOn: '2026-11-25',
    faq: [
      {
        question: 'How do I roll back a bad database migration in production?',
        answer:
          "Restore the database to the moment before the migration ran and run the code from before it against that copy. On Gregale, `gregale rollback my-api --to v41 --restore-databases` does both in one command, within the database's 7-day restore window.",
      },
      {
        question: 'Does rolling back a deploy roll back the database?',
        answer:
          'Not on its own, on Gregale or elsewhere: a plain rollback restores code and config. Gregale refuses a rollback to code older than a migration unless you acknowledge it, and `--restore-databases` rolls back the managed PostgreSQL database with the code.',
      },
      {
        question: 'What happens to writes made after the migration?',
        answer:
          'They stay in the original database, which is left unchanged and no longer bound to the app. The restored copy has the data up to the restore point, so you can compare the two and move rows by hand.',
      },
      {
        question: 'Is the app down during the rollback?',
        answer:
          'Briefly. It keeps serving until the restored copy is ready and its credentials are verified, then stops while the app switches: usually under a minute, plus a cold start.',
      },
      {
        question: 'Which plans can do this?',
        answer:
          'Managed PostgreSQL and its 7-day restore window are on Hobby, Pro and Scale. The one-command rollback needs room for one more database, which Pro and Scale have; on Hobby, restore with `gregale postgres restore`, attach the copy and roll back with `--acknowledge-releases`.',
      },
    ],
  },
  {
    slug: COLD_START_SLUG,
    title: 'Scale to zero without slow cold starts',
    summary:
      'Gregale scales idle apps to zero without booting them again: an app pauses in memory about a second after its last request and resumes in about a millisecond, and after 10 minutes it parks as a memory snapshot that wakes with its process already running.',
    publishedOn: '2026-11-25',
    updatedOn: '2026-11-26',
    faq: [
      {
        question: 'How do I avoid cold starts when scaling to zero?',
        answer:
          'Wake the app from a snapshot of its running process instead of booting it. Gregale pauses an idle app in memory about a second after its last request and parks it as a memory snapshot after 10 minutes, so the next request never waits for a full boot unless the node has no usable snapshot.',
      },
      {
        question: 'How fast does a parked app wake?',
        answer:
          "In Gregale's published benchmark, 100 snapshot restores of a 256 MiB app took 95 ms at the median and 138 ms at p95, measured inside the platform. A public request also includes network transit and your app's response time.",
      },
      {
        question: 'Am I billed while the app is idle?',
        answer:
          'No. Billing stops about a second after each request, when the app pauses, and a parked app uses no memory. An app that keeps working in the background is billed while it works.',
      },
      {
        question: 'Can I keep an instance warm anyway?',
        answer:
          'Yes, on Pro and Scale: `gregale app my-api --min 1` keeps an instance running, billed like any running instance.',
      },
    ],
  },
  {
    slug: 'render-vs-railway-vs-flyio',
    comparison: ['render', 'railway', 'fly'],
    title: 'Render vs Railway vs Fly.io for a production API',
    summary:
      'Render, Railway and Fly.io compared for a production API on price, regions, managed Postgres and releases, with where each one fits and where Gregale fits as a fourth option.',
    publishedOn: '2026-11-25',
    updatedOn: '2026-11-26',
    faq: [
      {
        question: 'Should I use Render, Railway or Fly.io for a production API?',
        answer:
          'Render for a fixed price per instance and a mature managed Postgres, Railway for several databases in one project paid by usage, and Fly.io for users on several continents and control over each Machine. None of them rolls a release back on its own when its error rate rises; Gregale sends each production release to 1%, 10%, 50% and 100% of traffic and rolls it back automatically on errors (in beta).',
      },
      {
        question: 'Which is cheapest for a small production API: Render, Railway or Fly.io?',
        answer:
          'Fly.io, on raw price: a 512 MB Machine is $3.69 a month and Fly.io Managed Postgres starts at $4 a month in its lowest-priced regions. Render is $13 a month for a Starter instance and the smallest paid Render Postgres. Railway bills by usage against a $5 monthly minimum.',
      },
      {
        question: 'Do Render, Railway and Fly.io roll back a bad release automatically?',
        answer:
          'Not when errors rise after a release goes live. Render and Railway send all traffic to a new version once its health check passes and leave rolling back to you. Fly.io replaces Machines one at a time, and its canary strategy health-checks one new Machine first.',
      },
    ],
  },
  {
    slug: 'railway-alternatives',
    alternativesTo: 'railway',
    title: 'Railway alternatives in 2026',
    summary:
      'Render, Fly.io, Northflank, Google Cloud Run, DigitalOcean App Platform, Heroku and Gregale compared on free plans, prices, idle billing and releases, with where each one fits better than Railway.',
    publishedOn: '2026-11-24',
    updatedOn: '2026-11-26',
    faq: [
      {
        question: 'What is the best Railway alternative?',
        answer:
          'It depends on why you are leaving. Render is the closest like-for-like move, Fly.io suits apps that must run in many regions, Google Cloud Run suits teams already on Google Cloud, and Gregale suits small teams that want gradual releases with automatic rollback, apps that stop billing when idle, and a fixed plan with a spend cap.',
      },
      {
        question: 'Which Railway alternative has a free plan?',
        answer:
          'Gregale, Render, Fly.io, Northflank and Google Cloud Run all have a free option. Gregale Free covers 1 app with 256 MB and 20 GB-RAM-hours a month. DigitalOcean App Platform is free for static sites only, and Heroku has no free plan.',
      },
      {
        question: 'Is there a Railway alternative with automatic rollback?',
        answer:
          'Gregale sends every production release to 1%, then 10%, 50% and 100% of traffic and rolls it back on its own if the new version returns more 5xx errors, on every plan (in beta). Render, Railway and Heroku switch all traffic to a healthy new version and leave rollback to you.',
      },
    ],
  },
  {
    slug: 'heroku-alternatives',
    alternativesTo: 'heroku',
    title: 'Heroku alternatives in 2026',
    summary:
      'Render, Railway, Fly.io, Northflank, Google Cloud Run, DigitalOcean App Platform and Gregale compared on free plans, prices, idle billing and releases, with where each one fits better than Heroku.',
    publishedOn: '2026-11-24',
    updatedOn: '2026-11-26',
    faq: [
      {
        question: 'What is the best Heroku alternative now that Heroku is in sustaining mode?',
        answer:
          'Render is the closest match to the Heroku model. Railway suits teams that want several databases in one click, Fly.io suits apps that must run in many regions, and Gregale suits small teams that want the Heroku workflow (it reads your Procfile) with gradual releases, automatic rollback and apps that stop billing when idle.',
      },
      {
        question: 'Can I move a Heroku app to Gregale without code changes?',
        answer:
          'Usually, yes. Gregale reads the same `Procfile`, including its release command, builds Node, Python and Go from source without a Dockerfile, and takes config vars as environment variables and secrets. Heroku Scheduler jobs become crons and worker dynos become background services.',
      },
      {
        question: 'Which Heroku alternative has a free plan?',
        answer:
          'Gregale, Render, Railway, Fly.io, Northflank and Google Cloud Run all have a free option. Gregale Free covers 1 app with 256 MB and 20 GB-RAM-hours a month. Heroku itself has no free plan: its cheapest option is the $5 Eco plan, which sleeps after 30 minutes idle.',
      },
    ],
  },
  {
    slug: 'render-alternatives',
    alternativesTo: 'render',
    title: 'Render alternatives in 2026',
    summary:
      'Railway, Fly.io, Heroku, Northflank, Google Cloud Run, DigitalOcean App Platform and Gregale compared on free plans, prices, idle billing and releases, with where each one fits better than Render.',
    publishedOn: '2026-11-24',
    updatedOn: '2026-11-26',
    faq: [
      {
        question: 'What is the best Render alternative?',
        answer:
          'It depends on what you need. Railway suits teams that want several databases in one click, Fly.io suits apps that must run in many regions, Google Cloud Run suits teams already on Google Cloud, and Gregale suits small teams that want paid apps to stop billing when idle and releases that roll back on their own.',
      },
      {
        question: 'Which Render alternative does not charge for idle apps?',
        answer:
          'On Gregale an idle app pauses about a second after its last request and is not billed while paused, on every plan. Google Cloud Run with request-based billing charges only while a service handles requests. Fly.io Machines can stop when idle and then bill only their root filesystem. Render paid instances run, and bill, all the time.',
      },
      {
        question: 'Is there a Render alternative with automatic rollback?',
        answer:
          'Gregale sends every production release to 1%, then 10%, 50% and 100% of traffic and rolls it back on its own if the new version returns more 5xx errors, on every plan (in beta). Render, Railway and Heroku switch all traffic to a healthy new version and leave rollback to you.',
      },
    ],
  },
  {
    slug: 'flyio-alternatives',
    alternativesTo: 'fly',
    title: 'Fly.io alternatives in 2026',
    summary:
      'Render, Railway, Heroku, Northflank, Google Cloud Run, DigitalOcean App Platform and Gregale compared on free plans, prices, idle billing and releases, with where each one fits better than Fly.io.',
    publishedOn: '2026-11-24',
    updatedOn: '2026-11-26',
    faq: [
      {
        question: 'What is the best Fly.io alternative?',
        answer:
          'Render and Railway suit teams that want Git deploys without infrastructure configuration, Google Cloud Run suits apps that need many regions, and Gregale suits small teams that want Firecracker isolation without managing Machines, with gradual releases and automatic rollback.',
      },
      {
        question: 'Is there a Fly.io alternative that also uses Firecracker microVMs?',
        answer:
          'Yes. Gregale runs every app instance in its own Firecracker microVM, like Fly.io Machines, but manages the instances for you and pauses idle apps automatically. It runs in one region today, where Fly.io runs in many.',
      },
      {
        question: 'Can I move a Fly.io app to Gregale?',
        answer:
          'Usually. If your app builds from a Dockerfile, Gregale can run that image. Apps that rely on a Fly.io volume need their files moved to managed PostgreSQL or object storage, because Gregale instances have no durable local disk.',
      },
    ],
  },
  {
    slug: BEST_CLOUD_AGENTS_SLUG,
    title: 'Best cloud platform for AI coding agents in 2026',
    summary:
      'What makes a cloud safe for Claude Code, Codex, Cursor and Gemini CLI: non-interactive JSON output, scoped agent keys, human approval on production mutations, cost previews, undo and automatic 5xx rollbacks, compared across Gregale, Vercel, Railway, Render, Fly.io and Cloud Run.',
    publishedOn: '2026-11-25',
    updatedOn: '2026-11-26',
    faq: [
      {
        question: 'What is the best cloud platform for AI coding agents?',
        answer:
          'Gregale is built for backend APIs, workers, crons and MCP servers deployed by coding agents: it enforces scoped `--agent` keys, approval links for production mutations, per-agent cost previews and budgets, undo for non-code edits, and 1% to 100% canary rollbacks. Vercel fits frontend Next.js apps, and Google Cloud Run fits services tied into a GCP VPC.',
      },
      {
        question: 'Why should an AI coding agent not use my personal cloud login?',
        answer:
          'A personal login or admin token lets a single agent mistake delete production resources, expose services publicly or raise scaling limits without review. On Gregale, `gregale key create --agent` creates a separate API-enforced identity with its own spend cap and human approval gates.',
      },
      {
        question: 'How do AI agents discover and operate Gregale without scraping HTML?',
        answer:
          'Every doc, article, research study and comparison is available at a `.md` URL and via `Accept: text/markdown` content negotiation, indexed in `/llms.txt` and `/llms-small.txt`, paired with a hosted MCP server (`https://api.gregale.dev/mcp`, discovered via `/.well-known/mcp/server-card.json`) and `gregale --non-interactive --json`.',
      },
    ],
  },
  {
    slug: 'cloud-run-alternatives',
    alternativesTo: 'cloud-run',
    title: 'Google Cloud Run alternatives in 2026',
    summary:
      'Gregale, Fly.io, Render, Railway, Northflank, DigitalOcean App Platform and Heroku compared on free tiers, prices, idle billing, bundled Postgres and releases.',
    publishedOn: '2026-11-25',
    updatedOn: '2026-11-26',
    faq: [
      {
        question: 'What is the best Google Cloud Run alternative?',
        answer:
          'Fly.io fits teams wanting multi-region Firecracker containers, Render and Railway fit classic Git-push PaaS with bundled databases, and Gregale fits small teams that want per-second billing that stops when idle alongside bundled PostgreSQL, PR previews and automatic canary rollbacks without configuring GCP IAM or Cloud Deploy.',
      },
      {
        question: 'Which Google Cloud Run alternative includes managed Postgres and previews?',
        answer:
          'Gregale bundles managed PostgreSQL (`DATABASE_URL`), PR preview environments, crons and workers alongside compute. Gregale Free covers 1 app with 256 MB and 20 GB-RAM-hours a month, and Hobby adds managed Postgres for $10 a month.',
      },
      {
        question: 'Is there a Cloud Run alternative with automatic canary rollbacks?',
        answer:
          'Gregale sends every production release through 1%, 10%, 50% and 100% of traffic and rolls back automatically if the new version returns more 5xx errors (in beta). Cloud Run requires Cloud Deploy for automated phased rollbacks.',
      },
    ],
  },
  {
    slug: 'vercel-alternatives',
    alternativesTo: 'vercel',
    title: 'Vercel alternatives for backends and full-stack apps in 2026',
    summary:
      'Gregale, Render, Railway, Fly.io, Google Cloud Run, Northflank and DigitalOcean App Platform compared on per-seat pricing, duration limits, bundled Postgres and releases.',
    publishedOn: '2026-11-25',
    updatedOn: '2026-11-26',
    faq: [
      {
        question: 'What is the best Vercel alternative for backend APIs and workers?',
        answer:
          'Render and Railway fit full-stack teams wanting traditional services and databases, Fly.io fits multi-region containers and WebSockets, and Gregale fits teams wanting Firecracker microVMs without function execution timeouts, bundled managed PostgreSQL, no per-seat fee and automatic canary rollbacks.',
      },
      {
        question: 'Which Vercel alternative has a free tier without per-seat fees?',
        answer:
          'Gregale Free covers 1 app with 256 MB and 20 GB-RAM-hours a month with no per-seat charge. Render, Railway, Fly.io, Google Cloud Run and Northflank also offer free compute tiers.',
      },
      {
        question: 'Can I run Next.js and a persistent worker together outside Vercel?',
        answer:
          'Yes. Gregale, Render, Railway and Fly.io all run Next.js servers alongside background worker processes and managed databases with no serverless 300s or 800s execution cutoff.',
      },
    ],
  },
  {
    slug: 'koyeb-alternatives',
    alternativesTo: 'koyeb',
    title: 'Koyeb alternatives in 2026',
    summary:
      'Gregale, Fly.io, Render, Railway, Northflank, Google Cloud Run and DigitalOcean App Platform compared on Firecracker scale-to-zero, managed Postgres pricing, volumes and canary rollbacks.',
    publishedOn: '2026-11-25',
    updatedOn: '2026-11-26',
    faq: [
      {
        question: 'What is the best Koyeb alternative?',
        answer:
          'Fly.io fits teams wanting multi-region Firecracker Machines and regional volumes, Render and Railway fit full-stack apps wanting lower paid Postgres entry prices than Koyeb ($29.76/mo Small Postgres), and Gregale fits teams wanting Firecracker microVMs, ~1s idle pause billing, bundled Postgres inside $10/mo Hobby and automatic 1% canary rollbacks.',
      },
      {
        question: 'Which Koyeb alternative has a free plan with no sleeping Postgres timer?',
        answer:
          'Gregale Free covers 1 app with 256 MB and 20 GB-RAM-hours a month (with Postgres starting at Hobby $10/mo), and Northflank Sandbox offers an always-on free database addon. Koyeb Free Postgres sleeps after 5 minutes idle and caps at 50 compute hours a month.',
      },
      {
        question: 'Do any Koyeb alternatives also use Firecracker microVMs?',
        answer:
          'Yes. Both Fly.io and Gregale isolate each app instance in its own Firecracker microVM. Gregale manages instances automatically and pauses billing ~1s after each request.',
      },
    ],
  },
  {
    slug: 'northflank-alternatives',
    alternativesTo: 'northflank',
    title: 'Northflank alternatives in 2026',
    summary:
      'Gregale, Railway, Render, Fly.io, Koyeb, Google Cloud Run and DigitalOcean App Platform compared on idle billing, Kubernetes complexity, BYOC, Postgres and automatic rollbacks.',
    publishedOn: '2026-11-25',
    updatedOn: '2026-11-26',
    faq: [
      {
        question: 'What is the best Northflank alternative?',
        answer:
          'Railway and Render fit teams wanting simpler Git-to-URL PaaS workflows without cluster pipelines, Fly.io and Koyeb fit multi-region Firecracker workloads, and Gregale fits teams wanting ~1s idle pause billing, automatic 1%→100% 5xx canary rollbacks and coding-agent safety guardrails.',
      },
      {
        question: 'Which Northflank alternative stops billing when paid apps are idle?',
        answer:
          'Gregale pauses each app ~1s after its last request and stops billing immediately on every plan (Gregale Free covers 1 app with 256 MB and 20 GB-RAM-hours a month). Google Cloud Run and Koyeb also scale paid containers to zero.',
      },
      {
        question: 'Do these alternatives support Bring-Your-Own-Cloud (BYOC)?',
        answer:
          'Most managed PaaS options run on their own cloud rather than inside your AWS or GCP account. Stay on Northflank if BYOC inside EKS, GKE or AKS is a hard requirement.',
      },
    ],
  },
  {
    slug: 'coolify-alternatives',
    alternativesTo: 'coolify',
    title: 'Coolify alternatives in 2026',
    summary:
      'Gregale, Dokploy, Railway, Render and Fly.io compared against self-hosted Coolify on maintenance, idle billing, Firecracker isolation, WAF and rollbacks.',
    publishedOn: '2026-11-26',
    updatedOn: '2026-11-26',
    faq: [
      {
        question: 'What is the best managed alternative to Coolify?',
        answer:
          'Railway and Render offer easy Git-push PaaS workflows, Fly.io fits multi-region Firecracker containers, and Gregale adds ~1s idle pause billing, default hard spend caps, pre-wake OWASP WAF, and automatic 1%→100% 5xx canary rollbacks.',
      },
      {
        question: 'Can Gregale match Coolify VPS pricing for low-traffic apps?',
        answer:
          'For intermittent or low-traffic APIs, Gregale Free covers 1 app with 256 MB and 20 GB-RAM-hours a month at $0, and paid apps pause billing ~1 second after requests complete instead of running 24/7 on a paid VPS.',
      },
      {
        question: 'When should I stay on Coolify instead of moving to a managed PaaS?',
        answer:
          'Stay on Coolify + Hetzner or DigitalOcean when you run steady heavy 24/7 services and want maximum raw RAM/CPU per dollar, durable host volumes, and full Linux root ownership.',
      },
    ],
  },
  {
    slug: 'cloudflare-workers-alternatives',
    alternativesTo: 'cloudflare-workers',
    title: 'Cloudflare Workers alternatives in 2026',
    summary:
      'Gregale, Google Cloud Run, Fly.io, Railway and Render compared against Cloudflare Workers when you need full CPython/Docker, bundled Postgres and automatic canary rollbacks.',
    publishedOn: '2026-11-26',
    updatedOn: '2026-11-26',
    faq: [
      {
        question: 'What is the best Cloudflare Workers alternative for Python and Docker APIs?',
        answer:
          'Google Cloud Run, Fly.io and Gregale run full Linux Docker containers without Pyodide or V8 isolate constraints. Gregale adds ~1s idle pause billing, bundled managed PostgreSQL with PITR rollback, and automatic 1%→100% 5xx canary rollbacks.',
      },
      {
        question: 'Does Gregale have a free plan without isolate limits?',
        answer:
          'Yes. Gregale Free covers 1 app with 256 MB and 20 GB-RAM-hours a month on full Firecracker microVMs, stopping at the allowance rather than billing overage.',
      },
      {
        question: 'When is Cloudflare Workers still the better fit?',
        answer:
          'Stay on Cloudflare Workers when you need sub-10ms edge execution across 300+ global PoPs, zero egress charges, or tight integration with D1, KV, and Durable Objects.',
      },
    ],
  },
  {
    slug: 'aws-app-runner-alternatives',
    alternativesTo: 'aws',
    title: 'AWS App Runner alternatives in 2026',
    summary:
      'Gregale, Google Cloud Run, Render, Railway, Fly.io, DigitalOcean App Platform and Northflank compared against AWS App Runner on idle billing, bundled Postgres, previews and automatic rollbacks.',
    publishedOn: '2026-11-26',
    updatedOn: '2026-11-26',
    faq: [
      {
        question: 'What is the best AWS App Runner alternative with bundled PostgreSQL?',
        answer:
          'Render, Railway and Gregale bundle managed PostgreSQL without requiring separate RDS instances or VPC connectors. Gregale also adds ~1s idle pause billing, PR preview environments, hard monthly spend caps and automatic 1%→100% 5xx canary rollbacks.',
      },
      {
        question:
          'Do any AWS App Runner alternatives stop billing without manually pausing services?',
        answer:
          'Yes. Google Cloud Run scales idle revisions to zero when min instances is 0, and Gregale pauses each Firecracker microVM ~1 second after requests stop. On Gregale Free, Gregale Free covers 1 app with 256 MB and 20 GB-RAM-hours a month at $0.',
      },
      {
        question: 'When should I stay on AWS App Runner?',
        answer:
          'Stay on AWS App Runner if your containers depend directly on AWS IAM roles, PrivateLink, Amazon RDS inside the same VPC, or consolidated AWS enterprise billing.',
      },
    ],
  },
  {
    slug: 'digitalocean-app-platform-alternatives',
    alternativesTo: 'digitalocean',
    title: 'DigitalOcean App Platform alternatives in 2026',
    summary:
      'Gregale, Render, Railway, Fly.io, Heroku, Koyeb and Northflank compared against DigitalOcean App Platform on backend free tiers, ~1s idle pause, Postgres pricing and canary rollbacks.',
    publishedOn: '2026-11-26',
    updatedOn: '2026-11-26',
    faq: [
      {
        question:
          'What is the best DigitalOcean App Platform alternative for intermittent backends?',
        answer:
          'Railway Serverless, Fly.io Machines, Koyeb and Gregale stop compute billing when idle rather than charging a flat monthly container rate 24/7. Gregale pauses ~1 second after each request, includes managed PostgreSQL on the $10 Hobby plan and enforces default 5xx canary rollbacks.',
      },
      {
        question: 'Does Gregale offer a free backend tier unlike DigitalOcean App Platform?',
        answer:
          'Yes. DigitalOcean App Platform free covers static sites only, whereas Gregale Free covers 1 app with 256 MB and 20 GB-RAM-hours a month on full Firecracker microVMs without overage billing.',
      },
      {
        question: 'When is DigitalOcean App Platform still the better fit?',
        answer:
          'Stay on DigitalOcean App Platform when your workloads run steady 24/7 traffic alongside existing DigitalOcean Droplets, Spaces buckets or Managed Databases.',
      },
    ],
  },
  {
    slug: 'replit-alternatives',
    alternativesTo: 'replit',
    title: 'Replit alternatives in 2026',
    summary:
      'Gregale, Railway, Render, Fly.io, Vercel and DigitalOcean App Platform compared for moving Replit and AI-built backends into Git-owned production with spend caps and automatic rollbacks.',
    publishedOn: '2026-11-26',
    updatedOn: '2026-11-26',
    faq: [
      {
        question: 'What is the best Replit alternative once my app moves to GitHub?',
        answer:
          'Railway, Render and Gregale deploy directly from GitHub with managed PostgreSQL. Gregale adds Firecracker microVM isolation, ~1s idle pause billing, hard monthly spend caps, scoped AI agent approval gates and automatic 1%→100% 5xx canary rollbacks.',
      },
      {
        question: 'Is there a free plan to try migrating off Replit?',
        answer:
          'Yes. Gregale Free covers 1 app with 256 MB and 20 GB-RAM-hours a month at $0 and stops at the allowance rather than billing overages, with PR preview environments included.',
      },
      {
        question: 'When should I stay on Replit?',
        answer:
          'Stay on Replit when you want an integrated browser IDE and built-in visual workspace for rapid prototyping without managing local tools or Git workflows.',
      },
    ],
  },
  {
    slug: CURSOR_SLUG,
    title: 'Let Cursor deploy to production safely',
    summary:
      'Give Cursor a scoped Gregale `--agent` token via `GREGALE_TOKEN` and project rules in `AGENTS.md`, or connect it via `gregale mcp connect --client cursor`, with server-side approval gates, budgets, undo and canary rollbacks.',
    publishedOn: '2026-11-25',
    updatedOn: '2026-11-25',
    faq: [
      {
        question: 'How do I let Cursor deploy to Gregale without risking production?',
        answer:
          'Run `gregale key create cursor-agent --agent`, set it as `GREGALE_TOKEN` in Cursor instead of relying on your personal `gregale login`, add `AGENTS.md` via `gregale init --agents`, and let Gregale enforce approval links, per-agent spend caps and 1% canary rollbacks in the API.',
      },
      {
        question: 'Does Cursor support Gregale’s MCP server?',
        answer:
          'Yes. Run `gregale mcp connect --client cursor` to connect Cursor to `https://api.gregale.dev/mcp` over OAuth.',
      },
      {
        question: 'Are `.cursorrules` enough to stop unsafe production commands?',
        answer:
          'No. Prompt rules can be ignored or misinterpreted, whereas Gregale enforces approval gates, budget checks, mutation undo and 5xx canary rollbacks server-side whenever `GREGALE_TOKEN` is an `--agent` key.',
      },
    ],
  },
  {
    slug: CODEX_SLUG,
    title: 'Let OpenAI Codex deploy to production safely',
    summary:
      'Configure Codex with a scoped `gregale key create --agent` token in `GREGALE_TOKEN`, sandbox network access in `~/.codex/config.toml`, and `AGENTS.md` deploy rules enforced by Gregale API guardrails.',
    publishedOn: '2026-11-25',
    updatedOn: '2026-11-25',
    faq: [
      {
        question: 'How do I connect OpenAI Codex to Gregale safely?',
        answer:
          'Create a scoped `--agent` key with `gregale key create codex-agent --agent`, pass it in `GREGALE_TOKEN`, run `gregale init --agents`, and allow outbound CLI access in `~/.codex/config.toml` under `[sandbox_workspace_write]` (`network_access = true`).',
      },
      {
        question: 'Why use `--non-interactive --json` with Codex?',
        answer:
          'In `--non-interactive --json` mode, `gregale` never pauses for prompts or opens a browser login flow and emits structured JSON error codes on stderr so Codex can inspect errors cleanly.',
      },
      {
        question: 'Can I undo scaling or env changes Codex made?',
        answer:
          'Yes. `gregale mcp connection undo` reverts non-code mutations such as scaling limits, environment variables, crons and domains logged over the last 7 days.',
      },
    ],
  },
  {
    slug: GEMINI_CLI_SLUG,
    title: 'Let Gemini CLI deploy to production safely',
    summary:
      'Authenticate Gemini CLI with a scoped Gregale `--agent` key, load `AGENTS.md` via `.gemini/settings.json`, and let Gregale enforce human approvals, budget previews, undo and 5xx canary rollbacks in production.',
    publishedOn: '2026-11-25',
    updatedOn: '2026-11-25',
    faq: [
      {
        question: 'How does Gemini CLI load Gregale deployment instructions?',
        answer:
          'Running `gregale init --agents` updates `AGENTS.md` and configures `.gemini/settings.json` when a `.gemini/` directory exists so Gemini CLI reads `AGENTS.md` automatically.',
      },
      {
        question: 'What if I use a personal Google AI account instead of Enterprise Gemini CLI?',
        answer:
          'Free and Google AI Pro/Ultra accounts use Antigravity rather than standalone Gemini CLI; see the Antigravity guide at `/docs/antigravity`. Both share the same `--agent` key and API guardrails.',
      },
      {
        question: 'Can Gemini CLI roll back both code and Postgres after a failed migration?',
        answer:
          'Yes, on paid plans: `gregale rollback --restore-databases` restores managed PostgreSQL to the release point in time and switches the app with earlier code.',
      },
    ],
  },
  {
    slug: REALTIME_SCALE_ZERO_SLUG,
    title: 'Hold WebSocket and SSE connections while your backend scales to zero',
    summary:
      'Gregale managed realtime holds client WebSocket and SSE sockets plus heartbeats at the edge while your backend microVM parks at zero billed compute, waking only on client messages or publishes. Core endpoints are in beta on every paid plan; resumable v2, history and channel rules are in per-account preview.',
    publishedOn: '2026-11-26',
    updatedOn: '2026-11-26',
    faq: [
      {
        question: 'Can WebSocket and SSE clients stay connected while the backend scales to zero?',
        answer:
          'Yes. With managed realtime (in beta on paid plans), Gregale holds the client WebSocket or SSE socket and answers heartbeats at the edge while your app parks unbilled. Client frames invoke your `/realtime/message` callback, and `gregale realtime publish` pushes updates without keeping the app pinned open.',
      },
      {
        question: 'How is managed realtime priced on Gregale?',
        answer:
          'There is no separate per-connection surcharge. Core realtime is included on Hobby (`200` concurrent connections), Pro (`1,000`), and Scale (`5,000`); delivered messages count toward monthly app egress.',
      },
      {
        question: 'When should I use self-managed WebSockets instead of managed realtime?',
        answer:
          'Use `gregale app <slug> --websocket-enabled` for constant, high-frequency streams such as real-time games or audio signaling where the microVM needs to stay running anyway, or if you need GA retained history before your account has the resumable preview enabled.',
      },
    ],
  },
  {
    slug: INBOUND_WEBHOOKS_SLUG,
    title: 'Receive Stripe and signed webhooks while scaled to zero',
    summary:
      'Gregale verifies Stripe and HMAC-SHA256 webhooks at the edge while your app is parked, persists them to a durable invocation queue, immediately responds `202 Accepted`, and delivers them with async retries and dead-letter replay on Hobby, Pro and Scale.',
    publishedOn: '2026-11-26',
    updatedOn: '2026-11-26',
    faq: [
      {
        question: 'How does Gregale handle Stripe webhooks when my backend is scaled to zero?',
        answer:
          'On Hobby, Pro and Scale, Gregale verifies the Stripe signature at the edge before waking your app, records the durable receipt with event-ID deduplication, answers `202 Accepted` immediately, and then wakes the app to POST the payload to `delivery_path`.',
      },
      {
        question: 'Why does Gregale omit Stripe-Signature when delivering queued webhooks?',
        answer:
          'The original timestamp inside `Stripe-Signature` can expire during a cold start or async retry. Gregale verifies the provider signature before returning `202`, strips caller-supplied `X-Gregale-Webhook-*` and `X-Gregale-Event-*` headers on public routes, and sets `X-Faas-Invocation-Source: inbound_webhook`.',
      },
      {
        question: 'What happens when a webhook handler fails or secrets rotate?',
        answer:
          'Handler errors, `408` and `429` trigger async retries and dead-letter storage replayable with `gregale dlq replay`. Secret rotation keeps the old secret valid for 24 hours without changing the endpoint URL.',
      },
    ],
  },
  {
    slug: EDGE_CACHE_SLUG,
    title: 'Cache public API responses at the edge without waking your app',
    summary:
      'Declare gateway caching with `gregale edge cache` using `stale-while-revalidate`, `stale-if-error`, query-order isolation and `Cache-Tag` purging, serving cache hits without waking your microVM while bypassing any request carrying cookies or `Authorization`.',
    publishedOn: '2026-11-26',
    updatedOn: '2026-11-26',
    faq: [
      {
        question: 'Do edge cache hits wake my app or count toward compute billing?',
        answer:
          'No. Responses served fresh or stale from Gregale gateway cache do not wake your app or consume compute. Delivered bytes still count toward monthly egress.',
      },
      {
        question: 'How does Gregale prevent leaking authenticated responses from the cache?',
        answer:
          'Any request with an `Authorization` header or any cookie bypasses the cache completely. Responses carrying `Set-Cookie`, `Cache-Control: no-store`, or `Cache-Control: private` are never cached, and cache keys isolate deployment cohorts and query parameter order.',
      },
      {
        question: 'Can I invalidate cached API responses by tag across routes?',
        answer:
          'Yes. Emit `Cache-Tag` headers on cacheable origin responses (stripped before clients see them) and run `gregale edge cache purge <app> --tag <tag>`. Purges are written to a replayable ledger verifiable at `/v1/apps/{slug}/policy/status`.',
      },
    ],
  },
  {
    slug: OUTBOUND_RELAY_SLUG,
    title: 'Call Stripe, OpenAI and third-party APIs without API keys in your app',
    summary:
      'Gregale outbound integrations (in preview per account on Hobby, Pro and Scale) inject sealed `Authorization` credentials outside your microVM at `$GREGALE_OUTBOUND_URL`, enforcing method/path allowlists, circuit breakers and daily request budgets.',
    publishedOn: '2026-11-26',
    updatedOn: '2026-11-26',
    faq: [
      {
        question:
          'How can my app call Stripe or OpenAI without holding API keys in environment variables?',
        answer:
          'In the outbound integrations preview (Hobby, Pro and Scale, enabled per account), you upload the `Authorization` header once to Gregale, bind the integration to an app, and call `$GREGALE_OUTBOUND_URL/i/{id}/...` with no credentials in the container.',
      },
      {
        question: 'What guardrails can the outbound relay enforce?',
        answer:
          'Each integration enforces public-IP-only HTTPS origins, allowed HTTP methods and path prefixes (which app bindings can only narrow), per-second rate limits, circuit breakers and optional `daily_request_limit` caps per integration and per app.',
      },
      {
        question: 'Is outbound relay available for every third-party SDK?',
        answer:
          'It is currently in per-account preview and works for HTTPS APIs authenticated with an `Authorization` header. Providers needing custom HMAC request signing headers or client mTLS certificates should keep using `gregale secrets`.',
      },
    ],
  },
  {
    slug: OPENAPI_GATE_SLUG,
    title: 'Block breaking OpenAPI changes and probe routes before traffic shifts',
    summary:
      'Validate OpenAPI changes with `gregale api spec preview`, `diff` and hash-pinned `apply`—exiting `2` on breaks and `3` on `UNKNOWN` schema changes while blocking promotion—and probe up to ten `x-gregale-hosting-check: true` GET routes on the exact candidate.',
    publishedOn: '2026-11-26',
    updatedOn: '2026-11-26',
    faq: [
      {
        question: 'How does Gregale block breaking OpenAPI changes before deployment?',
        answer:
          'Run `gregale api spec preview`, `diff` and hash-pinned `apply --confirm --preview-sha256`. Confirmed breaks such as dropping a `required` response field exit with code `2`, while ambiguous `oneOf`, `anyOf`, `enum`, or `format` edits report `UNKNOWN` with exit code `3` and block promotion.',
      },
      {
        question: 'How do pre-promotion OpenAPI route checks handle authenticated endpoints?',
        answer:
          'Mark up to ten static, read-only `GET` operations with `x-gregale-hosting-check: true`. Gregale probes the exact new candidate and treats `2xx`, `3xx`, `401`, and `403` as passes while failing `404`, `429`, and `5xx`, proving auth-gated routes exist without storing test credentials.',
      },
      {
        question: 'Do OpenAPI checks replace runtime canary rollouts?',
        answer:
          'No. Route checks confirm candidate reachability and exit `2`/`3` rules catch static schema regressions before traffic shifts, while Gregale canary rollouts monitor real production error rates after promotion.',
      },
    ],
  },
  {
    slug: CODE_WORKFLOWS_SLUG,
    title: 'Write durable workflows that sleep for months without a running VM',
    summary:
      'Write durable retries, multi-day sleeps (30 days on Hobby, 90 on Pro, 365 on Scale), and event waits as plain async functions in Node, Python or Go that hold zero running VM while parked (in preview on Hobby and up).',
    publishedOn: '2026-11-26',
    updatedOn: '2026-11-26',
    faq: [
      {
        question: 'Do durable code workflows keep a VM running while sleeping for days?',
        answer:
          'No. In this Hobby+ preview, `wf.sleep` and `wf.waitForEvent` park the workflow run with zero compute running and replay the function from stored step results once a timer fires or an event arrives.',
      },
      {
        question: 'Which languages support code-first workflows on Gregale?',
        answer:
          'Node (`@gregale/sdk-node/workflows`), Python (`faas_sdk.workflows`), and Go (`github.com/gregale-dev/gregale-go`), with local in-process test runners (`runWorkflowLocally`) included.',
      },
      {
        question: 'What limits apply to a code-first workflow run?',
        answer:
          'A run can execute up to 1,000 operations and record 1.5 MiB total, with 960 KiB of JSON per step call result and workflow output. Store larger artifacts in object storage and return their keys.',
      },
    ],
  },
  {
    slug: SECRET_ROTATION_SLUG,
    title: 'Rotate and revoke secrets without restarting containers or leaking snapshots',
    summary:
      'Every secret mutation on Gregale invalidates memory snapshots so restored VMs never serve stale keys, `--restart` performs a draining rolling replacement, and images with `com.gregale.secret-reload-signal` hot-reload in-process with verifiable acknowledgements.',
    publishedOn: '2026-11-26',
    updatedOn: '2026-11-27',
    faq: [
      {
        question: 'Can a restored scale-to-zero snapshot serve an old secret after rotation?',
        answer:
          'No. Rotating or deleting a secret immediately invalidates existing memory snapshots, forcing the next wake to cold-boot with the current secret versions before taking a fresh snapshot.',
      },
      {
        question: 'How does zero-restart secret reload verify my app updated its pools?',
        answer:
          'Images with `com.gregale.secret-reload-signal` receive an atomic mode-`0400` snapshot file and process signal, and POST a generation-scoped self-attestation to `FAAS_SECRETS_RELOAD_ACK_ENDPOINT` checked by `--wait-for-ack`.',
      },
      {
        question: 'What happens if my image does not handle reload signals?',
        answer:
          'Use `gregale env rotate --restart` for a draining rolling replacement. Commands with `--wait-for-ack` intentionally fail non-zero rather than pretending a non-reloading container rotated.',
      },
      {
        question:
          'Does the old database password stop working as soon as I rotate a managed Postgres credential?',
        answer:
          'No. `gregale postgres bindings rotate BINDING_ID --wait` keeps the previous login valid until Gregale confirms the rolling runtime refresh, then revokes it. The binding reports `rotation_pending` while both logins work, and the `rest-api-postgres` starters adopt the new credential by swapping their connection pool in-process.',
      },
    ],
  },
  {
    slug: INTERNAL_SERVICES_SLUG,
    title: 'Private service-to-service networking with caller allowlists and no VPC',
    summary:
      'Apps in the same account reach one another privately by name (`GREGALE_SERVICE_*_URL` and `.internal`) with zero VPC setup, while target caller allowlists, path scopes, deadlines and default-deny PR preview rules run at the proxy before waking targets.',
    publishedOn: '2026-11-26',
    updatedOn: '2026-11-26',
    faq: [
      {
        question: 'Do I need a VPC or private DNS setup for internal service calls on Gregale?',
        answer:
          'No. Same-account apps reach one another privately on every plan via auto-injected `GREGALE_SERVICE_*_URL` environment variables, `*.svc.gregale:10081`, and `.internal` aliases with no VPC or subnets to configure.',
      },
      {
        question: 'How do I stop other apps or PR previews from calling internal services?',
        answer:
          'Set `x-gregale-allow-callers` and `x-gregale-allow-call-scopes` on target services to enforce allowed callers, HTTP methods and path prefixes before waking the target VM. PR previews also default to `preview_service_policy: deny`.',
      },
      {
        question: 'Can internal calls use HTTPS and signed caller identities?',
        answer:
          'Yes: `x-gregale-service-transport: https` enables `https://<service>.internal` with automatic CA bundles (rolling out per account), and signed 30-second EdDSA `X-Faas-Caller-Assertion` headers are available in preview.',
      },
    ],
  },
  {
    slug: COMPANIONS_SLUG,
    title: 'Run OpenTelemetry, Datadog and proxy sidecars on a PaaS without Kubernetes',
    summary:
      'Declare built-in `opentelemetry`, `sentry` or `datadog-dogstatsd` presets or custom `@sha256` sidecars in `gregale.yaml` with loopback discovery, startup probes, Unix socket directories and per-companion `env_secrets` allowlists.',
    publishedOn: '2026-11-26',
    updatedOn: '2026-11-26',
    faq: [
      {
        question: 'How many sidecars can run alongside my app in one microVM?',
        answer:
          'Each deployment can declare up to four long-running companions plus one one-shot setup helper under `companions:` in `gregale.yaml` or `gregale.toml`.',
      },
      {
        question: 'Do companions inherit my main app secrets automatically?',
        answer:
          'No. Each companion receives only secrets explicitly granted in its own `env_secrets` block and never inherits the main app secret set automatically.',
      },
      {
        question: 'Are companion ports exposed publicly or only on loopback?',
        answer:
          'Declaring `port` binds loopback discovery (`FAAS_WORKLOAD_<NAME>_ADDR`) and opens `<app>--<companion>.<apps domain>` publicly. Omit `port` to use shared Unix sockets without opening a hostname, or protect `@app` hosts with edge rules.',
      },
    ],
  },
  {
    slug: PULL_QUEUE_WORKERS_SLUG,
    title: 'Run SQS-style pull queue workers with zero-secret workload identity',
    summary:
      'Long-running workers consume Gregale queues without an HTTP listener using `leases`, `ack`, `nack` and `extend`, preview SDK auto-heartbeating (`consumeQueue`), `queue_depth` autoscaling and `gregale:queues` workload tokens that block staging/preview code.',
    publishedOn: '2026-11-26',
    updatedOn: '2026-11-26',
    faq: [
      {
        question: 'How do pull queue workers authenticate without storing API keys in the image?',
        answer:
          'Workers inside a Gregale microVM fetch a short-lived workload-identity token for `gregale:queues` from the guest loopback endpoint (where workload identity is enabled), keeping long-lived keys out of images.',
      },
      {
        question: 'Can a staging deploy or PR preview accidentally drain production queue jobs?',
        answer:
          'No. Workload-identity queue leases only succeed for production deployments; staging or preview apps receive `401` if they try to lease production messages.',
      },
      {
        question: 'What happens if a worker scales in or crashes mid-message?',
        answer:
          'The platform tracks lease ownership to avoid stopping busy instances first during scale-in, and if an instance stops or fails, its leases end so messages redeliver cleanly.',
      },
    ],
  },
  {
    slug: SPEND_CAPS_SLUG,
    title: 'Hard cloud spend caps that actually stop runaway bills',
    summary:
      'Every paid Gregale plan enforces a hard monthly overage cap from day one (Hobby $10 default, Pro $50, Scale $150), stopping compute at the ceiling with HTTP 402 instead of alerting after a runaway loop or DDoS spike racks up charges.',
    publishedOn: '2026-11-26',
    updatedOn: '2026-11-26',
    faq: [
      {
        question: 'Do Gregale spend caps actually stop billing or only send email alerts?',
        answer:
          'They stop billing hard at your cap. Running instances and minimum-instance floors stop within one scheduler tick, new requests return `HTTP 402 admission_refused`, managed PostgreSQL pauses without losing data, and queued webhooks and crons wait until you raise the cap or the month resets.',
      },
      {
        question: 'Can a compromised CI token or AI coding agent raise my spend cap?',
        answer:
          'No. Raising or lowering the spend cap (`gregale billing spend-cap`) requires an `admin`-scoped credential and multi-factor authentication (plus recent step-up in the dashboard); deploy keys and MCP agents cannot raise it.',
      },
      {
        question: 'Can I stop preview environments at a limit while keeping production live?',
        answer:
          'Yes. A budget policy with `"action": "stop_previews"` pauses pull-request preview environments at your chosen dollar threshold while production continues serving.',
      },
    ],
  },
  {
    slug: OTEL_TRACING_SLUG,
    title: 'One-line OpenTelemetry tracing with deploy-to-deploy SQL regression detection',
    summary:
      'Add `tracing: { enabled: true }` in `gregale.yaml` for zero-code Node and Python OpenTelemetry spans, in-instance OTLP receivers for Go/containers, normalized SQL queries, PII log redaction and automatic deploy-to-deploy `failure_regression` alerts.',
    publishedOn: '2026-11-26',
    updatedOn: '2026-11-26',
    faq: [
      {
        question: 'Do I need to install an OpenTelemetry exporter or API key to trace requests?',
        answer:
          'No. Set `tracing: { enabled: true }` in `gregale.yaml` (`tracing.enabled = true` in `gregale.toml`) and Gregale auto-instruments managed Node.js (22, 24) and Python (3.12, 3.13) runtimes and provides loopback OTLP receivers (`127.0.0.1:4318` / `4317`) for Go and Docker images.',
      },
      {
        question: 'Does Gregale strip customer PII and SQL values from trace spans?',
        answer:
          'Yes. Gregale folds SQL literals into parameterized patterns (`WHERE customer_id = ?`), drops query values, request headers, user IDs and exception stack traces at ingestion, and redacts emails, card numbers and tokens from linked logs.',
      },
      {
        question: 'Can I still send traces to Grafana, Honeycomb or Datadog?',
        answer:
          'Yes. Set `tracing.forward` with your OTLP/HTTP endpoint and `OTLP_HEADERS` secret to forward complete raw spans, logs and metrics asynchronously via a 4 MiB in-instance buffer alongside the Gregale debugger.',
      },
    ],
  },
  {
    slug: AUTOSCALE_LAG_SLUG,
    title: 'Autoscale containers from zero on Kafka lag, custom metrics and schedules',
    summary:
      'Scale Gregale apps up from zero on upstream Kafka/NATS/SQS `queue_lag`, API-pushed `custom` backlog metrics, or timezone-aware cron warm windows (`scaling.schedules`) with bounded saturation queues—without Kubernetes or KEDA.',
    publishedOn: '2026-11-26',
    updatedOn: '2026-11-26',
    faq: [
      {
        question:
          'What is the difference between queue_depth and queue_lag in Gregale autoscaling?',
        answer:
          '`queue_depth` measures messages already inside Gregale’s own queue, whereas `queue_lag` measures backlog still waiting upstream on Kafka, NATS, Redis Streams or SQS brokers (such as summed partition offset lag). Scale broker-backed consumers on `queue_lag`.',
      },
      {
        question: 'Can a parked app at zero instances wake and scale out from a custom metric?',
        answer:
          'Yes, on paid plans. An external cron or database trigger can `PUT /v1/apps/$APP/custom-metrics/<name>` while your app is parked at zero, scaling replicas to match `ceil(value / target)`.',
      },
      {
        question: 'How do scheduled warm windows work with reactive scaling targets?',
        answer:
          '`scaling.schedules` sets a cron + duration floor in any IANA timezone (raising `min_instances` during busy weekday hours while parking overnight), and reactive signals scale above that floor whenever demand spikes further.',
      },
    ],
  },
  {
    slug: ENV_PROMOTION_SLUG,
    title: 'Promote tested staging artifacts to production without rebuilding',
    summary:
      'Promote exact staging build artifacts and pinned non-secret config to production with `gregale environment promote --sync-config` while keeping production secrets separate, with dark health rounds, service-graph rewiring and migrations rolling out per account.',
    publishedOn: '2026-11-26',
    updatedOn: '2026-11-26',
    faq: [
      {
        question: 'Does promoting from staging to production rebuild the container image?',
        answer:
          'No. `gregale environment promote --from staging --to production --sync-config` reuses the tested staging build artifact and binds pinned non-secret variables without running a fresh build.',
      },
      {
        question: 'Do staging secrets overwrite production secrets during promotion?',
        answer:
          'Never. Production retains its own secrets, secret version pins, authentication credentials and service bindings while receiving only the promoted artifact and approved non-secret configuration.',
      },
      {
        question: 'Which verified promotion features require account enablement today?',
        answer:
          'Health-verified (`--verify`) two-round dark cutovers, complete HTTP service-graph promotion, database migration expansion (`--migrate`) and push-worker promotion (`--workers`) are rolling out per account (contact support); `--release-secrets-file` and combined `--migrate --workers` are not available yet.',
      },
    ],
  },
  {
    slug: SYNTHETIC_CHECKS_SLUG,
    title: 'Synthetic uptime checks on scale-to-zero apps without accidental bills',
    summary:
      'Run external 5-, 15-, or 60-minute `GET`/`HEAD` uptime and p95-latency probes (`Gregale-Synthetics/1`) on Hobby+ apps with consecutive-failure alerts and exact per-plan GB-RAM-hour wake-cost tables.',
    publishedOn: '2026-11-26',
    updatedOn: '2026-11-26',
    faq: [
      {
        question: 'Do built-in synthetic checks wake a parked scale-to-zero app?',
        answer:
          'Yes. Probes travel through real DNS, TLS and the public edge (`User-Agent: Gregale-Synthetics/1`), so they wake a parked app and keep it up for the plan’s idle timeout (60 s Hobby, 300 s Pro, 600 s Scale).',
      },
      {
        question: 'Why does a 5-minute check keep Pro and Scale apps continuously warm?',
        answer:
          'Pro (300 s) and Scale (600 s) have idle timeouts at or above 5 minutes, so probing every 5 minutes resets the idle timer before the app parks (~726 GB-h/mo on Pro, ~1,446 GB-h/mo on Scale). Choose 15- or 60-minute intervals when you want the app to park between probes.',
      },
      {
        question: 'How many synthetic checks can an app run and on which plans?',
        answer:
          'Up to 5 checks per public app on Hobby, Pro and Scale; Free plans and internal-only apps (`409`) pause or disallow scheduled synthetic checks.',
      },
    ],
  },
  {
    slug: STATIC_EGRESS_IP_SLUG,
    title: 'Static egress IP on scale-to-zero without a NAT Gateway',
    summary:
      'Bind a dedicated outbound static IP per app and region with `gregale app static-egress-ip set` so banks, payment processors and allowlisted databases see one stable IP even while compute scales to zero.',
    publishedOn: '2026-11-26',
    updatedOn: '2026-11-26',
    faq: [
      {
        question: 'How do I assign a static outbound IP for IP allowlisting on Gregale?',
        answer:
          'Run `gregale app APP_ID static-egress-ip set 203.0.113.42` (`show` and `clear` inspect or remove it). The address applies to outbound connections from that app in its region without changing inbound routing.',
      },
      {
        question: 'Do I need to configure a VPC or NAT Gateway to get a static egress IP?',
        answer:
          'No. Gregale allocates and routes the outbound static address at the platform level per app and region without VPC subnets or NAT gateway instances.',
      },
      {
        question: 'Is static egress available on every plan and region?',
        answer:
          'No. Static egress is plan- and region-dependent, and the API reports availability and any charge before allocation. Do not hard-code the address in application configuration.',
      },
    ],
  },
  {
    slug: ATOMIC_RELEASES_SLUG,
    title: 'Stop microservice version drift with atomic project releases and release graphs',
    summary:
      'Preflight multi-service projects with `gregale deploy check --project`, pin compatible frontend, API, worker and queue versions with `X-Gregale-Release` and `__Host-gregale_release`, and opt into progressive whole-graph canaries.',
    publishedOn: '2026-11-26',
    updatedOn: '2026-11-26',
    faq: [
      {
        question: 'How does Gregale stop API and client versions from drifting during deploys?',
        answer:
          'A project release graph pins which deployment of each service a caller reaches using `X-Gregale-Release` headers and host-only `__Host-gregale_release` cookies across HTTP, WebSockets, internal calls and durable queues.',
      },
      {
        question: 'What does gregale deploy check --project check in CI?',
        answer:
          'It runs a read-only readiness check before uploading source or starting builds—reporting missing keys, invalid dependencies and policy blockers, and exiting `0` for ready, `1` for blocked or `2` for unknown.',
      },
      {
        question:
          'Are progressive multi-service canaries and worker cutovers available to every account?',
        answer:
          'Progressive whole-graph canaries (`--progressive`, 5%/25%/100% stages), atomic worker cutovers (`--workers --worker-health`), schema cleanup contracts and release secret snapshots are opt-in capabilities not yet enabled on every account.',
      },
    ],
  },
  {
    slug: BINDING_VERIFICATION_SLUG,
    title: 'Pre-traffic service binding verification for Postgres, S3 and queues',
    summary:
      'Probe `.internal` service routes, managed PostgreSQL (`SELECT 1`), object storage (`ListObjectsV2`) and push-queue consumers on your exact candidate release with `gregale app binding verify` and enforce gates inside promotion transactions.',
    publishedOn: '2026-11-26',
    updatedOn: '2026-11-26',
    faq: [
      {
        question: 'What does gregale app binding verify test before production traffic shifts?',
        answer:
          'It tests private `.internal` service DNS and endpoint health (without waking idle targets), runs `SELECT 1` inside a bounded candidate task for managed Postgres, executes read-only `ListObjectsV2` (`MaxKeys=1`) for S3 buckets and checks push-queue consumer readiness.',
      },
      {
        question: 'How do I block deployment promotion unless candidate bindings pass?',
        answer:
          'Pass `--require-bindings` to `gregale release traffic promote`, or store server-side enforcement via `gregale app binding release-policy set --require-verification --max-age 10m` so requests cannot waive the gate.',
      },
      {
        question: 'What happens if a CI runner disconnects during multi-binding verification?',
        answer:
          'Run `gregale app binding verify --release-policy --durable` to persist a resumable verification receipt (up to 128 steps, 10-minute lifetime, 1-8 concurrency) that you can inspect, resume or diagnose later.',
      },
    ],
  },
  {
    slug: RELEASE_CONTROLS_SLUG,
    title: 'Stop Friday-night outages with deploy freezes, approvals and scheduled rollouts',
    summary:
      'Require signed-in human MFA approvals (`--approvals 2`), enforce recurring weekend or post-rollback deploy freezes (`--after-rollback 1h`), and build releases early to roll out automatically during quiet windows.',
    publishedOn: '2026-11-26',
    updatedOn: '2026-11-26',
    faq: [
      {
        question: 'Can a CI key or AI agent approve its own production release on Gregale?',
        answer:
          'No. Release approvals require a signed-in human session (and MFA when enabled) on the dashboard approval page; CLI tokens, API keys and CI jobs receive `403 release_approval_session_required`.',
      },
      {
        question: 'Do deploy freezes block emergency rollbacks?',
        answer:
          'Never. Freezes block new production deploys, GitHub pushes and promotions (`release_frozen`), while rollbacks, in-progress rollouts, previews and secret rotations always remain open.',
      },
      {
        question: 'When does a database migration run under release approvals?',
        answer:
          'Releases with a release command wait after building and before executing the migration, so rejecting or timing out the approval leaves production data untouched.',
      },
    ],
  },
  {
    slug: EDGE_RULES_TRACE_SLUG,
    title: 'Programmable edge rules and replayable trace testing without Nginx or Cloudflare',
    summary:
      'Block scrapers, rate-limit routes, verify JWTs and validate JSON Schema requests at the gateway without waking idle VMs, then test rule sets deterministically with versioned `gregale edge rule trace` JSON scenarios.',
    publishedOn: '2026-11-26',
    updatedOn: '2026-11-26',
    faq: [
      {
        question: 'Do requests refused by edge rules wake a parked Gregale app?',
        answer:
          'No. `ip`, `geo`, `jwt`, `limit`, `throttle`, `validate`, `waf` and `challenge` rules run at the gateway in cheapest-first order, refusing blocked traffic before waking your microVM.',
      },
      {
        question: 'How can I test edge rule changes before applying them to production?',
        answer:
          'Deploy rules first in `mode: log`, inspect matched samples with `gregale edge rule review`, and run deterministic dry-runs against live rules using `gregale edge rule trace --config trace.json`.',
      },
      {
        question: 'Can I undo a broken edge rule change immediately?',
        answer:
          'Yes. Every change creates a versioned snapshot (`gregale edge rule history`) that you can restore in one command with `gregale edge rule rollback`.',
      },
    ],
  },
  {
    slug: CRONS_EVENTS_SLUG,
    title: 'Scale-to-zero cron jobs, delayed tasks and event queues without an always-on server',
    summary:
      'Run DST-safe HTTP crons (Hobby 5, Pro 20, Scale 100 per app), 365-day delayed tasks and CloudEvents app inboxes with zero idle compute and at least 30 days of dead-letter queue retention on every plan.',
    publishedOn: '2026-11-26',
    updatedOn: '2026-11-26',
    faq: [
      {
        question: 'How does Gregale bill scheduled cron jobs on a scale-to-zero app?',
        answer:
          'Cron runs bill only for the seconds your app runs (including wake), then the app scales back to zero. Choosing 15-minute or hourly intervals instead of every-minute runs avoids keeping apps continuously warm.',
      },
      {
        question: 'How do I run one-off future tasks or service-to-service events without SQS?',
        answer:
          'Use `gregale delayed-task add` for scheduled one-shot calls up to 365 days out, or `gregale event send` to place CloudEvents messages directly on another app’s durable invocation queue.',
      },
      {
        question: 'What happens when a scheduled cron or inbox message fails?',
        answer:
          'Failed and dead-lettered invocations stay inspectable and replayable in `gregale dlq list` for at least 30 days on every plan.',
      },
    ],
  },
  {
    slug: OBJECT_STORAGE_SLUG,
    title: 'Private app object storage and direct browser uploads without S3 IAM boilerplate',
    summary:
      'Create private S3-compatible buckets (`https://s3.gregale.dev`) with `gregale add bucket`, sealed env vars outside secret quotas, `$0.03/GiB-month` overage, direct upload routes and upload triggers without waking your app.',
    publishedOn: '2026-11-26',
    updatedOn: '2026-11-26',
    faq: [
      {
        question: 'Can I use boto3 or AWS SDK v3 with Gregale object storage?',
        answer:
          'Yes. Point any standard S3 client at `https://s3.gregale.dev` (`region: us-east-1`, path-style addressing, SigV4). `gregale add bucket` injects the six sealed credentials automatically.',
      },
      {
        question: 'Are downloads and API requests billed per operation on Gregale buckets?',
        answer:
          'No. Downloads and requests inside your monthly plan allowance (Free 10 GiB/50k, Hobby 100 GiB/500k, Pro 500 GiB/2.5M, Scale 2,000 GiB/10M) carry no separate charge; paid average storage past included GiB costs $0.03 per GiB-month.',
      },
      {
        question: 'Does Gregale object storage support versioning or Object Lock yet?',
        answer:
          'Buckets live in a single OVHcloud storage region that does not yet support versioning or Object Lock, while versioning, lifecycle rules and bucket CORS are gated preview capabilities. Keep external backups of critical files.',
      },
    ],
  },
  {
    slug: EGRESS_DENYLIST_SLUG,
    title: 'Default SSRF protection with platform egress denylists across every plan',
    summary:
      'Block `169.254.169.254` cloud metadata, RFC1918 private networks, IPv6 NAT64 bypasses, SMTP spam ports, SSH/RDP and mining pools automatically on every Gregale app without extra configuration.',
    publishedOn: '2026-11-26',
    updatedOn: '2026-11-26',
    faq: [
      {
        question: 'Can an app allowlist bypass Gregale’s SSRF and metadata IP denylist?',
        answer:
          'No. The blocked IPv4, IPv6 and port rules apply to every app on every plan, and egress allowlist entries or `gregale app egress-ports add` cannot open them.',
      },
      {
        question: 'Why does Gregale block ports 25 and 2525 outbound?',
        answer:
          'Closing raw SMTP ports 25 and 2525 stops abuse and spam relays by default. Apps send mail over HTTPS provider APIs or via allowlisted mail submission ports 465 and 587.',
      },
      {
        question: 'Does Gregale also protect against SSRF during container image pulls?',
        answer:
          'Yes. Container image pulls refuse any registry resolving to loopback (`127.0.0.0/8`), `0.0.0.0/8`, `192.0.0.0/24`, benchmarking (`198.18.0.0/15`), or reserved (`240.0.0.0/4`) IP ranges.',
      },
    ],
  },
  {
    slug: STORED_WORKFLOW_RECOVERY_SLUG,
    title: 'Diagnose and recover failed stored workflows and missed schedules safely',
    summary:
      'Inspect failed DAG blockers with `gregale workflow diagnose`, resume mid-run preserving completed steps (`expected_resume_count`, up to 16 resumptions), opt into `catch_up: latest` schedules and run rate-limited recovery batches.',
    publishedOn: '2026-11-26',
    updatedOn: '2026-11-26',
    faq: [
      {
        question: 'Does resuming a failed stored workflow re-run already completed steps?',
        answer:
          'No. `gregale workflow resume` preserves completed steps and batch progress, reopening only the failed step and downstream descendants while pinning the original handler deployment.',
      },
      {
        question: 'How does Gregale prevent two operators from double-resuming a failed run?',
        answer:
          'Every resume requires `--expected-resume-count N` and an `--idempotency-key`, rejecting concurrent or stale attempts via generation fencing, and blocking unsafe un-idempotent mutations (`unsafe_mutation`).',
      },
      {
        question:
          'How do scheduled workflows recover after an outage without running 50 backlogged copies?',
        answer:
          'Set `catch_up: latest` with a `catch_up_window` (`1m` to `24h`, default `1h`) so only the most recent missed schedule inside the window fires instead of flooding your app with old runs.',
      },
    ],
  },
  {
    slug: CONTAINER_COMPAT_SLUG,
    title: 'Deploy any Docker container at scale-to-zero without rewriting for serverless',
    summary:
      'Any stateless Linux/amd64 OCI image listening on `0.0.0.0:$PORT` runs inside a Gregale microVM with automatic kernel/Node/Python/Java snapshot reseeding, ECR/Artifact Registry/ACR pulls, Compose support and `HEALTHCHECK` conversion.',
    publishedOn: '2026-11-26',
    updatedOn: '2026-11-26',
    faq: [
      {
        question:
          'Do I have to rewrite my Express, Go, Spring or Rust HTTP server as a handler function?',
        answer:
          'No. Any stateless `Linux/amd64` OCI image listening on `0.0.0.0:$PORT` (default 8080) deploys directly with `gregale deploy --image`, preserving ENTRYPOINT, CMD, USER and WORKDIR.',
      },
      {
        question:
          'Why does random number generation sometimes break on snapshot-restored VMs, and how does Gregale fix it?',
        answer:
          'Restoring a memory snapshot without reseeding makes two woken VMs repeat identical PRNG sequences. Gregale automatically reseeds the kernel plus Node, Python and Java 16+ randomness and prevents Gunicorn clock-jump worker restarts on wake.',
      },
      {
        question: 'Can Gregale persist files written to a Docker VOLUME inside a microVM?',
        answer:
          'No. Container filesystems and `/tmp` are ephemeral across scale-to-zero cold fallbacks and deploys; store durable state in managed PostgreSQL or object storage.',
      },
    ],
  },
  {
    slug: 'antigravity-ide-mcp-server-deploy',
    title: 'Connect Antigravity IDE to an MCP server and deploy backends safely',
    summary:
      'Wire Google Antigravity IDE or agy to Gregale’s hosted MCP server in one command, teach repos with AGENTS.md, or host your own Streamable HTTP MCP server at $0 idle.',
    publishedOn: '2026-11-26',
    updatedOn: '2026-11-26',
    faq: [
      {
        question: 'How do I connect Gregale’s MCP server inside Antigravity IDE?',
        answer:
          'Run `gregale mcp connect --client antigravity` (or `--project` for `.agents/mcp_config.json`), then open Customizations → Installed and select Authenticate next to `gregale`, or run `/mcp` in `agy`.',
      },
      {
        question:
          'Can Antigravity IDE deploy and inspect apps without my personal browser login in CI?',
        answer:
          'Antigravity MCP uses browser OAuth, while headless automation uses `GREGALE_TOKEN` created via `gregale key create <name> --agent` with `--non-interactive --json`.',
      },
      {
        question: 'Can I host my own custom MCP server on Gregale for Antigravity IDE?',
        answer:
          'Yes. Run `gregale mcp server init` (Node, Python, or Go), define explicit `auth.tool_scopes` in `gregale-mcp.json`, and deploy to Gregale with scale-to-zero between sessions.',
      },
    ],
  },
  {
    slug: 'stop-bot-traffic-cloud-bill-shock',
    title: 'How to stop bot traffic cloud bill shock without taking your site down',
    summary:
      'Hard spend caps alone convert DDoS and scraper bursts into outages; block hostile requests at the edge with OWASP WAF and proof-of-work challenges before waking compute.',
    publishedOn: '2026-11-26',
    updatedOn: '2026-11-26',
    faq: [
      {
        question: 'Why does a spend cap alone fail during a bot or scraper spike?',
        answer:
          'On platforms that only pause workloads at a billing ceiling, bots keep hitting your containers until they exhaust your spend limit, knocking real users offline.',
      },
      {
        question: 'Do requests blocked by Gregale WAF or browser challenges cost money?',
        answer:
          'No. Requests refused at the edge with WAF `block`, proof-of-work challenges, rate limits, or access controls never wake parked microVMs and add $0 to compute bills.',
      },
      {
        question: 'Will browser challenges break legitimate API clients or mobile apps?',
        answer:
          'No. Requests carrying a verified API key, consumer key, or JWT bypass the browser challenge automatically.',
      },
    ],
  },
  {
    slug: 'deploy-vibe-coded-app-to-production',
    title: 'How to deploy a vibe-coded app (Claude Code, Cursor, Antigravity) to production safely',
    summary:
      'Ship AI-generated backends from localhost to production with hard default spend caps, scoped agent tokens, deploy secret/CVE scans, 1% canary rollbacks and DB-synced recovery.',
    publishedOn: '2026-11-26',
    updatedOn: '2026-11-26',
    faq: [
      {
        question: 'How do I stop an AI coding agent from causing a runaway cloud bill?',
        answer:
          'Use a Free plan (stops at its monthly allowance) or a paid plan with default hard monthly spend caps (`$10`/`$50`/`$150`), and give the agent a scoped `--agent` key with per-agent budgets and `gregale scale --plan` cost previews.',
      },
      {
        question: 'What protects production if an agent pushes a bad migration or bug?',
        answer:
          'Production releases roll out 1% → 10% → 50% → 100% with automatic 5xx rollback (beta), and `gregale rollback --restore-databases` reverts code and managed PostgreSQL together.',
      },
      {
        question:
          'Why aren’t prompt instructions in AGENTS.md or .cursorrules enough on their own?',
        answer:
          'Agents can misread or ignore prompt text; Gregale enforces budgets, approval links, dry-run checks, CVE scans and canary rollbacks server-side in its API.',
      },
    ],
  },
  {
    slug: 'host-python-fastmcp-server',
    title: 'Where to host a Python FastMCP remote MCP server with auth and scale-to-zero',
    summary:
      'Run Streamable HTTP Python MCP servers in full CPython 3.13 Firecracker microVMs without 128 MB Pyodide isolate limits, paying $0 while idle and enforcing per-tool allowlists.',
    publishedOn: '2026-11-26',
    updatedOn: '2026-11-26',
    faq: [
      {
        question: 'Why run Python MCP servers on Firecracker microVMs instead of edge isolates?',
        answer:
          'Full Linux/amd64 Firecracker microVMs run native CPython 3.13 packages and Dockerfiles cleanly without WebAssembly/Pyodide compatibility workarounds or 128 MB isolate limits.',
      },
      {
        question: 'Does a hosted Python MCP server cost money while nobody is chatting with it?',
        answer:
          'No. Idle instances pause ~1 second after a request completes and park to snapshot at $0 compute cost until the next `/mcp` request arrives.',
      },
      {
        question: 'How are individual MCP tools secured once hosted remotely?',
        answer:
          'List permitted tools in `auth.tool_scopes` inside `gregale-mcp.json`; unlisted tools stay hidden and are rejected with `403 tool_access_denied`.',
      },
    ],
  },
  {
    slug: 'remote-dev-environment-without-docker-desktop',
    title: 'Remote cloud dev environments without Docker Desktop or local KVM',
    summary:
      'Run `gregale dev` for an isolated, auto-expiring Firecracker dev environment with hot reload, managed PostgreSQL and production-identical routing — no local KVM or Docker needed.',
    publishedOn: '2026-11-26',
    updatedOn: '2026-11-26',
    faq: [
      {
        question: 'Do I need Linux, KVM, or Docker Desktop installed to use gregale dev?',
        answer:
          'No. Builds and Firecracker microVMs run remotely on Gregale’s infrastructure while local source edits sync automatically.',
      },
      {
        question: 'Do developer apps count against my production deployed apps quota?',
        answer:
          'No. `gregale dev` has a separate developer-app allowance (1 on Free, 2 Hobby, 5 Pro, 10 Scale) and auto-expires after an idle lease (24h default, configurable per plan).',
      },
      {
        question: 'Can I attach managed PostgreSQL inside a remote dev session?',
        answer:
          'Yes, on Hobby, Pro, and Scale plans pass `gregale dev --postgres` to provision a managed PostgreSQL database wired directly into the dev session.',
      },
    ],
  },
  {
    slug: NEXTJS_POSTGRES_SLUG,
    title: 'Host Next.js 16 and PostgreSQL outside Vercel without DevOps',
    summary:
      'Deploy Next.js 16 Server Components, Route Handlers and Server Actions with automatic standalone sizing (~40 MB), bundled managed PostgreSQL on Hobby ($10/mo), PR previews and 5xx canary rollbacks.',
    publishedOn: '2026-11-26',
    updatedOn: '2026-11-26',
    faq: [
      {
        question: 'Does Next.js 16 fit inside Gregale Free with standalone builds?',
        answer:
          'Yes. When package.json uses a plain next start script, Gregale enables standalone output and ships only the standalone bundle (~40 MB instead of ~530 MB), fitting Free’s 256 MB app-layer limit.',
      },
      {
        question: 'Do Server Components and Server Actions work without serverless adapters?',
        answer:
          'Yes. Gregale runs Next.js as a full Node process inside an isolated Firecracker microVM, so Server Components, Route Handlers, Middleware and Postgres connection pools work out of the box.',
      },
      {
        question: 'Can I bundle managed PostgreSQL with Next.js on Gregale?',
        answer:
          'Yes. Managed PostgreSQL is included on Hobby ($10 a month) and higher plans, wired automatically as DATABASE_URL with optional point-in-time rollback alongside app releases.',
      },
    ],
  },
  {
    slug: BUN_HONO_SLUG,
    title: 'Host a Bun and Hono API with PostgreSQL and ~1s idle pause',
    summary:
      'Deploy Bun TypeScript APIs with automatic bun.lock detection, ~95 MB Free-plan footprint, bundled managed PostgreSQL and automatic 5xx canary rollbacks.',
    publishedOn: '2026-11-26',
    updatedOn: '2026-11-26',
    faq: [
      {
        question: 'How does Gregale detect and build a Bun + Hono app?',
        answer:
          'A committed bun.lock file switches the builder to install dependencies with bun install --frozen-lockfile and start the TypeScript entrypoint directly with bun run start.',
      },
      {
        question: 'Does a Bun + Hono API fit on Gregale Free?',
        answer:
          'Yes. As long as your start scripts call bun or bunx rather than npm toolchain wrappers, Gregale keeps only Bun (~90 MB) beside your app (~95 MB total), leaving ~160 MB under Free’s 256 MB cap.',
      },
      {
        question: 'What happens to billing between Bun API requests?',
        answer:
          'About a second after its last HTTP request completes, the microVM pauses and stops accruing compute charges until the next request arrives.',
      },
    ],
  },
  {
    slug: DJANGO_POSTGRES_SLUG,
    title: 'Host Django and Postgres with safe pre-traffic migrations and rollback',
    summary:
      'Run Gunicorn, separate read/write DATABASE_URL from pre-traffic MIGRATION_DATABASE_URL, and recover code plus PostgreSQL state together on Gregale.',
    publishedOn: '2026-11-26',
    updatedOn: '2026-11-26',
    faq: [
      {
        question: 'How does Gregale separate Django runtime and migration database credentials?',
        answer:
          'Runtime instances receive pooled DATABASE_URL with data-only privileges and DISABLE_SERVER_SIDE_CURSORS enabled, while pre-traffic release commands receive MIGRATION_DATABASE_URL scoped to schema migrations.',
      },
      {
        question: 'What if a Django migration breaks production after deploy?',
        answer:
          'Production releases step through 1%, 10%, 50% and 100% traffic and stop automatically on 5xx errors without crossing a migration boundary, while paid plans let you restore code and Postgres together via PITR.',
      },
      {
        question: 'Do I need to configure ALLOWED_HOSTS for Gregale deploys?',
        answer:
          'Yes. Include your default gregale.app domain and any custom domains in DJANGO_ALLOWED_HOSTS before deploying so health and post-deploy verification requests succeed.',
      },
    ],
  },
  {
    slug: GO_API_SLUG,
    title: 'Host Go APIs and MCP servers on scale-to-zero microVMs',
    summary:
      'Compile Go services automatically from go.mod to a small binary under Free’s 256 MB limit, pause billing ~1s after idle, and deploy with canary rollbacks and bundled Postgres.',
    publishedOn: '2026-11-26',
    updatedOn: '2026-11-26',
    faq: [
      {
        question: 'Do I need a Dockerfile to deploy a Go HTTP API on Gregale?',
        answer:
          'Not for standard module-root services. Gregale detects go.mod, picks the Go toolchain version from your go directive, compiles ./out and runs it automatically.',
      },
      {
        question: 'How fast do scale-to-zero Go microVMs wake and stop billing?',
        answer:
          'Idle instances pause about one second after the last HTTP request to stop billing, park after 10 minutes, and resume quickly on the next request without an always-on VM charge.',
      },
      {
        question: 'Why avoid a Heroku-style Procfile for Go apps on Gregale?',
        answer:
          'Heroku Go Procfiles often reference a custom binary name installed only by Heroku’s buildpack; on Gregale, remove that Procfile or point hosting start in gregale.yaml at ./out.',
      },
    ],
  },
  {
    slug: MIRRORING_SLUG,
    title: 'Test a new release on real production traffic without users seeing it',
    summary:
      'Mirror a sample of live requests to a dark-deployed release, compare status codes, JSON shape, values, latency and crashes, and discard the copies’ responses.',
    publishedOn: '2026-11-27',
    updatedOn: '2026-11-27',
    faq: [
      {
        question: 'What is traffic mirroring?',
        answer:
          'Mirroring copies a share of live production requests to a second version of an app and compares its responses with the serving version’s. Callers always get the serving version’s response; the copy’s response is discarded after the comparison.',
      },
      {
        question: 'How do I mirror traffic to a new release on Gregale?',
        answer:
          'Stage the release with `gregale deploy --no-traffic`, then run `gregale release mirror create --app my-api --source v43 --mirror v44 --percent 10` and read the result with `gregale release mirror summary`. Without `--percent`, 5% of requests are copied.',
      },
      {
        question: 'Does mirroring send POST requests or credentials to the new version?',
        answer:
          'Not by default. POST, PUT, PATCH and DELETE requests are copied only with `--allow-unsafe-methods`, and the Authorization, Cookie, Set-Cookie, X-API-Key, Proxy-Authorization and WWW-Authenticate headers are always removed from the copy.',
      },
      {
        question: 'Which Gregale plans include traffic mirroring?',
        answer:
          'Traffic mirroring is in preview on the Pro and Scale plans: one mirror rule per app on Pro and three on Scale. The candidate’s running time while it answers copies is billed like any instance.',
      },
    ],
  },
  {
    slug: PG_BRANCH_SLUG,
    title: 'Test a migration on a copy of production Postgres that deletes itself',
    summary:
      'Branch a managed PostgreSQL database from its latest point or any time in the 7-day restore window, run migrations on real rows, and let a 5-minute to 30-day TTL purge it.',
    publishedOn: '2026-11-27',
    updatedOn: '2026-11-27',
    faq: [
      {
        question: 'What is a Postgres branch on Gregale?',
        answer:
          'A branch is a new database restored from another database’s latest point, a couple of seconds before the request, that shares its source’s storage until it is written to. The source database and the apps that use it are never changed.',
      },
      {
        question: 'How do I test a migration on a copy of production data?',
        answer:
          'Run `gregale postgres branch orders pr-42 --ttl 2h`, attach the branch to a test app twice, once with `--env DATABASE_URL` and once with `--access migration --env MIGRATION_DATABASE_URL` for the schema changes, run the migration and tests, then delete it with `gregale postgres branch delete orders pr-42 --yes` or let the TTL purge it.',
      },
      {
        question: 'How long can a branch live, and do branches count toward my database limit?',
        answer:
          'A TTL can be 5 minutes to 30 days. A branch with a TTL of 7 days or less does not count toward the database limit; Hobby allows 2 of them at once, Pro 5 and Scale 20.',
      },
      {
        question: 'Can I branch from a point in the past?',
        answer:
          'Yes. `--from` with a timestamp branches from any time in the source’s 7-day restore window, which lets you reproduce a bug against the data as it was.',
      },
    ],
  },
  {
    slug: BATCH_JOBS_SLUG,
    title: 'Fan out a batch job, one task per input, and re-run only the failures',
    summary:
      'Run one microVM task per named input from the CLI or a checksummed manifest, classify failures by exit or outcome code, and replay only the inputs that failed.',
    publishedOn: '2026-11-27',
    updatedOn: '2026-11-27',
    faq: [
      {
        question: 'How do I run one task per input in a Gregale job?',
        answer:
          'Pass repeated `--input ID=REF` values to `gregale job run`, or a JSON manifest in object storage with `--input-manifest-uri` and `--input-manifest-sha256`. Each task reads its input from GREGALE_INPUT_ID and GREGALE_INPUT_REF.',
      },
      {
        question: 'How do I re-run only the inputs that failed?',
        answer:
          'Run `gregale job replay nightly RUN_ID` after the run finishes. It creates a linked run that contains only the failed, timed-out, out-of-memory or cancelled inputs, each with a fresh attempt budget, on the same image digest.',
      },
      {
        question: 'Can a job retry some failures and not others?',
        answer:
          'Yes. Failure rules map exit codes or outcome codes that the task writes to its result manifest to `retry` or `fail_partition`, and `uncertain_outcome: hold` keeps a task whose completion receipt was lost instead of running it again.',
      },
      {
        question: 'Which plans include Gregale jobs?',
        answer:
          'Jobs are in beta on Hobby, Pro and Scale. Each task gets 256 MB unless set otherwise, up to 512 MB on Hobby, 2048 MB on Pro and 4096 MB on Scale.',
      },
    ],
  },
  {
    slug: DEPLOY_GUARD_SLUG,
    title: 'Block deploys of vulnerable or unsigned images with a per-app policy',
    summary:
      'Enforce mode refuses a deploy unless the exact image has a fresh, clean scan and a trusted signature, and quarantines a live app whose evidence regresses.',
    publishedOn: '2026-11-27',
    updatedOn: '2026-11-27',
    faq: [
      {
        question: 'How do I stop vulnerable images from being deployed on Gregale?',
        answer:
          'Set the app’s policy with `gregale app my-api security --security-policy=enforce`. Deploys then fail before snapshotting unless the image has a fresh, complete scan matched to the deployment with no high, critical or unknown-severity findings.',
      },
      {
        question: 'Why is a scanner in CI not enough?',
        answer:
          'A CI scan blocks only the pipelines that run it, and it describes one image digest. Gregale checks the scan evidence inside the deploy and requires its recorded image reference to match the image being promoted, however the deploy was started.',
      },
      {
        question: 'What are the off, warn and enforce policies?',
        answer:
          '`off`, the default, reports findings without affecting deploys. `warn` keeps deploys flowing while making the policy explicit. `enforce` rejects new deploys while high-severity findings remain and requires scan evidence and a trusted signature for OCI images.',
      },
      {
        question: 'What happens if a live app’s security evidence regresses?',
        answer:
          'Gregale parks the enforce-mode app and quarantines the deployment, refusing its traffic with `security_posture_blocked`. Deploy a newer image and call the recover endpoint, which needs deploy-write scope and MFA.',
      },
    ],
  },
  {
    slug: STATELESS_SLUG,
    title: 'What breaks when your app scales to zero, and how to catch it',
    summary:
      'Local files, /tmp, in-memory sessions, background timers and startup connections do not survive a park. Gregale refuses stateful images and audits writes that will be lost.',
    publishedOn: '2026-11-27',
    updatedOn: '2026-11-27',
    faq: [
      {
        question: 'What is lost when an app scales to zero?',
        answer:
          'Anything kept only on the instance: files written to local disk or /tmp, sessions and caches held in memory, and timers meant to run between requests. Data in a database, object storage or the platform’s crons and queues is kept.',
      },
      {
        question: 'How does Gregale warn me that my app writes data it will lose?',
        answer:
          'It rejects stateful base images such as postgres:16 and VOLUME directives at deploy with `stateless_only_violation`, and records a `stateless.advisory` audit row the first time an app writes to a database-shaped directory such as /data or /var/lib/postgresql.',
      },
      {
        question: 'How do I reconnect to my database after a snapshot restore?',
        answer:
          'Declare an `after_restore` hook in gregale.yaml. Gregale sends one POST to that path on the app’s loopback listener after repairing the clock and entropy; a 2xx answer lets the instance serve, anything else falls back to a cold boot.',
      },
      {
        question: 'Can a snapshot carry one user’s data into other instances?',
        answer:
          'Only if you opt in to warm snapshots on Pro or Scale, or your app was created there before 2026-11-10. A warm snapshot is taken after an instance has served a few requests and keeps what they left in memory, so apps with per-user state in memory should turn it off with `--no-warm-snapshot`.',
      },
      {
        question: 'Do I pay while my app is idle?',
        answer:
          'Not while it is paused. About a second after the last request, with nothing in flight, Gregale pauses the VM in memory, and paused seconds are not billed. An app that keeps itself busy with timers keeps running and is billed while it works.',
      },
    ],
  },
  {
    slug: TELEGRAM_SLUG,
    title: 'Host a Telegram bot that costs nothing while nobody uses it',
    summary:
      'Receive Telegram updates by webhook, not polling, check the secret header, and let the bot park between messages. On Gregale: 75 MB, first byte in 166 ms.',
    publishedOn: '2026-11-27',
    updatedOn: '2026-11-27',
    faq: [
      {
        question: 'Why does my Telegram bot stop answering on a free host?',
        answer:
          'A bot that uses long polling (getUpdates) needs a process running all the time to ask Telegram for updates. When the host stops idle apps, nothing is left to ask. With a webhook, Telegram sends each update to your URL, and that request wakes the bot.',
      },
      {
        question: 'How do I stop strangers from sending fake updates to my webhook?',
        answer:
          'Set the webhook with a secret_token. Telegram then sends it in the X-Telegram-Bot-Api-Secret-Token header of every update, and the bot answers 401 to any request without it.',
      },
      {
        question: 'Can the bot reply without its bot token?',
        answer:
          'Yes. A webhook response can itself be a Bot API call: return JSON with a method field, such as sendMessage, and its parameters. You cannot see whether that call succeeded, so call the Bot API with the token when you need the result.',
      },
      {
        question: 'How fast does the bot answer after it has been idle?',
        answer:
          'In our test on Gregale, the first byte of the reply left 166 ms after the update arrived for a bot parked to a snapshot. Telegram also retries an update that fails, so a slow answer delays a reply rather than losing it.',
      },
    ],
  },
  {
    slug: DISCORD_SLUG,
    title: 'Run a Discord bot without an always-on server',
    summary:
      'Give a Discord app an Interactions Endpoint URL, verify each Ed25519 signature, and answer slash commands within 3 seconds from an app that scales to zero.',
    publishedOn: '2026-11-27',
    updatedOn: '2026-11-27',
    faq: [
      {
        question: 'Does a Discord bot need to run all the time?',
        answer:
          'Only if it uses the Gateway, the WebSocket that delivers messages, presence and voice events. A bot that only handles slash commands and components can use an Interactions Endpoint URL, where Discord sends each interaction as an HTTPS request.',
      },
      {
        question: 'Why does Discord reject my interactions endpoint URL?',
        answer:
          'When you save the URL, Discord sends a PING and also checks that the endpoint verifies signatures. The endpoint must answer the PING with {"type": 1} and answer a request with a bad X-Signature-Ed25519 signature with 401.',
      },
      {
        question: 'What if a command takes longer than 3 seconds?',
        answer:
          'Respond with type 5, which shows a loading state, then edit the reply with PATCH /webhooks/<application_id>/<interaction_token>/messages/@original. The token is valid for 15 minutes, and on Gregale the work after the response keeps running.',
      },
      {
        question: 'How fast does the endpoint answer after it has been idle?',
        answer:
          'In our test on Gregale, the first byte of the PONG left 227 ms after the request arrived for an endpoint parked to a snapshot, far inside Discord’s 3 seconds. It used 68 MB, inside the Free plan’s 256 MB.',
      },
    ],
  },
  {
    slug: SLACK_SLUG,
    title: 'Run a Slack Bolt app in HTTP mode on a host that scales to zero',
    summary:
      'Slack wants a 2xx within 3 seconds. A Bolt app in HTTP mode on Gregale answered from a parked snapshot in 270 ms and kept working after ack().',
    publishedOn: '2026-11-27',
    updatedOn: '2026-11-27',
    faq: [
      {
        question: 'Should my Slack app use Socket Mode or HTTP mode?',
        answer:
          'Socket Mode keeps a WebSocket open, so the app has to run all the time. HTTP mode gives Slack a Request URL, Bolt’s /slack/events, and nothing has to run between requests, which lets the app scale to zero.',
      },
      {
        question: 'What happens if my Slack app answers too slowly?',
        answer:
          'Slack retries an Events API request three times: nearly immediately, after 1 minute and after 5 minutes, with x-slack-retry-reason set to http_timeout. A slash command not acknowledged within 3,000 milliseconds shows the user an operation_timeout error.',
      },
      {
        question: 'Does work after ack() keep running on Gregale?',
        answer:
          'Yes. The instance keeps running while the listener works after the acknowledgement, and the reply to a call your app made resumes a paused instance. On AWS Lambda, Bolt needs processBeforeResponse: true instead, which defers the acknowledgement.',
      },
      {
        question: 'Does a Bolt app fit the Free plan?',
        answer:
          'In our test it used 89 MB, inside the Free plan’s 256 MB, and it is billed only while it handles requests: about a second after each one, with nothing in flight, Gregale pauses it.',
      },
    ],
  },
  {
    slug: RAILS_SLUG,
    title: 'Deploy Rails 8 with PostgreSQL and migrations that run before traffic',
    summary:
      'Deploy a Rails 8 app from its own Dockerfile with four small changes, run db:migrate with a separate credential, and fit it in 512 MB. Measured on Gregale.',
    publishedOn: '2026-11-27',
    updatedOn: '2026-11-27',
    faq: [
      {
        question: 'How much memory does a Rails 8 app need on Gregale?',
        answer:
          'A scaffolded Rails 8.1 app on Ruby 4.0 used 257 MB with Puma’s default 3 threads in our test. That needs the Hobby plan’s 512 MB; the Free plan’s 256 MB is too small, and Free has no managed PostgreSQL.',
      },
      {
        question: 'Why does the Rails build fail with lstat /vendor?',
        answer:
          'Gregale leaves vendor folders out of uploads by default, and the Rails Dockerfile copies vendor/. Add a .gregaleignore at the project root with the line !vendor/ to upload it.',
      },
      {
        question: 'How do Rails migrations run on Gregale?',
        answer:
          'Put release: ./bin/rails db:migrate in a Procfile and attach the database a second time with --access migration --env MIGRATION_DATABASE_URL. Only the release command receives that credential, and if it fails, the previous version keeps serving.',
      },
      {
        question: 'Should I keep Thruster in front of Puma?',
        answer:
          'No. Gregale already terminates HTTPS and proxies requests to the app, so start Puma directly with hosting.start: ./bin/rails server and use Rails’ /up as the health check.',
      },
      {
        question: 'Why create the app with --skip-solid?',
        answer:
          'With Solid Cache, Solid Queue and Solid Cable, Rails 8 gives each its own production database next to the main one. Attaching a Gregale database gives the app a single DATABASE_URL.',
      },
    ],
  },
  {
    slug: DIRECT_UPLOADS_SLUG,
    title: 'Direct browser uploads and resumable multipart storage without waking your backend',
    summary:
      'Accept direct uploads on your domain without waking your app, issue short-lived S3 signed URLs, resume multipart uploads and set CORS presets.',
    publishedOn: '2026-11-27',
    updatedOn: '2026-11-27',
    faq: [
      {
        question: 'Do upload routes wake my app microVM?',
        answer:
          'No. POST /uploads/{name} runs on Gregale’s edge gateway, checks the caller’s API key, size limit and MIME allowlist, and streams directly to your bucket without starting your app.',
      },
      {
        question: 'Why does image/* still block SVG uploads?',
        answer:
          'Wildcard allowlists never admit active content such as SVG, HTML, XML, XSL or JavaScript. You must list an active MIME type explicitly, and public bucket mounts refuse active types with HTTP 415.',
      },
      {
        question: 'How long can a resumable multipart upload stay open?',
        answer:
          'Unfinished multipart uploads remain resumable for 24 hours with up to 10,000 parts and 64 MiB per single request or part through s3.gregale.dev.',
      },
      {
        question: 'Why do AWS SDK v3 presigned URLs need requestChecksumCalculation set?',
        answer:
          'Newer AWS SDKs otherwise sign an empty-body CRC32 checksum into presigned PUT URLs, causing real browser file uploads to fail checksum verification.',
      },
    ],
  },
  {
    slug: DELAYED_TASKS_SLUG,
    title: 'Schedule delayed tasks up to a year ahead without Redis or BullMQ',
    summary:
      'Schedule one-off delayed tasks up to one year ahead on scale-to-zero apps and cancel them atomically without running Redis or BullMQ.',
    publishedOn: '2026-11-27',
    updatedOn: '2026-11-27',
    faq: [
      {
        question: 'How far ahead can Gregale schedule a delayed task?',
        answer:
          'Up to one year ahead via scheduled_at or delay_seconds, compared with AWS SQS’s 15-minute maximum DelaySeconds ceiling.',
      },
      {
        question: 'Which plans include delayed tasks and how many can be queued?',
        answer:
          'Delayed execution is in beta on Hobby (5 pending delayed tasks per app), Pro (50) and Scale (1,000,000), and is not included on Free.',
      },
      {
        question: 'What happens if I cancel a delayed task that already ran?',
        answer:
          'DELETE /v1/delayed-tasks/{id} only cancels pending tasks and is idempotent. Dispatching or finished tasks stay untouched and return their actual state.',
      },
    ],
  },
  {
    slug: DEPLOY_DIFF_SLUG,
    title: 'Preview deploy diffs, SBOM changes and environment drift in CI',
    summary:
      'Preview config changes, quota breaks and env drift before deploying, and inspect release-to-release SBOM and config diffs without plaintext secrets.',
    publishedOn: '2026-11-27',
    updatedOn: '2026-11-27',
    faq: [
      {
        question: 'Does POST /v1/apps/{slug}/diff create any release or require MFA?',
        answer:
          'No. The deploy diff preview is strictly read-only, writes no deployment or audit rows, and accepts apps:read or deploy:write bearer keys without MFA.',
      },
      {
        question: 'Can release diffs or env-diff expose secret values?',
        answer:
          'Never. Release diffs only list added, removed or changed key names, and env-diff returns {present, value_hash} per scope without plaintext.',
      },
      {
        question: 'Does POST /v1/apps/{slug}/diff replace OpenAPI breaking-change checks?',
        answer:
          'No. App deploy diff reports quota breaks and text-level runtime or env warnings; response schema compatibility is checked via /v1/apps/{slug}/openapi/diff.',
      },
    ],
  },
  {
    slug: CRASH_SNAPSHOTS_SLUG,
    title: 'Capture production 5xx crash snapshots and diff CPU or heap profiles',
    summary:
      'Capture microVM memory automatically on a production 5xx, fork it offline to debug safely, and diff CPU or heap flamegraphs across deploys.',
    publishedOn: '2026-11-27',
    updatedOn: '2026-11-27',
    faq: [
      {
        question: 'Will automatic 5xx crash snapshots overload a failing instance?',
        answer:
          'No. Gregale captures only the first 5xx per window, allowing at most one capture in flight and none within 10 minutes of the previous capture.',
      },
      {
        question: 'Does forking a crash snapshot affect live production traffic?',
        answer:
          'No. Forking boots a separate isolated microVM restored from the captured crash memory with its own one-time access token while live traffic continues untouched.',
      },
      {
        question: 'Which plans include crash snapshots vs profile capture diffs?',
        answer:
          'Both features are in preview: profile capture diffs unlock on Hobby, Pro and Scale, while automatic 5xx crash snapshots and crash-snapshot forks unlock on Pro and Scale.',
      },
    ],
  },
  {
    slug: RAILWAY_CONFIG_SLUG,
    title: "railway.json is deprecated: what to do before Railway's 2027 cutoff",
    summary:
      'Railway stops reading railway.json and railway.toml on January 1, 2027. How to move to .railway/railway.ts safely, or map the same settings to gregale.yaml.',
    publishedOn: '2026-11-27',
    updatedOn: '2026-11-27',
    faq: [
      {
        question: 'When does Railway stop reading railway.json?',
        answer:
          'On January 1, 2027, a hard cutoff that also covers railway.toml. Until then the files keep working for services that already use them, and new services cannot use them. Earlier versions of Railway’s docs gave December 1, 2026.',
      },
      {
        question: 'What replaces railway.json on Railway?',
        answer:
          'Infrastructure as Code: one .railway/railway.ts file for the project, covering services, databases, volumes, domains and variables. The Railway CLI applies it with railway config plan and railway config apply, locally or from CI; Railway does not read it during deploys.',
      },
      {
        question: 'How do I migrate railway.json to railway.ts?',
        answer:
          'Run railway config migrate --apply to write .railway/railway.ts, then railway config migrate cutover in each environment, then railway config plan and railway config apply. Delete railway.json only after cutover, or the next build fails because the file is missing.',
      },
      {
        question: 'What happens if I do not migrate?',
        answer:
          'From the cutoff, deploys ignore the file, so a start command, pre-deploy migration, health check or cron schedule that lives only there is dropped on the next deploy, and the service runs with its dashboard settings.',
      },
      {
        question: 'Can I move a railway.json service to Gregale instead?',
        answer:
          'Yes. startCommand becomes hosting.start in gregale.yaml, preDeployCommand becomes release.command, healthcheckPath becomes hosting.health and dockerfilePath becomes build.dockerfile. Add access: public for a public web service, and check the result with gregale deploy --dry-run. Gregale has no persistent volumes.',
      },
    ],
  },
];

/** FAQ answers as plain text, for structured data: no Markdown code spans. */
export function plainFaq(entries: readonly FaqEntry[]): FaqEntry[] {
  return entries.map(({ question, answer }) => ({ question, answer: answer.replaceAll('`', '') }));
}

const CANARY_LINK = `[Canary deploys with automatic rollback](/articles/${CANARY_SLUG}) explains the default rollout and what rolls a release back, and compares it with other platforms.`;
const MICROVM_LINK = `[A microVM for every app](/articles/${MICROVM_SLUG}) explains what each app's microVM isolates, and compares it with other platforms.`;

const HEROKU_ALTERNATIVES_LINK =
  '[Heroku alternatives in 2026](/articles/heroku-alternatives) compares the main platforms people move to from Heroku.';
const RENDER_ALTERNATIVES_LINK =
  '[Render alternatives in 2026](/articles/render-alternatives) compares the main platforms people move to from Render.';
const RAILWAY_ALTERNATIVES_LINK =
  '[Railway alternatives in 2026](/articles/railway-alternatives) compares the main platforms people move to from Railway.';
const FLY_ALTERNATIVES_LINK =
  '[Fly.io alternatives in 2026](/articles/flyio-alternatives) compares the main platforms people move to from Fly.io.';

const PREVIEW_LINK =
  '[Preview environments for every pull request](/articles/preview-environments) explains what a preview includes and keeps out, and compares it with other platforms.';
const MCP_LINK =
  '[Where to host an MCP server](/articles/mcp-server-hosting) explains what an MCP server needs from a host, and compares the options.';
const NO_DEVOPS_LINK =
  '[Hosting a startup backend without a DevOps engineer](/articles/backend-without-devops) lists the operations work Gregale does and what your team still owns.';

const FASTAPI_JOBS_LINK = `[Where to host a FastAPI app with background jobs and Postgres](/articles/${FASTAPI_JOBS_SLUG}) explains where each kind of background work belongs, and compares the options.`;
const NODE_WORKER_LINK = `[Running a Node.js API and a worker together](/articles/${NODE_WORKER_SLUG}) shows how to keep an API and its worker on one version, and what the setup costs on each platform.`;

const AGENT_SAFETY_LINK = `[Best cloud platform for AI coding agents in 2026](/articles/${BEST_CLOUD_AGENTS_SLUG}), [Human approval before an AI agent changes production](/articles/${APPROVAL_SLUG}), [Undo what an AI agent changed in production](/articles/${UNDO_SLUG}), [Cap what an AI agent adds to your hosting bill](/articles/${BUDGET_SLUG}) and [Hosting platforms with an MCP server that deploys, reads logs and rolls back](/articles/${MCP_OPERATIONS_SLUG}) compare platforms and explain the limits Gregale puts on coding agents.`;
const CLAUDE_CODE_LINK = `[Let Claude Code deploy to production safely](/articles/${CLAUDE_CODE_SLUG}) shows the setup and the guardrails that hold whatever the agent runs.`;
const CURSOR_LINK = `[Let Cursor deploy to production safely](/articles/${CURSOR_SLUG}) shows the token, MCP and API guardrails for Cursor. ${AGENT_SAFETY_LINK}`;
const CODEX_LINK = `[Let OpenAI Codex deploy to production safely](/articles/${CODEX_SLUG}) shows the sandbox, token and API guardrails for Codex. ${AGENT_SAFETY_LINK}`;
const GEMINI_CLI_LINK = `[Let Gemini CLI deploy to production safely](/articles/${GEMINI_CLI_SLUG}) shows the settings, token and API guardrails for Gemini CLI. ${AGENT_SAFETY_LINK}`;

const DATABASE_ROLLBACK_LINK = `[Roll back a bad migration: code and database together](/articles/${DATABASE_ROLLBACK_SLUG}) explains why a code rollback is not enough after a migration, and how other platforms handle it.`;
const COLD_START_LINK = `[Scale to zero without slow cold starts](/articles/${COLD_START_SLUG}) explains what an idle app costs and how fast it wakes, and compares other platforms.`;
const REALTIME_SCALE_ZERO_LINK = `[Hold WebSocket and SSE connections while your backend scales to zero](/articles/${REALTIME_SCALE_ZERO_SLUG}) explains how managed realtime holds client sockets at the edge while your microVM parks at zero compute.`;
const INBOUND_WEBHOOKS_LINK = `[Receive Stripe and signed webhooks while scaled to zero](/articles/${INBOUND_WEBHOOKS_SLUG}) explains edge signature verification, durable queuing, deduplication and dead-letter replay.`;
const EDGE_CACHE_LINK = `[Cache public API responses at the edge without waking your app](/articles/${EDGE_CACHE_SLUG}) explains declarative \`stale-while-revalidate\`, privacy bypass guarantees and \`Cache-Tag\` purging.`;
const OUTBOUND_RELAY_LINK = `[Call Stripe, OpenAI and third-party APIs without API keys in your app](/articles/${OUTBOUND_RELAY_SLUG}) explains zero-secret credential injection, route allowlists and daily budgets.`;
const OPENAPI_GATE_LINK = `[Block breaking OpenAPI changes and probe routes before traffic shifts](/articles/${OPENAPI_GATE_SLUG}) explains exit code \`2\`/\`3\` schema gates and \`x-gregale-hosting-check\` candidate probes.`;
const CODE_WORKFLOWS_LINK = `[Write durable workflows that sleep for months without a running VM](/articles/${CODE_WORKFLOWS_SLUG}) explains code-first retries, multi-day sleeps, deterministic replay and limits.`;
const SECRET_ROTATION_LINK = `[Rotate and revoke secrets without restarting containers or leaking snapshots](/articles/${SECRET_ROTATION_SLUG}) explains snapshot invalidation, draining restarts, in-process hot reload and revocation proofs.`;
const INTERNAL_SERVICES_LINK = `[Private service-to-service networking with caller allowlists and no VPC](/articles/${INTERNAL_SERVICES_SLUG}) explains zero-VPC discovery, caller scopes, private HTTPS and PR preview isolation.`;
const COMPANIONS_LINK = `[Run OpenTelemetry, Datadog and proxy sidecars on a PaaS without Kubernetes](/articles/${COMPANIONS_SLUG}) explains presets, custom digest-pinned companions, probes and secret grants.`;
const PULL_QUEUE_WORKERS_LINK = `[Run SQS-style pull queue workers with zero-secret workload identity](/articles/${PULL_QUEUE_WORKERS_SLUG}) explains pull leases, SDK heartbeating, scale-in safety and production isolation.`;
const SPEND_CAPS_LINK = `[Hard cloud spend caps that actually stop runaway bills](/articles/${SPEND_CAPS_SLUG}) explains day-one overage caps, MFA enforcement, HTTP 402 freezing and preview-only shutoffs.`;
const OTEL_TRACING_LINK = `[One-line OpenTelemetry tracing with deploy-to-deploy SQL regression detection](/articles/${OTEL_TRACING_SLUG}) explains zero-code instrumentation, SQL normalization, PII redaction and OTLP forwarding.`;
const AUTOSCALE_LAG_LINK = `[Autoscale containers from zero on Kafka lag, custom metrics and schedules](/articles/${AUTOSCALE_LAG_SLUG}) explains queue_lag vs queue_depth, pushed backlog metrics and cron warm windows.`;
const ENV_PROMOTION_LINK = `[Promote tested staging artifacts to production without rebuilding](/articles/${ENV_PROMOTION_SLUG}) explains immutable artifact promotion, secret isolation and verified dark cutovers.`;
const SYNTHETIC_CHECKS_LINK = `[Synthetic uptime checks on scale-to-zero apps without accidental bills](/articles/${SYNTHETIC_CHECKS_SLUG}) explains external probe alerts, failure classes and exact per-plan wake costs.`;
const STATIC_EGRESS_IP_LINK = `[Static egress IP on scale-to-zero without a NAT Gateway](/articles/${STATIC_EGRESS_IP_SLUG}) explains how to bind a dedicated outbound IP per app and region for partner allowlists.`;
const ATOMIC_RELEASES_LINK = `[Stop microservice version drift with atomic project releases and release graphs](/articles/${ATOMIC_RELEASES_SLUG}) explains read-only CI project checks, release-set pinning and coordinated multi-service rollouts.`;
const BINDING_VERIFICATION_LINK = `[Pre-traffic service binding verification for Postgres, S3 and queues](/articles/${BINDING_VERIFICATION_SLUG}) explains candidate-pinned connectivity canaries, transaction-locked promotions and durable CI runs.`;
const RELEASE_CONTROLS_LINK = `[Stop Friday-night outages with deploy freezes, approvals and scheduled rollouts](/articles/${RELEASE_CONTROLS_SLUG}) explains MFA human approvals, recurring/post-rollback freezes and scheduled deployments.`;
const EDGE_RULES_TRACE_LINK = `[Programmable edge rules and replayable trace testing without Nginx or Cloudflare](/articles/${EDGE_RULES_TRACE_SLUG}) explains gateway rate limits, schema validation, log mode and JSON trace scenarios.`;
const CRONS_EVENTS_LINK = `[Scale-to-zero cron jobs, delayed tasks and event queues without an always-on server](/articles/${CRONS_EVENTS_SLUG}) explains DST-safe crons, 365-day delayed tasks, app inboxes and dead-letter recovery.`;
const OBJECT_STORAGE_LINK = `[Private app object storage and direct browser uploads without S3 IAM boilerplate](/articles/${OBJECT_STORAGE_SLUG}) explains one-command S3 buckets, zero-wake upload routes and plan pricing.`;
const EGRESS_DENYLIST_LINK = `[Default SSRF protection with platform egress denylists across every plan](/articles/${EGRESS_DENYLIST_SLUG}) explains blocked RFC1918/metadata/NAT64 ranges, closed ports and registry SSRF guards.`;
const STORED_WORKFLOW_RECOVERY_LINK = `[Diagnose and recover failed stored workflows and missed schedules safely](/articles/${STORED_WORKFLOW_RECOVERY_SLUG}) explains recovery diagnostics, generation-fenced resumes, schedule catch-up and batch jobs.`;
const CONTAINER_COMPAT_LINK = `[Deploy any Docker container at scale-to-zero without rewriting for serverless](/articles/${CONTAINER_COMPAT_SLUG}) explains the Linux/amd64 OCI contract, snapshot PRNG reseeding and private registry pulls.`;
const ANTIGRAVITY_LINK =
  '[Connect Antigravity IDE to an MCP server and deploy backends safely](/articles/antigravity-ide-mcp-server-deploy) covers browser OAuth MCP setup, `AGENTS.md`, scoped CI keys and hosting custom Streamable HTTP MCP servers.';
const BOT_BILL_SHOCK_LINK =
  '[How to stop bot traffic cloud bill shock without taking your site down](/articles/stop-bot-traffic-cloud-bill-shock) compares spend caps that take apps offline against pre-wake OWASP WAF and browser challenges.';
const VIBE_DEPLOY_LINK =
  '[How to deploy a vibe-coded app (Claude Code, Cursor, Antigravity) to production safely](/articles/deploy-vibe-coded-app-to-production) shows default spend caps, scoped agent keys, deploy scans and atomic DB rollbacks.';
const PYTHON_FASTMCP_LINK =
  '[Where to host a Python FastMCP remote MCP server with auth and scale-to-zero](/articles/host-python-fastmcp-server) explains CPython 3.13 support, $0 idle parking and fail-closed tool allowlists.';
const REMOTE_DEV_LINK =
  '[Remote cloud dev environments without Docker Desktop or local KVM](/articles/remote-dev-environment-without-docker-desktop) covers hot-reload remote microVMs, Postgres bindings and auto-expiring leases.';
const NEXTJS_POSTGRES_LINK = `[Host Next.js 16 and managed PostgreSQL outside Vercel](/articles/${NEXTJS_POSTGRES_SLUG}) shows automatic standalone sizing, Server Actions parity, bundled Postgres and canary rollbacks.`;
const BUN_HONO_LINK = `[Host a Bun and Hono API with managed Postgres and scale-to-zero](/articles/${BUN_HONO_SLUG}) explains bun.lock detection, ~95 MB Free-plan fit and ~1s idle pause billing.`;
const DJANGO_POSTGRES_LINK = `[Host Django with pre-traffic migrations and coordinated Postgres rollback](/articles/${DJANGO_POSTGRES_SLUG}) explains separated migration roles, Gunicorn setup and code + PITR rollbacks.`;
const GO_API_LINK = `[Host Go APIs and Go MCP servers on scale-to-zero microVMs](/articles/${GO_API_SLUG}) covers zero-Dockerfile go.mod builds, small binaries and automatic 5xx canary rollbacks.`;
const MIRRORING_LINK = `[Test a new release on real production traffic without users seeing it](/articles/${MIRRORING_SLUG}) shows how to mirror live requests to a dark deploy and compare its answers, and how other platforms handle it.`;
const PG_BRANCH_LINK = `[Test a migration on a copy of production Postgres that deletes itself](/articles/${PG_BRANCH_SLUG}) shows a branch, migrate and expire workflow, plan limits, and how other platforms compare.`;
const BATCH_JOBS_LINK = `[Fan out a batch job, one task per input, and re-run only the failures](/articles/${BATCH_JOBS_SLUG}) explains input manifests, failure rules and replays, and compares Cloud Run jobs and AWS Batch.`;
const DEPLOY_GUARD_LINK = `[Block deploys of vulnerable or unsigned images with a per-app policy](/articles/${DEPLOY_GUARD_SLUG}) explains the off, warn and enforce policies, quarantine and recovery.`;
const BOTS_LINK = `[Telegram bots by webhook](/articles/${TELEGRAM_SLUG}), [Discord interactions endpoints](/articles/${DISCORD_SLUG}) and [Slack Bolt apps in HTTP mode](/articles/${SLACK_SLUG}) show chat bots that answer within each platform's deadline and cost nothing between messages.`;
const RAILS_LINK = `[Deploy Rails 8 with PostgreSQL and migrations that run before traffic](/articles/${RAILS_SLUG}) shows the four changes a generated Rails app needs, the migration credential and measured memory.`;
const RAILWAY_CONFIG_LINK = `[railway.json is deprecated: what to do before Railway's 2027 cutoff](/articles/${RAILWAY_CONFIG_SLUG}) shows the migration to .railway/railway.ts, the steps that can go wrong, and the same settings in gregale.yaml.`;
const STATELESS_LINK = `[What breaks when your app scales to zero, and how to catch it](/articles/${STATELESS_SLUG}) lists what does not survive a park, what to use instead, and the checks that catch it.`;
const DIRECT_UPLOADS_LINK = `[Direct browser uploads and resumable multipart storage without waking your backend](/articles/${DIRECT_UPLOADS_SLUG}) covers zero-wake edge upload routes, signed PUT URLs, 24-hour multipart uploads and CORS presets.`;
const DELAYED_TASKS_LINK = `[Schedule delayed tasks up to a year ahead without Redis or BullMQ](/articles/${DELAYED_TASKS_SLUG}) shows one-off 365-day delayed callbacks, atomic cancel semantics and plan limits.`;
const DEPLOY_DIFF_LINK = `[Preview deploy diffs, SBOM changes and environment drift in CI](/articles/${DEPLOY_DIFF_SLUG}) covers \`gregale deploy --diff\`, \`blocking\` CI checks, release SBOM diffs and hashed \`env-diff\` matrices.`;
const CRASH_SNAPSHOTS_LINK = `[Capture production 5xx crash snapshots and diff CPU or heap profiles](/articles/${CRASH_SNAPSHOTS_SLUG}) explains auto 5xx memory captures, isolated crash forks and differential flamegraphs.`;

const RELATED_ARTICLES: Record<string, string> = {
  postgres: `${PG_BRANCH_LINK} ${DATABASE_ROLLBACK_LINK} ${RAILS_LINK}`,
  'scale-to-zero': `${COLD_START_LINK} ${STATELESS_LINK}`,
  realtime: REALTIME_SCALE_ZERO_LINK,
  'inbound-webhooks': `${INBOUND_WEBHOOKS_LINK} ${BOTS_LINK}`,
  cache: EDGE_CACHE_LINK,
  'outbound-integrations': OUTBOUND_RELAY_LINK,
  'api-hosting-openapi': OPENAPI_GATE_LINK,
  'code-workflows': CODE_WORKFLOWS_LINK,
  secrets: SECRET_ROTATION_LINK,
  'internal-services': INTERNAL_SERVICES_LINK,
  companions: COMPANIONS_LINK,
  'queue-pull-leases': PULL_QUEUE_WORKERS_LINK,
  'cost-controls': `${SPEND_CAPS_LINK} ${BOT_BILL_SHOCK_LINK}`,
  tracing: `${OTEL_TRACING_LINK} ${CRASH_SNAPSHOTS_LINK}`,
  troubleshooting: CRASH_SNAPSHOTS_LINK,
  'scaling-policy': AUTOSCALE_LAG_LINK,
  'environment-promotion': ENV_PROMOTION_LINK,
  'synthetic-checks': SYNTHETIC_CHECKS_LINK,
  'static-egress-ip': STATIC_EGRESS_IP_LINK,
  'project-releases': ATOMIC_RELEASES_LINK,
  'service-release-graphs': ATOMIC_RELEASES_LINK,
  'service-bindings': BINDING_VERIFICATION_LINK,
  'binding-verification-runs': BINDING_VERIFICATION_LINK,
  'edge-rules': EDGE_RULES_TRACE_LINK,
  'edge-rule-trace': EDGE_RULES_TRACE_LINK,
  crons: `${CRONS_EVENTS_LINK} ${DELAYED_TASKS_LINK}`,
  'event-driven': `${CRONS_EVENTS_LINK} ${DELAYED_TASKS_LINK}`,
  'object-storage': `${OBJECT_STORAGE_LINK} ${DIRECT_UPLOADS_LINK}`,
  storage: `${STATELESS_LINK} ${OBJECT_STORAGE_LINK}`,
  'egress-denylist': EGRESS_DENYLIST_LINK,
  'stored-workflows': STORED_WORKFLOW_RECOVERY_LINK,
  'stored-workflows-recovery': STORED_WORKFLOW_RECOVERY_LINK,
  agents: `${AGENT_SAFETY_LINK} ${VIBE_DEPLOY_LINK}`,
  antigravity: ANTIGRAVITY_LINK,
  dev: REMOTE_DEV_LINK,
  'claude-code': CLAUDE_CODE_LINK,
  codex: CODEX_LINK,
  cursor: CURSOR_LINK,
  'gemini-cli': GEMINI_CLI_LINK,
  'deploy-fastapi': FASTAPI_JOBS_LINK,
  jobs: `${BATCH_JOBS_LINK} ${FASTAPI_JOBS_LINK}`,
  'deploy-express': NODE_WORKER_LINK,
  'deploy-nextjs': NEXTJS_POSTGRES_LINK,
  'deploy-bun': BUN_HONO_LINK,
  'deploy-django': DJANGO_POSTGRES_LINK,
  'deploy-go': GO_API_LINK,
  'multi-service': `${ATOMIC_RELEASES_LINK} ${NODE_WORKER_LINK}`,
  'getting-started': NO_DEVOPS_LINK,
  'mcp-hosting': `${MCP_LINK} ${PYTHON_FASTMCP_LINK}`,
  'preview-environments': PREVIEW_LINK,
  'migrate-from-heroku': HEROKU_ALTERNATIVES_LINK,
  'migrate-from-render': RENDER_ALTERNATIVES_LINK,
  'migrate-from-railway': `${RAILWAY_CONFIG_LINK} ${RAILWAY_ALTERNATIVES_LINK}`,
  'migrate-from-fly': FLY_ALTERNATIVES_LINK,
  rollouts: `${MIRRORING_LINK} ${CANARY_LINK}`,
  releases: `${CANARY_LINK} ${DEPLOY_DIFF_LINK}`,
  env: DEPLOY_DIFF_LINK,
  'release-controls': `${RELEASE_CONTROLS_LINK} ${CANARY_LINK}`,
  security: `${DEPLOY_GUARD_LINK} ${MICROVM_LINK} ${BOT_BILL_SHOCK_LINK}`,
  compliance: MICROVM_LINK,
  'container-compatibility': `${CONTAINER_COMPAT_LINK} ${RAILS_LINK} ${MICROVM_LINK}`,
  'registry-credentials': CONTAINER_COMPAT_LINK,
};

/** Answer articles: how Gregale works, without the vendor roundups or head-to-heads. */
export const ARTICLE_TOPICS: readonly ArticleTopic[] = [
  {
    id: 'safe-releases',
    title: 'Safe releases, rollbacks & governance',
    description:
      'Canary traffic ramps, coordinated Postgres rollbacks, MFA approvals, freezes, binding verification and OpenAPI deploy gates.',
    solutionSlug: 'safe-production-deploys',
    slugs: [
      CANARY_SLUG,
      MIRRORING_SLUG,
      DEPLOY_DIFF_SLUG,
      CRASH_SNAPSHOTS_SLUG,
      DATABASE_ROLLBACK_SLUG,
      PG_BRANCH_SLUG,
      RELEASE_CONTROLS_SLUG,
      BINDING_VERIFICATION_SLUG,
      ENV_PROMOTION_SLUG,
      OPENAPI_GATE_SLUG,
      SECRET_ROTATION_SLUG,
    ],
  },
  {
    id: 'scale-to-zero',
    title: 'Scale-to-zero, caching & cost control',
    description:
      'Millisecond snapshot wakes, hard monthly spend caps, edge caching, managed realtime sockets, inbound webhooks, chat bots, crons and uptime probes.',
    solutionSlug: 'scale-to-zero-apis',
    slugs: [
      COLD_START_SLUG,
      STATELESS_SLUG,
      SPEND_CAPS_SLUG,
      REALTIME_SCALE_ZERO_SLUG,
      INBOUND_WEBHOOKS_SLUG,
      TELEGRAM_SLUG,
      DISCORD_SLUG,
      SLACK_SLUG,
      EDGE_CACHE_SLUG,
      CRONS_EVENTS_SLUG,
      DELAYED_TASKS_SLUG,
      SYNTHETIC_CHECKS_SLUG,
      'stop-bot-traffic-cloud-bill-shock',
    ],
  },
  {
    id: 'ai-agents',
    title: 'AI coding agents & MCP',
    description:
      'Server-side approval gates, spend ceilings, mutation undo and OAuth MCP hosting for Claude Code, Cursor, Codex, Gemini CLI and Antigravity.',
    solutionSlug: 'ai-coding-agent-guardrails',
    slugs: [
      BEST_CLOUD_AGENTS_SLUG,
      CLAUDE_CODE_SLUG,
      CURSOR_SLUG,
      CODEX_SLUG,
      GEMINI_CLI_SLUG,
      'antigravity-ide-mcp-server-deploy',
      'deploy-vibe-coded-app-to-production',
      APPROVAL_SLUG,
      BUDGET_SLUG,
      UNDO_SLUG,
      MCP_OPERATIONS_SLUG,
      'mcp-server-hosting',
      'host-python-fastmcp-server',
    ],
  },
  {
    id: 'networking-security',
    title: 'Networking, security & multi-service ops',
    description:
      'Atomic release graphs, Firecracker microVM isolation, zero-VPC internal routing, static egress IPs, SSRF denylists, pull queues and durable workflows.',
    solutionSlug: 'multi-service-networking',
    slugs: [
      ATOMIC_RELEASES_SLUG,
      MICROVM_SLUG,
      DEPLOY_GUARD_SLUG,
      INTERNAL_SERVICES_SLUG,
      STATIC_EGRESS_IP_SLUG,
      EGRESS_DENYLIST_SLUG,
      OUTBOUND_RELAY_SLUG,
      EDGE_RULES_TRACE_SLUG,
      PULL_QUEUE_WORKERS_SLUG,
      AUTOSCALE_LAG_SLUG,
      CODE_WORKFLOWS_SLUG,
      STORED_WORKFLOW_RECOVERY_SLUG,
      BATCH_JOBS_SLUG,
    ],
  },
  {
    id: 'backend-foundations',
    title: 'Backend foundations, frameworks & storage',
    description:
      'No-DevOps startup architecture, Next.js, Bun, Django, Rails, Go, FastAPI and Node.js workers, PR previews, private S3 storage, zero-code OTel tracing, sidecars and OCI containers.',
    solutionSlug: 'backend-without-devops',
    slugs: [
      'backend-without-devops',
      NEXTJS_POSTGRES_SLUG,
      BUN_HONO_SLUG,
      DJANGO_POSTGRES_SLUG,
      RAILS_SLUG,
      GO_API_SLUG,
      FASTAPI_JOBS_SLUG,
      NODE_WORKER_SLUG,
      'preview-environments',
      'remote-dev-environment-without-docker-desktop',
      OBJECT_STORAGE_SLUG,
      DIRECT_UPLOADS_SLUG,
      OTEL_TRACING_SLUG,
      COMPANIONS_SLUG,
      CONTAINER_COMPAT_SLUG,
    ],
  },
  {
    id: 'comparisons',
    title: 'Platform comparisons & alternatives',
    description:
      'Side-by-side pricing, idle billing, isolation and rollback comparisons against Heroku, Render, Railway, Fly.io, Cloud Run, Vercel, Koyeb, Northflank, Coolify, Cloudflare Workers, AWS App Runner, DigitalOcean App Platform and Replit.',
    slugs: [
      'render-vs-railway-vs-flyio',
      'heroku-alternatives',
      'render-alternatives',
      'railway-alternatives',
      RAILWAY_CONFIG_SLUG,
      'flyio-alternatives',
      'cloud-run-alternatives',
      'vercel-alternatives',
      'koyeb-alternatives',
      'northflank-alternatives',
      'coolify-alternatives',
      'cloudflare-workers-alternatives',
      'aws-app-runner-alternatives',
      'digitalocean-app-platform-alternatives',
      'replit-alternatives',
    ],
  },
];

export function groupedArticles(): (ArticleTopic & { articles: Article[] })[] {
  const bySlug = new Map(ARTICLES.map((article) => [article.slug, article]));
  return ARTICLE_TOPICS.map((topic) => ({
    ...topic,
    articles: topic.slugs
      .map((slug) => bySlug.get(slug))
      .filter((entry): entry is Article => Boolean(entry)),
  }));
}

export const ANSWER_ARTICLES = ARTICLES.filter(
  (article) => !article.alternativesTo && !article.comparison
);

/** Head-to-head comparisons that include a vendor, by that vendor's /vs slug. */
export function comparisonArticles(comparisonSlug: string): Article[] {
  return ARTICLES.filter((article) => article.comparison?.includes(comparisonSlug));
}

/** The roundup of a vendor's alternatives, by that vendor's /vs slug. */
export function alternativesArticle(comparisonSlug: string): Article | undefined {
  return ARTICLES.find((article) => article.alternativesTo === comparisonSlug);
}

export function withRelatedArticles(slug: string, source: string): string {
  const related = RELATED_ARTICLES[slug];
  return related ? `${source.trimEnd()}\n\n## Related articles\n\n${related}\n` : source;
}

export function articleDate(date: string): string {
  return new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(date)
  );
}
