/**
 * One entry per GA, beta and preview row of faas docs/ga-capability-inventory.md
 * (vendored in content/capabilities by `npm run capabilities:pull`), saying where
 * the console covers it. The spec is
 * docs/superpowers/specs/2026-10-30-console-backend-parity-design.md; every
 * parity PR moves its rows' status and gap, and `npm run parity` prints coverage.
 *
 * - `full`: the console does what the capability offers customers.
 * - `partial`: a surface exists; `gap` says what is missing.
 * - `cli`: no console surface yet; `cli` is the command to show meanwhile.
 * - `none`: nothing in the console yet.
 * - `platform`: ambient platform behaviour with nothing to operate (isolation,
 *   the wake page, notification emails, the SDKs, the CLI itself).
 */
export type ParityStatus = 'full' | 'partial' | 'cli' | 'none' | 'platform';
export interface LedgerEntry {
  row: number;
  /** Verbatim from the inventory; the test fails if upstream renames the row. */
  name: string;
  status: ParityStatus;
  /** Console routes; `?tab=` must be an app tab and `?section=` a settings section. */
  surfaces: string[];
  /** The catalog id the surface is gated on; required for preview rows with a surface. */
  capability?: string;
  /** The exact `gregale` command shown where the console defers to the CLI. */
  cli?: string;
  /** What is missing, in one line; required unless status is 'full' or 'platform'. */
  gap?: string;
  /** The spec wave that closes the gap. */
  wave?: 0 | 1 | 2 | 3;
}

