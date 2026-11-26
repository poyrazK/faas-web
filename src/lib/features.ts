import type { FaqEntry } from './faq.ts';
import { RESTORE_CONTEXT, RESTORE_TARGET } from './platform-claims.ts';

/**
 * Product-level feature pages showcasing Gregale's flagship GA and Beta
 * capabilities (`/features` and `/features/<slug>`).
 *
 * Loaded by `scripts/prerender.mjs` with plain Node: no JSX, no `?raw`.
 */
export interface FeatureHighlight {
  title: string;
  detail: string;
}

export interface FeatureComparisonRow {
  capability: string;
  typicalPaas: string;
  gregale: string;
}

export interface FeatureDocLink {
  slug: string;
  label: string;
}

export interface Feature {
  slug: string;
  category: string;
  maturity: string;
  plans: string;
  title: string;
  headline: string;
  summary: string;
  overview: string;
  updatedOn: string;
  codeTitle: string;
  codeLanguage: string;
  codeSnippet: string;
  highlights: readonly FeatureHighlight[];
  comparison: readonly FeatureComparisonRow[];
  docSlugs: readonly FeatureDocLink[];
  articleSlugs: readonly string[];
  researchSlugs?: readonly string[];
  faq: readonly FaqEntry[];
}

export const FEATURES_TITLE = 'Features';
export const FEATURES_DESCRIPTION =
  'The platform capabilities that set Gregale apart: database-synced rollbacks, pre-wake edge WAF, scale-to-zero realtime, durable webhooks, Firecracker snapshot restore, zero-secret outbound relays, hosted MCP servers, and hard spend caps.';

