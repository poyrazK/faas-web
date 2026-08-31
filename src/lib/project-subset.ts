import type { components } from '@/lib/api/schema';
import type { ProjectPlan } from '@/lib/api/queries';

type Affected = components['schemas']['PlanAffectedApp'];

/**
 * The CLI's `--exclude` is client-side sugar over the wire's `only` CSV; the
 * console keeps the same shape so a re-scan matches what the CLI would send.
 */
export function onlyCsv(all: string[], excluded: Set<string>): string | undefined {
  if (excluded.size === 0) return undefined;
  return all.filter((n) => !excluded.has(n)).join(',');
}

export interface AffectedRow {
  slug: string;
  action: Affected['action'];
  bucket: 'deploy' | 'unaffected' | 'skipped';
  note?: string;
}

const note = (a: Affected) => (a.existing_root_dir ? `root was ${a.existing_root_dir}` : undefined);

/** The `--show-affected` table: what a re-apply would touch, and what it would leave alone. */
export function affectedRows(plan: ProjectPlan): AffectedRow[] {
  const bucket = (list: Affected[] | undefined, b: AffectedRow['bucket']) =>
    (list ?? []).map((a) => ({ slug: a.slug, action: a.action, bucket: b, note: note(a) }));
  return [
    ...bucket(plan.will_deploy, 'deploy'),
    ...bucket(plan.unaffected, 'unaffected'),
    ...bucket(plan.skipped, 'skipped'),
  ];
}
