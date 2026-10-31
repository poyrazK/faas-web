import { InlinePhase, queryPhase } from '@/components/dashboard/primitives';
import { Button } from '@/components/ui/button';
import { Timestamp } from '@/components/ui/timestamp';
import {
  useBucketLifecycle,
  useBucketVersioning,
  type ObjectBucket,
} from '@/lib/api/object-storage';
import type { components } from '@/lib/api/schema';

type Rule = components['schemas']['ObjectLifecycleRule'];
type Versioning = components['schemas']['ObjectBucketVersioning'];

const STATUS_WORD: Record<string, string> = {
  Enabled: 'on',
  Suspended: 'suspended',
  '': 'off',
};

/** What a lifecycle rule does, as the sentences a person would say. */
export function ruleSentences(rule: Rule): string[] {
  const scope = [
    rule.filter?.prefix ? `under ${rule.filter.prefix}` : '',
    ...Object.entries(rule.filter?.tags ?? {}).map(([k, v]) => `tagged ${k}=${v}`),
  ]
    .filter(Boolean)
    .join(' ');
  const objects = scope ? `objects ${scope}` : 'objects';
  const out: string[] = [];
  if (rule.expiration?.days)
    out.push(`Delete ${objects} ${rule.expiration.days} days after they are written`);
  if (rule.expiration?.date)
    out.push(`Delete ${objects} on ${new Date(rule.expiration.date).toLocaleDateString()}`);
  if (rule.expiration?.expired_object_delete_marker)
    out.push('Clear delete markers left with no versions behind them');
  if (rule.noncurrent_version_expiration?.noncurrent_days) {
    const keep = rule.noncurrent_version_expiration.newer_noncurrent_versions;
    out.push(
      `Delete old versions of ${objects} ${rule.noncurrent_version_expiration.noncurrent_days} days after they are replaced${keep ? `, keeping the newest ${keep}` : ''}`
    );
  }
  if (rule.abort_incomplete_multipart_days)
    out.push(
      `Abort unfinished multipart uploads after ${rule.abort_incomplete_multipart_days} days`
    );
  return rule.status === 'Disabled' ? out.map((s) => `${s} (paused)`) : out;
}

function versioningSentence(v: Versioning): string {
  const observed = STATUS_WORD[v.observed_status] ?? v.observed_status;
  if (v.desired_status !== v.observed_status || v.state !== 'ready')
    return `Versioning is ${observed}, changing to ${STATUS_WORD[v.desired_status] ?? v.desired_status}`;
  return `Versioning is ${observed}`;
}

export function BucketSettings({
  slug,
  bucket,
  onDelete,
  deleting,
}: {
  slug: string;
  bucket: ObjectBucket;
  onDelete: () => void;
  deleting: boolean;
}) {
  const versioning = useBucketVersioning(slug, bucket.id);
  const lifecycle = useBucketLifecycle(slug, bucket.id);
  const vPhase = queryPhase({ loading: versioning.isPending, error: versioning.error });
  const lPhase = queryPhase({ loading: lifecycle.isPending, error: lifecycle.error });
  const rules = lifecycle.data?.rules ?? [];

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="storage-setting flex flex-col gap-3 rounded-2xl border border-border p-5">
        <h3 className="text-sm font-medium">Versions</h3>
        {vPhase !== 'ready' || !versioning.data ? (
          <InlinePhase
            phase={vPhase}
            error={versioning.error}
            onRetry={() => void versioning.refetch()}
          />
        ) : (
          <>
            <p className="text-lg">{versioningSentence(versioning.data)}</p>
            <p className="text-sm text-muted-foreground">
              {versioning.data.observed_status === 'Enabled'
                ? 'Overwrites and deletes keep the previous version, so a bad write can be undone.'
                : 'An overwrite replaces the object for good.'}
            </p>
            <p className="text-xs text-muted-foreground">
              Changed <Timestamp value={versioning.data.updated_at} />
            </p>
          </>
        )}
      </section>

      <section className="storage-setting flex flex-col gap-3 rounded-2xl border border-border p-5">
        <h3 className="text-sm font-medium">Cleanup rules</h3>
        {lPhase !== 'ready' ? (
          <InlinePhase
            phase={lPhase}
            error={lifecycle.error}
            onRetry={() => void lifecycle.refetch()}
          />
        ) : rules.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No rules. Objects stay until something deletes them.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rules.flatMap((rule, i) =>
              ruleSentences(rule).map((sentence) => (
                <li key={`${rule.id ?? i}:${sentence}`} className="storage-rule flex gap-3 text-sm">
                  <span aria-hidden="true" className="storage-rule__tick mt-2 h-px w-3 shrink-0" />
                  <span>{sentence}</span>
                </li>
              ))
            )}
          </ul>
        )}
      </section>

      <p className="text-xs text-muted-foreground lg:col-span-2">
        These are read here. Change them with the gregale CLI or the API; this page shows the
        result.
      </p>

      <section className="storage-danger flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-5 lg:col-span-2">
        <div>
          <h3 className="text-sm font-medium">Delete this bucket</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Only an empty bucket can be deleted. Nothing is emptied for you.
          </p>
        </div>
        <Button variant="outline" size="sm" disabled={deleting} onClick={onDelete}>
          Delete bucket
        </Button>
      </section>
    </div>
  );
}
