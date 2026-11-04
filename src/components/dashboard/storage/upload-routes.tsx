import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, Pause } from 'iconoir-react';
import { InlinePhase, queryPhase } from '@/components/dashboard/primitives';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { FIELD, Select } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { useCapabilityAccess } from '@/lib/api/capabilities';
import { ApiError } from '@/lib/api/errors';
import { formatUsageBytes } from '@/lib/usage-format';
import { cn } from '@/lib/utils';
import {
  deleteUploadRoute,
  saveUploadRoute,
  uploadRoutesKey,
  useEncryptionCapabilities,
  useUploadRoutes,
  type ObjectBucket,
  type ObjectEncryption,
  type UploadRoute,
  type UploadRouteRequest,
} from '@/lib/api/object-storage';
import { ALGORITHM_LABEL } from './encryption-setting';
import { storageRefusal } from './refusals';
import { StatusChip } from './status-chip';

const LABEL = 'flex flex-col gap-1 text-xs text-muted-foreground';
const NAME = /^[a-z][a-z0-9-]{0,62}$/;
const MIB = 1024 ** 2;

interface Draft {
  name: string;
  prefix: string;
  maxMiB: string;
  types: string;
  enabled: boolean;
  /** '' for the bucket default, else `algorithm` or `algorithm|key`. */
  encryption: string;
  /** The stored limit, kept exactly unless the MiB field is edited. */
  bytes?: number;
}

const mib = (bytes: number) => String(Math.round((bytes / MIB) * 100) / 100);

const blank = (): Draft => ({
  name: '',
  prefix: '',
  maxMiB: '5',
  types: '',
  enabled: true,
  encryption: '',
});

function toDraft(route: UploadRoute): Draft {
  const e = route.encryption;
  return {
    name: route.name,
    prefix: route.key_prefix ?? '',
    maxMiB: mib(route.max_bytes),
    bytes: route.max_bytes,
    types: (route.allowed_content_types ?? []).join(', '),
    enabled: route.enabled,
    encryption: e ? (e.key_id ? `${e.algorithm}|${e.key_id}` : e.algorithm) : '',
  };
}

function encryptionOf(value: string): ObjectEncryption | undefined {
  if (!value) return undefined;
  const [algorithm, key] = value.split('|') as [ObjectEncryption['algorithm'], string?];
  return key ? { algorithm, key_id: key } : { algorithm };
}

export function routeRequest(bucket: string, d: Draft): UploadRouteRequest {
  const types = d.types
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const encryption = encryptionOf(d.encryption);
  return {
    name: d.name.trim(),
    bucket_id: bucket,
    ...(d.prefix.trim() ? { key_prefix: d.prefix.trim() } : {}),
    max_bytes:
      d.bytes !== undefined && d.maxMiB === mib(d.bytes)
        ? d.bytes
        : Math.round(Number(d.maxMiB) * MIB),
    ...(types.length ? { allowed_content_types: types } : {}),
    enabled: d.enabled,
    ...(encryption ? { encryption } : {}),
  };
}

export function draftProblem(d: Draft): string {
  if (!NAME.test(d.name.trim()))
    return 'A route name starts with a letter and uses a-z, 0-9 and -, up to 63 characters.';
  const size = Number(d.maxMiB);
  if (!(size > 0)) return 'Give the largest upload as a size above zero.';
  if (d.prefix.length > 256 || /[\\\r\n]/.test(d.prefix))
    return 'A key prefix is at most 256 characters, without backslashes or line breaks.';
  if (d.types.split(',').filter((t) => t.trim()).length > 32)
    return 'List at most 32 content types.';
  return '';
}

/**
 * Upload routes for this bucket: `POST /uploads/{name}` on the app's own
 * hostname takes a file from a client with an API key and writes it here
 * without waking the app. The edge picks the final key under the prefix.
 */
