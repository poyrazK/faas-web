import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, Clock, Trash } from 'iconoir-react';
import { InlinePhase, queryPhase } from '@/components/dashboard/primitives';
import { Button } from '@/components/ui/button';
import { CopyableId } from '@/components/ui/copyable-id';
import { useConfirm } from '@/components/ui/confirm';
import { Timestamp } from '@/components/ui/timestamp';
import { useToast } from '@/components/ui/toast';
import { formatUsageBytes } from '@/lib/usage-format';
import {
  deleteObjectVersion,
  objectKey,
  restoreObjectVersion,
  signStoredObject,
  useBucketVersioning,
  useObjectVersions,
  versionsKey,
  type ObjectBucket,
  type ObjectVersion,
  type VersionMarker,
} from '@/lib/api/object-storage';
import { storageRefusal } from './refusals';
import { StatusChip } from './status-chip';

/** apid's selector for data written while versioning was off; signed reads refuse it. */
const NULL_VERSION = 'null';

function VersionChip({ version }: { version: ObjectVersion }) {
  if (version.delete_marker)
    return (
      <StatusChip
        tone="warning"
        icon={Trash}
        label={version.is_latest ? 'Deleted' : 'Delete marker'}
      />
    );
  if (version.is_latest) return <StatusChip tone="good" icon={CheckCircle} label="Current" />;
  return <StatusChip tone="muted" icon={Clock} label="Older" />;
}

/**
 * Every kept version and delete marker under the open folder, newest first per
 * key. A deleted object only shows up here: its newest entry is a marker, so
 * the current listing leaves it out.
 */
