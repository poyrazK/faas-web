/**
 * Mock data for the Gregale dashboard.
 *
 * Everything is generated from a seeded PRNG at module scope, so values are
 * identical on every render and across reloads — charts never jitter and there
 * is no hydration mismatch. Swap this module for real API calls later; the
 * exported shapes are the contract.
 */

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fixed "now" so relative timestamps never drift between renders. */
export const NOW = new Date('2026-08-13T14:00:00Z').getTime();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export type RunState = 'running' | 'idle' | 'error' | 'deploying' | 'undeployed';

/**
 * The runtimes `apid` actually accepts, mirrored from `CreateAppRequest` in
 * `api/openapi.yaml`. Kept as a hand-written union rather than an import so the
 * fixtures below do not depend on the generated schema; `npm run api:types`
 * will break the build here if upstream changes the set.
 */
export type Runtime = 'node22' | 'node24' | 'python312' | 'python313' | 'go124' | 'go124-alpine';

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: number;
}

export interface Workflow {
  /** The app slug — what `/v1/apps/{slug}` is keyed by, and what the URL shows. */
  id: string;
  /**
   * Optional because the API has no project concept: apps are flat per
   * account. Only the remaining fixtures still set it.
   */
  projectId?: string;
  name: string;
  /** `node22`, `python312`, … or the app `type` for non-function apps. */
  runtime: string;
  memoryMb: number;
  state: RunState;
  /** Optional: this is a one-box platform, so the API reports no region. */
  region?: string;
  url: string;
  invocations24h: number;
  avgDurationMs: number;
  coldStartP50Ms: number;
  errorRatePct: number;
  lastDeployedAt: number;
  version: string;
}

export interface Deployment {
  id: string;
  workflowId: string;
  version: string;
  state: 'succeeded' | 'failed' | 'building';
  /** The unmodified lifecycle status returned by the deployment API. */
  status?: string;
  /** The server's failure detail, when this deployment failed. */
  error?: string | null;
  errorCode?: string | null;
  buildId?: string | null;
  commit: string;
  message: string;
  author: string;
  createdAt: number;
  durationMs: number;
}

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LogEntry {
  id: string;
  ts: number;
  level: LogLevel;
  workflowId: string;
  requestId: string;
  message: string;
  durationMs: number;
  statusCode: number;
}

export interface SeriesPoint {
  t: number;
  invocations: number;
  errors: number;
  coldStarts: number;
  p50: number;
  p95: number;
  p99: number;
  gbSeconds: number;
}

export const PROJECTS: Project[] = [
  {
    id: 'proj_storefront',
    name: 'storefront',
    description: 'Public commerce surface — checkout, catalog, and media pipeline.',
    createdAt: NOW - 214 * DAY,
  },
  {
    id: 'proj_analytics',
    name: 'analytics-pipeline',
    description: 'Nightly ETL, warehouse sync, and event enrichment.',
    createdAt: NOW - 132 * DAY,
  },
  {
    id: 'proj_internal',
    name: 'internal-tools',
    description: 'Back-office automation and internal webhooks.',
    createdAt: NOW - 61 * DAY,
  },
];

const WORKFLOW_SEED: {
  name: string;
  projectId: string;
  runtime: Runtime;
  memoryMb: number;
  state: RunState;
}[] = [
  {
    name: 'image-resize',
    projectId: 'proj_storefront',
    runtime: 'go124',
    memoryMb: 512,
    state: 'running',
  },
  {
    name: 'checkout-hook',
    projectId: 'proj_storefront',
    runtime: 'node22',
    memoryMb: 256,
    state: 'running',
  },
  {
    name: 'catalog-search',
    projectId: 'proj_storefront',
    runtime: 'node24',
    memoryMb: 1024,
    state: 'running',
  },
  {
    name: 'thumbnail-gen',
    projectId: 'proj_storefront',
    runtime: 'go124',
    memoryMb: 512,
    state: 'idle',
  },
  {
    name: 'nightly-etl',
    projectId: 'proj_analytics',
    runtime: 'python312',
    memoryMb: 2048,
    state: 'idle',
  },
  {
    name: 'event-enrich',
    projectId: 'proj_analytics',
    runtime: 'node22',
    memoryMb: 512,
    state: 'running',
  },
  {
    name: 'warehouse-sync',
    projectId: 'proj_analytics',
    runtime: 'python312',
    memoryMb: 1024,
    state: 'error',
  },
  {
    name: 'webhook-router',
    projectId: 'proj_internal',
    runtime: 'node22',
    memoryMb: 256,
    state: 'running',
  },
  {
    name: 'auth-callback',
    projectId: 'proj_internal',
    runtime: 'go124',
    memoryMb: 128,
    state: 'running',
  },
  {
    name: 'pdf-render',
    projectId: 'proj_internal',
    runtime: 'node22',
    memoryMb: 1024,
    state: 'deploying',
  },
];

