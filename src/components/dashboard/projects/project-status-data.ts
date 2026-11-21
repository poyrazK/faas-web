import type { Workflow } from '@/lib/mock-data';
import { projectTotals, type AppFigures, type ProjectTotals } from '../project-analytics';

/**
 * A project's status figures, built only from reads the console already makes:
 * each app's row of `/v1/apps/metrics`, the instance snapshot and the latest
 * deployment per app. Nothing is estimated; a figure that cannot be read for
 * every app of the project is unknown, never a smaller number.
 */

/** A healthy rollup omits an app that served nothing in the window: zero is its reading. */
const NO_TRAFFIC: AppFigures = {
  source: 'prometheus',
  request_count: 0,
  error_rate_pct: 0,
  cold_start_pct: 0,
  latency_p95_ms: 0,
};

export interface ProjectTraffic {
  /** False while reading, on a failed or degraded rollup, or when an app is out of reach. */
  known: boolean;
  totals: ProjectTotals;
}

export function projectTraffic(
  slugs: string[],
  rollup: { source: string; apps?: Record<string, AppFigures> | null } | undefined,
  /** Apps this account can read; a company's app missing from them has no row to trust. */
  readable: ReadonlySet<string>
): ProjectTraffic {
  const healthy = Boolean(rollup && rollup.source === 'prometheus' && rollup.apps);
  const rows = slugs.map(
    (slug) => [slug, rollup?.apps?.[slug] ?? NO_TRAFFIC] as [string, AppFigures]
  );
  const totals = projectTotals(rows);
  return {
    known: healthy && totals.known && slugs.every((slug) => readable.has(slug)),
    totals,
  };
}

export interface ProjectResident {
  known: boolean;
  /** Instances holding memory right now. */
  count: number;
  mb: number;
  /** How many of the project's apps have at least one of them. */
  apps: number;
}

/**
 * Memory the project holds right now: its apps' instances that are not
 * parked (a parked instance's cgroup is gone). The same rule as the
 * Overview's "Memory now", so the two never disagree.
 */
export function projectResident(
  slugs: string[],
  appIdBySlug: ReadonlyMap<string, string> | undefined,
  instances:
    | {
        instances: { app_id: string; state: string; ram_mb: number }[];
        next_before?: string | null;
      }
    | undefined
): ProjectResident {
  const unknown = { known: false, count: 0, mb: 0, apps: 0 };
  // A partial page is never an exact total, and an app with no id cannot be matched.
  if (!instances || instances.next_before || !appIdBySlug) return unknown;
  const ids = new Set<string>();
  for (const slug of slugs) {
    const id = appIdBySlug.get(slug);
    if (!id) return unknown;
    ids.add(id);
  }
  const rows = instances.instances.filter(
    (row) => ids.has(row.app_id) && row.state.toLowerCase() !== 'parked'
  );
  return {
    known: true,
    count: rows.length,
    mb: rows.reduce((sum, row) => sum + row.ram_mb, 0),
    apps: new Set(rows.map((row) => row.app_id)).size,
  };
}

/** The project's most recent deployment: the app and when, or null when none is known. */
export function lastDeploy(
  slugs: string[],
  apps: ReadonlyMap<string, Pick<Workflow, 'name' | 'lastDeployedAt'>>
): { slug: string; name: string; at: number } | null {
  let latest: { slug: string; name: string; at: number } | null = null;
  for (const slug of slugs) {
    const app = apps.get(slug);
    if (app && app.lastDeployedAt > 0 && (!latest || app.lastDeployedAt > latest.at))
      latest = { slug, name: app.name, at: app.lastDeployedAt };
  }
  return latest;
}
