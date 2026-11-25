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
const DATABASE_ROLLBACK_SLUG = 'rollback-code-and-database';
const COLD_START_SLUG = 'scale-to-zero-without-cold-starts';
const BEST_CLOUD_AGENTS_SLUG = 'best-cloud-for-ai-coding-agents';

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
    updatedOn: '2026-11-24',
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
    updatedOn: '2026-11-24',
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
    updatedOn: '2026-11-24',
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

const PREVIEW_LINK =
  '[Preview environments for every pull request](/articles/preview-environments) explains what a preview includes and keeps out, and compares it with other platforms.';
const MCP_LINK =
  '[Where to host an MCP server](/articles/mcp-server-hosting) explains what an MCP server needs from a host, and compares the options.';
const NO_DEVOPS_LINK =
  '[Hosting a startup backend without a DevOps engineer](/articles/backend-without-devops) lists the operations work Gregale does and what your team still owns.';

const FASTAPI_JOBS_LINK = `[Where to host a FastAPI app with background jobs and Postgres](/articles/${FASTAPI_JOBS_SLUG}) explains where each kind of background work belongs, and compares the options.`;
const NODE_WORKER_LINK = `[Running a Node.js API and a worker together](/articles/${NODE_WORKER_SLUG}) shows how to keep an API and its worker on one version, and what the setup costs on each platform.`;

const AGENT_SAFETY_LINK = `[Best cloud platform for AI coding agents in 2026](/articles/${BEST_CLOUD_AGENTS_SLUG}), [Human approval before an AI agent changes production](/articles/${APPROVAL_SLUG}), [Undo what an AI agent changed in production](/articles/${UNDO_SLUG}) and [Cap what an AI agent adds to your hosting bill](/articles/${BUDGET_SLUG}) compare platforms and explain the limits Gregale puts on coding agents.`;
const CLAUDE_CODE_LINK = `[Let Claude Code deploy to production safely](/articles/${CLAUDE_CODE_SLUG}) shows the setup and the guardrails that hold whatever the agent runs.`;

const DATABASE_ROLLBACK_LINK = `[Roll back a bad migration: code and database together](/articles/${DATABASE_ROLLBACK_SLUG}) explains why a code rollback is not enough after a migration, and how other platforms handle it.`;
const COLD_START_LINK = `[Scale to zero without slow cold starts](/articles/${COLD_START_SLUG}) explains what an idle app costs and how fast it wakes, and compares other platforms.`;

const RELATED_ARTICLES: Record<string, string> = {
  postgres: DATABASE_ROLLBACK_LINK,
  'scale-to-zero': COLD_START_LINK,
  agents: AGENT_SAFETY_LINK,
  'claude-code': CLAUDE_CODE_LINK,
  codex: AGENT_SAFETY_LINK,
  cursor: AGENT_SAFETY_LINK,
  'gemini-cli': AGENT_SAFETY_LINK,
  'deploy-fastapi': FASTAPI_JOBS_LINK,
  jobs: FASTAPI_JOBS_LINK,
  'deploy-express': NODE_WORKER_LINK,
  'multi-service': NODE_WORKER_LINK,
  'getting-started': NO_DEVOPS_LINK,
  'mcp-hosting': MCP_LINK,
  'preview-environments': PREVIEW_LINK,
  'migrate-from-heroku': HEROKU_ALTERNATIVES_LINK,
  'migrate-from-render': RENDER_ALTERNATIVES_LINK,
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
