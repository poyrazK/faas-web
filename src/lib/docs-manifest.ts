import { RESTORE_TARGET } from './platform-claims.ts';

/**
 * The documentation table of contents.
 *
 * **This is a curated subset, not a mirror.** `poyrazK/faas` carries roughly
 * 200 markdown files, and most of them are not documentation in the sense a
 * customer means it:
 *
 * - `docs/runbooks/*` (~40) are incident-response procedures. They name alert
 *   thresholds, failover steps, and internal hostnames. Publishing them hands
 *   an attacker a map.
 * - `docs/adr/*` (~100) are architecture decision records — the reasoning
 *   behind internal design, written for the people maintaining it.
 * - `docs/ops/*`, `docs/drills/*`, `deploy/*` are operator procedures for
 *   running the platform, not for using it.
 * - `docs/faas_implementation_spec.md`, `repo_decomposition_implementation.md`
 *   and friends are engineering planning documents.
 *
 * What is left is the genuinely customer-facing material, listed below. Each
 * entry pins a source path so `npm run docs:pull` can refresh it, and a slug
 * that becomes the URL — slugs are stable and independent of upstream paths, so
 * a file moving upstream does not break a published link.
 *
 * Order within a section is the reading order, and it drives prev/next.
 */

export interface DocEntry {
  /** URL segment under /docs. Stable; do not rename once published. */
  slug: string;
  /** Path in the upstream repository. */
  source: string;
  /** Locally authored customer guides must not be overwritten by docs:pull. */
  local?: boolean;
  title: string;
  /** One line, used on the index and as the meta description. */
  summary: string;
}

export interface DocSection {
  title: string;
  /** Shown under the section heading on the index page. */
  blurb: string;
  entries: DocEntry[];
}

/** The docs index page's meta description, which its Markdown copy also opens with. */
export const DOCS_DESCRIPTION =
  'Deploy your first Gregale app, connect a repository, and learn how to run, observe, and scale your backend.';

