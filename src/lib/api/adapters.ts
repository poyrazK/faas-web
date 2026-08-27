import type { Deployment as ApiDeployment, App, AppsMetrics } from './queries';
import type { Deployment, RunState, Workflow } from '../mock-data';

/**
 * Projects the REST shapes onto the view models the console already renders.
 *
 * This exists so wiring the real API did not mean rewriting twenty pages in one
 * commit. It is a seam, not a permanent layer: as each page moves to the richer
 * `App` / `Deployment` types directly, its mapping here can go.
 *
 * Where the API has no counterpart the field is left `undefined` rather than
 * filled with something plausible. A console that invents a region is worse
 * than one that shows a dash — the whole point of this change was to stop
 * showing numbers that were never real.
 *
 * Specifically absent upstream:
 * - **projects** — apps are flat per account; the grouping the API does have is
 *   orgs (`/v1/orgs`), which is a different thing.
 * - **region** — this is a one-box platform. There is exactly one.
 * - **deploy author / commit message** — a deployment records an image digest
 *   and a kind, not a VCS commit. `commit` carries the digest prefix, which is
 *   the closest true identifier.
 */

/** App status is an open string upstream; everything unrecognised reads as idle. */
export function toRunState(status: string | undefined): RunState {
  switch ((status ?? '').toLowerCase()) {
    case 'active':
    case 'running':
      return 'running';
    case 'deploying':
    case 'pending':
    case 'building':
      return 'deploying';
    case 'error':
    case 'failed':
    case 'crashed':
      return 'error';
    default:
      // `parked` and `stopped` land here, which is correct: scale-to-zero is
      // the normal resting state on this platform, not a fault.
      return 'idle';
  }
}

function shortDigest(digest: string | undefined): string {
  if (!digest) return '';
  // `sha256:ab12…` — the algorithm prefix is noise in a table cell.
  const bare = digest.includes(':') ? digest.slice(digest.indexOf(':') + 1) : digest;
  return bare.slice(0, 7);
}

/**
 * `latest` is the app's most recent deployment, when one is known.
 *
 * `AppResponse` carries neither a version nor a deploy timestamp — the spec's
 * *example* shows `updated_at` and `last_deployment_id`, but the schema defines
 * neither, so reading them would compile against a fiction. The deployments
 * list is the real source for both, and the store already fetches it.
 */
export function toWorkflow(app: App, metrics?: AppsMetrics, latest?: ApiDeployment): Workflow {
  const row = metrics?.apps?.[app.slug];
  const appState = toRunState(app.status);
  // `active` is the API's default for a newly-created app as well as a live
  // one. Without a deployment row, showing "Running" tells the customer that
  // something is serving traffic when there is nothing to serve yet.
  const state = latest
    ? appState
    : appState === 'deploying' || appState === 'error'
      ? appState
      : 'undeployed';

  return {
    // The slug, not the 32-hex id: it is what every `/v1/apps/{slug}` route is
    // keyed by, and it makes a shareable console URL readable.
    id: app.slug,
    name: app.slug,
    runtime: app.runtime ?? app.type,
    memoryMb: app.ram_mb,
    state,
    url: app.url,
    // Metrics come from the Prometheus rollup and are absent when it is
    // degraded — zero is the honest reading of "no requests in the window".
    invocations24h: row?.request_count ?? 0,
    avgDurationMs: Math.round(row?.latency_p50_ms ?? 0),
    coldStartP50Ms: Math.round(row?.wake_p95_ms ?? 0),
    errorRatePct: Number((row?.error_rate_pct ?? 0).toFixed(2)),
    lastDeployedAt: Date.parse(latest?.created_at ?? '') || 0,
    // No version column upstream; the image digest is the deployment's identity.
    version: shortDigest(latest?.image_digest),
  };
}

/**
 * Deployments arrive keyed by `app_id`, but every route and filter in the
 * console is keyed by slug — so the app list has to be threaded through to
 * resolve them.
 */
export function toDeployment(deployment: ApiDeployment, slugById: Map<string, string>): Deployment {
  return {
    id: deployment.id,
    workflowId: slugById.get(deployment.app_id) ?? deployment.app_id,
    version: shortDigest(deployment.image_digest),
    state: toDeployState(deployment.status),
    status: deployment.status,
    error: deployment.error,
    errorCode: deployment.error_code,
    buildId: deployment.build_id,
    commit: shortDigest(deployment.image_digest),
    message: deployment.error || deployment.kind || 'Deployment',
    author: '',
    createdAt: Date.parse(deployment.created_at) || 0,
    durationMs: 0,
  };
}

function toDeployState(status: string | undefined): Deployment['state'] {
  switch ((status ?? '').toLowerCase()) {
    case 'active':
    case 'succeeded':
    case 'complete':
      return 'succeeded';
    case 'failed':
    case 'error':
      return 'failed';
    default:
      return 'building';
  }
}

export function slugIndex(apps: App[]): Map<string, string> {
  return new Map(apps.map((app) => [app.id, app.slug]));
}
