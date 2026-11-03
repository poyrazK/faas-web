import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Circle, Lock, RefreshDouble } from 'iconoir-react';
import { InlinePhase, queryPhase } from '@/components/dashboard/primitives';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { Select } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import {
  clearBucketEncryption,
  encryptionKey,
  setBucketEncryption,
  useBucketEncryption,
  useEncryptionCapabilities,
  type ObjectBucket,
  type ObjectEncryption,
} from '@/lib/api/object-storage';
import { storageRefusal } from './refusals';
import { StatusChip } from './status-chip';

type Algorithm = ObjectEncryption['algorithm'];

export const ALGORITHM_LABEL: Record<Algorithm, string> = {
  AES256: 'AES-256, managed by storage',
  'aws:kms': 'Your KMS key',
  'aws:kms:dsse': 'Your KMS key, dual-layer',
};

const LABEL = 'flex flex-col gap-1 text-xs text-muted-foreground';

/** "AES-256, managed by storage" or "Your KMS key arn:… with a bucket key". */
export function encryptionSentence(e: ObjectEncryption): string {
  const key = e.key_id ? ` ${e.key_id}` : '';
  const bucketKey = e.bucket_key_enabled ? ', with a bucket key' : '';
  return `${ALGORITHM_LABEL[e.algorithm]}${key}${bucketKey}`;
}

/**
 * The default encryption apid applies to new writes that do not choose their
 * own. A new default is verified against storage before it applies; writes
 * already accepted keep the encryption they were accepted with.
 */
export function EncryptionSetting({
  slug,
  bucket,
  enabled,
}: {
  slug: string;
  bucket: ObjectBucket;
  enabled: boolean;
}) {
  const encryption = useBucketEncryption(slug, bucket.id);
  const capabilities = useEncryptionCapabilities(slug, bucket.id);
  const phase = queryPhase({
    loading: encryption.isPending || capabilities.isPending,
    error: encryption.error ?? capabilities.error,
  });
  const cache = useQueryClient();
  const confirm = useConfirm();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [algorithm, setAlgorithm] = useState<Algorithm | ''>('');
  const [keyId, setKeyId] = useState('');
  const [bucketKey, setBucketKey] = useState(false);
  const change = useMutation({
    mutationFn: (next: ObjectEncryption | null) =>
      next ? setBucketEncryption(slug, bucket.id, next) : clearBucketEncryption(slug, bucket.id),
    onSuccess: (result) => {
      cache.setQueryData(encryptionKey(slug, bucket.id), result);
      setEditing(false);
      toast({
        kind: 'success',
        title: result.desired_encryption
          ? 'Encryption default requested'
          : 'Encryption default cleared',
        description: 'New writes that rely on the default wait until storage confirms it.',
      });
    },
    onError: (error) =>
      toast({
        kind: 'error',
        title: 'Encryption was not changed',
        description: storageRefusal(error, 'Another encryption change is still being applied.'),
        error,
      }),
  });

  const e = encryption.data;
  const caps = capabilities.data;
  const settling = e ? e.state !== 'ready' : false;
  const kms = algorithm === 'aws:kms' || algorithm === 'aws:kms:dsse';
  const keys = caps?.key_ids ?? [];
  const ready = algorithm !== '' && (!kms || keyId !== '');

  const start = () => {
    const current = e?.desired_encryption ?? e?.encryption;
    setAlgorithm(current?.algorithm ?? caps?.algorithms[0] ?? '');
    setKeyId(current?.key_id ?? '');
    setBucketKey(Boolean(current?.bucket_key_enabled));
    setEditing(true);
  };
  const save = () => {
    if (!ready) return;
    change.mutate({
      algorithm,
      ...(kms ? { key_id: keyId } : {}),
      ...(algorithm === 'aws:kms' ? { bucket_key_enabled: bucketKey } : {}),
    });
  };
  const clear = async () => {
    const ok = await confirm({
      title: `Clear the encryption default for ${bucket.name}?`,
      description:
        "New writes go back to the storage provider's baseline encryption. Objects already written keep the encryption they were written with.",
      confirmLabel: 'Clear default',
      destructive: true,
    });
    if (ok) change.mutate(null);
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Encryption</h3>
        {e &&
          (settling ? (
            <StatusChip tone="warning" icon={RefreshDouble} spin label="Applying" />
          ) : e.encryption ? (
            <StatusChip tone="good" icon={Lock} label="Bucket default" />
          ) : (
            <StatusChip tone="muted" icon={Circle} label="Provider default" />
          ))}
      </div>
      {phase !== 'ready' || !e || !caps ? (
        <InlinePhase
          phase={phase}
          error={encryption.error ?? capabilities.error}
          onRetry={() => {
            void encryption.refetch();
            void capabilities.refetch();
          }}
        />
      ) : (
        <>
          <p className="text-sm">
            {e.encryption
              ? `New objects are encrypted with ${encryptionSentence(e.encryption)}.`
              : "No bucket default. Objects are encrypted at rest with the storage provider's baseline encryption."}
          </p>
          {settling && e.desired_encryption && (
            <p role="status" className="text-sm text-muted-foreground">
              Changing to {encryptionSentence(e.desired_encryption)}. New writes that rely on the
              default wait until storage confirms it.
            </p>
          )}
          {settling && !e.desired_encryption && (
            <p role="status" className="text-sm text-muted-foreground">
              Clearing the default. New writes that rely on it wait until storage confirms.
            </p>
          )}
          {!caps.bucket_defaults ? (
            <p className="text-xs text-muted-foreground">
              This bucket&apos;s storage does not support a bucket default.
            </p>
          ) : editing ? (
            <form
              aria-label={`Encryption default for ${bucket.name}`}
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                save();
              }}
            >
              <label className={LABEL}>
                Algorithm
                <Select
                  value={algorithm}
                  onChange={(ev) => setAlgorithm(ev.target.value as Algorithm)}
                >
                  {caps.algorithms.map((a) => (
                    <option key={a} value={a}>
                      {ALGORITHM_LABEL[a]}
                    </option>
                  ))}
                </Select>
              </label>
              {kms &&
                (keys.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No keys are enrolled for this bucket yet, so a KMS default cannot be set.
                  </p>
                ) : (
                  <label className={LABEL}>
                    Key
                    <Select value={keyId} onChange={(ev) => setKeyId(ev.target.value)}>
                      <option value="" disabled>
                        Choose a key
                      </option>
                      {keys.map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                    </Select>
                  </label>
                ))}
              {algorithm === 'aws:kms' && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={bucketKey}
                    onChange={(ev) => setBucketKey(ev.target.checked)}
                  />
                  Use a bucket key (fewer KMS calls)
                </label>
              )}
              <div className="flex flex-wrap gap-2">
                <Button type="submit" size="sm" disabled={!ready || change.isPending}>
                  Save default
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={change.isPending}
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!enabled || settling || caps.algorithms.length === 0}
                onClick={start}
              >
                {e.encryption ? 'Change default' : 'Set a default'}
              </Button>
              {e.encryption && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={settling || change.isPending}
                  onClick={() => void clear()}
                >
                  Clear default
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}