export const FEATURES: readonly Feature[] = [
  {
    slug: 'database-rollbacks',
    category: 'Data & releases',
    maturity: 'GA',
    plans: 'Hobby, Pro, Scale',
    title: 'Database-synced rollbacks',
    headline: 'Roll back your app and its managed PostgreSQL database together',
    summary:
      'Undo a broken release across both application code and managed PostgreSQL in one phased operation that preserves post-deploy writes in the original database.',
    overview:
      'Rolling back an application container without reversing its schema migration often leaves production broken. Gregale coordinates code rollback and managed PostgreSQL point-in-time recovery as one tracked switch, staging and verifying credentials on the restored database copy before fencing traffic.',
    updatedOn: '2026-11-26',
    codeTitle: 'Roll back code and database together, or restore data independently',
    codeLanguage: 'bash',
    codeSnippet: `gregale rollback my-api --to v41 --restore-databases

# Or restore only the database and switch the app without changing code
gregale postgres restore orders --name orders-0900 --point-in-time 2026-11-26T09:00:00Z --switch my-api`,
    highlights: [
      {
        title: 'Undoes release migrations automatically',
        detail:
          'Pass --restore-databases to restore each database migrated by undone releases back to the exact start timestamp of the earliest replaced release command.',
      },
      {
        title: 'Non-destructive copy semantics',
        detail:
          'Restores into a new database (<name>-before-v<revision>) so writes recorded after the restore point stay intact in the original database.',
      },
      {
        title: 'Verified phased cutover',
        detail:
          'Your current release keeps serving while Gregale restores the copy, stages credentials, and checks SQL connectivity before fencing and switching the app.',
      },
      {
        title: 'Data-only switch without code changes',
        detail:
          'When code is healthy and data is not, restore a managed PostgreSQL database to any timestamp in its 7-day window and switch the app in place.',
      },
    ],
    comparison: [
      {
        capability: 'Coordinated code + DB rollback',
        typicalPaas: 'Reverts image only; manual DB backup restore and rebind',
        gregale: 'One CLI command restores both to the migration boundary',
      },
      {
        capability: 'Post-incident writes preservation',
        typicalPaas: 'In-place restores risk overwriting recent rows',
        gregale: 'Creates a new restored copy and leaves original DB intact',
      },
      {
        capability: 'Credential verification',
        typicalPaas: 'App boots and discovers broken credentials live',
        gregale: 'Stages and verifies SQL credentials before fencing traffic',
      },
    ],
    docSlugs: [
      { slug: 'releases', label: 'Releases & rollbacks' },
      { slug: 'postgres', label: 'Managed PostgreSQL' },
      { slug: 'rollouts', label: 'Canary rollouts' },
      { slug: 'release-controls', label: 'Release controls' },
    ],
    articleSlugs: [
      'rollback-code-and-database',
      'canary-deploys',
      'deploy-freezes-release-approvals-schedules',
      'atomic-multi-service-releases',
    ],
    faq: [
      {
        question: 'Does --restore-databases overwrite my existing PostgreSQL database?',
        answer:
          'No. Gregale restores a new database named <name>-before-v<revision> and rebinds the app to it. All writes that landed in the original database after the restore point remain untouched until you explicitly delete the old database.',
      },
      {
        question:
          'Can I restore a database and switch my app without rolling back application code?',
        answer:
          'Yes. Run gregale postgres restore <db> --name <new-name> --point-in-time <timestamp> --switch <app> to execute the same credential staging, fencing, drain, and switch flow while keeping the current code release.',
      },
      {
        question: 'Is there brief downtime during a database-synced rollback?',
        answer:
          'While the database copy restores and SQL credentials are checked, the app continues serving. Gregale then fences traffic, drains active instances, switches the binding and release, and resumes the app (typically under a minute plus wake time).',
      },
    ],
  },
  {
    slug: 'edge-security',
    category: 'Edge protection',
    maturity: 'GA & Beta',
    plans: 'Free+ (edge rules), Hobby+ (challenge), Pro+ (WAF)',
    title: 'Pre-wake WAF & edge security',
    headline: 'Block OWASP attacks and scrapers at the edge before your app even wakes',
    summary:
      'In-path OWASP Core Rule Set WAF blocking, adaptive proof-of-work browser challenges, declarative edge caching, and replayable trace tests that reject hostile traffic before waking parked compute.',
    overview:
      'On scale-to-zero platforms without edge enforcement, every scanner probe or credential-stuffing burst wakes a container and bills compute. Gregale evaluates WAF rules, rate limits, IP/country/token checks, and browser challenges in the public edge path so blocked requests receive 403 at $0 compute cost.',
    updatedOn: '2026-11-26',
    codeTitle: 'Trace and test edge rules locally or against a live project environment',
    codeLanguage: 'bash',
    codeSnippet: `# Replay a versioned edge-rule scenario from a JSON file
gregale edge rule trace my-api --file ./edge-trace.json

# Or trace a live project environment against its effective policy
gregale edge rule trace my-api --project shop --environment staging --url https://staging.shop.gregale.app/search`,
    highlights: [
      {
        title: 'In-path OWASP WAF blocking',
        detail:
          'kind=waf rules on Pro and Scale inspect matched headers and URLs against the OWASP Core Rule Set (SQLi, XSS, path traversal, scanners). Block mode rejects with 403 before waking your app at paranoia level 1; paranoia level 2 runs in observe-only preview.',
      },
      {
        title: 'Zero-third-party browser challenge',
        detail:
          'kind=challenge stops scrapers with a lightweight proof-of-work check and signed pass cookie on custom domains too, while verified API keys, consumer keys, and JWTs pass without friction.',
      },
      {
        title: 'Replayable edge rule trace & rollback',
        detail:
          'Verify how a request matches your rules before pushing changes using gregale edge rule trace scenarios, and inspect rule revision history or roll back anytime.',
      },
      {
        title: 'Declarative edge response cache',
        detail:
          'Cache selected GET and HEAD responses at the edge with bounded freshness, stale-while-revalidate, and explicit purges so repeated reads never wake an instance.',
      },
    ],
    comparison: [
      {
        capability: 'Requests blocked before app wake',
        typicalPaas: 'Traffic reaches container or requires external WAF proxy',
        gregale: 'Refused at the edge (403); parked microVM stays at $0',
      },
      {
        capability: 'OWASP Core Rule Set WAF',
        typicalPaas: 'Usually an enterprise add-on or external CDN layer',
        gregale: 'Built-in kind=waf rules with observe, warn, and block modes',
      },
      {
        capability: 'Scraper challenge without CAPTCHA SaaS',
        typicalPaas: 'External CAPTCHA scripts or Cloudflare enterprise config',
        gregale: 'Native proof-of-work pass cookie that exempts API keys & JWTs',
      },
    ],
    docSlugs: [
      { slug: 'security', label: 'Security & WAF' },
      { slug: 'edge-rules', label: 'Edge rules' },
      { slug: 'edge-rule-trace', label: 'Edge rule trace' },
      { slug: 'cache', label: 'Response caching' },
    ],
    articleSlugs: [
      'edge-rules-rate-limiting-trace-testing',
      'declarative-edge-response-cache',
      'ssrf-protection-egress-denylist-paas',
    ],
    faq: [
      {
        question: 'Do blocked requests wake a parked Gregale app or count toward my bill?',
        answer:
          'No. Requests refused at the edge by WAF block rules, browser challenges, rate limits, or access controls never wake your Firecracker microVM and cost nothing.',
      },
      {
        question: 'Which plans include WAF and browser challenge rules?',
        answer:
          'General edge rules and rate limits are available across plans including Free. Browser challenges (kind=challenge) unlock on Hobby, Pro, and Scale (up to 3, 10, and 25 rules). OWASP WAF rules (kind=waf) unlock on Pro and Scale, with observe/warn/block available per account rollout at paranoia level 1.',
      },
      {
        question: 'Will browser challenge rules break API clients calling my backend?',
        answer:
          'No. Requests carrying a verified API key, consumer key, or JWT bypass the browser challenge automatically so programmatic clients keep working.',
      },
    ],
  },
  {
    slug: 'realtime-scale-to-zero',
    category: 'Realtime',
    maturity: 'Beta',
    plans: 'Hobby, Pro, Scale',
    title: 'Scale-to-zero managed realtime',
    headline: 'Hold WebSockets and SSE connections open while your backend sleeps at $0',
    summary:
      'Gregale terminates long-lived WebSocket and Server-Sent Events connections at the edge, handles heartbeats while your backend stays parked, and wakes your app only when messages arrive or you broadcast.',
    overview:
      'Holding idle WebSockets inside your own backend forces at least one instance to remain running around the clock. Gregale Managed Realtime decouples persistent socket termination from your application compute so clients stay connected for hours while you pay only for actual request handling.',
    updatedOn: '2026-11-26',
    codeTitle: 'Create a managed realtime endpoint and broadcast from anywhere',
    codeLanguage: 'bash',
    codeSnippet: `# Create an endpoint backed by your app callbacks (pipe secret via stdin)
printf '%s\\n' "$CALLBACK_TOKEN" | gregale realtime create my-app \\
  --callback-url https://my-app.example.com \\
  --callback-auth-token-stdin

# Publish to a channel from your backend, CI job, or CLI without holding sockets
gregale realtime publish my-app <endpoint-id> notifications --data '{"status":"ready"}'`,
    highlights: [
      {
        title: 'Heartbeats handled while parked',
        detail:
          'Clients connect to wss://<your-app-host>/__gregale/realtime/<endpoint-id> over WebSocket or HTTPS SSE. Gregale maintains heartbeats while your app stays at zero resident RAM.',
      },
      {
        title: 'Wake-on-message callbacks',
        detail:
          'Incoming client messages and connection lifecycle hooks invoke your backend over HTTP callbacks; once processed, the app parks again after its idle timeout.',
      },
      {
        title: 'Zero-connection backend broadcasts',
        detail:
          'Publish to channels or send directly to a connection via the Node/Python/Go SDKs, REST API, or CLI from short-lived handlers or background jobs.',
      },
      {
        title: 'Explicit trade-off vs. direct WebSockets',
        detail:
          'Self-terminated WebSockets (--websocket-enabled) remain available when sockets must terminate inside the app, whereas Managed Realtime maximizes savings on long, sparse connections.',
      },
    ],
    comparison: [
      {
        capability: 'Idle client WebSocket connections',
        typicalPaas: 'Keeps app container running and billed 24/7',
        gregale: 'Held by Gregale edge while app stays parked at $0',
      },
      {
        capability: 'Client transport support',
        typicalPaas: 'Separate third-party realtime SaaS required for sleep',
        gregale: 'Built-in WebSocket and HTTPS Server-Sent Events',
      },
      {
        capability: 'Fan-out publish from serverless jobs',
        typicalPaas: 'Requires Redis pub/sub + dedicated socket fleet',
        gregale: 'Single SDK/API/CLI publish call wakes zero extra servers',
      },
    ],
    docSlugs: [
      { slug: 'realtime', label: 'Managed realtime' },
      { slug: 'scale-to-zero', label: 'Scale to zero' },
      { slug: 'sdks', label: 'SDKs' },
      { slug: 'billing', label: 'Billing' },
    ],
    articleSlugs: [
      'websockets-sse-scale-to-zero',
      'scale-to-zero-without-cold-starts',
      'hard-cloud-spend-caps',
    ],
    researchSlugs: ['paas-intermittent-api-cost-model-2026-11-25'],
    faq: [
      {
        question: 'Which parts of Managed Realtime are Beta today vs. Preview?',
        answer:
          'Realtime endpoints, WebSocket and SSE connections held while your app is parked, callbacks, live publish, direct/principal send, connection operations, and fair-use limits are Beta on every paid plan. Retained history/resumable protocol, presence, occupancy, tickets, and worker groups are per-account Preview.',
      },
      {
        question: 'Does holding 1,000 open WebSocket clients bill compute on my app?',
        answer:
          'No app compute is billed while your app is parked and connections are idle because Gregale handles heartbeats at the realtime edge. Your app is billed only during active callbacks or backend requests.',
      },
      {
        question: 'What if I want to handle raw WebSocket frames directly inside my app process?',
        answer:
          'You can still enable --websocket-enabled on the app directly. Keep in mind those sockets terminate inside your running VM, which keeps that instance active and billed while connections stay open.',
      },
    ],
  },
  {
    slug: 'durable-webhooks-and-workflows',
    category: 'Async & workflows',
    maturity: 'GA & Beta',
    plans: 'Hobby, Pro, Scale',
    title: 'Durable webhooks, delayed tasks & workflows',
    headline: 'Accept Stripe and GitHub webhooks while your app is asleep — zero lost events',
    summary:
      'Verify and persist inbound webhooks before responding, schedule one-shot delayed invocations, run crons and pull-queue workers, and execute multi-step workflows with automatic retries and dead-letter recovery.',
    overview:
      'External webhook providers time out or fail deliveries if a sleeping backend takes too long to respond or hits a transient error. Gregale combines signature verification, durable queuing, delayed tasks, batch jobs, crons, and multi-step workflow recovery natively on the same platform.',
    updatedOn: '2026-11-26',
    codeTitle: 'Register a durable Stripe webhook and inspect dead-letter entries',
    codeLanguage: 'bash',
    codeSnippet: `curl -X POST https://api.gregale.dev/v1/apps/my-api/inbound-webhooks \\
  -H "Authorization: Bearer $GREGALE_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "stripe-primary",
    "provider": "stripe",
    "signing_secret": "whsec_...",
    "delivery_path": "/internal/stripe"
  }'

# Inspect failed deliveries or delayed tasks in the unified dead-letter ledger
gregale dlq list my-api`,
    highlights: [
      {
        title: 'Persist-before-ack inbound webhooks',
        detail:
          'Verifies Stripe or generic HMAC-SHA256 signatures, deduplicates on X-Gregale-Event-ID, persists to the durable queue, and returns 202 Accepted before waking your app.',
      },
      {
        title: 'Delayed one-shot execution',
        detail:
          'Schedule a durable future invocation directly on Gregale without provisioning a separate Redis queue, cron daemon, or external scheduler.',
      },
      {
        title: 'Built-in jobs, crons & pull leases',
        detail:
          'Run HTTP crons or command tasks alongside your app, process large batches with jobs and artifacts, or lease messages directly from workers without an HTTP listener.',
      },
      {
        title: 'Stored & code-first durable workflows',
        detail:
          'Orchestrate multi-step execution with retries, waits, dependencies, scheduled triggers, workflow insights, and configurable recovery policies.',
      },
    ],
    comparison: [
      {
        capability: 'Webhooks arriving while backend sleeps',
        typicalPaas: 'May time out on cold boot or drop on 503',
        gregale: 'Signature checked and queued durably before 202 Accepted',
      },
      {
        capability: 'Delayed tasks, crons & retries',
        typicalPaas: 'Requires Upstash QStash, Inngest, or Temporal add-ons',
        gregale: 'Built into the core API with unified dead-letter ledger',
      },
      {
        capability: 'Pull-queue worker model',
        typicalPaas: 'Manage SQS/RabbitMQ separately',
        gregale: 'Pull leases with capacity-controlled worker acks/nacks',
      },
    ],
    docSlugs: [
      { slug: 'inbound-webhooks', label: 'Inbound webhooks' },
      { slug: 'event-driven', label: 'Event-driven workloads' },
      { slug: 'stored-workflows', label: 'Stored workflows' },
      { slug: 'code-workflows', label: 'Code workflows' },
      { slug: 'jobs', label: 'Jobs' },
      { slug: 'crons', label: 'Scheduled crons' },
      { slug: 'queue-pull-leases', label: 'Pull-queue leases' },
    ],
    articleSlugs: [
      'durable-inbound-webhooks-scale-to-zero',
      'durable-code-workflows-scale-to-zero',
      'stored-workflow-recovery-missed-schedules',
      'scale-to-zero-cron-jobs-event-triggers',
      'pull-queue-workers-workload-identity',
    ],
    faq: [
      {
        question: 'Which webhook providers are supported out of the box?',
        answer:
          'Inbound webhook endpoints support stripe (verifying Stripe signatures with sealed secrets) and generic HMAC-SHA256 senders using X-Gregale-Event-ID, X-Gregale-Event-Type, X-Gregale-Timestamp, and X-Gregale-Signature headers.',
      },
      {
        question: 'What happens if my app returns an error when delivering a queued webhook?',
        answer:
          'Failed deliveries retry according to your plan policy (3, 10, or 25 attempts on Hobby, Pro, and Scale) and land in the app dead-letter queue (gregale dlq list) for inspection and replay.',
      },
      {
        question: 'Can I share one workflow recovery policy across scheduled and manual runs?',
        answer:
          'Yes. Stored workflows, delayed tasks, and async invocations expose run history, status insights, and policy-based recovery in both the dashboard and CLI.',
      },
    ],
  },
  {
    slug: 'firecracker-scale-to-zero',
    category: 'Runtime',
    maturity: 'GA & Beta',
    plans: 'Free, Hobby, Pro, Scale',
    title: 'Firecracker snapshot restore & wake-ahead',
    headline: 'Isolated microVMs that park to $0 and pre-wake downstream services automatically',
    summary: `Every workload runs in its own Firecracker microVM that snapshots to disk at zero RAM cost (${RESTORE_TARGET}) and pre-wakes internal service dependencies automatically.`,
    overview:
      'Most scale-to-zero platforms force either shared container kernels, multi-second cold starts, or cascading delays when an edge API calls internal microservices. Gregale pairs hardware-virtualized Firecracker snapshots with Service Wake-Ahead, after-restore lifecycle hooks, and zero-rewrite OCI compatibility.',
    updatedOn: '2026-11-26',
    codeTitle: 'Configure after_restore hooks and multi-service wake-ahead in YAML',
    codeLanguage: 'yaml',
    codeSnippet: `# gregale.yaml — refresh in-memory connections right after snapshot restore
lifecycle:
  after_restore:
    path: /internal/after-restore
    timeout_ms: 500

# compose.yaml — toggle automatic wake-ahead per dependent service
services:
  billing:
    build: ./billing
    x-gregale-wake-ahead: true`,
    highlights: [
      {
        title: 'MicroVM snapshot restore',
        detail: `Idle instances park to snapshot on disk at zero resident RAM. ${RESTORE_TARGET}. ${RESTORE_CONTEXT}`,
      },
      {
        title: 'Service wake-ahead',
        detail:
          'When an app wakes, Gregale automatically starts waking its parked internal dependencies right away so multi-service chains avoid serialized cold-start stacks.',
      },
      {
        title: 'After-restore hooks & automatic fallback',
        detail:
          'Run an idempotent loopback hook (X-Faas-After-Restore: 1) after guest clock and entropy repair; if it fails or times out, Gregale falls back cleanly to a fresh cold boot.',
      },
      {
        title: 'Warm pools, wake pages & timelines',
        detail:
          'Inspect exact phase timings per wake in the Wake Timeline, show branded waiting pages to browser visitors if needed, or keep warm paused capacity on paid plans.',
      },
    ],
    comparison: [
      {
        capability: 'Workload isolation boundary',
        typicalPaas: 'Shared Linux kernel / cgroup containers',
        gregale: 'Dedicated Firecracker KVM microVM per instance',
      },
      {
        capability: 'Cascading microservice wakes',
        typicalPaas: 'Downstream services stay cold until caller reaches them',
        gregale: 'Service wake-ahead wakes declared dependencies immediately',
      },
      {
        capability: 'Post-restore connection refresh',
        typicalPaas: 'Stale sockets discovered on live user request',
        gregale: 'lifecycle.after_restore hook with cold-boot fallback',
      },
    ],
    docSlugs: [
      { slug: 'scale-to-zero', label: 'Scale to zero' },
      { slug: 'internal-services', label: 'Internal services' },
      { slug: 'multi-service', label: 'Multi-service Compose' },
      { slug: 'container-compatibility', label: 'Container compatibility' },
      { slug: 'scaling-policy', label: 'Scaling policies' },
    ],
    articleSlugs: [
      'scale-to-zero-without-cold-starts',
      'microvm-isolation',
      'private-microservice-networking-no-vpc',
      'deploy-docker-container-scale-to-zero-no-rewrite',
    ],
    researchSlugs: [
      'firecracker-snapshot-restore-ssd-2026-09-09',
      'intermittent-fastapi-cost-2026-11-24',
      'paas-intermittent-api-cost-model-2026-11-25',
    ],
    faq: [
      {
        question: 'What does the snapshot restore target measure?',
        answer: `${RESTORE_TARGET}. ${RESTORE_CONTEXT} The platform interval covers capacity admission or boot start through the first upstream byte (scheduler, snapshot restore, and internal proxy).`,
      },
      {
        question: 'Do I have to configure Service Wake-Ahead manually for Compose apps?',
        answer:
          'Wake-ahead is enabled automatically for declared project dependencies and can also be toggled per app with gregale app wake-ahead <app> on|off or x-gregale-wake-ahead in Compose.',
      },
      {
        question: 'How do existing Docker images run with scale to zero?',
        answer:
          'Any stateless Linux/amd64 Docker or OCI container listening on HTTP works without function SDK rewrites. Stateless contract checks also warn before deploy if code relies on local ephemeral disk surviving a park.',
      },
    ],
  },
  {
    slug: 'zero-secret-outbound',
    category: 'Zero-trust security',
    maturity: 'GA & Beta',
    plans: 'Free+ (secrets, OIDC, scans), Hobby+ (outbound integrations)',
    title: 'Zero-secret outbound relay & workload identity',
    headline: 'Call third-party APIs without ever putting the API key in your app’s environment',
    summary:
      'Inject upstream API credentials at Gregale’s outbound relay, exchange short-lived OIDC workload identity tokens, scan deployments for CVEs and leaked secrets, and reload secrets without dropping traffic.',
    overview:
      'Storing raw vendor API keys in container environment variables exposes credentials to application-level RCE, dependency supply-chain leaks, or stale snapshots. Gregale removes static secrets wherever possible and strictly controls every credential that remains.',
    updatedOn: '2026-11-26',
    codeTitle: 'Keep vendor keys in Gregale’s outbound relay and rotate app secrets safely',
    codeLanguage: 'bash',
    codeSnippet: `# Seal a provider Authorization header in Gregale's outbound relay (never exposed in app env)
curl -X PUT https://api.gregale.dev/v1/outbound/integrations/$INTEGRATION_ID/credential \\
  -H "Authorization: Bearer $GREGALE_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"authorization": "Bearer re_live_..."}'

# Rotate an app secret cleanly with snapshot invalidation and rolling drain
gregale env rotate --app my-api DATABASE_URL="$NEW_DATABASE_URL" --restart`,
    highlights: [
      {
        title: 'Credential-injecting outbound relay',
        detail:
          'Register provider origin, allowed HTTP methods/paths, and daily limits on an outbound integration (per-account preview on paid plans). The relay attaches Authorization in transit — app code never reads the key.',
      },
      {
        title: 'Short-lived OIDC workload identity',
        detail:
          'Authenticate workloads to external cloud providers with signed short-lived OIDC tokens instead of pasting static cloud access keys.',
      },
      {
        title: 'Automated CVE & secret scanning',
        detail:
          'Every deployment can be scanned for known vulnerabilities and accidentally committed credentials alongside an outbound SSRF egress denylist covering RFC1918, loopback, and IMDS.',
      },
      {
        title: 'Snapshot-safe secret rotation',
        detail:
          'Mutating a secret invalidates prior snapshots immediately; adding --restart queues a rolling replacement that drains old VMs without ever snapshotting old credentials.',
      },
    ],
    comparison: [
      {
        capability: 'Third-party API credentials in app runtime',
        typicalPaas: 'Plain env vars readable by any compromised package',
        gregale: 'Outbound relay injects sealed headers outside the microVM',
      },
      {
        capability: 'Cloud provider auth',
        typicalPaas: 'Static IAM keys copied into env config',
        gregale: 'Short-lived OIDC workload identity tokens (Beta)',
      },
      {
        capability: 'Snapshots after secret rotation',
        typicalPaas: 'Risk of stale memory/env state in warm containers',
        gregale: 'Auto-invalidates snapshots + rolling --restart drain',
      },
    ],
    docSlugs: [
      { slug: 'outbound-integrations', label: 'Outbound integrations' },
      { slug: 'secrets', label: 'Secrets management' },
      { slug: 'security', label: 'Security overview' },
      { slug: 'egress-denylist', label: 'Egress denylist' },
    ],
    articleSlugs: [
      'zero-secret-outbound-api-relay',
      'zero-restart-secret-rotation',
      'pull-queue-workers-workload-identity',
      'ssrf-protection-egress-denylist-paas',
    ],
    faq: [
      {
        question: 'Can my application code read a credential stored on an outbound integration?',
        answer:
          'No. The credential is sealed at rest and never exposed in the microVM environment or API responses (which only report credential_configured: true). Gregale injects it at the outbound relay after checking method, path, and rate policy.',
      },
      {
        question: 'Are outbound integrations enabled by default on all accounts?',
        answer:
          'Outbound integrations are available on Hobby, Pro, and Scale plans as a per-account preview enabled through support. Sealed app secrets, OIDC workload identity, and egress SSRF protection are available independently.',
      },
      {
        question: 'How does secret rotation interact with Firecracker snapshots?',
        answer:
          'Updating or rotating any secret automatically invalidates existing snapshots so no restored microVM can boot with old credentials. Passing --restart runs a rolling cold-boot replacement cleanly.',
      },
    ],
  },
  {
    slug: 'mcp-hosting',
    category: 'AI & MCP',
    maturity: 'Beta',
    plans: 'Hobby, Pro, Scale',
    title: 'Hosted MCP servers',
    headline: 'Deploy scale-to-zero Streamable HTTP MCP servers with verified tool scopes',
    summary:
      'Scaffold Streamable HTTP MCP servers in Node, Go, or Python, lock down every tool behind gregale-mcp.json allowlists, scale to zero between agent sessions, and monitor readiness continuously.',
    overview:
      'Remote Model Context Protocol servers sit idle between agent bursts yet need strict tool authorization and health verification before Claude, Cursor, Codex, or VS Code connect. Gregale treats MCP hosting as a first-class workload with official starters, protocol checks, and zero-idle billing.',
    updatedOn: '2026-11-26',
    codeTitle: 'Scaffold a Streamable HTTP MCP server and lock down tool allowlists',
    codeLanguage: 'bash',
    codeSnippet: `# Create a Node, Go (--runtime go), or Python (--runtime python) MCP server
gregale mcp server init --path ./my-mcp

# gregale-mcp.json — unlisted tools are hidden and refused with 403 tool_access_denied
# {
#   "auth": {
#     "tool_scopes": { "lookup": [], "greet": [] }
#   }
# }`,
    highlights: [
      {
        title: 'Official Node, Go & Python starters',
        detail:
          'Generate a working Streamable HTTP server at /mcp in seconds with sample tools, resources, prompts, health checks, and drain handlers wired.',
      },
      {
        title: 'Fail-closed tool, resource & prompt allowlists',
        detail:
          'Every exposed capability must be listed in gregale-mcp.json (tool_scopes, resource_scopes, prompt_scopes). Unlisted tools are hidden and rejected with 403 tool_access_denied.',
      },
      {
        title: 'Scale-to-zero between agent calls',
        detail:
          'Hosted MCP servers run in isolated Firecracker microVMs that park at $0 between sessions and wake on demand without idling GPUs or VM instances.',
      },
      {
        title: 'Protocol diagnostics & readiness checks',
        detail:
          'Each new deployment runs MCP verification before taking live traffic, paired with readiness monitoring and optional PostgreSQL-backed durable MCP Tasks (Preview).',
      },
    ],
    comparison: [
      {
        capability: 'Idle MCP server billing',
        typicalPaas: 'Fixed monthly container charge even between sessions',
        gregale: 'Parks to $0 idle between agent calls; wakes on /mcp requests',
      },
      {
        capability: 'Per-tool allowlists & scoping',
        typicalPaas: 'Hand-rolled auth middleware inside server code',
        gregale: 'Declarative gregale-mcp.json scope maps enforced per tool',
      },
      {
        capability: 'Account management via MCP + guardrails',
        typicalPaas: 'Direct destructive CLI tokens only',
        gregale: 'Plan -> Verify -> Approval -> Undo workflows for agent safety',
      },
    ],
    docSlugs: [
      { slug: 'mcp-hosting', label: 'Host an MCP server' },
      { slug: 'agents', label: 'Coding agents & MCP' },
      { slug: 'claude-code', label: 'Claude Code' },
      { slug: 'cursor', label: 'Cursor' },
      { slug: 'codex', label: 'Codex' },
      { slug: 'gemini-cli', label: 'Gemini CLI' },
    ],
    articleSlugs: [
      'mcp-server-hosting',
      'hosting-mcp-server-deploy-logs-rollback',
      'best-cloud-for-ai-coding-agents',
    ],
    researchSlugs: ['agent-ops-guardrails-matrix-2026-11-25'],
    faq: [
      {
        question: 'Which MCP transport and runtimes does Gregale support?',
        answer:
          'Gregale hosts Streamable HTTP MCP servers at /mcp and provides official starters via gregale mcp server init for Node.js, Go (--runtime go), and Python (--runtime python).',
      },
      {
        question:
          'What happens if an MCP tool is registered in code but omitted from gregale-mcp.json?',
        answer:
          'The scope maps act as allowlists. Any tool missing from auth.tool_scopes (or resource_scopes / prompt_scopes) is hidden from callers and rejected with 403 tool_access_denied.',
      },
      {
        question: 'Can coding agents also manage my Gregale apps safely over MCP?',
        answer:
          'Yes. Gregale exposes a hosted management MCP endpoint (https://api.gregale.dev/mcp) with OAuth, dry-run deploy diffs, canary verification, approval gates, and single-command undo.',
      },
    ],
  },
  {
    slug: 'strict-budgets',
    category: 'Cost control',
    maturity: 'GA & Beta',
    plans: 'Free, Hobby, Pro, Scale',
    title: 'Hard spend caps, strict budgets & FinOps',
    headline: 'Cloud budgets that actually stop overspend — plus automatic PR preview stops',
    summary:
      'Hard monthly overage ceilings turned on by default on every paid plan, scoped strict budgets across orgs, projects, and previews, live cost forecasts, and FOCUS 1.4 invoice exports.',
    overview:
      'Most PaaS platforms notify you after a traffic loop or forgotten staging environment has already inflated your invoice. Gregale enforces hard spend ceilings automatically on every plan, stops noisy PR previews when budgets trip, and pairs usage tracking with standard FinOps exports.',
    updatedOn: '2026-11-26',
    codeTitle: 'Check your spend cap, forecast monthly costs, and export FOCUS data',
    codeLanguage: 'bash',
    codeSnippet: `gregale billing spend-cap
gregale billing costs --month 2026-11 --json
gregale billing forecast --json

# Export a partial FOCUS 1.4 invoice detail ZIP (CSV + metadata.json)
gregale billing export --month 2026-11 --out invoices.zip`,
    highlights: [
      {
        title: 'Default hard spend caps on every plan',
        detail:
          'Paid plans start with a hard monthly overage ceiling (Hobby $10 default / $75 max, Pro $50 / $200, Scale $150 / $1,000). Reaching the cap pauses compute and queues work cleanly without deleting data.',
      },
      {
        title: 'Granular monitored & strict budgets',
        detail:
          'Scope budgets to an account, organization, project, environment, app, or job with Slack, PagerDuty, and email alerts plus automatic PR preview stops on overrun.',
      },
      {
        title: 'Edge rejections & parked state stay $0',
        detail:
          'Requests blocked by edge WAF/challenge/throttle rules, parked microVMs, included build minutes, and platform features like canaries and custom domains cost nothing.',
      },
      {
        title: 'Per-app cost trends & FOCUS 1.4 exports',
        detail:
          'Inspect per-app compute and egress breakdowns with monthly forecasts and download partial FOCUS 1.4 invoice detail archives for financial reconciliation.',
      },
    ],
    comparison: [
      {
        capability: 'Exceeding monthly spend budget',
        typicalPaas: 'Sends email alert while compute continues billing uncapped',
        gregale: 'Hard spend cap stops compute and queued work cleanly',
      },
      {
        capability: 'Default spend protection at signup',
        typicalPaas: 'Opt-in soft alerts or credit card chargebacks only',
        gregale: 'Hard cap enabled automatically from day one on every plan',
      },
      {
        capability: 'Runaway PR preview protection',
        typicalPaas: 'Preview environments bill until manually closed',
        gregale: 'Budgets can stop preview environments automatically',
      },
    ],
    docSlugs: [
      { slug: 'cost-controls', label: 'Cost controls' },
      { slug: 'billing', label: 'Billing & forecasts' },
      { slug: 'plans', label: 'Plans & limits' },
      { slug: 'preview-environments', label: 'Preview environments' },
    ],
    articleSlugs: ['hard-cloud-spend-caps', 'ai-agent-hosting-budget', 'preview-environments'],
    researchSlugs: [
      'paas-intermittent-api-cost-model-2026-11-25',
      'intermittent-fastapi-cost-2026-11-24',
    ],
    faq: [
      {
        question: 'Does hitting my hard spend cap delete my apps, buckets, or databases?',
        answer:
          'No. When monthly overage reaches the cap, running workloads stop and incoming work waits until you raise the cap or the new UTC calendar month starts. Nothing is deleted.',
      },
      {
        question:
          'What happens if the Free plan reaches its 20 GB-RAM-hours or 10 GiB egress allowance?',
        answer:
          'The Free plan never bills and cannot turn on overage — workloads simply stop once the included monthly allowance is exhausted.',
      },
      {
        question: 'How complete is the FOCUS 1.4 invoice export?',
        answer:
          'gregale billing export produces a partial FOCUS 1.4 Invoice Detail CSV alongside metadata.json describing exact columns and source coverage (carrying header X-Gregale-FOCUS-Conformance: partial).',
      },
    ],
  },
];

