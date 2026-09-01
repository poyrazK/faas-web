import { Pill } from '@/components/dashboard/resource-table';
import type { AffectedRow } from '@/lib/project-subset';

const HEADING: Record<AffectedRow['bucket'], string> = {
  deploy: 'Will deploy',
  unaffected: 'Unaffected',
  skipped: 'Skipped',
};

const COLOR: Record<AffectedRow['action'], string | undefined> = {
  create: 'var(--status-good)',
  update: 'var(--status-warning)',
  remove: 'var(--status-critical)',
  noop: undefined,
};

/** The blast radius of an apply, bucket by bucket. Empty buckets are not drawn. */
export function AffectedApps({ rows }: { rows: AffectedRow[] }) {
  const buckets = (['deploy', 'unaffected', 'skipped'] as const).map(
    (b) => [b, rows.filter((r) => r.bucket === b)] as const
  );
  return (
    <div className="flex flex-col gap-4">
      {buckets.map(([b, list]) =>
        list.length === 0 ? null : (
          <section key={b}>
            <h4 className="label-mono mb-2 text-muted-foreground">{HEADING[b]}</h4>
            <ul className="divide-y divide-border rounded-md border border-border">
              {list.map((r) => (
                <li key={r.slug} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="font-mono">{r.slug}</span>
                  <Pill label={r.action} color={COLOR[r.action]} />
                  {r.note && <span className="text-xs text-muted-foreground">{r.note}</span>}
                </li>
              ))}
            </ul>
          </section>
        )
      )}
    </div>
  );
}
