import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, Circle, Pause, RefreshDouble } from 'iconoir-react';
import { InlinePhase, queryPhase } from '@/components/dashboard/primitives';
import { CapabilityGate } from '@/components/dashboard/capability-gate';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { Timestamp } from '@/components/ui/timestamp';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import {
  clearBucketLifecycle,
  lifecycleKey,
  setBucketLifecycle,
  setBucketVersioning,
  useBucketLifecycle,
  useBucketVersioning,
  versioningKey,
  type BucketVersioning,
  type ObjectBucket,
  type VersioningStatus,
} from '@/lib/api/object-storage';
import {
  deletesData,
  draftProblems,
  fromDraft,
  ruleSentences,
  toDraft,
  type RuleDraft,
} from './lifecycle-draft';
import { LifecycleEditor } from './lifecycle-editor';
import { CorsSetting } from './cors-setting';
import { EncryptionSetting } from './encryption-setting';
import { ObjectLockSetting } from './object-lock-setting';
import { NotificationsSetting } from './notifications-setting';
import { storageRefusal } from './refusals';
import { StatusChip } from './status-chip';

export { ruleSentences };

const STATUS_WORD: Record<string, string> = {
  Enabled: 'on',
  Suspended: 'suspended',
  '': 'off',
};

/** What each step of a versioning change is waiting for (faas ObjectBucketVersioning.state). */
const STEP: Record<BucketVersioning['state'], string> = {
  ready: '',
  waiting: 'Waiting for writes already in flight to finish.',
  propagating: 'Propagating the change to storage.',
  inventory: 'Counting every stored version.',
};

/** A change is still running until apid reports it ready at the status it was asked for. */
export function versioningSettling(v: BucketVersioning) {
  return v.state !== 'ready' || v.desired_status !== v.observed_status;
}

function versioningSentence(v: BucketVersioning): string {
  const observed = STATUS_WORD[v.observed_status] ?? v.observed_status;
  if (versioningSettling(v))
    return `Versioning is ${observed}, changing to ${STATUS_WORD[v.desired_status] ?? v.desired_status}`;
  return `Versioning is ${observed}`;
}

function VersioningChip({ v }: { v: BucketVersioning }) {
  if (versioningSettling(v))
    return <StatusChip tone="warning" icon={RefreshDouble} spin label="Changing" />;
  if (v.observed_status === 'Enabled')
    return <StatusChip tone="good" icon={CheckCircle} label="On" />;
  if (v.observed_status === 'Suspended')
    return <StatusChip tone="warning" icon={Pause} label="Suspended" />;
  return <StatusChip tone="muted" icon={Circle} label="Off" />;
}

export function BucketSettings({
  slug,
  bucket,
  enabled = true,
  onDelete,
  deleting,
}: {
  slug: string;
  bucket: ObjectBucket;
  /** False when the installation has storage turned off: settings read, but do not change. */
  enabled?: boolean;
  onDelete: () => void;
  deleting: boolean;
}) {
  const [editingRules, setEditingRules] = useState(false);
  const [editingCors, setEditingCors] = useState(false);
  const [editingNotifications, setEditingNotifications] = useState(false);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Each setting is its own preview capability: off, its panel explains
          itself and its routes are never called (apid capgates them to 404). */}
      <CapabilityGate capability="object-versioning" title="Versions">
        <section className="storage-setting flex flex-col gap-3 rounded-2xl border border-border p-5">
          <VersioningSetting slug={slug} bucket={bucket} enabled={enabled} />
        </section>
      </CapabilityGate>

      <CapabilityGate capability="object-lifecycle" title="Cleanup rules">
        <section
          className={cn(
            'storage-setting flex min-w-0 flex-col gap-3 rounded-2xl border border-border p-5',
            editingRules && 'lg:col-span-2'
          )}
        >
          <LifecycleSetting
            slug={slug}
            bucket={bucket}
            enabled={enabled}
            onEditing={setEditingRules}
          />
        </section>
      </CapabilityGate>

      <CapabilityGate capability="bucket-encryption" title="Encryption">
        <section className="storage-setting flex min-w-0 flex-col gap-3 rounded-2xl border border-border p-5">
          <EncryptionSetting slug={slug} bucket={bucket} enabled={enabled} />
        </section>
      </CapabilityGate>

      <CapabilityGate capability="object-protection" title="Object Lock">
        <section className="storage-setting flex min-w-0 flex-col gap-3 rounded-2xl border border-border p-5">
          <ObjectLockSetting slug={slug} bucket={bucket} enabled={enabled} />
        </section>
      </CapabilityGate>

      <CapabilityGate capability="bucket-cors" title="Browser access (CORS)">
        <section
          className={cn(
            'storage-setting flex min-w-0 flex-col gap-3 rounded-2xl border border-border p-5',
            editingCors && 'lg:col-span-2'
          )}
        >
          <CorsSetting slug={slug} bucket={bucket} onEditing={setEditingCors} />
        </section>
      </CapabilityGate>

      <CapabilityGate capability="object-storage-compute" title="Change notifications">
        <section
          className={cn(
            'storage-setting flex min-w-0 flex-col gap-3 rounded-2xl border border-border p-5',
            editingNotifications && 'lg:col-span-2'
          )}
        >
          <NotificationsSetting
            slug={slug}
            bucket={bucket}
            enabled={enabled}
            onEditing={setEditingNotifications}
          />
        </section>
      </CapabilityGate>

      <section className="storage-danger flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-5 lg:col-span-2">
        <div>
          <h3 className="text-sm font-medium">Delete this bucket</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Only an empty bucket can be deleted, including its kept versions. Nothing is emptied for
            you.
          </p>
        </div>
        <Button variant="outline" size="sm" disabled={deleting} onClick={onDelete}>
          Delete bucket
        </Button>
      </section>
    </div>
  );
}