export const DOC_SECTIONS: DocSection[] = [
  {
    title: 'Start here',
    blurb: 'Deploy a first app, then bring your own repository.',
    entries: [
      {
        slug: 'install',
        source: 'content/docs/install.md',
        local: true,
        title: 'Install the CLI',
        summary:
          'npm, the curl installer, or a verified manual download; the beta channel and how to pin a version.',
      },
      {
        slug: 'getting-started',
        source: 'content/docs/getting-started.md',
        local: true,
        title: 'Deploy your first app',
        summary: 'Install the CLI, deploy a starter API, and verify its live URL.',
      },
      {
        slug: 'quickstart',
        source: 'docs/quickstart.md',
        title: 'Guided first deploy',
        summary:
          'Let `gregale start` detect, review, and launch an existing project, then iterate on it.',
      },
      {
        slug: 'deploy-from-github',
        source: 'docs/deploys.md',
        title: 'Deploy from your repository',
        summary: 'Deploy a source checkout, connect GitHub, or use GitHub Actions.',
      },
      {
        slug: 'deploy-from-source',
        source: 'docs/source-ref.md',
        title: 'Deploy a GitHub source ref',
        summary: 'Pin a branch, tag, or commit for a reproducible CI deployment.',
      },
      {
        slug: 'troubleshooting',
        source: 'docs/troubleshooting.md',
        title: 'Troubleshooting',
        summary:
          'Failed deploys, failing requests, slow first requests, domains and missing logs, by symptom.',
      },
      {
        slug: 'agents',
        source: 'docs/agents.md',
        title: 'Use Gregale from coding agents',
        summary:
          'Give Claude Code, Codex, Cursor or Antigravity a scoped key, the non-interactive CLI contract, the management MCP server, and the Gregale plugin.',
      },
      {
        slug: 'claude-code',
        source: 'docs/claude-code.md',
        title: 'Deploy with Claude Code',
        summary:
          'Install the CLI, point Claude Code at AGENTS.md, deploy, read failures and roll back.',
      },
      {
        slug: 'codex',
        source: 'docs/codex.md',
        title: 'Deploy with Codex',
        summary:
          'Install the CLI, let the sandbox reach Gregale, deploy, read failures and roll back.',
      },
      {
        slug: 'cursor',
        source: 'docs/cursor.md',
        title: 'Deploy with Cursor',
        summary: 'Install the CLI, have Cursor deploy from AGENTS.md, read failures and roll back.',
      },
      {
        slug: 'antigravity',
        source: 'docs/antigravity.md',
        title: 'Deploy with Antigravity',
        summary:
          'Install the CLI, have Antigravity deploy from AGENTS.md, connect the MCP server, read failures and roll back.',
      },
      {
        slug: 'gemini-cli',
        source: 'docs/gemini-cli.md',
        title: 'Deploy with Gemini CLI',
        summary:
          'Install the CLI, have Gemini CLI read AGENTS.md, deploy, read failures and roll back.',
      },
    ],
  },
  {
    title: 'Frameworks and migration',
    blurb: 'Deploy Express, FastAPI, Django, Flask or Go, or move an app from Heroku or Render.',
    entries: [
      {
        slug: 'frameworks',
        source: 'docs/frameworks.md',
        title: 'Deploy a web framework',
        summary:
          'What Gregale detects, the start command, the listener, health checks and runtime versions for every framework.',
      },
      {
        slug: 'deploy-express',
        source: 'docs/deploy-express.md',
        title: 'Deploy an Express app',
        summary:
          'Express, Fastify, Hono and NestJS: the start script, the port, Node versions and PostgreSQL.',
      },
      {
        slug: 'deploy-nextjs',
        source: 'docs/deploy-nextjs.md',
        title: 'Deploy a Next.js app',
        summary:
          'next build and next start, standalone output to fit small plans, env vars, PostgreSQL and caching.',
      },
      {
        slug: 'deploy-bun',
        source: 'docs/deploy-bun.md',
        title: 'Deploy a Bun app',
        summary:
          'bun.lock, bun install and bun run start, random numbers after a wake, secrets and PostgreSQL.',
      },
      {
        slug: 'deploy-fastapi',
        source: 'docs/deploy-fastapi.md',
        title: 'Deploy a FastAPI app',
        summary:
          'Uvicorn on $PORT, Python versions, secrets, PostgreSQL and migrations as a release command.',
      },
      {
        slug: 'deploy-django',
        source: 'docs/deploy-django.md',
        title: 'Deploy a Django app',
        summary:
          'Gunicorn, settings from the environment, ALLOWED_HOSTS, migrations and static files.',
      },
      {
        slug: 'deploy-flask',
        source: 'docs/deploy-flask.md',
        title: 'Deploy a Flask app',
        summary: 'Gunicorn on $PORT, app factories, PostgreSQL with SQLAlchemy and migrations.',
      },
      {
        slug: 'deploy-go',
        source: 'docs/deploy-go.md',
        title: 'Deploy a Go app',
        summary: 'net/http and Gin on $PORT, the Go version, PostgreSQL with pgx and migrations.',
      },
      {
        slug: 'migrate-from-heroku',
        source: 'docs/migrate-from-heroku.md',
        title: 'Migrate from Heroku',
        summary:
          'Map dynos, the Procfile, config vars, Postgres, workers and Scheduler to Gregale, step by step.',
      },
      {
        slug: 'migrate-from-render',
        source: 'docs/migrate-from-render.md',
        title: 'Migrate from Render',
        summary:
          'Translate render.yaml services, pre-deploy commands, workers, crons and Postgres to Gregale.',
      },
      {
        slug: 'migrate-from-railway',
        source: 'docs/migrate-from-railway.md',
        title: 'Migrate from Railway',
        summary:
          'Map Railway services, railpack.json, variables, cron services and Postgres to Gregale, step by step.',
      },
      {
        slug: 'migrate-from-fly',
        source: 'docs/migrate-from-fly.md',
        title: 'Migrate from Fly.io',
        summary:
          'Translate fly.toml, secrets, process groups, volumes and Managed Postgres to Gregale, step by step.',
      },
    ],
  },
  {
    title: 'Ship releases',
    blurb: 'Change production safely: database releases, gates, approvals, rollouts and promotion.',
    entries: [
      {
        slug: 'releases',
        source: 'docs/releases.md',
        title: 'Release safely',
        summary:
          'Safe changes, database releases and rollbacks, release gates, and the release page.',
      },
      {
        slug: 'release-controls',
        source: 'docs/release-controls.md',
        title: 'Approvals, freezes and schedules',
        summary: 'Require approvals, freeze deploys, and schedule releases for a chosen time.',
      },
      {
        slug: 'rollouts',
        source: 'docs/rollouts.md',
        title: 'Roll out gradually',
        summary: 'Dark deployments, canary stages, safe-by-default rollouts and sticky revisions.',
      },
      {
        slug: 'project-releases',
        source: 'docs/project-releases.md',
        title: 'Atomic project releases',
        summary:
          'Release every service of a project together, with readiness checks and schema contracts.',
      },
      {
        slug: 'environment-promotion',
        source: 'docs/environment-promotion.md',
        title: 'Promote between environments',
        summary:
          'Promote a tested artifact and its configuration from one environment to the next.',
      },
    ],
  },
  {
    title: 'Run your app',
    blurb: 'Scaling, runtimes, domains, previews and dev environments.',
    entries: [
      {
        slug: 'scale-to-zero',
        source: 'docs/cold-wake.md',
        title: 'How scaling to zero works',
        summary: `Parked apps hold zero resident RAM. ${RESTORE_TARGET}. Measurement boundaries and cold-boot fallback.`,
      },
      {
        slug: 'scaling-policy',
        source: 'docs/scaling-policy.md',
        title: 'Tune scaling',
        summary:
          'Instance bounds, scaling signals, custom metrics, and scheduled warm windows per app.',
      },
      {
        slug: 'storage',
        source: 'docs/storage.md',
        title: 'Storage',
        summary:
          'What the platform stores per app: VM snapshots, image layers, and what you pay for.',
      },
      {
        slug: 'apps',
        source: 'docs/apps.md',
        title: 'Apps',
        summary:
          'Create, configure, scale, rename and restore apps, and open a shell in a fresh VM.',
      },
      {
        slug: 'functions',
        source: 'docs/functions.md',
        title: 'Functions and runtimes',
        summary: 'Function handlers, streaming, budgets, runtimes and database requests.',
      },
      {
        slug: 'multi-service',
        source: 'docs/multi-service-apps.md',
        title: 'Multi-service apps',
        summary: 'Deploy a Compose project or several services as one project.',
      },
      {
        slug: 'container-compatibility',
        source: 'docs/container-compatibility.md',
        title: 'Container compatibility',
        summary: 'Which image, Compose and listener features a container deployment supports.',
      },
      {
        slug: 'custom-domains',
        source: 'docs/domains.md',
        title: 'Add a custom domain',
        summary: 'Attach, verify, and diagnose your own domain on a deployed app.',
      },
      {
        slug: 'preview-environments',
        source: 'docs/preview-environments.md',
        title: 'Preview environments',
        summary: 'Per-PR deployments with their own URL, shared app quotas, and cleanup lifecycle.',
      },
      {
        slug: 'dev',
        source: 'docs/gregale-dev.md',
        title: 'Remote dev environments',
        summary:
          'Sync local code to a cloud dev environment with a stable URL, live patches, and debugging.',
      },
      {
        slug: 'mcp-hosting',
        source: 'docs/mcp-hosting.md',
        title: 'Host an MCP server',
        summary:
          'Build, test and deploy an MCP server that Claude, Cursor and other clients can call.',
      },
    ],
  },
  {
    title: 'Store data',
    blurb: 'Managed PostgreSQL and object storage.',
    entries: [
      {
        slug: 'postgres',
        source: 'docs/postgres.md',
        title: 'Managed PostgreSQL',
        summary:
          'A database per app with its URL delivered as a secret, point-in-time restore, compute that stops when idle, and the plan limits.',
      },
      {
        slug: 'object-storage',
        source: 'docs/object-storage.md',
        title: 'Object storage',
        summary:
          'Private S3-compatible buckets for your app: signed URLs, any S3 SDK, and the plan limits.',
      },
      // `docs/executions.md` (slug `executions`) was published here until
      // 2026-10-20. Upstream marks it an internal capability, so it stays in
      // `UNPUBLISHED_DOCS` with that reason. `object-storage` came back once
      // upstream cut its operator half and shipped it to every customer
      // (poyrazK/faas#7815, general availability 2026-11-22).
    ],
  },
  {
    title: 'Background work and workflows',
    blurb: 'Jobs, crons, events, webhooks, realtime and durable workflows.',
    entries: [
      {
        slug: 'jobs',
        source: 'docs/jobs.md',
        title: 'Run jobs',
        summary: 'Run-to-completion tasks from an OCI image, on demand or on a schedule.',
      },
      {
        slug: 'crons',
        source: 'docs/crons.md',
        title: 'Schedule crons',
        summary: 'Call a path on your app on a schedule, waking it when needed.',
      },
      {
        slug: 'event-driven',
        source: 'docs/event-driven.md',
        title: 'Event-driven workloads',
        summary: 'Async invokes, workflows, delayed tasks and deployment webhooks.',
      },
      {
        slug: 'inbound-webhooks',
        source: 'docs/inbound-webhooks.md',
        title: 'Receive webhooks',
        summary: 'Accept provider webhooks while the app is parked; verified, queued and retried.',
      },
      {
        slug: 'realtime',
        source: 'docs/realtime.md',
        title: 'Managed realtime',
        summary: 'Push messages to web and mobile clients over WebSocket or Server-Sent Events.',
      },
      {
        slug: 'code-workflows',
        source: 'docs/code-workflows.md',
        title: 'Code-first workflows',
        summary: 'Durable workflows written as ordinary async functions.',
      },
      {
        slug: 'stored-workflows',
        source: 'docs/stored-workflow-authoring.md',
        title: 'Build stored workflows',
        summary:
          'Steps against an app with a manual, scheduled or event start, retries and run history.',
      },
      {
        slug: 'stored-workflows-testing',
        source: 'docs/stored-workflow-testing.md',
        title: 'Test stored workflows',
        summary: 'Test cases, verification suites, baselines, simulation and publishing checks.',
      },
      {
        slug: 'stored-workflows-operations',
        source: 'docs/stored-workflow-operations.md',
        title: 'Run and monitor stored workflows',
        summary: 'Find and cancel runs, health, alerts and automatic pausing.',
      },
      {
        slug: 'stored-workflows-recovery',
        source: 'docs/stored-workflow-recovery.md',
        title: 'Recover stored workflow runs',
        summary: 'Resume failed runs, replay missed starts, and recovery plans and policies.',
      },
    ],
  },
  {
    title: 'Connect services',
    blurb: 'Outbound traffic, calls between your apps, and the bindings that connect them.',
    entries: [
      {
        slug: 'networking',
        source: 'docs/networking.md',
        title: 'Networking',
        summary: 'Outbound rules, WebSockets, gRPC, internal services and service bindings.',
      },
      {
        slug: 'outbound-integrations',
        source: 'docs/outbound-integrations.md',
        title: 'Outbound integrations',
        summary:
          "Call a third-party API through Gregale's relay without putting its key in your app.",
      },
      {
        slug: 'internal-services',
        source: 'docs/internal-services.md',
        title: 'Internal services',
        summary: 'Call other apps by name, set deadlines and call scopes, and verify the caller.',
      },
      {
        slug: 'service-bindings',
        source: 'docs/service-bindings.md',
        title: 'Service bindings',
        summary: 'The binding inventory, readiness checks in CI, canaries and release enforcement.',
      },
    ],
  },
  {
    title: 'Configure',
    blurb: 'What an app is given, and where it may reach.',
    entries: [
      {
        slug: 'env',
        source: 'docs/env.md',
        title: 'Set environment variables',
        summary:
          'Non-secret configuration, its precedence, history, rollback, and the config guard.',
      },
      {
        slug: 'secrets',
        source: 'docs/secrets.md',
        title: 'Manage secrets',
        summary: 'Set, rotate and hot-reload secrets without restarting the app.',
      },
      {
        slug: 'auth',
        source: 'docs/auth.md',
        title: 'Authentication',
        summary: 'CLI login, scoped tokens for CI, MFA and OIDC token exchange.',
      },
      {
        slug: 'build',
        source: 'docs/build.md',
        title: 'Builds and framework detection',
        summary:
          'How a framework is detected and built, how to override it, and how to read a failure.',
      },
      {
        slug: 'deploy-overrides',
        source: 'docs/deploy-overrides.md',
        title: 'Deployment overrides',
        summary: 'Pin the start command, port, health path, and readiness probe in gregale.yaml.',
      },
      {
        slug: 'registry-credentials',
        source: 'docs/registry-credentials.md',
        title: 'Pull from a private registry',
        summary: 'Store write-only credentials so private OCI images can be pulled at deploy time.',
      },
      {
        slug: 'static-egress-ip',
        source: 'docs/static-egress-ip.md',
        title: 'Get a static egress IP',
        summary: 'Reserve a fixed outbound address an upstream service can allowlist.',
      },
      {
        slug: 'edge-rules',
        source: 'docs/edge-rules.md',
        title: 'Edge rules',
        summary: 'Redirects, headers, rate limits, IP and geo rules at the edge.',
      },
      {
        slug: 'cache',
        source: 'docs/cache.md',
        title: 'Cache responses',
        summary: 'Cache public GET and HEAD responses at the edge, and purge them.',
      },
      {
        slug: 'companions',
        source: 'docs/companions.md',
        title: 'Application companions',
        summary:
          'Run a collector, proxy, or other helper alongside an app, with probes and dependencies.',
      },
    ],
  },
  {
    title: 'Observe',
    blurb: 'What the platform can tell you about a request.',
    entries: [
      {
        slug: 'logs',
        source: 'docs/logs.md',
        title: 'Read logs',
        summary:
          'Live tail, archived logs of parked instances, retention by plan, filters and log drains.',
      },
      {
        slug: 'tracing',
        source: 'docs/tracing.md',
        title: 'Trace requests',
        summary:
          'One-setting OpenTelemetry tracing to see slow or failing dependencies per request.',
      },
      {
        slug: 'alerts',
        source: 'docs/alerts.md',
        title: 'Set up alerts',
        summary: 'Alert presets, notification channels and anomaly rules.',
      },
      {
        slug: 'synthetic-checks',
        source: 'docs/synthetic-checks.md',
        title: 'Run synthetic checks',
        summary:
          'Probe a path on a schedule from outside, track uptime and latency, alert on failure.',
      },
    ],
  },
  {
    title: 'CLI',
    blurb: 'Everyday use of the gregale CLI, by task.',
    entries: [
      {
        slug: 'cli',
        source: 'docs/cli-setup.md',
        title: 'CLI guide',
        summary:
          'Interactive flows, saved log views, Job and workflow recovery, required secrets, and shell completion for the gregale CLI.',
      },
      {
        slug: 'cli-command-tree',
        source: 'docs/cli-command-tree.md',
        title: 'CLI command tree',
        summary:
          'How every gregale command is named (noun, subnoun, verb) and the older names that still work.',
      },
      {
        slug: 'cli-inspect',
        source: 'docs/cli-inspect.md',
        title: 'Deployments, settings and health',
        summary: 'Inspect deployments, read settings receipts, and check health in scripts.',
      },
      {
        slug: 'cli-context',
        source: 'docs/cli-context.md',
        title: 'Linked targets and saved runs',
        summary: 'Which app and environment a command uses, presets, and saved run records.',
      },
      {
        slug: 'cli-secrets',
        source: 'docs/cli-secrets.md',
        title: 'Secrets and required configuration',
        summary: 'Set, remove and watch secrets; declare and check required names.',
      },
      {
        slug: 'cli-logs',
        source: 'docs/cli-logs.md',
        title: 'Logs and saved log views',
        summary: 'Filter logs, save and reuse log views, and query archives.',
      },
      {
        slug: 'cli-jobs',
        source: 'docs/cli-jobs.md',
        title: 'Jobs from the CLI',
        summary: 'Submit a Job run, wait for it, and save project-local Job defaults.',
      },
      {
        slug: 'cli-jobs-interactive',
        source: 'docs/cli-jobs-interactive.md',
        title: 'Interactive Job commands',
        summary: 'Guided prompts for creating, running, retrying and editing Jobs.',
      },
      {
        slug: 'cli-job-results',
        source: 'docs/cli-job-results.md',
        title: 'Job run results and artifacts',
        summary: 'Read the newest run, find tasks with artifacts, and collect outputs.',
      },
      {
        slug: 'cli-job-recovery',
        source: 'docs/cli-job-recovery.md',
        title: 'Recover Job runs',
        summary: 'Preview and run retries, replays and cancellations from saved run records.',
      },
      {
        slug: 'cli-workflows',
        source: 'docs/cli-workflows.md',
        title: 'Workflows from the CLI',
        summary: 'Start, wait for, inspect and recover workflow runs.',
      },
      {
        slug: 'cli-operations',
        source: 'docs/cli-operations.md',
        title: 'Scheduled tasks, alerts and issues',
        summary: 'Scheduled HTTP tasks, alert presets and deliveries, and issue triage.',
      },
    ],
  },
  {
    title: 'Runtimes',
    blurb: 'The managed runtimes, and what each one gives you.',
    entries: [
      {
        slug: 'handler-api',
        source: 'docs/handler-api.md',
        title: 'Handler API',
        summary: 'Everything a Node or Python function handler receives and can return.',
      },
      {
        slug: 'runtime-node',
        source: 'docs/runtimes/node24.md',
        title: 'Node 24',
        summary: 'The Node runtime: entrypoint, build behaviour, and what ships in the image.',
      },
      {
        slug: 'runtime-python',
        source: 'docs/runtimes/python313.md',
        title: 'Python 3.13',
        summary: 'The Python runtime: entrypoint, dependency install, and image contents.',
      },
      // `docs/runtimes/go124.md` (slug `runtime-go`) is held back since
      // 2026-10-20: its troubleshooting table tells the reader to apply
      // migration 00043 and revert a field in `pkg/imaged/handler.go`
      // (poyrazK/faas#5023). Not a catalog path, so it has no
      // `UNPUBLISHED_DOCS` row; it returns here once upstream cuts the rows.
    ],
  },
  {
    title: 'Reference',
    blurb: 'Limits and rules the platform enforces.',
    entries: [
      {
        slug: 'plans',
        source: 'docs/plans.md',
        title: 'Plans and pricing',
        summary: 'Generated platform prices, included compute, and hard plan limits.',
      },
      {
        slug: 'egress-denylist',
        source: 'docs/egress-denylist.md',
        title: 'Blocked outbound destinations',
        summary: 'Destinations outbound traffic cannot reach, and why.',
      },
      {
        slug: 'api-hosting-openapi',
        source: 'docs/api-hosting-openapi.md',
        title: 'OpenAPI hosting',
        summary: 'Preview, compare, and publish an OpenAPI contract for an app.',
      },
      {
        slug: 'faas_openapi_spec',
        source: 'docs/faas_openapi_spec.md',
        title: 'Gregale API specification',
        summary: 'The OpenAPI contract, supported routes, response shapes, and CI guarantees.',
      },
      {
        slug: 'account',
        source: 'docs/account.md',
        title: 'Account and organizations',
        summary:
          'Identity, organizations, members, feature availability, data export, and deletion.',
      },
      {
        slug: 'billing',
        source: 'docs/billing.md',
        title: 'Billing',
        summary: 'Spend caps, usage costs, budgets and invoice exports.',
      },
      {
        slug: 'cost-controls',
        source: 'docs/cost-controls.md',
        title: 'Cost controls',
        summary:
          'Set a spend cap, get budget alerts, stop previews at a limit, and see what each app costs.',
      },
      {
        slug: 'errors',
        source: 'docs/errors.md',
        title: 'Errors',
        summary: 'How errors are shaped, and what to do about the most common ones.',
      },
      {
        slug: 'error-codes',
        source: 'docs/error-codes.md',
        title: 'Error code reference',
        summary:
          'Every error code with its HTTP status, title, hint and the page that explains it.',
      },
      {
        slug: 'sdks',
        source: 'docs/sdks.md',
        title: 'SDKs',
        summary: 'Install the Node, Python and Go SDKs.',
      },
    ],
  },
  {
    title: 'Advanced',
    blurb: 'Specialized features most apps never need.',
    entries: [
      {
        slug: 'binding-verification-runs',
        source: 'docs/binding-verification-runs.md',
        title: 'Binding verification runs',
        summary: 'Durable, resumable verification runs for one app or a whole project.',
      },
      {
        slug: 'service-release-graphs',
        source: 'docs/service-release-graphs.md',
        title: 'Service release graphs',
        summary:
          'Keep callers and services on consistent revisions; qualify, activate and recover graphs.',
      },
      {
        slug: 'queue-pull-leases',
        source: 'docs/queue-pull-leases.md',
        title: 'Pull queue leases',
        summary:
          'Consume queue messages from a worker without an HTTP listener: lease, ack, nack, extend.',
      },
      {
        slug: 'edge-rule-trace',
        source: 'docs/edge-rule-trace.md',
        title: 'Trace edge rules',
        summary:
          'Replay a request against an app’s edge rules from a JSON scenario to see what applies.',
      },
      {
        slug: 'trace-propagation',
        source: 'docs/runtimes/trace-propagation.md',
        title: 'Trace propagation',
        summary: 'How trace context travels through the gateway into your handler.',
      },
    ],
  },
  {
    title: 'Trust',
    blurb: 'Legal and security commitments.',
    entries: [
      {
        slug: 'compliance',
        source: 'docs/compliance/overview.md',
        title: 'Compliance overview',
        summary: 'The DPA, sub-processors, your data rights and how to report a vulnerability.',
      },
      {
        slug: 'dpa',
        source: 'docs/DPA.md',
        title: 'Data Processing Agreement',
        summary: 'The DPA governing personal data processed on your behalf.',
      },
      {
        slug: 'subprocessors',
        source: 'docs/compliance/subprocessors.md',
        title: 'Sub-processors',
        summary: 'Third parties with access to customer data, and what each one does.',
      },
      {
        slug: 'responsible-disclosure',
        source: 'docs/compliance/responsible-disclosure.md',
        title: 'Responsible disclosure',
        summary: 'How to report a vulnerability, and what to expect once you do.',
      },
      {
        slug: 'security',
        source: 'docs/security.md',
        title: 'Security',
        summary: 'Gregale isolation boundaries and the security responsibilities you retain.',
      },
    ],
  },
];

/** Flat reading order, for prev/next and for the prerender route list. */
export const DOC_ENTRIES: DocEntry[] = DOC_SECTIONS.flatMap((section) => section.entries);

export function findDoc(slug: string): DocEntry | undefined {
  return DOC_ENTRIES.find((entry) => entry.slug === slug);
}

/** The entry before and after `slug` in reading order, for the page footer. */
export function docNeighbours(slug: string): { prev?: DocEntry; next?: DocEntry } {
  const index = DOC_ENTRIES.findIndex((entry) => entry.slug === slug);
  if (index === -1) return {};
  return { prev: DOC_ENTRIES[index - 1], next: DOC_ENTRIES[index + 1] };
}
