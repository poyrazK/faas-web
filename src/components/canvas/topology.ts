import type { App, AppsMetrics } from '@/lib/api/queries';
import type { components } from '@/lib/api/schema';
import { toRunState } from '@/lib/api/adapters';
import { isPlanGate } from '@/components/dashboard/plan-gated';
import type { LaunchState } from './launch';

/**
 * The canvas's data model, and the only place an edge is decided.
 *
 * Every edge is read off an identifier the API returned: a domain's `app_id`,
 * a cron's `app_id`, an app's own bucket list, a Postgres binding's
 * `app_id`/`database_id`. Nothing is inferred from names, and anything that
 * points at an app we cannot see is dropped and reported rather than drawn.
 */

type S = components['schemas'];
export type Domain = S['CustomDomainResponse'];
export type Cron = S['CronResponse'];
export type BucketList = S['ObjectBucketList'];
export type PostgresDatabase = S['ManagedPostgresDatabase'];
export type PostgresBinding = S['ManagedPostgresBinding'];

export type Read<T> =
  { status: 'ready'; data: T } | { status: 'loading' } | { status: 'error'; error: unknown };

export type AppPhase = 'running' | 'parked' | 'idle' | 'deploying' | 'error' | 'undeployed';

export type InternetData = {
  kind: 'internet';
};
export type DomainData = {
  kind: 'domain';
  domain: string;
  verified: boolean;
  txtRecord: string | null;
  appSlug: string;
};
export type AppData = {
  kind: 'app';
  slug: string;
  phase: AppPhase;
  requests24h?: number;
  p95Ms?: number;
  metrics: 'ready' | 'loading' | 'unavailable';
  connections: 'ready' | 'loading' | 'error';
  /** Only known once the app's bucket list has answered. */
  buckets?: { enabled: boolean; atLimit: boolean; defaultRegion: string };
  /** Why `requests24h`/`p95Ms` are absent, when they are. */
  metricsWhy?: 'plan' | 'unavailable';
  errorRatePct?: number;
  runtime?: string;
  url?: string;
  /** Set while the canvas watches this app's first deploy. */
  launch?: LaunchState;
};
export type CronData = {
  kind: 'cron';
  id: string;
  schedule: string;
  path: string;
  timezone: string;
  enabled: boolean;
  lastFiredAt: string | null;
  appSlug: string;
};
export type BucketData = {
  kind: 'bucket';
  appSlug: string;
  name: string;
  state: string;
};
export type PostgresData = {
  kind: 'postgres';
  id: string;
  name: string;
  state: string;
};
export type CanvasNodeData =
  InternetData | DomainData | AppData | CronData | BucketData | PostgresData;
export type CanvasNodeKind = CanvasNodeData['kind'];

export interface CanvasNode {
  id: string;
  data: CanvasNodeData;
}
export type EdgeKind = 'ingress' | 'schedule' | 'storage' | 'database';
export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  /** Present only when the edge carries a known, unshared request count. */
  requests24h?: number;
  pending?: boolean;
}
export interface TopologyIssue {
  kind: 'orphan' | 'read_failed';
  ref: string;
  detail: string;
}
export interface Topology {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  issues: TopologyIssue[];
}

export interface TopologyInput {
  apps: App[];
  domains: Domain[];
  crons: Cron[];
  metrics: Read<AppsMetrics>;
  /** Keyed by app slug. A missing key reads as still loading. */
  buckets: Record<string, Read<BucketList>>;
  /** `failedBindings` names databases whose binding list could not be read. */
  postgres: Read<{
    databases: PostgresDatabase[];
    bindings: PostgresBinding[];
    failedBindings: string[];
  }>;
}

export const nodeId = {
  internet: 'internet',
  domain: (domain: string) => `domain:${domain}`,
  app: (slug: string) => `app:${slug}`,
  cron: (id: string) => `cron:${id}`,
  bucket: (slug: string, name: string) => `bucket:${slug}/${name}`,
  postgres: (id: string) => `postgres:${id}`,
};

