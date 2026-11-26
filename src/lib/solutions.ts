import type { Article } from './articles.ts';
import type { FaqEntry } from './faq.ts';

/**
 * Problem-first solution hub pages (`/solutions` and `/solutions/<slug>`).
 *
 * Plain TypeScript with explicit `.ts` extensions so `scripts/prerender.mjs`
 * can import this directly in Node without JSX or `?raw` imports.
 */

export interface SolutionPainPoint {
  before: string;
  withGregale: string;
}

export interface SolutionDocLink {
  slug: string;
  label: string;
}

export interface Solution {
  slug: string;
  kicker: string;
  title: string;
  summary: string;
  problemStatement: string;
  publishedOn: string;
  updatedOn: string;
  painPoints: readonly SolutionPainPoint[];
  articleSlugs: readonly string[];
  docSlugs: readonly SolutionDocLink[];
  researchSlugs?: readonly string[];
  faq: readonly FaqEntry[];
}

export const SOLUTIONS_TITLE = 'Solutions';
export const SOLUTIONS_DESCRIPTION =
  'Concrete backend, deployment, cost-control and AI-agent problems Gregale solves out of the box.';

export const SOLUTIONS: readonly Solution[] = [
  {
    slug: 'scale-to-zero-apis',
    kicker: 'Idle compute & latency',
    title: 'Stop paying for idle APIs without 60-second cold starts',
    summary:
      'Gregale pauses idle HTTP instances about a second after their last request, wakes from Firecracker memory snapshots in milliseconds, and keeps WebSockets, webhooks, caching and crons working while compute sleeps.',
    problemStatement:
      'Traditional PaaS providers bill fixed containers 24/7 or shut free apps down completely, causing minute-long cold starts and dropped sockets, webhooks and background triggers.',
    publishedOn: '2026-11-26',
    updatedOn: '2026-11-26',
    painPoints: [
      {
        before: 'Paid PaaS dynos bill 24/7 even when traffic drops overnight or between webhooks.',
        withGregale:
          'Instances pause ~1 second after the last response and park to memory snapshots after 10 minutes at zero billed compute.',
      },
      {
        before:
          'Full container cold boots re-initialize Python, Node or JVM frameworks in seconds.',
        withGregale:
          'Wakes restore directly from Firecracker memory snapshots on local SSD instead of cold-booting from scratch.',
      },
      {
        before:
          'WebSocket pings, Stripe webhooks and health probes keep serverless instances pinned awake.',
        withGregale:
          'Managed realtime holds edge sockets, inbound webhooks queue at the edge with 202 Accepted, and gateway cache hits never wake VMs.',
      },
    ],
    articleSlugs: [
      'scale-to-zero-without-cold-starts',
      'websockets-sse-scale-to-zero',
      'durable-inbound-webhooks-scale-to-zero',
      'declarative-edge-response-cache',
      'scale-to-zero-cron-jobs-event-triggers',
      'deploy-docker-container-scale-to-zero-no-rewrite',
    ],
    docSlugs: [
      { slug: 'scale-to-zero', label: 'Scale to zero' },
      { slug: 'realtime', label: 'Managed realtime' },
      { slug: 'inbound-webhooks', label: 'Inbound webhooks' },
      { slug: 'cache', label: 'Edge response cache' },
      { slug: 'crons', label: 'Scheduled crons' },
      { slug: 'container-compatibility', label: 'Container compatibility' },
    ],
    researchSlugs: [
      'firecracker-snapshot-restore-ssd-2026-09-09',
      'intermittent-fastapi-cost-2026-11-24',
    ],
    faq: [
      {
        question: 'How fast does an idle Gregale app pause billing?',
        answer:
          'About a second after answering its last request, compute pausing stops billing immediately. After 10 minutes of inactivity, the instance parks to a Firecracker memory snapshot.',
      },
      {
        question: 'Can my API still accept WebSockets, webhooks and crons while scaled to zero?',
        answer:
          'Yes. Managed realtime (in beta on paid plans) holds WebSocket and SSE clients at the edge, inbound webhook routes verify signatures and return `202` before waking your app, and HTTP crons wake the app only for the duration of each run.',
      },
      {
        question: 'Do I have to rewrite a standard Docker container for scale-to-zero?',
        answer:
          'No. Any stateless Linux/amd64 OCI image listening on `0.0.0.0:$PORT` deploys unchanged, with automatic kernel, Node, Python and Java snapshot randomness reseeding on wake.',
      },
    ],
  },
  {
    slug: 'safe-production-deploys',
    kicker: 'Releases & rollbacks',
    title: 'Ship every release through automatic canaries, binding checks and rollbacks',
    summary:
      'Every production deployment starts at 1% traffic, rolls back automatically on 5xx errors or latency regressions, verifies DB/S3/service bindings pre-cutover, and can restore both code and managed Postgres together.',
    problemStatement:
      'Blind all-at-once container swaps turn bad configs, broken migrations and Friday-night pushes into customer-facing outages with fragmented manual recovery.',
    publishedOn: '2026-11-26',
    updatedOn: '2026-11-26',
    painPoints: [
      {
        before: 'One-shot cutovers send 100% of live production traffic to broken builds at once.',
        withGregale:
          'Default progressive rollouts climb 1% -> 10% -> 50% -> 100% and roll back automatically on 5xx spikes, crash loops or latency regressions.',
      },
      {
        before:
          'Code rollbacks leave incompatible Postgres schema changes or broken env secrets behind.',
        withGregale:
          'Paid plans support `gregale rollback --restore-databases` PITR restores, plus automatic snapshot invalidation on every secret rotation.',
      },
      {
        before:
          'CI passes unit tests while production breaks on missing DB URLs or Friday deploys.',
        withGregale:
          'Pre-promotion binding checks (`--require-bindings`), OpenAPI contract gates, MFA human approvals and recurring deploy freezes block bad ships before traffic moves.',
      },
    ],
    articleSlugs: [
      'canary-deploys',
      'rollback-code-and-database',
      'deploy-freezes-release-approvals-schedules',
      'pre-traffic-service-binding-verification',
      'promote-staging-to-production-without-rebuilding',
      'openapi-breaking-change-deploy-gate',
      'zero-restart-secret-rotation',
    ],
    docSlugs: [
      { slug: 'rollouts', label: 'Canary rollouts' },
      { slug: 'releases', label: 'Releases & rollbacks' },
      { slug: 'release-controls', label: 'Approvals, freezes & schedules' },
      { slug: 'service-bindings', label: 'Service binding verification' },
      { slug: 'environment-promotion', label: 'Environment promotion' },
      { slug: 'api-hosting-openapi', label: 'OpenAPI deploy checks' },
    ],
    faq: [
      {
        question: 'Do canary deploys and automatic rollbacks require extra configuration?',
        answer:
          'No. Every HTTP production release on Gregale uses 1% -> 10% -> 50% -> 100% progressive canary stages and automatic 5xx/crash rollback by default across all plans.',
      },
      {
        question: 'What happens if an automatic rollback crosses a database migration?',
        answer:
          'Automatic rollbacks never blindly move older code onto a newer schema; they keep the current release serving and notify you. On paid plans, `gregale rollback --restore-databases` restores managed PostgreSQL to the release timestamp alongside earlier code.',
      },
      {
        question: 'Can deploy freezes or OpenAPI checks block emergency rollbacks?',
        answer:
          'No. Deploy freezes block new forward production releases (`release_frozen`), while rollbacks to previously serving versions always remain open.',
      },
    ],
  },
  {
    slug: 'ai-coding-agent-guardrails',
    kicker: 'AI agent operations',
    title: 'Let Claude Code, Cursor, Codex and Gemini CLI deploy without breaking production',
    summary:
      'Replace prompt-only rules with platform-enforced scoped `--agent` keys, explicit human approval links for destructive mutations, spend ceilings an agent cannot raise, 7-day mutation undo, and an OAuth MCP server.',
    problemStatement:
      'Prompt instructions in AGENTS.md cannot hold under pressure: an autonomous coding agent given raw cloud keys can delete databases, run up overage bills or push broken schemas straight to production.',
    publishedOn: '2026-11-26',
    updatedOn: '2026-11-26',
    painPoints: [
      {
        before:
          'Prompt rules like "never delete production" fail when agents try to fix failing tasks.',
        withGregale:
          'Server-side enforcement with scoped `--agent` keys refuses destructive production deletions and schema changes until a signed-in human approves.',
      },
      {
        before:
          'Full admin cloud tokens let runaway loops add databases, scale replicas or inflate bills.',
        withGregale:
          'Monthly overage spend caps stop compute at the dollar ceiling and cannot be raised by deploy tokens or MCP coding agents.',
      },
      {
        before:
          'Reverting an agent’s accidental env var, scaling or domain change means digging through logs.',
        withGregale:
          'Built-in 7-day mutation undo (`gregale mcp connection undo`) plus 5xx canary rollbacks and PITR database restore recover cleanly.',
      },
    ],
    articleSlugs: [
      'best-cloud-for-ai-coding-agents',
      'claude-code-deploy-production-safely',
      'cursor-deploy-production-safely',
      'codex-deploy-production-safely',
      'gemini-cli-deploy-production-safely',
      'ai-agent-production-approval',
      'ai-agent-hosting-budget',
      'undo-ai-agent-changes',
      'hosting-mcp-server-deploy-logs-rollback',
      'mcp-server-hosting',
    ],
    docSlugs: [
      { slug: 'agents', label: 'AI coding agents' },
      { slug: 'claude-code', label: 'Claude Code guide' },
      { slug: 'cursor', label: 'Cursor guide' },
      { slug: 'codex', label: 'Codex guide' },
      { slug: 'gemini-cli', label: 'Gemini CLI guide' },
      { slug: 'mcp-hosting', label: 'Host remote MCP servers' },
    ],
    researchSlugs: ['agent-ops-guardrails-matrix-2026-11-25'],
    faq: [
      {
        question: 'How does Gregale stop an AI coding agent from deleting production services?',
        answer:
          'When connected via a scoped `--agent` token or OAuth MCP session, destructive actions pause on the server and return a human approval URL that only a signed-in account owner or admin can authorize.',
      },
      {
        question: 'Can an AI coding agent raise my cloud spend cap?',
        answer:
          'No. Changing the monthly overage spend cap requires an `admin`-scoped credential with multi-factor authentication; `--agent` keys, CI deploy tokens and MCP sessions are blocked from raising it.',
      },
      {
        question: 'Can I host my own remote Streamable HTTP MCP server on Gregale too?',
        answer:
          'Yes. Gregale deploys Node, Python or Docker MCP servers using Streamable HTTP (`/mcp`) with edge OAuth validation (`jwt` edge rules), SSE streaming support and scale-to-zero pause.',
      },
    ],
  },
  {
    slug: 'hard-cloud-cost-control',
    kicker: 'Spend predictability',
    title: 'Eliminate surprise cloud bills with hard spend caps and idle pause',
    summary:
      'Every paid plan includes a hard monthly overage cap from day one (`HTTP 402` enforcement instead of post-facto alerts), free static cache/edge blocks that do not wake VMs, preview-only shutoff budgets and FOCUS FinOps exports.',
    problemStatement:
      'Soft cloud budget alerts only email you hours after an infinite loop, DDoS scrape or overly chatty uptime monitor burns hundreds of dollars on always-on compute and bandwidth.',
    publishedOn: '2026-11-26',
    updatedOn: '2026-11-26',
    painPoints: [
      {
        before: 'Soft email alerts arrive after runaway webhook loops or bots spike your invoice.',
        withGregale:
          'Hard monthly spend caps (Hobby $10, Pro $50, Scale $150 defaults) freeze compute within one scheduler tick via `HTTP 402` while preserving databases and storage.',
      },
      {
        before: 'Egress overages and 5-minute health pings quietly pin paid containers awake 24/7.',
        withGregale:
          'Egress hard-stops by default unless you opt in ($0.03/GiB), and synthetic-check cost tables prevent unintended 24/7 wakes.',
      },
      {
        before:
          'PR previews rack up charges alongside production with no separate circuit breaker.',
        withGregale:
          'Monitored budgets (`"action": "stop_previews"`) pause pull-request previews at a threshold without disrupting production traffic.',
      },
    ],
    articleSlugs: [
      'hard-cloud-spend-caps',
      'ai-agent-hosting-budget',
      'synthetic-uptime-checks-scale-to-zero',
      'declarative-edge-response-cache',
      'scale-to-zero-without-cold-starts',
      'private-object-storage-without-s3-iam',
    ],
    docSlugs: [
      { slug: 'cost-controls', label: 'Cost controls & spend caps' },
      { slug: 'billing', label: 'Billing & forecasts' },
      { slug: 'plans', label: 'Plans & limits' },
      { slug: 'synthetic-checks', label: 'Synthetic checks' },
      { slug: 'edge-rules', label: 'Edge cache & throttling' },
    ],
    researchSlugs: [
      'paas-intermittent-api-cost-model-2026-11-25',
      'intermittent-fastapi-cost-2026-11-24',
    ],
    faq: [
      {
        question: 'Does Gregale Free ever incur overage charges?',
        answer:
          'Never. Free hard-stops at 20 GB-RAM-hours of compute, 1 GiB of object storage and 10 GiB of monthly egress, and cannot enable overage.',
      },
      {
        question: 'Is data deleted when an account hits its monthly spend cap?',
        answer:
          'No. Running workloads pause (`HTTP 402`), managed PostgreSQL pauses with data intact, object storage remains intact, and queued webhooks/crons wait until you raise the cap or the UTC month resets.',
      },
      {
        question: 'Can traffic filtered by edge rules or gateway cache consume compute quota?',
        answer:
          'No. Requests blocked by IP, geo, rate-limit or JWT edge rules—and responses served from gateway edge cache—never wake your microVM or count toward compute GB-RAM-hours.',
      },
    ],
  },
  {
    slug: 'backend-without-devops',
    kicker: 'Zero-Ops backend platform',
    title: 'Run production APIs, Postgres, workers and storage without Kubernetes or a DevOps team',
    summary:
      'Replace fragmented EC2/RDS/S3/Datadog setup with git-push deploys, automatic TLS, managed PostgreSQL with PITR, free-tier PR previews, private S3 object storage, one-line OpenTelemetry tracing and localhost sidecar companions.',
    problemStatement:
      'Small backend teams lose weeks wiring VPCs, Terraform, certbot, Postgres backups, S3 IAM policies and APM agents instead of shipping product code.',
    publishedOn: '2026-11-26',
    updatedOn: '2026-11-26',
    painPoints: [
      {
        before:
          'Connecting API, background worker, managed Postgres and S3 requires multi-vendor Glue & IAM JSON.',
        withGregale:
          'One CLI deploys HTTP APIs, workers, `DATABASE_URL` Postgres and sealed S3 bucket bindings on unified project releases.',
      },
      {
        before:
          'Pull-request preview environments are gated behind expensive enterprise workspace plans.',
        withGregale:
          'Automatic PR preview environments ship on every plan—including Free—with isolated config and safe preview service policies.',
      },
      {
        before:
          'Debugging production regressions requires third-party APM agents, custom exporters and log redaction.',
        withGregale:
          'Adding `tracing: { enabled: true }` turns on zero-code OpenTelemetry spans, PII redaction, normalized SQL and deploy regression alerts.',
      },
    ],
    articleSlugs: [
      'backend-without-devops',
      'fastapi-background-jobs-postgres',
      'nodejs-api-and-worker',
      'preview-environments',
      'private-object-storage-without-s3-iam',
      'zero-code-otel-sql-regression-tracing',
      'sidecar-companions-without-kubernetes',
      'deploy-docker-container-scale-to-zero-no-rewrite',
    ],
    docSlugs: [
      { slug: 'getting-started', label: 'Getting started' },
      { slug: 'postgres', label: 'Managed PostgreSQL' },
      { slug: 'preview-environments', label: 'PR preview environments' },
      { slug: 'object-storage', label: 'Object storage' },
      { slug: 'tracing', label: 'OpenTelemetry tracing' },
      { slug: 'companions', label: 'Sidecar companions' },
    ],
    faq: [
      {
        question: 'Can I keep an API and background worker on the same release without Kubernetes?',
        answer:
          'Yes. Define multiple workloads in a single repository via `gregale.yaml` or `docker-compose.yaml` and deploy them together as one project.',
      },
      {
        question: 'What operations work does Gregale take off my team’s plate?',
        answer:
          'Gregale manages Firecracker VM isolation, TLS issuance and renewal, builds, canary traffic shifting, automatic 5xx rollbacks, managed Postgres backups/PITR, S3 storage bindings and zero-code tracing; your team keeps ownership of app logic and authorization.',
      },
      {
        question:
          'Does Gregale support sidecar containers like OpenTelemetry or Datadog without Kubernetes pods?',
        answer:
          'Yes. Companions (in preview) let you declare up to four long-running sidecars plus a setup helper in `gregale.yaml` sharing loopback and Unix sockets cleanly inside your deployment.',
      },
    ],
  },
  {
    slug: 'multi-service-networking',
    kicker: 'Microservices, security & async scale',
    title:
      'Connect internal microservices, queues and workflows without AWS VPCs or Kafka/KEDA ops',
    summary:
      'Run Firecracker-isolated internal services over `.internal` DNS with zero-VPC caller allowlists, atomic release graphs, platform SSRF denylists, static egress IPs, zero-secret API relays, pull-queue workload identity, Kafka-lag scaling and durable workflows.',
    problemStatement:
      'As backends grow past one service, teams usually get forced into Kubernetes, Istio service meshes, AWS VPC NAT Gateways, KEDA scalers and Temporal clusters just for basic internal reliability and security.',
    publishedOn: '2026-11-26',
    updatedOn: '2026-11-26',
    painPoints: [
      {
        before:
          'Internal service communication demands VPC peering, private hosted zones and manual mTLS certs.',
        withGregale:
          'Apps in the same account discover one another via `GREGALE_SERVICE_*_URL` and `.internal` aliases with target caller allowlists enforced before waking targets.',
      },
      {
        before:
          'Partner IP allowlists or SSRF defense force expensive NAT Gateways and brittle firewall scripts.',
        withGregale:
          'Bind static egress IPs per app/region on demand while platform-wide egress denylists block `169.254.169.254`, RFC1918 and SMTP spam ports across every plan.',
      },
      {
        before:
          'Scaling workers on queue lag or durable workflows means operating KEDA or Temporal.',
        withGregale:
          'Autoscale directly from zero on `queue_lag`, custom metrics or cron schedules, use workload-identity queue leases, and write resumable workflows in plain code or YAML.',
      },
    ],
    articleSlugs: [
      'atomic-multi-service-releases',
      'private-microservice-networking-no-vpc',
      'static-egress-ip-scale-to-zero',
      'ssrf-protection-egress-denylist-paas',
      'zero-secret-outbound-api-relay',
      'edge-rules-rate-limiting-trace-testing',
      'pull-queue-workers-workload-identity',
      'autoscale-from-zero-kafka-lag-custom-metrics',
      'durable-code-workflows-scale-to-zero',
      'stored-workflow-recovery-missed-schedules',
      'microvm-isolation',
    ],
    docSlugs: [
      { slug: 'project-releases', label: 'Atomic project releases' },
      { slug: 'internal-services', label: 'Internal services' },
      { slug: 'static-egress-ip', label: 'Static egress IP' },
      { slug: 'egress-denylist', label: 'Blocked outbound destinations' },
      { slug: 'outbound-integrations', label: 'Outbound integrations' },
      { slug: 'queue-pull-leases', label: 'Pull-queue workers' },
      { slug: 'scaling-policy', label: 'Autoscaling policies' },
      { slug: 'stored-workflows-recovery', label: 'Workflow recovery' },
    ],
    faq: [
      {
        question:
          'Do I need to configure VPC subnets or security groups for private microservice calls?',
        answer:
          'No. Private `.internal` routing and `GREGALE_SERVICE_*_URL` injection work across your account on every plan without configuring VPCs, and target caller allowlists plus default-deny PR preview rules run in the proxy before waking target VMs.',
      },
      {
        question:
          'How does Gregale isolate untrusted workloads compared to shared container clouds?',
        answer:
          'Every app runs in its own Firecracker microVM with an independent guest kernel, memory ceiling and jailed hypervisor boundary—never sharing a host kernel across tenants.',
      },
      {
        question:
          'Can workers authenticate to queues or call Stripe/OpenAI without storing long-lived keys?',
        answer:
          'Yes. Workers with workload identity (preview) fetch short-lived `gregale:queues` tokens on loopback (and block staging/preview reads against production queues), while outbound integrations (preview) inject sealed `Authorization` headers outside the container at `$GREGALE_OUTBOUND_URL`.',
      },
    ],
  },
];

