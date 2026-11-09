import { useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CloudUpload } from 'iconoir-react';
import { Sheet } from '@/components/dashboard/kit/sheet';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { FIELD } from '@/components/ui/field';
import { useCapabilityAccess } from '@/lib/api/capabilities';
import { formatUsageBytes } from '@/lib/usage-format';
import { cn } from '@/lib/utils';
import {
  multipartKey,
  objectKey,
  signStoredObject,
  uploadMultipartObject,
  uploadSignedObject,
  useBucketObjectLock,
  type MultipartProgress,
  type ObjectBucket,
  type WriteProtection,
} from '@/lib/api/object-storage';
import { lockEnabled } from './object-lock-setting';

export function formatUploadLimit(bytes: number): string {
  if (bytes >= 1024 ** 3 && bytes % 1024 ** 3 === 0) return `${bytes / 1024 ** 3} GiB`;
  if (bytes >= 1024 ** 2) return `${Math.floor(bytes / 1024 ** 2)} MiB`;
  if (bytes >= 1024) return `${Math.floor(bytes / 1024)} KiB`;
  return `${bytes} B`;
}

/**
 * The upload flow, in a sheet: pick or drop a file, check the key it lands at,
 * upload. A file above the single-upload limit goes in parts where multipart
 * is released. Stays mounted while closed, so an upload in flight finishes
 * (and its availability guard keeps watching) after the sheet is dismissed.
 */