export function ObjectVersions({
  slug,
  bucket,
  prefix,
  onPrefix,
  maxBytes,
  signingEnabled,
}: {
  slug: string;
  bucket: ObjectBucket;
  prefix: string;
  onPrefix: (prefix: string) => void;
  maxBytes: number;
  signingEnabled: boolean;
}) {
  const [marker, setMarker] = useState<VersionMarker | null>(null);
  const [shownPrefix, setShownPrefix] = useState(prefix);
  if (shownPrefix !== prefix) {
    // Another folder starts from its own first page.
    setShownPrefix(prefix);
    setMarker(null);
  }
  const query = useObjectVersions(slug, bucket.id, prefix, marker);
  const versioning = useBucketVersioning(slug, bucket.id);
  const cache = useQueryClient();
  const confirm = useConfirm();
  const { toast } = useToast();
  const mutation = useMutation({
    mutationFn: async (task: () => Promise<unknown>) => task(),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: versionsKey(slug, bucket.id) });
      void cache.invalidateQueries({ queryKey: objectKey(slug, bucket.id) });
    },
    onError: (error) =>
      toast({
        kind: 'error',
        title: 'Version operation failed',
        description: storageRefusal(
          error,
          'The bucket is busy, or this version is protected from deletion. Try again later.'
        ),
        error,
      }),
  });

  const items = useMemo(() => query.data?.items ?? [], [query.data]);
  const folders = query.data?.common_prefixes ?? [];
  const groups = useMemo(() => {
    const out = new Map<string, ObjectVersion[]>();
    for (const v of items) out.set(v.key, [...(out.get(v.key) ?? []), v]);
    return [...out.entries()];
  }, [items]);
  const phase = queryPhase({
    loading: query.isPending,
    error: query.error,
    isEmpty: items.length === 0 && folders.length === 0,
  });
  const kept = versioning.data?.observed_status === 'Enabled';
  const neverOn = versioning.data?.observed_status === '' && !versioning.data.versions_required;
  const next =
    query.data?.next_key_marker && query.data.next_version_id_marker
      ? { key: query.data.next_key_marker, version: query.data.next_version_id_marker }
      : null;

  const download = (v: ObjectVersion) =>
    mutation.mutate(async () => {
      const signed = await signStoredObject(slug, bucket.id, {
        method: 'GET',
        expires_in: 300,
        key: v.key,
        version_id: v.version_id,
      });
      const link = document.createElement('a');
      link.href = signed.url;
      link.rel = 'noreferrer';
      link.referrerPolicy = 'no-referrer';
      link.click();
    });

  const restore = async (v: ObjectVersion) => {
    const ok = await confirm({
      title: `Restore this version of ${v.key}?`,
      description: kept
        ? 'A copy of it becomes the current object. The current version is kept as an older one, so this can be undone the same way.'
        : 'A copy of it becomes the current object. Versioning is not on, so the current object is replaced for good.',
      confirmLabel: 'Restore version',
      destructive: !kept,
    });
    if (ok)
      mutation.mutate(async () => {
        await restoreObjectVersion(slug, bucket.id, v);
        toast({ kind: 'success', title: `Restored ${v.key}` });
      });
  };

  const undelete = async (v: ObjectVersion) => {
    const ok = await confirm({
      title: `Undelete ${v.key}?`,
      description:
        'Removes the delete marker, so the newest version beneath it is the current object again.',
      confirmLabel: 'Undelete',
    });
    if (ok)
      mutation.mutate(async () => {
        await deleteObjectVersion(slug, bucket.id, v.key, v.version_id);
        toast({ kind: 'success', title: `Undeleted ${v.key}` });
      });
  };

  const remove = async (v: ObjectVersion) => {
    const ok = await confirm({
      title: v.delete_marker
        ? `Remove this delete marker for ${v.key}?`
        : `Permanently delete this version of ${v.key}?`,
      description: v.delete_marker
        ? 'The marker is removed for good.'
        : `This version is deleted for good. It cannot be undone or restored${v.is_latest ? ', and the next older version becomes current' : ''}.`,
      confirmLabel: v.delete_marker ? 'Remove marker' : 'Delete version',
      destructive: true,
    });
    if (ok) mutation.mutate(() => deleteObjectVersion(slug, bucket.id, v.key, v.version_id));
  };

  return (
    <div className="flex flex-col gap-4">
      {neverOn && (
        <p className="text-sm text-muted-foreground">
          Versioning is off for this bucket, so each object has only its current version. Turn it on
          in Settings to keep earlier versions.
        </p>
      )}
      {phase !== 'ready' ? (
        <InlinePhase
          phase={phase}
          error={query.error}
          onRetry={() => void query.refetch()}
          loadingMessage="Loading versions…"
          emptyMessage={prefix ? `No versions under ${prefix}.` : 'No versions in this bucket.'}
        />
      ) : (
        <>
          {folders.length > 0 && (
            <ul aria-label="Folders" className="flex flex-wrap gap-2">
              {folders.map((folder) => (
                <li key={folder}>
                  <button
                    type="button"
                    aria-label={`Open folder ${folder.slice(prefix.length)}`}
                    onClick={() => onPrefix(folder)}
                    className="storage-folder pressable flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 font-mono text-xs hover:border-[color:var(--brand)]"
                  >
                    {folder.slice(prefix.length)}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {groups.length > 0 && (
            <ul
              aria-label={`Versions in ${bucket.name}`}
              className="flex flex-col divide-y divide-border rounded-xl border border-border"
            >
              {groups.map(([key, versions]) => (
                <li key={key} className="flex flex-col gap-2 px-4 py-3">
                  <h4 className="break-all font-mono text-xs" title={key}>
                    {key.slice(prefix.length) || key}
                  </h4>
                  <ul aria-label={`Versions of ${key}`} className="flex flex-col gap-2">
                    {versions.map((v) => {
                      const readable = !v.delete_marker && v.version_id !== NULL_VERSION;
                      const fits = v.size_bytes <= maxBytes;
                      return (
                        <li
                          key={v.version_id}
                          className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
                        >
                          <VersionChip version={v} />
                          {v.version_id === NULL_VERSION ? (
                            <span className="text-xs text-muted-foreground">
                              Written while versioning was off
                            </span>
                          ) : (
                            <CopyableId value={v.version_id} label="version ID" />
                          )}
                          {!v.delete_marker && (
                            <span className="text-xs tabular-nums text-muted-foreground">
                              {formatUsageBytes(v.size_bytes)}
                            </span>
                          )}
                          <Timestamp
                            value={v.last_modified}
                            className="text-xs text-muted-foreground"
                          />
                          <span className="ml-auto flex flex-wrap gap-1">
                            {readable && (
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label={`Download version ${v.version_id} of ${v.key}`}
                                disabled={!signingEnabled || mutation.isPending}
                                onClick={() => download(v)}
                              >
                                Download
                              </Button>
                            )}
                            {readable && !v.is_latest && fits && (
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label={`Restore version ${v.version_id} of ${v.key}`}
                                disabled={!signingEnabled || mutation.isPending}
                                onClick={() => void restore(v)}
                              >
                                Restore
                              </Button>
                            )}
                            {readable && !v.is_latest && !fits && (
                              <span className="self-center text-xs text-muted-foreground">
                                Too large to restore here
                              </span>
                            )}
                            {v.delete_marker && v.is_latest ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label={`Undelete ${v.key}`}
                                disabled={mutation.isPending}
                                onClick={() => void undelete(v)}
                              >
                                Undelete
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label={`Delete version ${v.version_id} of ${v.key}`}
                                disabled={mutation.isPending}
                                onClick={() => void remove(v)}
                              >
                                Delete
                              </Button>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={!marker} onClick={() => setMarker(null)}>
          First page
        </Button>
        <Button variant="outline" size="sm" disabled={!next} onClick={() => setMarker(next)}>
          Next page
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void query.refetch()}>
          Refresh
        </Button>
      </div>
    </div>
  );
}