export function findSolution(slug: string): Solution | undefined {
  return SOLUTIONS.find((entry) => entry.slug === slug);
}

/** Markdown representation served at `/solutions/<slug>.md` and in `/llms-full.txt`. */
export function solutionMarkdown(
  solution: Solution,
  articlesBySlug: ReadonlyMap<string, Article>,
  siteUrl: string
): string {
  const base = siteUrl.replace(/\/$/, '');
  const cell = (text: string) => text.replace(/\s+/g, ' ').replaceAll('|', '\\|').trim();
  const painTable = [
    '| Problem without Gregale | How Gregale solves it |',
    '|---|---|',
    ...solution.painPoints.map((row) => `| ${cell(row.before)} | ${cell(row.withGregale)} |`),
  ].join('\n');

  const articles = solution.articleSlugs
    .map((slug) => {
      const article = articlesBySlug.get(slug);
      return article
        ? `- [${article.title}](${base}/articles/${slug}.md): ${article.summary}`
        : `- [${slug}](${base}/articles/${slug}.md)`;
    })
    .join('\n');

  const docs = solution.docSlugs
    .map((doc) => `- [${doc.label}](${base}/docs/${doc.slug}.md)`)
    .join('\n');

  const faq = solution.faq.map((item) => `### ${item.question}\n\n${item.answer}`).join('\n\n');

  const sections = [
    `# ${solution.title}`,
    `Gregale Solutions · ${solution.kicker} · Updated ${solution.updatedOn}`,
    `> ${solution.summary}`,
    solution.problemStatement,
    `## What breaks vs. how Gregale solves it\n\n${painTable}`,
    `## Deep-dive guides\n\n${articles}`,
    `## Documentation\n\n${docs}`,
  ];
  if (solution.researchSlugs?.length) {
    sections.push(
      `## Benchmarks & research\n\n${solution.researchSlugs
        .map((slug) => `- [${slug}](${base}/research/${slug}.md)`)
        .join('\n')}`
    );
  }
  sections.push(`## Questions\n\n${faq}`, `Canonical URL: ${base}/solutions/${solution.slug}`, '');
  return sections.join('\n\n');
}
