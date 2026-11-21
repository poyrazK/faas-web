import type { EnvironmentDiff, EnvironmentState } from '@/lib/api/projects';

/**
 * Plain words for a project's environments (docs/console-plain-english.md):
 * the answer first, ids and fingerprints only behind "Technical details".
 */

type Release = EnvironmentState['workloads'][number]['release'];
type WorkloadDiff = EnvironmentDiff['workloads'][number];

/** The first seven characters, the way a commit is usually named. */
export const shortId = (id: string) => id.slice(0, 7);

/** "Production" for `production`: slugs are lower-case, names are not. */
export const environmentName = (slug: string) => slug.charAt(0).toUpperCase() + slug.slice(1);

/** What one app's row says: its release, or that nothing is deployed. */
export function releaseWords(release: Release): string {
  if (release.status === 'not_deployed') return 'not deployed';
  return release.deployment_id ? `release ${shortId(release.deployment_id)}` : 'live';
}

/** One line under the environment's name: how much of it is running. */
export function environmentSummary(state: EnvironmentState): string {
  const total = state.workloads.length;
  if (!total) return 'No apps yet';
  const live = state.workloads.filter((w) => w.release.status === 'live').length;
  if (!live) return 'Nothing deployed yet';
  return live === total
    ? `${total === 1 ? 'Its app is' : `All ${total} apps are`} live`
    : `${live} of ${total} apps live`;
}

/** "a", "a and b", "a, b and c". */
export function listWords(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * A release difference. When one side has nothing deployed the ids add
 * nothing (they are in Technical details), and leaving them out lets apps in
 * the same situation read as one line.
 */
function releaseDifference(before: Release, after: Release, a: string, b: string): string {
  const idle = (r: Release) => r.status === 'not_deployed';
  if (idle(before) && !idle(after)) return `Live in ${b}; nothing deployed in ${a}.`;
  if (!idle(before) && idle(after)) return `Live in ${a}; nothing deployed in ${b}.`;
  const id = (r: Release) => (r.deployment_id ? shortId(r.deployment_id) : 'unknown');
  return `Runs a different release (${id(before)} in ${a}, ${id(after)} in ${b}).`;
}

const BINDING = { managed_postgres: 'Postgres database', object_storage: 'bucket' } as const;

/**
 * Each difference as a sentence, from the `from` environment to the `to` one.
 * A secret neither side fingerprints is "can't tell", never "the same".
 */
export function workloadDifferences(w: WorkloadDiff, from: string, to: string): string[] {
  const [a, b] = [environmentName(from), environmentName(to)];
  const lines: string[] = [];
  if (w.release.kind !== 'unchanged')
    lines.push(releaseDifference(w.release.before, w.release.after, a, b));
  for (const v of w.variables)
    lines.push(
      v.kind === 'added'
        ? `Variable ${v.key} is only in ${b}.`
        : v.kind === 'removed'
          ? `Variable ${v.key} is only in ${a}.`
          : `Variable ${v.key} has a different value.`
    );
  for (const s of w.secrets)
    lines.push(
      s.kind === 'added'
        ? `Secret ${s.key} is only in ${b}.`
        : s.kind === 'removed'
          ? `Secret ${s.key} is only in ${a}.`
          : s.kind === 'changed'
            ? `Secret ${s.key} has a different value.`
            : s.kind === 'version_drift'
              ? `Secret ${s.key} is on a different version (${s.before.version ?? '?'} in ${a}, ${s.after.version ?? '?'} in ${b}).`
              : `Can't tell whether secret ${s.key} matches: neither side reports a fingerprint.`
    );
  for (const binding of w.bindings) {
    const what = BINDING[binding.kind] ?? 'resource';
    lines.push(
      binding.change === 'added'
        ? `A ${what} is connected only in ${b}.`
        : binding.change === 'removed'
          ? `A ${what} is connected only in ${a}.`
          : `The connected ${what} differs.`
    );
  }
  if (w.routes.kind === 'changed') lines.push('Routes differ.');
  if (w.policies.kind === 'changed') lines.push('Headers and CORS differ.');
  if (w.domains.kind === 'changed') lines.push('Domains differ.');
  return lines;
}

export interface Differences {
  /** Apps with the same differences, grouped so they read once. */
  groups: { apps: string[]; lines: string[] }[];
  /** What matches in every app, as one sentence; null when nothing does. */
  same: string | null;
  /** Project settings that differ, or null. */
  configuration: string | null;
}

export function describeDifferences(diff: EnvironmentDiff): Differences {
  const from = diff.from_environment;
  const to = diff.to_environment;
  const groups: Differences['groups'] = [];
  for (const w of diff.workloads) {
    const lines = workloadDifferences(w, from, to);
    if (!lines.length) continue;
    const key = lines.join('\n');
    const group = groups.find((g) => g.lines.join('\n') === key);
    if (group) group.apps.push(w.workload_name);
    else groups.push({ apps: [w.workload_name], lines });
  }
  const none = (pick: (w: WorkloadDiff) => boolean) => diff.workloads.every((w) => !pick(w));
  const same = [
    none((w) => w.release.kind !== 'unchanged') && 'releases',
    none((w) => w.variables.length > 0) && 'variables',
    none((w) => w.secrets.length > 0) && 'secrets',
    none((w) => w.routes.kind === 'changed') && 'routes',
    none((w) => w.policies.kind === 'changed') && 'headers',
    none((w) => w.domains.kind === 'changed') && 'domains',
  ].filter((x): x is string => Boolean(x));
  const changes = diff.configuration.changes.length;
  return {
    groups,
    same:
      diff.workloads.length && same.length
        ? `${listWords(same).replace(/^./, (c) => c.toUpperCase())} ${same.length === 1 ? 'is' : 'are'} the same.`
        : null,
    configuration: changes
      ? `${changes} project ${changes === 1 ? 'setting differs' : 'settings differ'} (version ${diff.configuration.from_version} in ${environmentName(from)}, ${diff.configuration.to_version} in ${environmentName(to)}).`
      : null,
  };
}

/** "All 3 apps" when a group covers every app, else their names. */
export function groupLabel(apps: string[], total: number): string {
  return apps.length > 1 && apps.length === total ? `All ${total} apps` : listWords(apps);
}