/** `evicted_cold`/`parked` is scale-to-zero at rest, the state the canvas breathes. */
export function appPhase(status: string | undefined): AppPhase {
  const s = (status ?? '').toLowerCase();
  if (s === 'evicted_cold' || s === 'parked') return 'parked';
  if (s === 'undeployed') return 'undeployed';
  return toRunState(s);
}

const GONE = new Set(['deleting', 'deleted']);

export function buildTopology(input: TopologyInput): Topology {
  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];
  const issues: TopologyIssue[] = [];
  const apps = [...input.apps].sort((a, b) => a.slug.localeCompare(b.slug));
  if (apps.length === 0) return { nodes, edges, issues };

  const slugById = new Map(apps.map((a) => [a.id, a.slug]));
  const rows = input.metrics.status === 'ready' ? input.metrics.data.apps : null;
  const metricsLoading = input.metrics.status === 'loading';
  // Branch on the code, not the status: the house rule (CLAUDE.md).
  const metricsPlanGated = input.metrics.status === 'error' && isPlanGate(input.metrics.error);

  const domainsBySlug = new Map<string, Domain[]>();
  for (const d of [...input.domains].sort((a, b) => a.domain.localeCompare(b.domain))) {
    const slug = slugById.get(d.app_id);
    if (!slug) {
      issues.push({
        kind: 'orphan',
        ref: nodeId.domain(d.domain),
        detail: `points at unknown app ${d.app_id}`,
      });
      continue;
    }
    domainsBySlug.set(slug, [...(domainsBySlug.get(slug) ?? []), d]);
  }

  nodes.push({ id: nodeId.internet, data: { kind: 'internet' } });

  for (const a of apps) {
    const row = rows?.[a.slug];
    const read = input.buckets[a.slug] ?? { status: 'loading' };
    const appNode = nodeId.app(a.slug);
    nodes.push({
      id: appNode,
      data: {
        kind: 'app',
        slug: a.slug,
        phase: appPhase(a.status),
        requests24h: row?.request_count,
        p95Ms: row?.latency_p95_ms,
        metrics: metricsLoading ? 'loading' : row ? 'ready' : 'unavailable',
        metricsWhy: row || metricsLoading ? undefined : metricsPlanGated ? 'plan' : 'unavailable',
        errorRatePct: row?.error_rate_pct,
        runtime: a.runtime ?? a.type,
        url: a.url || undefined,
        connections: read.status,
        buckets:
          read.status === 'ready'
            ? {
                enabled: read.data.enabled,
                atLimit: read.data.items.length >= read.data.max_buckets_per_app,
                defaultRegion: read.data.default_region,
              }
            : undefined,
      },
    });

    const domains = domainsBySlug.get(a.slug) ?? [];
    // The default URL keeps serving after a custom domain is attached, so it
    // is a path of its own. Only a single path can carry the app's whole
    // count; with several, the API has no per-host split and no edge claims
    // a share.
    const paths = domains.length + (a.url ? 1 : 0);
    const ingress = paths === 1 ? row?.request_count : undefined;
    if (a.url) {
      edges.push({
        id: `ingress:internet>${a.slug}`,
        source: nodeId.internet,
        target: appNode,
        kind: 'ingress',
        requests24h: ingress,
      });
    }
    for (const d of domains) {
      const dn = nodeId.domain(d.domain);
      nodes.push({
        id: dn,
        data: {
          kind: 'domain',
          domain: d.domain,
          verified: d.verified,
          txtRecord: d.txt_record ?? null,
          appSlug: a.slug,
        },
      });
      edges.push({
        id: `ingress:internet>${d.domain}`,
        source: nodeId.internet,
        target: dn,
        kind: 'ingress',
        requests24h: ingress,
        pending: !d.verified,
      });
      edges.push({
        id: `ingress:${d.domain}>${a.slug}`,
        source: dn,
        target: appNode,
        kind: 'ingress',
        requests24h: ingress,
        pending: !d.verified,
      });
    }

    if (read.status === 'error') {
      issues.push({ kind: 'read_failed', ref: appNode, detail: 'bucket list' });
    } else if (read.status === 'ready') {
      for (const b of [...read.data.items].sort((x, y) => x.name.localeCompare(y.name))) {
        if (GONE.has(b.state)) continue;
        const bn = nodeId.bucket(a.slug, b.name);
        nodes.push({
          id: bn,
          data: { kind: 'bucket', appSlug: a.slug, name: b.name, state: b.state },
        });
        edges.push({
          id: `storage:${a.slug}>${b.name}`,
          source: appNode,
          target: bn,
          kind: 'storage',
        });
      }
    }
  }

  for (const c of [...input.crons].sort((a, b) => a.id.localeCompare(b.id))) {
    const slug = slugById.get(c.app_id);
    if (!slug) {
      issues.push({
        kind: 'orphan',
        ref: nodeId.cron(c.id),
        detail: `points at unknown app ${c.app_id}`,
      });
      continue;
    }
    nodes.push({
      id: nodeId.cron(c.id),
      data: {
        kind: 'cron',
        id: c.id,
        schedule: c.schedule,
        // Command crons have no path; the node shows what an HTTP cron calls.
        path: c.path ?? '',
        timezone: c.timezone,
        enabled: c.enabled,
        lastFiredAt: c.last_fired_at ?? null,
        appSlug: slug,
      },
    });
    edges.push({
      id: `schedule:${c.id}`,
      source: nodeId.cron(c.id),
      target: nodeId.app(slug),
      kind: 'schedule',
    });
  }

  if (input.postgres.status === 'ready') {
    const { databases, bindings, failedBindings } = input.postgres.data;
    for (const id of failedBindings) {
      issues.push({ kind: 'read_failed', ref: nodeId.postgres(id), detail: 'postgres bindings' });
    }
    for (const db of [...databases].sort((a, b) => a.name.localeCompare(b.name))) {
      if (GONE.has(db.state)) continue;
      nodes.push({
        id: nodeId.postgres(db.id),
        data: { kind: 'postgres', id: db.id, name: db.name, state: db.state },
      });
    }
    const live = new Set(nodes.map((n) => n.id));
    for (const b of bindings) {
      if (GONE.has(b.state)) continue;
      const slug = slugById.get(b.app_id);
      const target = nodeId.postgres(b.database_id);
      if (!slug || !live.has(target)) {
        issues.push({
          kind: 'orphan',
          ref: `binding:${b.id}`,
          detail: 'binding to an unknown app or database',
        });
        continue;
      }
      edges.push({
        id: `database:${b.id}`,
        source: nodeId.app(slug),
        target,
        kind: 'database',
      });
    }
  } else if (input.postgres.status === 'error') {
    issues.push({ kind: 'read_failed', ref: 'postgres', detail: 'postgres databases' });
  }

  return { nodes, edges, issues };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The canvas never draws a failed read as empty, so it says what is missing.
 * One sentence per kind of gap, in the order a reader would care.
 */
export function summarizeIssues(issues: TopologyIssue[]): string[] {
  const failed = issues.filter((i) => i.kind === 'read_failed');
  const bindings = failed.filter((i) => i.ref.startsWith('postgres:')).length;
  const apps = failed.filter((i) => i.ref.startsWith('app:')).length;
  const orphans = issues.filter((i) => i.kind === 'orphan').length;
  return [
    failed.some((i) => i.ref === 'postgres') && 'Couldn’t load Postgres.',
    bindings > 0 && `Couldn’t load bindings for ${plural(bindings, 'database', 'databases')}.`,
    apps > 0 && `Couldn’t load connections for ${plural(apps, 'app', 'apps')}.`,
    orphans > 0 &&
      (orphans === 1
        ? '1 item points at an app that no longer exists.'
        : `${orphans} items point at apps that no longer exist.`),
  ].filter((line): line is string => Boolean(line));
}

/** The name a person uses for a node: in the finder, the inspector and labels. */
export function nodeTitle(data: CanvasNodeData): string {
  switch (data.kind) {
    case 'internet':
      return 'Internet';
    case 'domain':
      return data.domain;
    case 'app':
      return data.slug;
    case 'cron':
      return data.path || '/';
    default:
      return data.name;
  }
}