const REGIONS = ['fra-metal-1', 'iad-metal-1', 'sin-metal-1'];

export const WORKFLOWS: Workflow[] = (() => {
  const rand = mulberry32(1337);
  return WORKFLOW_SEED.map((seed, i) => {
    const invocations24h = Math.round(2_000 + rand() * 480_000);
    const errorRatePct =
      seed.state === 'error' ? 4.2 + rand() * 3 : Number((rand() * 0.6).toFixed(2));
    return {
      id: `fn_${seed.name.replace(/-/g, '_')}`,
      projectId: seed.projectId,
      name: seed.name,
      runtime: seed.runtime,
      memoryMb: seed.memoryMb,
      state: seed.state,
      region: REGIONS[i % REGIONS.length],
      url: `https://${seed.name}.gregale.run`,
      invocations24h,
      avgDurationMs: Math.round(18 + rand() * 340),
      coldStartP50Ms: Math.round(180 + rand() * 160),
      errorRatePct: Number(errorRatePct.toFixed(2)),
      lastDeployedAt: NOW - Math.round(rand() * 9 * DAY),
      version: `v0.${8 + (i % 3)}.${1 + Math.round(rand() * 20)}`,
    };
  });
})();

export function workflowsForProject(projectId: string) {
  return WORKFLOWS.filter((fn) => fn.projectId === projectId);
}

export function getWorkflow(id: string) {
  return WORKFLOWS.find((fn) => fn.id === id);
}

export function getProject(id: string) {
  return PROJECTS.find((p) => p.id === id);
}

const COMMIT_MESSAGES = [
  'Cache resized variants in the bucket',
  'Drop the retry loop on 4xx',
  'Bump runtime to go1.23',
  'Add structured logging for cold starts',
  'Reduce snapshot size by trimming layers',
  'Fix off-by-one in pagination cursor',
  'Wire secrets through the boot manifest',
  'Tighten the egress allowlist',
  'Parallelize the warehouse upsert',
  'Handle empty payloads without panicking',
];

const AUTHORS = ['e.cintas', 'k.poyraz', 'm.aydin', 'dependabot'];

export const DEPLOYMENTS: Deployment[] = (() => {
  const rand = mulberry32(90210);
  const out: Deployment[] = [];
  WORKFLOWS.forEach((fn) => {
    const count = 3 + Math.floor(rand() * 4);
    for (let i = 0; i < count; i++) {
      const failed = rand() < 0.12;
      out.push({
        id: `dep_${fn.id}_${i}`,
        workflowId: fn.id,
        version: `v0.${8 + (i % 3)}.${count - i}`,
        state: fn.state === 'deploying' && i === 0 ? 'building' : failed ? 'failed' : 'succeeded',
        commit: Math.floor(rand() * 0xfffffff)
          .toString(16)
          .padStart(7, '0')
          .slice(0, 7),
        message: COMMIT_MESSAGES[Math.floor(rand() * COMMIT_MESSAGES.length)],
        author: AUTHORS[Math.floor(rand() * AUTHORS.length)],
        createdAt: fn.lastDeployedAt - i * (rand() * 3 * DAY),
        durationMs: Math.round(14_000 + rand() * 50_000),
      });
    }
  });
  return out.sort((a, b) => b.createdAt - a.createdAt);
})();

const LOG_MESSAGES: Record<LogLevel, string[]> = {
  info: [
    'request completed',
    'snapshot restored from warm pool',
    'response written to client',
    'cache hit for object key',
  ],
  debug: ['resolving component bindings', 'boot manifest applied', 'vsock channel opened'],
  warn: [
    'cold start exceeded target budget',
    'retrying upstream after 502',
    'payload approaching size limit',
  ],
  error: [
    'upstream timeout after 30s',
    'connection refused by warehouse',
    'unhandled rejection in handler',
  ],
};