export function UploadRoutes({
  slug,
  bucket,
  enabled,
}: {
  slug: string;
  bucket: ObjectBucket;
  enabled: boolean;
}) {
  const routes = useUploadRoutes(slug);
  const mine = (routes.data?.items ?? []).filter((r) => r.bucket_id === bucket.id);
  const phase = queryPhase({ loading: routes.isPending, error: routes.error });
  const encryptionOn = useCapabilityAccess('bucket-encryption').access === 'on';
  const caps = useEncryptionCapabilities(slug, encryptionOn ? bucket.id : '');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tried, setTried] = useState(false);
  const cache = useQueryClient();
  const confirm = useConfirm();
  const { toast } = useToast();
  const refresh = () => void cache.invalidateQueries({ queryKey: uploadRoutesKey(slug) });
  const save = useMutation({
    mutationFn: (body: UploadRouteRequest) => saveUploadRoute(slug, body),
    onSuccess: (route) => {
      refresh();
      setDraft(null);
      toast({ kind: 'success', title: `Saved upload route ${route.name}` });
    },
    onError: (error) =>
      toast({
        kind: 'error',
        title: 'The upload route was not saved',
        description:
          error instanceof ApiError && error.code === 'object_storage_not_found'
            ? 'The bucket is not ready for uploads.'
            : storageRefusal(error),
        error,
      }),
  });
  const remove = useMutation({
    mutationFn: (name: string) => deleteUploadRoute(slug, name),
    onSuccess: () => {
      refresh();
      toast({ kind: 'success', title: 'Upload route deleted' });
    },
    onError: (error) =>
      toast({
        kind: 'error',
        title: 'The upload route was not deleted',
        description: storageRefusal(error),
        error,
      }),
  });
  const problem = draft ? draftProblem(draft) : '';
  const taken =
    draft && !mine.some((r) => r.name === draft.name.trim())
      ? (routes.data?.items ?? []).find(
          (r) => r.name === draft.name.trim() && r.bucket_id !== bucket.id
        )
      : undefined;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (!draft || problem || taken) return;
    save.mutate(routeRequest(bucket.id, draft));
  };
  const askDelete = async (route: UploadRoute) => {
    if (
      await confirm({
        title: `Delete the upload route ${route.name}?`,
        description:
          'New uploads to it stop immediately, and clients still posting to it get an error. Objects it already stored stay in the bucket.',
        confirmLabel: 'Delete route',
        destructive: true,
      })
    )
      remove.mutate(route.name);
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-medium">Uploads from your users</h3>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            A route takes files on your app&apos;s own hostname and writes them straight to this
            bucket, without waking the app. Clients send an API key with{' '}
            <code className="font-mono">storage:write</code>, and an{' '}
            <code className="font-mono">Idempotency-Key</code> header so a retry cannot store a file
            twice.
          </p>
        </div>
        {!draft && phase === 'ready' && (
          <Button
            variant="outline"
            size="sm"
            disabled={!enabled}
            onClick={() => {
              setTried(false);
              setDraft(blank());
            }}
          >
            New upload route
          </Button>
        )}
      </div>

      {draft && (
        <form
          aria-label="Upload route"
          noValidate
          onSubmit={submit}
          className="flex flex-col gap-3 rounded-xl border border-border p-4"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={LABEL}>
              Route name
              <input
                className={cn(FIELD, 'font-mono')}
                value={draft.name}
                placeholder="avatar"
                spellCheck={false}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label className={LABEL}>
              Key prefix
              <input
                className={cn(FIELD, 'font-mono')}
                value={draft.prefix}
                placeholder="avatars"
                spellCheck={false}
                onChange={(e) => setDraft({ ...draft, prefix: e.target.value })}
              />
            </label>
            <label className={LABEL}>
              Largest upload (MiB)
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                className={cn(FIELD, 'tabular-nums')}
                value={draft.maxMiB}
                onChange={(e) => setDraft({ ...draft, maxMiB: e.target.value })}
              />
            </label>
            <label className={LABEL}>
              Content types allowed
              <input
                className={cn(FIELD, 'font-mono')}
                value={draft.types}
                placeholder="Any, or image/*, application/pdf"
                spellCheck={false}
                onChange={(e) => setDraft({ ...draft, types: e.target.value })}
              />
            </label>
            {encryptionOn && caps.data && (
              <label className={LABEL}>
                Encryption
                <Select
                  value={draft.encryption}
                  onChange={(e) => setDraft({ ...draft, encryption: e.target.value })}
                >
                  <option value="">Bucket default</option>
                  {caps.data.algorithms.includes('AES256') && (
                    <option value="AES256">{ALGORITHM_LABEL.AES256}</option>
                  )}
                  {caps.data.algorithms
                    .filter((a) => a !== 'AES256')
                    .flatMap((a) =>
                      caps.data.key_ids.map((k) => (
                        <option key={`${a}|${k}`} value={`${a}|${k}`}>
                          {ALGORITHM_LABEL[a]}: {k}
                        </option>
                      ))
                    )}
                </Select>
              </label>
            )}
            <label className="flex h-9 items-center gap-2 self-end text-sm">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
              />
              Accept uploads
            </label>
          </div>
          {draft.name.trim() && NAME.test(draft.name.trim()) && (
            <p className="text-xs text-muted-foreground">
              Clients post to{' '}
              <code className="font-mono text-foreground">/uploads/{draft.name.trim()}</code> on
              your app&apos;s hostname.
            </p>
          )}
          {tried && (problem || taken) && (
            <p className="text-xs" style={{ color: 'var(--status-critical)' }}>
              {problem ||
                'Another bucket of this app already has a route with this name; saving would move it here. Pick another name.'}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save route'}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {phase !== 'ready' ? (
        <InlinePhase phase={phase} error={routes.error} onRetry={() => void routes.refetch()} />
      ) : mine.length === 0 ? (
        <p className="text-sm text-muted-foreground">No upload routes write to this bucket.</p>
      ) : (
        <ul
          aria-label={`Upload routes for ${bucket.name}`}
          className="flex flex-col divide-y divide-border rounded-xl border border-border"
        >
          {mine.map((route) => (
            <li
              key={route.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm"
            >
              {route.enabled ? (
                <StatusChip tone="good" icon={CheckCircle} label="Accepting" />
              ) : (
                <StatusChip tone="warning" icon={Pause} label="Paused" />
              )}
              <code className="font-mono text-xs">POST /uploads/{route.name}</code>
              <span className="text-xs text-muted-foreground">
                into {route.key_prefix ? `${route.key_prefix}/` : 'the bucket root'}, up to{' '}
                {formatUsageBytes(route.max_bytes)}
                {route.allowed_content_types?.length
                  ? `, ${route.allowed_content_types.join(', ')}`
                  : ', any type'}
              </span>
              <span className="ml-auto flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Edit upload route ${route.name}`}
                  disabled={!enabled}
                  onClick={() => {
                    setTried(false);
                    setDraft(toDraft(route));
                  }}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`${route.enabled ? 'Pause' : 'Resume'} upload route ${route.name}`}
                  disabled={!enabled || save.isPending}
                  onClick={() =>
                    save.mutate(
                      routeRequest(bucket.id, { ...toDraft(route), enabled: !route.enabled })
                    )
                  }
                >
                  {route.enabled ? 'Pause' : 'Resume'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Delete upload route ${route.name}`}
                  disabled={remove.isPending}
                  onClick={() => void askDelete(route)}
                >
                  Delete
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