function VersioningSetting({
  slug,
  bucket,
  enabled,
}: {
  slug: string;
  bucket: ObjectBucket;
  enabled: boolean;
}) {
  const versioning = useBucketVersioning(slug, bucket.id);
  const phase = queryPhase({ loading: versioning.isPending, error: versioning.error });
  const cache = useQueryClient();
  const confirm = useConfirm();
  const { toast } = useToast();
  const change = useMutation({
    mutationFn: (status: VersioningStatus) => setBucketVersioning(slug, bucket.id, status),
    onSuccess: (next) => {
      cache.setQueryData(versioningKey(slug, bucket.id), next);
      toast({
        kind: 'success',
        title:
          next.desired_status === 'Enabled' ? 'Turning versioning on' : 'Suspending versioning',
        description: 'Writes to this bucket pause until the change is ready.',
      });
    },
    onError: (error) =>
      toast({
        kind: 'error',
        title: 'Versioning was not changed',
        description: storageRefusal(
          error,
          'Another versioning change is still running, or Object Lock keeps versioning on for this bucket.'
        ),
        error,
      }),
  });

  const ask = async (status: VersioningStatus) => {
    const on = status === 'Enabled';
    const ok = await confirm(
      on
        ? {
            title: `Turn on versioning for ${bucket.name}?`,
            description:
              'Writes and deletes to this bucket pause for at least fifteen minutes while the change propagates and every object is counted. Afterwards an overwrite or delete keeps the previous version, and kept versions count toward your stored bytes.',
            confirmLabel: 'Turn on versioning',
          }
        : {
            title: `Suspend versioning for ${bucket.name}?`,
            description:
              'From then on an overwrite or delete replaces the object for good. The versions already kept stay, and still count toward your stored bytes. Writes pause for at least fifteen minutes while the change propagates.',
            confirmLabel: 'Suspend versioning',
            destructive: true,
          }
    );
    if (ok) change.mutate(status);
  };

  const v = versioning.data;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Versions</h3>
        {v && <VersioningChip v={v} />}
      </div>
      {phase !== 'ready' || !v ? (
        <InlinePhase
          phase={phase}
          error={versioning.error}
          onRetry={() => void versioning.refetch()}
        />
      ) : (
        <>
          <p className="text-lg">{versioningSentence(v)}</p>
          <p className="text-sm text-muted-foreground">
            {v.observed_status === 'Enabled'
              ? 'Overwrites and deletes keep the previous version, so a bad write can be undone from the Objects tab.'
              : v.observed_status === 'Suspended'
                ? 'An overwrite replaces the object for good. Versions kept while versioning was on are still there.'
                : 'An overwrite replaces the object for good.'}
          </p>
          {versioningSettling(v) && (
            <div role="status" className="flex flex-col gap-1 text-sm">
              <span>{STEP[v.state] || 'Waiting for storage to report the new setting.'}</span>
              <span className="text-xs text-muted-foreground">
                New writes are paused until it finishes
                {v.propagation_until ? (
                  <>
                    , no sooner than <Timestamp value={v.propagation_until} mode="absolute" />
                  </>
                ) : null}
                .
              </span>
              {v.last_error_code && (
                <span className="text-xs text-muted-foreground">
                  The last attempt failed (<code className="font-mono">{v.last_error_code}</code>);
                  Gregale retries on its own.
                </span>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            {!versioningSettling(v) &&
              (v.observed_status === 'Enabled' ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!enabled || change.isPending}
                  onClick={() => void ask('Suspended')}
                >
                  Suspend versioning
                </Button>
              ) : (
                <Button
                  size="sm"
                  disabled={!enabled || change.isPending}
                  onClick={() => void ask('Enabled')}
                >
                  Turn on versioning
                </Button>
              ))}
            <span className="text-xs text-muted-foreground">
              Changed <Timestamp value={v.updated_at} />
            </span>
          </div>
        </>
      )}
    </>
  );
}

function LifecycleSetting({
  slug,
  bucket,
  enabled,
  onEditing,
}: {
  slug: string;
  bucket: ObjectBucket;
  enabled: boolean;
  onEditing: (editing: boolean) => void;
}) {
  const lifecycle = useBucketLifecycle(slug, bucket.id);
  const phase = queryPhase({ loading: lifecycle.isPending, error: lifecycle.error });
  const rules = lifecycle.data?.rules ?? [];
  const [drafts, setDrafts] = useState<RuleDraft[] | null>(null);
  const [tried, setTried] = useState(false);
  const cache = useQueryClient();
  const confirm = useConfirm();
  const { toast } = useToast();
  const edit = (next: RuleDraft[] | null) => {
    setDrafts(next);
    setTried(false);
    onEditing(next !== null);
  };
  const save = useMutation({
    mutationFn: (next: RuleDraft[]) =>
      next.length
        ? setBucketLifecycle(slug, bucket.id, next.map(fromDraft))
        : clearBucketLifecycle(slug, bucket.id),
    onSuccess: (policy) => {
      cache.setQueryData(lifecycleKey(slug, bucket.id), policy);
      edit(null);
      toast({
        kind: 'success',
        title: policy.rules.length ? 'Cleanup rules saved' : 'Cleanup rules removed',
      });
    },
    onError: (error) =>
      toast({
        kind: 'error',
        title: 'Cleanup rules were not saved',
        description: storageRefusal(
          error,
          'A cleanup scan is running on this bucket right now. Save again in a moment.'
        ),
        error,
      }),
  });
  const problems = drafts ? draftProblems(drafts) : [];

  const submit = async () => {
    if (!drafts) return;
    setTried(true);
    if (problems.some((p) => p.length)) return;
    if (drafts.length === 0) {
      const ok = await confirm({
        title: `Remove every cleanup rule from ${bucket.name}?`,
        description:
          'Nothing is deleted on a schedule any more. Deletions and upload aborts already started still finish.',
        confirmLabel: 'Remove rules',
        destructive: true,
      });
      if (ok) save.mutate(drafts);
      return;
    }
    if (deletesData(drafts)) {
      const ok = await confirm({
        title: `Save cleanup rules for ${bucket.name}?`,
        description:
          'Rules are checked every hour. The objects and versions they match are deleted for good, and deleted data cannot be recovered.',
        confirmLabel: 'Save rules',
        destructive: true,
      });
      if (!ok) return;
    }
    save.mutate(drafts);
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Cleanup rules</h3>
        {phase === 'ready' && !drafts && (
          <Button
            variant="outline"
            size="sm"
            disabled={!enabled}
            onClick={() => edit(rules.map(toDraft))}
          >
            {rules.length ? 'Edit rules' : 'Add rules'}
          </Button>
        )}
      </div>
      {phase !== 'ready' ? (
        <InlinePhase
          phase={phase}
          error={lifecycle.error}
          onRetry={() => void lifecycle.refetch()}
        />
      ) : drafts ? (
        <form
          aria-label={`Cleanup rules for ${bucket.name}`}
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <p className="text-sm text-muted-foreground">
            Rules are checked every hour. Storage-class transitions are not supported.
          </p>
          <LifecycleEditor
            drafts={drafts}
            problems={problems}
            showProblems={tried}
            onChange={setDrafts}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save rules'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={save.isPending}
              onClick={() => edit(null)}
            >
              Cancel
            </Button>
          </div>
        </form>
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
    </>
  );
}