export const LEDGER: LedgerEntry[] = [
  // A1 · GA
  {
    row: 1,
    name: 'Apps: create, update, rename, delete, restore deleted',
    status: 'partial',
    surfaces: ['/dashboard/apps'],
    gap: 'Recently deleted: list /v1/deleted-apps and restore after the grace window',
    wave: 1,
  },
  // A2 · GA
  {
    row: 2,
    name: 'Source deploys: local tree, tarball, Dockerfile; resumable uploads',
    status: 'partial',
    surfaces: ['/dashboard/apps/$appSlug?tab=Deployments'],
    gap: 'Tarball deploys use the deprecated multipart route; move to /v1/uploads',
    wave: 0,
  },
  // A3 · GA
  {
    row: 3,
    name: 'Builds in builder microVMs: Railpack, build logs, build cache',
    status: 'full',
    surfaces: ['/dashboard/builds'],
  },
  // A4 · GA
  {
    row: 4,
    name: 'Container / OCI image deploys, incl. image-published deployments; image preflight',
    status: 'full',
    surfaces: ['/dashboard/apps/$appSlug?tab=Deployments'],
  },
  // A5 · GA
  {
    row: 5,
    name: 'GitHub: App install, push-to-deploy, Checks status',
    status: 'partial',
    surfaces: ['/dashboard/settings?section=integrations'],
    gap: 'GitHub status, sync and disconnect',
    wave: 1,
  },
  // A6 · preview
  {
    row: 6,
    name: 'GitLab connect and deploys',
    status: 'none',
    surfaces: [],
    gap: 'GitLab connect and deploys',
    wave: 3,
  },
  // A7 · preview
  {
    row: 7,
    name: 'Service migration: public "would my app run here" preflight, import from GitHub, verify, cut over',
    status: 'partial',
    surfaces: ['/dashboard/import'],
    capability: 'service-migration',
    gap: 'Guided resumable migrations (open PR #195)',
    wave: 3,
  },
  // A9 · GA
  { row: 9, name: 'Starter templates (17)', status: 'full', surfaces: ['/dashboard/templates'] },
  // A10 · beta
  {
    row: 10,
    name: 'Framework profiles: detect start command, port, health path',
    status: 'full',
    surfaces: ['/dashboard/apps/new'],
  },
  // A11 · GA
  {
    row: 11,
    name: '`gregale.yaml` deploy overrides, app config',
    status: 'partial',
    surfaces: ['/dashboard/apps/$appSlug?tab=Configuration'],
    gap: 'release_policy, release_probe_paths and function_concurrency are not shown',
    wave: 1,
  },
  // A12 · beta
  {
    row: 12,
    name: 'Source-ref deploys: one-shot pinned CI deploy',
    status: 'full',
    surfaces: ['/dashboard/apps/$appSlug?tab=Deployments'],
  },
  // A13 · GA
  {
    row: 13,
    name: 'Per-app deploy tokens for CI',
    status: 'none',
    surfaces: [],
    gap: 'Deploy tokens: list, create, rotate and revoke',
    wave: 1,
  },
  // A15 · GA
  {
    row: 15,
    name: 'Private registry credentials',
    status: 'full',
    surfaces: ['/dashboard/apps/$appSlug?tab=Configuration'],
  },
  // A16 · GA
  {
    row: 16,
    name: 'Stateless-contract checks and source review',
    status: 'none',
    surfaces: [],
    gap: 'Source-review results on the deployment (open PR #168)',
    wave: 1,
  },
  // A17 · beta
  {
    row: 17,
    name: 'Affected-workload preview: what a deploy will touch',
    status: 'partial',
    surfaces: ['/dashboard/projects'],
    gap: 'Single-app deploy diff (gregale diff)',
    wave: 2,
  },
  // A18 · beta
  {
    row: 18,
    name: 'Deploy-time vulnerability scan (Grype) and secret scan',
    status: 'full',
    surfaces: ['/dashboard/releases'],
  },
  // A19 · GA
  {
    row: 19,
    name: 'Projects: multi-app apply, submissions, project previews',
    status: 'partial',
    surfaces: ['/dashboard/projects'],
    gap: 'Update and delete projects, project previews, new fields',
    wave: 1,
  },
  // A20 · preview
  {
    row: 20,
    name: 'Environments and Environment GitOps (field ownership)',
    status: 'partial',
    surfaces: ['/dashboard/projects/$projectSlug'],
    capability: 'environments',
    gap: 'Create, config, secrets and routes; promotions, approvals, release sets, GitOps',
    wave: 3,
  },
  // A21 · preview
  {
    row: 21,
    name: 'App tasks: one-off commands (`app exec`, ADR-230)',
    status: 'none',
    surfaces: [],
    gap: 'One-off app tasks (app exec)',
    wave: 3,
  },
  // A23 · beta
  {
    row: 23,
    name: 'Deploy queue controls: reorder, deploy immediately, cancel, clear obsolete',
    status: 'partial',
    surfaces: ['/dashboard/apps/$appSlug?tab=Deployments'],
    gap: 'Reorder, deploy immediately and cancel queued deploys',
    wave: 2,
  },
  // B24 · GA
  {
    row: 24,
    name: 'Rollback to a named revision',
    status: 'partial',
    surfaces: ['/dashboard/apps/$appSlug?tab=Deployments'],
    gap: 'Rollback status and named-revision detail',
    wave: 1,
  },
  // B25 · beta
  {
    row: 25,
    name: 'Progressive rollouts: canary ladder, traffic split, automatic rollback on 5xx',
    status: 'partial',
    surfaces: ['/dashboard/releases'],
    gap: 'Deployment diff, runtime upgrade preview, promote, rollout observation',
    wave: 1,
  },
  // B26 · beta
  {
    row: 26,
    name: 'Deployment aliases',
    status: 'none',
    surfaces: [],
    gap: 'Deployment aliases',
    wave: 2,
  },
  // B27 · GA
  {
    row: 27,
    name: 'Pull-request previews',
    status: 'partial',
    surfaces: ['/dashboard/releases'],
    gap: 'Create a preview; preview by slug',
    wave: 1,
  },
  // B28 · preview
  {
    row: 28,
    name: 'Release gates on customer signals',
    status: 'none',
    surfaces: [],
    gap: 'Release gates on customer signals',
    wave: 3,
  },
  // B29 · preview
  {
    row: 29,
    name: 'Release approvals and approval policy',
    status: 'none',
    surfaces: [],
    gap: 'Release approvals and approval policy',
    wave: 3,
  },
  // B30 · preview
  {
    row: 30,
    name: 'Deploy freezes and release windows',
    status: 'none',
    surfaces: [],
    gap: 'Deploy freezes and release windows',
    wave: 3,
  },
  // B31 · preview
  {
    row: 31,
    name: 'Scheduled releases',
    status: 'none',
    surfaces: [],
    gap: 'Scheduled releases',
    wave: 3,
  },
  // B34 · beta
  {
    row: 34,
    name: 'Release commands: a command (e.g. migrations) that must succeed before a deployment takes traffic',
    status: 'partial',
    surfaces: ['/dashboard/releases'],
    gap: 'Release command status on the deployment',
    wave: 2,
  },
  // B35 · preview
  {
    row: 35,
    name: 'Traffic mirroring',
    status: 'partial',
    surfaces: ['/dashboard/apps/$appSlug?tab=Mirrors'],
    capability: 'traffic-mirroring',
    gap: 'Mirror detail and replay',
    wave: 3,
  },
  // B36 · preview
  {
    row: 36,
    name: 'Critical route health during canaries',
    status: 'partial',
    surfaces: ['/dashboard/releases'],
    capability: 'route-health-canary-guard',
    gap: 'Route-health gate',
    wave: 3,
  },
  // B37 · preview
  {
    row: 37,
    name: 'Alert-triggered rollbacks',
    status: 'none',
    surfaces: [],
    gap: 'Alert-triggered rollbacks',
    wave: 3,
  },
  // C38 · GA
  {
    row: 38,
    name: 'Scale to zero: park idle, wake on request',
    status: 'full',
    surfaces: ['/dashboard/apps/$appSlug?tab=Configuration'],
  },
  // C39 · GA
  {
    row: 39,
    name: 'Browser wake page: a waiting page for browser visits during a cold wake',
    status: 'platform',
    surfaces: [],
  },
  // C40 · GA
  { row: 40, name: 'Firecracker isolation', status: 'platform', surfaces: [] },
  // C41 · GA
  {
    row: 41,
    name: 'Function runtimes: Node 22/24, Python 3.12/3.13, Go 1.24 (+alpine), static binary',
    status: 'full',
    surfaces: ['/dashboard/apps/new'],
  },
  // C42 · GA
  {
    row: 42,
    name: 'Manual park / wake, prewarm',
    status: 'full',
    surfaces: ['/dashboard/apps/$appSlug?tab=Configuration'],
  },
  // C43 · GA
  {
    row: 43,
    name: 'Autoscaling and min instances (target RPS / CPU), scheduled scaling',
    status: 'full',
    surfaces: ['/dashboard/apps/$appSlug?tab=Configuration'],
  },
  // C44 · GA
  {
    row: 44,
    name: 'Service wake-ahead',
    status: 'none',
    surfaces: [],
    gap: 'Service wake-ahead',
    wave: 1,
  },
  // C46 · GA
  {
    row: 46,
    name: 'Instances: list, restart, runtime-config restarts',
    status: 'full',
    surfaces: ['/dashboard/instances'],
  },
  // C47 · GA
  {
    row: 47,
    name: 'Health probes and auto-restart: startup, readiness, liveness; restart policy, stop signal, grace period, drain timeout',
    status: 'cli',
    surfaces: [],
    cli: 'gregale deploy (gregale.yaml probes and restart_policy)',
    gap: 'Probe and restart settings are not shown in the console',
    wave: 1,
  },
  // C48 · beta
  {
    row: 48,
    name: 'Snapshot lifecycle hooks: run app code before checkpoint and after restore',
    status: 'cli',
    surfaces: [],
    cli: 'gregale deploy (gregale.yaml before_checkpoint and after_restore)',
    gap: 'Snapshot lifecycle hooks are not shown in the console',
    wave: 2,
  },
  // C49 · GA
  {
    row: 49,
    name: 'Resource sizing: RAM, CPU millicores, scratch disk, disk I/O profile, workload classes (http / worker / job), replicas',
    status: 'full',
    surfaces: ['/dashboard/apps/$appSlug?tab=Configuration'],
  },
  // C50 · beta
  {
    row: 50,
    name: 'Warm pool and warm snapshots',
    status: 'none',
    surfaces: [],
    gap: 'Warm pool size and warm snapshots',
    wave: 2,
  },
  // C51 · preview
  {
    row: 51,
    name: 'Reserved concurrency and eviction priority',
    status: 'full',
    surfaces: ['/dashboard/apps/$appSlug?tab=Configuration'],
    capability: 'reserved-concurrency',
  },
  // C52 · preview
  {
    row: 52,
    name: 'Application companions (sidecars)',
    status: 'partial',
    surfaces: ['/dashboard/apps/$appSlug?tab=Configuration'],
    capability: 'companions',
    gap: 'Sidecar timeline',
    wave: 3,
  },
  // C53 · preview
  {
    row: 53,
    name: 'Disposable isolated runs, execution workflows, artifact grants',
    status: 'none',
    surfaces: [],
    gap: 'Disposable runs and execution workflows',
    wave: 3,
  },
  // C54 · preview
  {
    row: 54,
    name: 'MCP hosting: readiness, catalog monitor, OAuth, tasks',
    status: 'partial',
    surfaces: ['/dashboard/apps/$appSlug?tab=MCP'],
    capability: 'mcp-hosting',
    gap: 'Readiness monitoring, diagnostics and OAuth retirements',
    wave: 3,
  },
  // C55 · preview
  {
    row: 55,
    name: 'Production forks',
    status: 'none',
    surfaces: [],
    gap: 'Production forks',
    wave: 3,
  },
  // C56 · preview
  {
    row: 56,
    name: 'Crash snapshots',
    status: 'none',
    surfaces: [],
    gap: 'Crash snapshots',
    wave: 3,
  },
  // C58 · preview
  {
    row: 58,
    name: 'Developer environments: expiring `gregale dev` environments, developer session leases, file watch and sync, live source patch without rebuild',
    status: 'none',
    surfaces: [],
    gap: 'Developer environments (read, plus the gregale dev command)',
    wave: 3,
  },
  // C60 · GA
  {
    row: 60,
    name: 'Env vars: diff, history and rollback, push / pull, environment clone, secret scanning',
    status: 'partial',
    surfaces: ['/dashboard/apps/$appSlug?tab=Environment'],
    gap: 'History, rollback and config guard',
    wave: 1,
  },
  // C61 · GA
  {
    row: 61,
    name: 'Secrets: sealed values, references, revocations, hot reload without restart, delivery status',
    status: 'partial',
    surfaces: ['/dashboard/apps/$appSlug?tab=Environment'],
    gap: 'Secret references and revocations',
    wave: 1,
  },
  // C62 · beta
  {
    row: 62,
    name: 'Workload identity: short-lived OIDC tokens for apps',
    status: 'platform',
    surfaces: [],
  },
  // D63 · GA
  {
    row: 63,
    name: 'Custom domains with managed TLS, wildcard domains (Pro+), domain doctor',
    status: 'partial',
    surfaces: ['/dashboard/domains'],
    gap: 'Domain detail and default (open PRs #206, #208)',
    wave: 1,
  },
  // D64 · GA
  {
    row: 64,
    name: 'Streaming, SSE, WebSockets, gRPC, protocol selector, streaming cap',
    status: 'platform',
    surfaces: [],
  },
  // D65 · GA
  {
    row: 65,
    name: 'Internal services (call apps by name)',
    status: 'full',
    surfaces: ['/dashboard/apps/$appSlug?tab=Services'],
  },
  // D66 · GA
  {
    row: 66,
    name: 'Service bindings, verification and probes',
    status: 'partial',
    surfaces: ['/dashboard/apps/$appSlug?tab=Services'],
    gap: 'Verification runs, release policy, queue canaries',
    wave: 1,
  },
  // D67 · beta
  {
    row: 67,
    name: 'Private apps',
    status: 'full',
    surfaces: ['/dashboard/apps/$appSlug?tab=Configuration'],
  },
  // D68 · preview
  {
    row: 68,
    name: 'Private networks',
    status: 'none',
    surfaces: [],
    gap: 'Private networks and peerings',
    wave: 3,
  },
  // D69 · preview
  { row: 69, name: 'TCP listeners', status: 'none', surfaces: [], gap: 'TCP listeners', wave: 3 },
  // D70 · preview
  { row: 70, name: 'UDP listeners', status: 'none', surfaces: [], gap: 'UDP listeners', wave: 3 },
  // D71 · preview
  {
    row: 71,
    name: 'Static egress IP',
    status: 'none',
    surfaces: [],
    gap: 'Static egress IP',
    wave: 3,
  },
  // D72 · beta
  {
    row: 72,
    name: 'Egress allowlist and extra egress ports',
    status: 'full',
    surfaces: ['/dashboard/apps/$appSlug?tab=Configuration'],
  },
  // D74 · beta
  {
    row: 74,
    name: 'Edge rules (incl. host / path routing declared in `gregale.yaml`): route, rewrite, redirect, headers, CORS, JWT, IP, request validation, geo, async, throttle, cache, retry, circuit breaker, WAF, challenge, maintenance; rule lists; rule trace',
    status: 'partial',
    surfaces: ['/dashboard/edge-rules'],
    gap: 'Versions and rollback, rule lists, suggestions, WAF review; challenge and penalty kinds',
    wave: 2,
  },
  // D75 · beta
  {
    row: 75,
    name: 'CORS presets',
    status: 'partial',
    surfaces: ['/dashboard/edge-rules'],
    gap: 'Edit a CORS preset',
    wave: 2,
  },
  // D76 · beta
  {
    row: 76,
    name: 'Edge protection: pre-auth guard, challenge under attack, WAF',
    status: 'none',
    surfaces: [],
    gap: 'Pre-auth observations and attack mode',
    wave: 2,
  },
  // D77 · GA
  {
    row: 77,
    name: 'App access control: per-app authentication (`require_authn`), public bearer / basic auth, IP allowlist',
    status: 'full',
    surfaces: ['/dashboard/apps/$appSlug?tab=Configuration'],
  },
  // D79 · beta
  {
    row: 79,
    name: 'Session affinity: sticky routing to one instance by signed cookie',
    status: 'platform',
    surfaces: [],
  },
  // D80 · beta
  {
    row: 80,
    name: 'Declarative response caching',
    status: 'full',
    surfaces: ['/dashboard/edge-rules'],
  },
  // D81 · preview
  {
    row: 81,
    name: 'Async routes at the edge: accept and run a route asynchronously',
    status: 'none',
    surfaces: [],
    gap: 'Async routes at the edge',
    wave: 3,
  },
  // D82 · preview
  {
    row: 82,
    name: 'Tenant surfaces: per-customer hostnames (ADR-100)',
    status: 'full',
    surfaces: ['/dashboard/apps/$appSlug?tab=Tenant surfaces'],
    capability: 'tenant-surfaces',
  },
  // D83 · preview
  {
    row: 83,
    name: 'OpenAPI: captured discovery, import and merged spec, contract preview and diff',
    status: 'partial',
    surfaces: ['/dashboard/apps/$appSlug?tab=OpenAPI'],
    capability: 'openapi-contract-preview',
    gap: 'Diff and apply; manual upload',
    wave: 3,
  },
  // D88 · preview
  {
    row: 88,
    name: 'Production route budgets and monitor',
    status: 'none',
    surfaces: [],
    gap: 'Production route budgets and monitor',
    wave: 3,
  },
  // E92 · GA
  {
    row: 92,
    name: 'Crons, fire-now',
    status: 'partial',
    surfaces: ['/dashboard/jobs'],
    gap: 'Cron occurrences and command-run cancel',
    wave: 1,
  },
  // E93 · beta
  {
    row: 93,
    name: 'Jobs, including output artifacts',
    status: 'partial',
    surfaces: ['/dashboard/jobs'],
    gap: 'Retry a task, replay failed runs, artifacts, registry credentials, schedule fields',
    wave: 2,
  },
  // E94 · beta
  {
    row: 94,
    name: 'Workflows: code workflows SDK, attention/outcomes/performance, recovery policy',
    status: 'partial',
    surfaces: ['/dashboard/workflows'],
    gap: 'Runs (cancel, resume, step retry, events), schedules, insights, recovery policy',
    wave: 2,
  },
  // E95 · beta
  {
    row: 95,
    name: 'Delayed tasks',
    status: 'partial',
    surfaces: ['/dashboard/apps/$appSlug?tab=Queues'],
    gap: 'List delayed tasks',
    wave: 2,
  },
  // E96 · beta
  {
    row: 96,
    name: 'Async invocations and results',
    status: 'partial',
    surfaces: ['/dashboard/invocations'],
    gap: 'Keyed replay; work policy and destination fields',
    wave: 2,
  },
  // E97 · preview
  {
    row: 97,
    name: 'Triggers and event sources: Kafka, NATS JetStream, Redis Streams, AMQP / RabbitMQ, SQS-compatible, bucket events, function webhooks; batch delivery',
    status: 'partial',
    surfaces: ['/dashboard/triggers'],
    capability: 'event-triggers',
    gap: 'Realtime kind and delivery mode',
    wave: 3,
  },
  // E98 · preview
  {
    row: 98,
    name: 'Events: publish, schemas, subscriptions, deliveries, replays, recoveries, DLQ, work policies',
    status: 'partial',
    surfaces: ['/dashboard/events'],
    capability: 'events',
    gap: 'Subscriptions, deliveries, schemas, acknowledgements, delivery controls, replays and recoveries',
    wave: 3,
  },
  // E99 · preview
  {
    row: 99,
    name: 'Queues: in-platform SQS-compatible HTTP queue, pull leases, queue bindings, queue workloads',
    status: 'partial',
    surfaces: ['/dashboard/apps/$appSlug?tab=Queues'],
    capability: 'queues',
    gap: 'Unified dead-letter ledger',
    wave: 3,
  },
  // E100 · preview
  {
    row: 100,
    name: 'Worker pools',
    status: 'full',
    surfaces: ['/dashboard/workers'],
    capability: 'worker-pools',
  },
  // E101 · preview
  {
    row: 101,
    name: 'Application inbox and outbox',
    status: 'none',
    surfaces: [],
    gap: 'Application inbox and outbox',
    wave: 3,
  },
  // E102 · beta
  {
    row: 102,
    name: 'Durable inbound webhooks',
    status: 'full',
    surfaces: ['/dashboard/apps/$appSlug?tab=Webhooks'],
  },
  // E103 · beta
  {
    row: 103,
    name: 'Outbound webhooks (account and app)',
    status: 'partial',
    surfaces: ['/dashboard/apps/$appSlug?tab=Webhooks'],
    gap: 'Account release webhooks; webhook health and attempts',
    wave: 2,
  },
  // E104 · preview
  {
    row: 104,
    name: 'Operations: typed customer work, approvals, schedules, children, signals, milestones, effects',
    status: 'none',
    surfaces: [],
    gap: 'Operations and work policies',
    wave: 3,
  },
  // F108 · preview
  {
    row: 108,
    name: 'Object storage: buckets, signed URLs, upload routes, S3 gateway, versioning, lifecycle rules, object lock, write protection, encryption keys, change notifications, multipart uploads',
    status: 'partial',
    surfaces: ['/dashboard/storage'],
    capability: 'object-storage',
    gap: 'Versioning, lifecycle, CORS, tags, encryption, object lock, multipart, upload routes, notifications, write receipts (after open PR #211)',
    wave: 3,
  },
  // F109 · preview
  {
    row: 109,
    name: 'Managed Postgres (account and org databases): point-in-time restore, scale-to-zero, availability classes, resize, connection pool',
    status: 'partial',
    surfaces: ['/dashboard/postgres'],
    capability: 'managed-postgres',
    gap: 'Usage, compute cap, resize, compute policy, cutovers',
    wave: 3,
  },
  // F110 · preview
  {
    row: 110,
    name: 'Data API',
    status: 'none',
    surfaces: [],
    gap: 'Data API usage and budget',
    wave: 3,
  },
  // F111 · preview
  {
    row: 111,
    name: 'Durable entities and sessions, incl. browser sessions, backup, export and restore',
    status: 'none',
    surfaces: [],
    gap: 'Durable entities (run by operators today)',
    wave: 3,
  },
  // F112 · preview
  {
    row: 112,
    name: 'Realtime channels: resume, tickets, access, occupancy',
    status: 'none',
    surfaces: [],
    gap: 'Realtime endpoints, connections, occupancy, send and publish',
    wave: 3,
  },
  // F113 · preview
  { row: 113, name: 'Live queries', status: 'none', surfaces: [], gap: 'Live queries', wave: 3 },
  // F114 · preview
  {
    row: 114,
    name: 'AI gateway',
    status: 'partial',
    surfaces: ['/dashboard/integrations'],
    capability: 'ai-gateway',
    gap: 'Routes, canaries, traces and access tokens',
    wave: 3,
  },
  // F115 · preview
  {
    row: 115,
    name: 'Outbound integrations and bindings: key pools, probes',
    status: 'partial',
    surfaces: ['/dashboard/integrations'],
    capability: 'outbound-integrations',
    gap: 'Binding budget, usage and policy (bind/unbind in open PR #208)',
    wave: 3,
  },
  // G118 · GA
  {
    row: 118,
    name: 'Logs, tail, log archive with retention',
    status: 'full',
    surfaces: ['/dashboard/logs'],
  },
  // G119 · beta
  {
    row: 119,
    name: 'Log drains, log analytics',
    status: 'full',
    surfaces: ['/dashboard/apps/$appSlug?tab=Log drains'],
    capability: 'log-drains',
    wave: 2,
  },
  // G121 · GA
  {
    row: 121,
    name: 'App, service and account metrics; request analytics',
    status: 'full',
    surfaces: ['/dashboard/analytics'],
  },
  // G122 · beta
  {
    row: 122,
    name: 'Custom metrics and OTLP metric ingest',
    status: 'none',
    surfaces: [],
    gap: 'Custom metrics',
    wave: 2,
  },
  // G124 · preview
  {
    row: 124,
    name: 'Tracing: in-guest request tracing, customer OTLP trace ingest, W3C trace propagation',
    status: 'partial',
    surfaces: ['/dashboard/traces'],
    capability: 'tracing',
    gap: 'Customer OTLP trace ingest settings',
    wave: 3,
  },
  // G125 · beta
  {
    row: 125,
    name: 'Alerts, notification channels, alert presets',
    status: 'partial',
    surfaces: ['/dashboard/alerts'],
    gap: 'Notification channels; rule-form metrics, baselines, SLO and log queries; alert detail',
    wave: 2,
  },
  // G127 · preview
  {
    row: 127,
    name: 'Issues: error grouping, Linear and Slack integrations, errors view',
    status: 'partial',
    surfaces: ['/dashboard/apps/$appSlug?tab=Issues'],
    capability: 'issues',
    gap: 'Alert policies, Linear, saved views, source maps',
    wave: 3,
  },
  // G128 · preview
  {
    row: 128,
    name: 'SLOs and error budgets',
    status: 'none',
    surfaces: [],
    gap: 'SLOs and error budgets',
    wave: 3,
  },
  // G129 · preview
  {
    row: 129,
    name: 'Synthetic checks',
    status: 'none',
    surfaces: [],
    gap: 'Synthetic checks',
    wave: 3,
  },
  // G168 · preview
  {
    row: 168,
    name: 'On-demand profile captures: CPU, heap, stacks, Go locks; automatic captures; capture diff',
    status: 'none',
    surfaces: [],
    gap: 'On-demand profile captures',
    wave: 3,
  },
  // G134 · beta
  {
    row: 134,
    name: 'Debug: debug bundle and telemetry, dependency view, post-deploy regressions',
    status: 'partial',
    surfaces: ['/dashboard/debug'],
    gap: 'Request replay and export, debug status, regression review',
    wave: 2,
  },
  // G135 · preview
  {
    row: 135,
    name: 'Production debugger: request evidence capture and safe replay (ADR-127)',
    status: 'partial',
    surfaces: ['/dashboard/apps/$appSlug?tab=Debugger'],
    capability: 'production-debugger',
    gap: 'Evidence capture and safe replay depth',
    wave: 3,
  },
  // G136 · GA
  {
    row: 136,
    name: 'Wake timeline',
    status: 'full',
    surfaces: ['/dashboard/apps/$appSlug?tab=Overview'],
  },
  // G137 · beta
  {
    row: 137,
    name: 'App health assessment, read without waking the app',
    status: 'none',
    surfaces: [],
    gap: 'App health assessment (open PR #125)',
    wave: 2,
  },
  // G138 · GA
  {
    row: 138,
    name: 'Audit log',
    status: 'partial',
    surfaces: ['/dashboard/audit'],
    gap: 'Request audit (opt-in) and route-customer usage',
    wave: 1,
  },
  // G140 · GA
  {
    row: 140,
    name: 'Per-app costs and cost trend',
    status: 'full',
    surfaces: ['/dashboard/usage'],
  },
  // G141 · GA
  { row: 141, name: 'Public status page and incidents', status: 'platform', surfaces: [] },
  // H142 · GA
  {
    row: 142,
    name: 'Signup, login (password and magic link), MFA, password reset, email verification, CLI login',
    status: 'full',
    surfaces: ['/login', '/dashboard/settings?section=security'],
  },
  // H143 · GA
  {
    row: 143,
    name: 'Customer notification emails: verification, magic link, password reset, MFA alerts, deploy failed, quota warning, certificate expiry, payment failed, subscription ended, suspension and restore',
    status: 'platform',
    surfaces: [],
  },
  // H144 · GA
  { row: 144, name: 'API keys with scopes', status: 'full', surfaces: ['/dashboard/keys'] },
  // H145 · beta
  {
    row: 145,
    name: 'Orgs: members, invitations, roles, ownership transfer, seats',
    status: 'full',
    surfaces: ['/dashboard/settings?section=members'],
  },
  // H147 · preview
  {
    row: 147,
    name: 'Application Auth: end-user auth on GoTrue',
    status: 'none',
    surfaces: [],
    gap: 'Application Auth for end users',
    wave: 3,
  },
  // H151 · GA
  {
    row: 151,
    name: 'Plans, usage, invoices, overage cap, cost breakdown and forecast, FOCUS 1.4 invoice export',
    status: 'partial',
    surfaces: ['/dashboard/plans', '/dashboard/usage', '/dashboard/invoices'],
    gap: 'Billing identity, billing status and invoice refresh; company billing',
    wave: 1,
  },
  // H152 · beta
  {
    row: 152,
    name: 'Budgets: policies, projections, alerts and channels, automatic stops (strict budgets)',
    status: 'none',
    surfaces: [],
    gap: 'Budgets: policies, projections, alerts and automatic stops',
    wave: 2,
  },
  // H153 · GA
  {
    row: 153,
    name: 'GDPR export, account deletion and restore during grace, DPA',
    status: 'full',
    surfaces: ['/dashboard/settings?section=data-and-privacy'],
  },
  // I156 · GA
  {
    row: 156,
    name: '`gregale` CLI: guided `start` and `menu`, doctor, context, completion, man, open',
    status: 'platform',
    surfaces: [],
  },
  // I157 · GA
  { row: 157, name: 'Web dashboard', status: 'full', surfaces: ['/dashboard'] },
  // I158 · beta
  {
    row: 158,
    name: 'SDKs: Node, Python, Go, Kotlin, Swift; auth and data SDKs; webhook verifier, idempotency helpers',
    status: 'platform',
    surfaces: [],
  },
  // I159 · GA
  {
    row: 159,
    name: 'Public OpenAPI spec and capabilities endpoint',
    status: 'full',
    surfaces: ['/docs'],
  },
  // I160 · preview
  {
    row: 160,
    name: 'Gregale management MCP server: AI agents manage Gregale over MCP, with an OAuth server',
    status: 'cli',
    surfaces: [],
    cli: 'gregale mcp serve',
    gap: 'Agents manage Gregale through the MCP server; no console surface',
    wave: 3,
  },
  // I161 · GA
  {
    row: 161,
    name: 'Docs site and trust pages: DPA, subprocessors, security reporting, security.txt',
    status: 'full',
    surfaces: ['/docs'],
  },
];