export const LOGS: LogEntry[] = (() => {
  const rand = mulberry32(5150);
  const out: LogEntry[] = [];
  for (let i = 0; i < 240; i++) {
    const fn = WORKFLOWS[Math.floor(rand() * WORKFLOWS.length)];
    const roll = rand();
    const level: LogLevel =
      roll > 0.93 ? 'error' : roll > 0.82 ? 'warn' : roll > 0.24 ? 'info' : 'debug';
    const pool = LOG_MESSAGES[level];
    out.push({
      id: `log_${i}`,
      ts: NOW - Math.round(rand() * 6 * HOUR),
      level,
      workflowId: fn.id,
      requestId: Math.floor(rand() * 0xffffffffff)
        .toString(16)
        .padStart(12, '0')
        .slice(0, 12),
      message: pool[Math.floor(rand() * pool.length)],
      durationMs: Math.round(4 + rand() * 900),
      statusCode: level === 'error' ? 500 : level === 'warn' ? 429 : 200,
    });
  }
  return out.sort((a, b) => b.ts - a.ts);
})();

export type RangeKey = '24h' | '7d' | '30d';

export const RANGES: { key: RangeKey; label: string; points: number; stepMs: number }[] = [
  { key: '24h', label: 'Last 24 hours', points: 24, stepMs: HOUR },
  { key: '7d', label: 'Last 7 days', points: 7 * 4, stepMs: 6 * HOUR },
  { key: '30d', label: 'Last 30 days', points: 30, stepMs: DAY },
];

/**
 * Traffic series with a diurnal cycle plus noise. `scale` lets a single
 * function's series be a fraction of the account-wide one.
 */
export function buildSeries(range: RangeKey, seedOffset = 0, scale = 1): SeriesPoint[] {
  const cfg = RANGES.find((r) => r.key === range)!;
  const rand = mulberry32(4242 + seedOffset);
  const out: SeriesPoint[] = [];

  for (let i = cfg.points - 1; i >= 0; i--) {
    const t = NOW - i * cfg.stepMs;
    const hourOfDay = new Date(t).getUTCHours();
    // Traffic peaks mid-afternoon UTC and troughs overnight.
    const diurnal = 0.55 + 0.45 * Math.sin(((hourOfDay - 4) / 24) * Math.PI * 2);
    const noise = 0.82 + rand() * 0.36;
    const base = (range === '30d' ? 1_180_000 : range === '7d' ? 310_000 : 62_000) * scale;

    const invocations = Math.round(base * diurnal * noise);
    const errorShare = 0.002 + rand() * 0.004;
    const p50 = Math.round(26 + rand() * 22);

    out.push({
      t,
      invocations,
      errors: Math.round(invocations * errorShare),
      coldStarts: Math.round(invocations * (0.03 + rand() * 0.035)),
      p50,
      p95: Math.round(p50 * (2.4 + rand() * 0.8)),
      p99: Math.round(p50 * (5.1 + rand() * 2.4)),
      gbSeconds: Math.round(invocations * (0.0009 + rand() * 0.0007) * 100) / 100,
    });
  }
  return out;
}

export interface UsageLine {
  label: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  cost: number;
  included: number;
}

export function buildUsage(): UsageLine[] {
  const lines: Omit<UsageLine, 'cost'>[] = [
    {
      label: 'Compute',
      quantity: 812_400,
      unit: 'GB-seconds',
      unitPrice: 0.000012,
      included: 400_000,
    },
    {
      label: 'Invocations',
      quantity: 24_310_000,
      unit: 'requests',
      unitPrice: 0.0000002,
      included: 1_000_000,
    },
    { label: 'Egress', quantity: 1_284, unit: 'GB', unitPrice: 0.01, included: 100 },
  ];
  return lines.map((line) => ({
    ...line,
    cost: Math.max(0, line.quantity - line.included) * line.unitPrice,
  }));
}

/* ---------- formatting helpers ---------- */

export function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

export function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

export function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
}

export function formatRelative(ts: number): string {
  // A zero timestamp is the adapter's explicit sentinel for an app that has
  // never been deployed. Treat invalid timestamps as missing data rather than
  // rendering the Unix epoch as a many-thousand-day-old deployment.
  if (!Number.isFinite(ts) || ts <= 0) return 'Never';

  // Against the real clock: every caller now passes live API timestamps, and
  // the pinned fixture clock above made anything newer than it read "just now".
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < HOUR) return `${Math.max(1, Math.round(diff / 60_000))}m ago`;
  if (diff < DAY) return `${Math.round(diff / HOUR)}h ago`;
  return `${Math.round(diff / DAY)}d ago`;
}

export function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  });
}

export function formatAxisTime(ts: number, range: RangeKey): string {
  const d = new Date(ts);
  if (range === '30d')
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  if (range === '7d') return d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  return `${String(d.getUTCHours()).padStart(2, '0')}:00`;
}

export function formatUsd(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  });
}
