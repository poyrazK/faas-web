export type PublicTemplateCategory =
  | 'Application Starters'
  | 'Remote MCP Servers'
  | 'IDE & Coding Agent Plugins'
  | 'CI/CD Integrations';

export interface PublicTemplateEntry {
  slug: string;
  category: PublicTemplateCategory;
  runtime: string;
  title: string;
  summary: string;
  command: string;
  repoUrl: string;
  featureSlugs: readonly string[];
  docSlug: string;
  updatedOn: string;
}

export const TEMPLATES_TITLE = 'Templates & Starters';
export const TEMPLATES_DESCRIPTION =
  'Runnable open-source application starters, scale-to-zero remote MCP servers, IDE plugins, and GitHub Actions integrations hosted on github.com/gregale-dev.';

export const TEMPLATE_CATEGORIES: readonly PublicTemplateCategory[] = [
  'Application Starters',
  'Remote MCP Servers',
  'IDE & Coding Agent Plugins',
  'CI/CD Integrations',
];

export const PUBLIC_TEMPLATES: readonly PublicTemplateEntry[] = [
  {
    slug: 'postgres-migration-rollback-demo',
    category: 'Application Starters',
    runtime: 'Python 3.13 · FastAPI · Postgres 17',
    title: 'Postgres Migration & Rollback Demo',
    summary:
      'FastAPI + managed PostgreSQL 17 starter demonstrating release.command migrations (MIGRATION_DATABASE_URL) and coordinated code + database rollback via gregale rollback --restore-databases.',
    command:
      'gh repo create my-rollback-demo --template gregale-dev/postgres-migration-rollback-demo --clone && gregale deploy --name my-rollback-demo',
    repoUrl: 'https://github.com/gregale-dev/postgres-migration-rollback-demo',
    featureSlugs: ['database-rollbacks', 'firecracker-scale-to-zero'],
    docSlug: 'releases',
    updatedOn: '2026-11-26',
  },
  {
    slug: 'nextjs-postgres-starter',
    category: 'Application Starters',
    runtime: 'Node 24 · Next.js 16 · Postgres 17',
    title: 'Next.js 16 + Postgres Starter',
    summary:
      'Next.js App Router with output: "standalone", pre-traffic SQL migrations, separate /healthz readiness check, and scale-to-zero MicroVMs.',
    command:
      'gh repo create my-nextjs-app --template gregale-dev/nextjs-postgres-starter --clone && gregale deploy --name my-nextjs-app',
    repoUrl: 'https://github.com/gregale-dev/nextjs-postgres-starter',
    featureSlugs: ['database-rollbacks', 'firecracker-scale-to-zero'],
    docSlug: 'deploy-nextjs',
    updatedOn: '2026-11-26',
  },
  {
    slug: 'bun-hono-postgres-starter',
    category: 'Application Starters',
    runtime: 'Bun 1 · Hono · TypeScript · Postgres 17',
    title: 'Bun + Hono + Postgres Starter',
    summary:
      'TypeScript REST API using Bun, Hono, and postgres.js with release-command SQL migrations and managed PostgreSQL 17 suspension when idle.',
    command:
      'gh repo create my-hono-api --template gregale-dev/bun-hono-postgres-starter --clone && gregale deploy --name my-hono-api',
    repoUrl: 'https://github.com/gregale-dev/bun-hono-postgres-starter',
    featureSlugs: ['database-rollbacks', 'firecracker-scale-to-zero'],
    docSlug: 'releases',
    updatedOn: '2026-11-26',
  },
  {
    slug: 'scale-to-zero-websockets',
    category: 'Application Starters',
    runtime: 'Node 22 · Managed Realtime',
    title: 'Scale-to-Zero WebSockets & SSE',
    summary:
      'Hold thousands of idle WebSocket or SSE connections on Gregale Managed Realtime with heartbeat offload and HTTP callbacks so your app parks at $0 compute.',
    command:
      'gh repo create my-realtime-app --template gregale-dev/scale-to-zero-websockets --clone && gregale deploy --name my-realtime-app',
    repoUrl: 'https://github.com/gregale-dev/scale-to-zero-websockets',
    featureSlugs: ['realtime-scale-to-zero', 'firecracker-scale-to-zero'],
    docSlug: 'realtime',
    updatedOn: '2026-11-26',
  },
  {
    slug: 'durable-stripe-webhooks',
    category: 'Application Starters',
    runtime: 'Node 22 · Inbound Webhooks',
    title: 'Durable Stripe & HMAC Webhooks',
    summary:
      'Stripe and generic HMAC-SHA256 inbound webhook receiver validating X-Faas-Invocation-Source, event deduplication, retries, and DLQ replay while parked.',
    command:
      'gh repo create my-webhooks-app --template gregale-dev/durable-stripe-webhooks --clone && gregale deploy --name my-webhooks-app',
    repoUrl: 'https://github.com/gregale-dev/durable-stripe-webhooks',
    featureSlugs: ['durable-webhooks-and-workflows'],
    docSlug: 'inbound-webhooks',
    updatedOn: '2026-11-26',
  },
  {
    slug: 'edge-waf-rate-limit-starter',
    category: 'Application Starters',
    runtime: 'Node 22 · Edge Rules & Trace Fixtures',
    title: 'Edge WAF, Bot Challenge & Spend Caps',
    summary:
      'Pre-wake OWASP CRS WAF, proof-of-work scraper challenge, failure-only composite login throttle, edge response cache, and versioned trace fixtures for gregale edge rule trace.',
    command:
      'gh repo create my-edge-app --template gregale-dev/edge-waf-rate-limit-starter --clone && gregale deploy --name my-edge-app',
    repoUrl: 'https://github.com/gregale-dev/edge-waf-rate-limit-starter',
    featureSlugs: ['edge-security', 'strict-budgets'],
    docSlug: 'edge-rules',
    updatedOn: '2026-11-26',
  },
  {
    slug: 'node-api-worker',
    category: 'Application Starters',
    runtime: 'Node 22 · Docker Compose · Postgres 17',
    title: 'Node.js API + Private Worker Queue',
    summary:
      'Multi-service Compose starter pairing a public Express API with a private worker and Postgres FOR UPDATE SKIP LOCKED job queue without Redis.',
    command:
      'gh repo create my-node-worker --template gregale-dev/node-api-worker --clone && gregale deploy --project',
    repoUrl: 'https://github.com/gregale-dev/node-api-worker',
    featureSlugs: ['durable-webhooks-and-workflows', 'firecracker-scale-to-zero'],
    docSlug: 'multi-service',
    updatedOn: '2026-11-26',
  },
  {
    slug: 'fastapi-postgres-jobs',
    category: 'Application Starters',
    runtime: 'Python 3.13 · FastAPI · Postgres 17',
    title: 'FastAPI + Postgres Background Jobs',
    summary:
      'FastAPI HTTP API with a durable PostgreSQL job queue, leases, and exponential retries that scales both compute and database to zero when idle.',
    command:
      'gh repo create my-fastapi-jobs --template gregale-dev/fastapi-postgres-jobs --clone && gregale deploy --name my-fastapi-jobs',
    repoUrl: 'https://github.com/gregale-dev/fastapi-postgres-jobs',
    featureSlugs: ['durable-webhooks-and-workflows', 'firecracker-scale-to-zero'],
    docSlug: 'deploy-fastapi',
    updatedOn: '2026-11-26',
  },
  {
    slug: 'mcp-server-node',
    category: 'Remote MCP Servers',
    runtime: 'Node 22 · Streamable HTTP MCP',
    title: 'Remote MCP Server in Node.js',
    summary:
      'Stateless Streamable HTTP MCP server built on the official TypeScript SDK with external OAuth, per-tool scopes, SSE progress, and AGENTS.md.',
    command:
      'gregale mcp server init --path ./my-mcp --runtime node && gregale mcp server deploy --path ./my-mcp --name my-mcp',
    repoUrl: 'https://github.com/gregale-dev/mcp-server-node',
    featureSlugs: ['mcp-hosting', 'zero-secret-outbound'],
    docSlug: 'mcp-hosting',
    updatedOn: '2026-11-26',
  },
  {
    slug: 'mcp-server-python',
    category: 'Remote MCP Servers',
    runtime: 'Python 3.13 · Streamable HTTP MCP',
    title: 'Remote MCP Server in Python',
    summary:
      'Stateless Streamable HTTP MCP server in Python with PyJWT external OAuth, JSON Schema tool validation, resource subscriptions, and AGENTS.md.',
    command:
      'gregale mcp server init --path ./my-mcp --runtime python && gregale mcp server deploy --path ./my-mcp --name my-mcp',
    repoUrl: 'https://github.com/gregale-dev/mcp-server-python',
    featureSlugs: ['mcp-hosting'],
    docSlug: 'mcp-hosting',
    updatedOn: '2026-11-26',
  },
  {
    slug: 'mcp-server-go',
    category: 'Remote MCP Servers',
    runtime: 'Go 1.26 · Streamable HTTP MCP',
    title: 'Remote MCP Server in Go',
    summary:
      'Stateless Streamable HTTP MCP server using modelcontextprotocol/go-sdk with JWKS external OAuth, per-tool allowlists, and AGENTS.md.',
    command:
      'gregale mcp server init --path ./my-mcp --runtime go && gregale mcp server deploy --path ./my-mcp --name my-mcp',
    repoUrl: 'https://github.com/gregale-dev/mcp-server-go',
    featureSlugs: ['mcp-hosting'],
    docSlug: 'mcp-hosting',
    updatedOn: '2026-11-26',
  },
  {
    slug: 'gregale-antigravity-plugin',
    category: 'IDE & Coding Agent Plugins',
    runtime: 'Antigravity Plugin · Hosted MCP',
    title: 'Gregale Plugin for Antigravity',
    summary:
      'Connects Antigravity to https://api.gregale.dev/mcp with deploy and diagnose skills plus plain-Markdown operational rules.',
    command: 'agy plugin install https://github.com/gregale-dev/gregale-antigravity-plugin',
    repoUrl: 'https://github.com/gregale-dev/gregale-antigravity-plugin',
    featureSlugs: ['mcp-hosting'],
    docSlug: 'antigravity',
    updatedOn: '2026-11-26',
  },
  {
    slug: 'gregale-claude-code-plugin',
    category: 'IDE & Coding Agent Plugins',
    runtime: 'Claude Code Plugin & Marketplace',
    title: 'Gregale Plugin for Claude Code',
    summary:
      'Claude Code plugin marketplace configuring https://api.gregale.dev/mcp, deploy/diagnose skills, and CLAUDE.md guardrails.',
    command: '/plugin marketplace add gregale-dev/gregale-claude-code-plugin',
    repoUrl: 'https://github.com/gregale-dev/gregale-claude-code-plugin',
    featureSlugs: ['mcp-hosting'],
    docSlug: 'claude-code',
    updatedOn: '2026-11-26',
  },
  {
    slug: 'gregale-cursor-plugin',
    category: 'IDE & Coding Agent Plugins',
    runtime: 'Cursor Plugin · Hosted MCP',
    title: 'Gregale Plugin for Cursor',
    summary:
      'Deploy, inspect logs, diagnose regressions, and roll back releases directly from Cursor over OAuth-scoped hosted MCP.',
    command: 'https://github.com/gregale-dev/gregale-cursor-plugin',
    repoUrl: 'https://github.com/gregale-dev/gregale-cursor-plugin',
    featureSlugs: ['mcp-hosting'],
    docSlug: 'cursor',
    updatedOn: '2026-11-26',
  },
  {
    slug: 'setup-gregale',
    category: 'CI/CD Integrations',
    runtime: 'GitHub Action · @v1',
    title: 'setup-gregale GitHub Action',
    summary:
      'Composite GitHub Action that installs the Gregale CLI, masks optional bearer credentials, and pairs with edge-rule-trace and deploy verification workflows.',
    command: 'uses: gregale-dev/setup-gregale@v1',
    repoUrl: 'https://github.com/gregale-dev/setup-gregale',
    featureSlugs: ['edge-security', 'database-rollbacks', 'strict-budgets'],
    docSlug: 'cli',
    updatedOn: '2026-11-26',
  },
];

export function templatesForFeature(featureSlug: string): readonly PublicTemplateEntry[] {
  return PUBLIC_TEMPLATES.filter((entry) => entry.featureSlugs.includes(featureSlug));
}