export function findFeature(slug: string): Feature | undefined {
  return FEATURES.find((feature) => feature.slug === slug);
}

const cell = (text: string): string => text.replace(/\s+/g, ' ').replaceAll('|', '\\|').trim();

/** Markdown version of one `/features/<slug>` page for `Accept: text/markdown` and `llms-full.txt`. */
export function featureMarkdown(feature: Feature, siteUrl: string): string {
  const highlights = feature.highlights
    .map((item) => `- **${item.title}:** ${item.detail}`)
    .join('\n');
  const table = [
    '| Capability | Typical PaaS | Gregale |',
    '|---|---|---|',
    ...feature.comparison.map(
      (row) => `| ${cell(row.capability)} | ${cell(row.typicalPaas)} | ${cell(row.gregale)} |`
    ),
  ].join('\n');
  const docs = feature.docSlugs
    .map((doc) => `- [${doc.label}](${siteUrl}/docs/${doc.slug}.md)`)
    .join('\n');
  const articles = feature.articleSlugs
    .map((slug) => `- [${slug}](${siteUrl}/articles/${slug}.md)`)
    .join('\n');
  const faq = feature.faq.map((item) => `### ${item.question}\n\n${item.answer}`).join('\n\n');

  const sections = [
    `# ${feature.title}`,
    `> ${feature.summary}`,
    `Category: ${feature.category} · Maturity: ${feature.maturity} · Plans: ${feature.plans} · Updated ${feature.updatedOn}`,
    feature.overview,
    `## ${feature.codeTitle}\n\n\`\`\`${feature.codeLanguage}\n${feature.codeSnippet}\n\`\`\``,
    `## Key capabilities\n\n${highlights}`,
    `## Typical PaaS vs. Gregale\n\n${table}`,
    `## Documentation\n\n${docs}`,
    `## Related guides\n\n${articles}`,
  ];

  if (feature.researchSlugs?.length) {
    const studies = feature.researchSlugs
      .map((slug) => `- [${slug}](${siteUrl}/research/${slug}.md)`)
      .join('\n');
    sections.push(`## Research\n\n${studies}`);
  }

  sections.push(`## Frequently asked questions\n\n${faq}`);
  sections.push(`Canonical URL: ${siteUrl}/features/${feature.slug}`);

  return sections.join('\n\n') + '\n';
}
