import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, Circle, NavArrowRight, RefreshDouble, Xmark } from 'iconoir-react';
import { InlinePhase, queryPhase } from '@/components/dashboard/primitives';
import { Button } from '@/components/ui/button';
import { CopyableId } from '@/components/ui/copyable-id';
import { useConfirm } from '@/components/ui/confirm';
import { Timestamp } from '@/components/ui/timestamp';
import { useToast } from '@/components/ui/toast';
import { formatUsageBytes } from '@/lib/usage-format';
import {
  abortMultipartUpload,
  multipartKey,
  useMultipartParts,
  useMultipartUploads,
  type MultipartUpload,
  type ObjectBucket,
} from '@/lib/api/object-storage';
import { storageRefusal } from './refusals';
import { StatusChip } from './status-chip';

/** Sessions that can still take parts or be aborted (faas state.ObjectMultipart*). */
const OPEN = new Set<MultipartUpload['state']>(['initiating', 'active']);

function SessionChip({ state }: { state: MultipartUpload['state'] }) {
  if (state === 'completed') return <StatusChip tone="good" icon={CheckCircle} label="Completed" />;
  if (state === 'aborted') return <StatusChip tone="muted" icon={Xmark} label="Aborted" />;
  if (state === 'active') return <StatusChip tone="warning" icon={Circle} label="Unfinished" />;
  const label =
    state === 'aborting' ? 'Aborting' : state === 'initiating' ? 'Starting' : 'Completing';
  return <StatusChip tone="warning" icon={RefreshDouble} spin label={label} />;
}

/**
 * Multipart sessions for this bucket. An interrupted upload keeps its parts
 * (and its reserved capacity) until it completes, is aborted, or expires 24
 * hours after it started.
 */
export function MultipartUploads({ slug, bucket }: { slug: string; bucket: ObjectBucket }) {
  const uploads = useMultipartUploads(slug, bucket.id);
  const items = uploads.data?.items ?? [];
  const phase = queryPhase({
    loading: uploads.isPending,
    error: uploads.error,
    isEmpty: items.length === 0,
  });
  const [open, setOpen] = useState('');
  const cache = useQueryClient();
  const confirm = useConfirm();
  const { toast } = useToast();
  const abort = useMutation({
    mutationFn: (upload: string) => abortMultipartUpload(slug, bucket.id, upload),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: multipartKey(slug, bucket.id) });
      toast({ kind: 'success', title: 'Upload aborted' });
    },
    onError: (error) =>
      toast({
        kind: 'error',
        title: 'The upload was not aborted',
        description: storageRefusal(error, 'The upload is completing or busy; try again shortly.'),
        error,
      }),
  });

  const ask = async (u: MultipartUpload) => {
    if (
      await confirm({
        title: `Abort the upload of ${u.key}?`,
        description:
          'Its uploaded parts are discarded and it cannot be resumed; the file has to be uploaded again from the start.',
        confirmLabel: 'Abort upload',
        destructive: true,
      })
    )
      abort.mutate(u.id);
  };

  const unfinished = items.filter((u) => OPEN.has(u.state)).length;
  return (
    <details className="storage-disclosure group flex flex-col">
      <summary className="pressable flex w-fit cursor-pointer list-none items-center gap-1.5 rounded text-sm text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
        <NavArrowRight
          aria-hidden="true"
          className="size-3.5 transition-transform group-open:rotate-90 motion-reduce:transition-none"
        />
        Unfinished uploads{phase === 'loading' || phase === 'error' ? '' : ` (${unfinished})`}
      </summary>
      <section aria-label="Uploads in parts" className="mt-3 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Files above the single-upload limit go up in parts. An interrupted one keeps its parts
            until it finishes, is aborted, or expires 24 hours after it started.
          </p>
          <Button variant="ghost" size="sm" onClick={() => void uploads.refetch()}>
            Refresh
          </Button>
        </div>
        {phase !== 'ready' ? (
          <InlinePhase
            phase={phase}
            error={uploads.error}
            onRetry={() => void uploads.refetch()}
            emptyMessage="No uploads in parts. Files above the single-upload limit upload in parts automatically."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border well rounded-xl bg-muted/40">
            {items.map((u) => (
              <li
                key={u.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm"
              >
                <SessionChip state={u.state} />
                <span className="min-w-0 flex-1 break-all font-mono text-xs" title={u.key}>
                  {u.key}
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {formatUsageBytes(u.size_bytes)} in {u.part_count}{' '}
                  {u.part_count === 1 ? 'part' : 'parts'}
                </span>
                {OPEN.has(u.state) && (
                  <span className="text-xs text-muted-foreground">
                    expires <Timestamp value={u.expires_at} />
                  </span>
                )}
                <CopyableId value={u.id} label="upload ID" />
                <span className="flex gap-1">
                  {u.state === 'active' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-expanded={open === u.id}
                      aria-label={`Parts of ${u.key}`}
                      onClick={() => setOpen(open === u.id ? '' : u.id)}
                    >
                      Parts
                    </Button>
                  )}
                  {OPEN.has(u.state) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Abort upload of ${u.key}`}
                      disabled={abort.isPending}
                      onClick={() => void ask(u)}
                    >
                      Abort
                    </Button>
                  )}
                </span>
                {u.completion_error_code && (
                  <span className="basis-full text-xs" style={{ color: 'var(--status-critical)' }}>
                    Completion was refused ({u.completion_error_code}).
                  </span>
                )}
                {open === u.id && <ConfirmedParts slug={slug} bucket={bucket} upload={u} />}
              </li>
            ))}
          </ul>
        )}
        {phase === 'ready' && items.some((u) => u.state === 'active') && (
          <p className="text-xs text-muted-foreground">
            To resume an unfinished upload, choose the same file with the same object key.
          </p>
        )}
      </section>
    </details>
  );
}

function ConfirmedParts({
  slug,
  bucket,
  upload,
}: {
  slug: string;
  bucket: ObjectBucket;
  upload: MultipartUpload;
}) {
  const parts = useMultipartParts(slug, bucket.id, upload.id);
  const items = parts.data?.items ?? [];
  const phase = queryPhase({ loading: parts.isPending, error: parts.error });
  return (
    <div className="basis-full well rounded-xl bg-muted/40 p-3 text-xs">
      {phase !== 'ready' ? (
        <InlinePhase phase={phase} error={parts.error} onRetry={() => void parts.refetch()} />
      ) : (
        <p className="text-muted-foreground">
          Storage has confirmed {items.length} of {upload.part_count}{' '}
          {upload.part_count === 1 ? 'part' : 'parts'}
          {items.length > 0 &&
            ` (${formatUsageBytes(items.reduce((sum, p) => sum + p.size_bytes, 0))})`}
          .{parts.data?.next_part_number_marker ? ' More parts are on later pages.' : ''}
        </p>
      )}
    </div>
  );
}