export function UploadSheet({
  slug,
  bucket,
  prefix,
  open,
  onClose,
  initialFile,
  maxBytes,
  partsMaxBytes,
  signingEnabled,
}: {
  slug: string;
  bucket: ObjectBucket;
  /** The folder open in Files; a chosen file is named under it. */
  prefix: string;
  open: boolean;
  onClose: () => void;
  /** A file dropped on the page, which opened the sheet. */
  initialFile: File | null;
  maxBytes: number;
  /** The largest upload in parts, or 0 when multipart is not available. */
  partsMaxBytes: number;
  signingEnabled: boolean;
}) {
  const formId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [key, setKey] = useState('');
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<MultipartProgress | null>(null);
  const [hold, setHold] = useState(false);
  // Write receipts, Object Lock and legal holds share the object-protection capability.
  const protectionOn = useCapabilityAccess('object-protection').access === 'on';
  const lock = useBucketObjectLock(slug, protectionOn ? bucket.id : '');
  const lockable = protectionOn && lockEnabled(lock.data);
  const choose = (f: File | null) => {
    setFile(f);
    setKey(f ? `${prefix}${f.name}` : '');
  };
  // A dropped file arrives with the sheet; take it as if it were chosen here
  // (adjusted during render, so the sheet never paints without it).
  const [taken, setTaken] = useState<File | null>(null);
  if (initialFile !== taken) {
    setTaken(initialFile);
    if (initialFile) choose(initialFile);
  }
  const writable = useRef(signingEnabled);
  useLayoutEffect(() => {
    writable.current = signingEnabled;
    return () => {
      writable.current = false;
    };
  }, [signingEnabled]);
  const cache = useQueryClient();
  const confirm = useConfirm();
  const { toast } = useToast();
  const mutation = useMutation({
    mutationFn: async (task: () => Promise<unknown>) => task(),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: objectKey(slug, bucket.id) });
    },
    onError: (error) => toast({ kind: 'error', title: 'Object operation failed', error: error }),
  });

  const upload = async (event: FormEvent) => {
    event.preventDefault();
    if (!file || !signingEnabled) return;
    const inParts = file.size > maxBytes;
    if (inParts && file.size > partsMaxBytes) {
      toast({
        kind: 'error',
        title: partsMaxBytes
          ? `File exceeds the ${formatUploadLimit(partsMaxBytes)} upload limit`
          : `File exceeds the ${formatUploadLimit(maxBytes)} direct upload limit`,
      });
      return;
    }
    if (
      !(await confirm({
        title: `Upload ${key}?`,
        description: inParts
          ? 'An existing object with the same key will be overwritten. The file uploads in parts; if that is interrupted, choose the same file and key to resume.'
          : 'An existing object with the same key will be overwritten.',
        confirmLabel: 'Upload',
      }))
    )
      return;
    if (!writable.current) return;
    const protection: WriteProtection | undefined =
      lockable && hold ? { legal_hold: { status: 'ON' } } : undefined;
    const done = () => {
      toast({ kind: 'success', title: 'Object uploaded' });
      choose(null);
      onClose();
    };
    mutation.mutate(async () => {
      if (!writable.current) return;
      if (inParts) {
        try {
          await uploadMultipartObject(slug, bucket.id, file, key, {
            protection,
            onProgress: setProgress,
          });
        } finally {
          setProgress(null);
          void cache.invalidateQueries({ queryKey: multipartKey(slug, bucket.id) });
        }
        done();
        return;
      }
      const signed = await signStoredObject(slug, bucket.id, {
        method: 'PUT',
        expires_in: 300,
        key,
        size_bytes: file.size,
        content_type: file.type || 'application/octet-stream',
        ...(protection ? { protection } : {}),
      });
      if (!writable.current)
        throw new Error('Storage availability or selection changed. Upload was not sent.');
      await uploadSignedObject(signed, file);
      done();
    });
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Upload to ${bucket.name}`}
      size="sm"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {mutation.isPending ? 'Hide' : 'Cancel'}
          </Button>
          <Button
            type="submit"
            form={formId}
            disabled={!signingEnabled || !file || mutation.isPending}
          >
            {progress
              ? `Part ${progress.part} of ${progress.parts}`
              : mutation.isPending
                ? 'Uploading…'
                : 'Upload'}
          </Button>
        </div>
      }
    >
      <form
        id={formId}
        aria-label={`Upload to ${bucket.name}`}
        onSubmit={(e) => void upload(e)}
        className="flex flex-col gap-4"
      >
        <label
          onDragOver={(e) => {
            if (!signingEnabled) return;
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (signingEnabled) choose(e.dataTransfer.files?.[0] ?? null);
          }}
          className={cn(
            'storage-drop flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center text-xs text-muted-foreground transition-colors',
            dragging ? 'border-[color:var(--brand)] text-foreground' : 'border-border',
            !signingEnabled && 'cursor-not-allowed opacity-60'
          )}
        >
          <CloudUpload aria-hidden="true" className="size-6 text-muted-foreground" />
          <input
            aria-label="File"
            type="file"
            required
            disabled={!signingEnabled}
            className="sr-only"
            onChange={(e) => choose(e.target.files?.[0] ?? null)}
          />
          <span className="text-sm text-foreground">
            {file ? file.name : 'Drop a file here, or choose one'}
          </span>
          <span>
            {file
              ? `${formatUsageBytes(file.size)}${file.size > maxBytes && partsMaxBytes >= file.size ? ', in parts' : ''}, up to ${formatUploadLimit(partsMaxBytes || maxBytes)}`
              : partsMaxBytes
                ? `Up to ${formatUploadLimit(partsMaxBytes)}; above ${formatUploadLimit(maxBytes)} in parts`
                : `Up to ${formatUploadLimit(maxBytes)} in one upload`}
          </span>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Saved as
          <input
            aria-label="Object key"
            className={cn(FIELD, 'font-mono')}
            required
            disabled={!signingEnabled}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            spellCheck={false}
          />
          <span className="text-xs text-muted-foreground">
            The object key: a folder path and a name. A file already saved under it is replaced.
          </span>
        </label>
        {lockable && (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={hold}
              disabled={!signingEnabled}
              onChange={(e) => setHold(e.target.checked)}
            />
            Place a legal hold on this upload
          </label>
        )}
      </form>
    </Sheet>
  );
}
