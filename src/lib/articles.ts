import type { FaqEntry } from './faq.ts';

/**
 * Plain-answer articles: one question a buyer asks, answered first, then how
 * Gregale does it and how other platforms compare. The body lives in
 * `content/articles/<slug>.md`; the questions live here so the visible FAQ and
 * its FAQPage structured data come from the same strings.
 *
 * Loaded by `scripts/prerender.mjs` with plain Node: no JSX, no `?raw`.
 */
interface Article {
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
    updatedOn: '2026-11-24',
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
    updatedOn: '2026-11-25',
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
    updatedOn: '2026-11-25',
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
    updatedOn: '2026-11-25',
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
    updatedOn: '2026-11-25',
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
    updatedOn: '2026-11-24',
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
    updatedOn: '2026-11-24',
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
    updatedOn: '2026-11-25',
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
    updatedOn: '2026-11-25',
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
    updatedOn: '2026-11-25',
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
    updatedOn: '2026-11-25',
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
    updatedOn: '2026-11-25',
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
    updatedOn: '2026-11-25',
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
    updatedOn: '2026-11-26',
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

const RELATED_ARTICLES: Record<string, string> = {
  postgres: DATABASE_ROLLBACK_LINK,
  'scale-to-zero': COLD_START_LINK,
  realtime: REALTIME_SCALE_ZERO_LINK,
  'inbound-webhooks': INBOUND_WEBHOOKS_LINK,
  cache: EDGE_CACHE_LINK,
  'outbound-integrations': OUTBOUND_RELAY_LINK,
  'api-hosting-openapi': OPENAPI_GATE_LINK,
  'code-workflows': CODE_WORKFLOWS_LINK,
  secrets: SECRET_ROTATION_LINK,
  'internal-services': INTERNAL_SERVICES_LINK,
  companions: COMPANIONS_LINK,
  'queue-pull-leases': PULL_QUEUE_WORKERS_LINK,
  agents: AGENT_SAFETY_LINK,
  'claude-code': CLAUDE_CODE_LINK,
  codex: CODEX_LINK,
  cursor: CURSOR_LINK,
  'gemini-cli': GEMINI_CLI_LINK,
  'deploy-fastapi': FASTAPI_JOBS_LINK,
  jobs: FASTAPI_JOBS_LINK,
  'deploy-express': NODE_WORKER_LINK,
  'multi-service': NODE_WORKER_LINK,
  'getting-started': NO_DEVOPS_LINK,
  'mcp-hosting': MCP_LINK,
  'preview-environments': PREVIEW_LINK,
  'migrate-from-heroku': HEROKU_ALTERNATIVES_LINK,
  'migrate-from-render': RENDER_ALTERNATIVES_LINK,
  'migrate-from-railway': RAILWAY_ALTERNATIVES_LINK,
  'migrate-from-fly': FLY_ALTERNATIVES_LINK,
  rollouts: CANARY_LINK,
  releases: CANARY_LINK,
  'release-controls': CANARY_LINK,
  security: MICROVM_LINK,
  compliance: MICROVM_LINK,
  'container-compatibility': MICROVM_LINK,
};

/** Answer articles: how Gregale works, without the vendor roundups or head-to-heads. */
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
