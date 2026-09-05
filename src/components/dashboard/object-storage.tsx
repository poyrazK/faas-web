import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AppScope, AppSelect, useSelectedApp } from './app-select';
import { ErrorState, LoadingState, Panel } from './primitives';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/api/errors';
import {
  bucketKey,
  objectKey,
  createObjectBucket,
  deleteObjectBucket,
  deleteStoredObject,
  signStoredObject,
  uploadSignedObject,
  useObjectBuckets,
  useBucketObjects,
  type ObjectBucket,
} from '@/lib/api/object-storage';

const FIELD = 'h-9 rounded-md border border-border bg-background px-3 text-sm';

export function ObjectStorage() {
  const app = useSelectedApp();
  return (
    <Panel
      title="Object storage"
      description="Private S3-backed buckets. Separate from VM snapshots and image-layer usage."
    >
      <div className="flex flex-col gap-4 p-4">
        <AppSelect slug={app.slug} onSelect={app.select} apps={app.apps} />
        <AppScope state={app} resource="buckets">
          <BucketManager key={app.slug} slug={app.slug} />
        </AppScope>
      </div>
    </Panel>
  );
}

function BucketManager({ slug }: { slug: string }) {
  const query = useObjectBuckets(slug);
  const cache = useQueryClient();
  const confirm = useConfirm();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [scope, setScope] = useState('default');
  const [region, setRegion] = useState('');
  const [selected, setSelected] = useState('');
  const refresh = () => cache.invalidateQueries({ queryKey: bucketKey(slug) });
  const mutation = useMutation({
    mutationFn: async (task: () => Promise<unknown>) => task(),
    onSuccess: () => void refresh(),
    onError: (error) => {
      toast({ kind: 'error', title: 'Storage operation failed', description: errorMessage(error) });
      void refresh();
    },
  });
  const create = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate(async () => {
      const bucket = await createObjectBucket(
        slug,
        name,
        scope,
        region || query.data!.default_region
      );
      setSelected(bucket.id);
      setName('');
    });
  };
  if (query.isPending) return <LoadingState message="Loading buckets…" />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const data = query.data!;
  const bucket = data.items.find((b) => b.id === selected);
  return (
    <div className="flex flex-col gap-4">
      {!data.enabled ? (
        <p className="text-sm text-muted-foreground">
          Object storage has not been enabled by the operator.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Preview · Up to {data.max_buckets_per_app} buckets per app. Single uploads up to{' '}
            {Math.round(data.max_upload_bytes / 1024 / 1024)} MiB. Storage billing is not integrated
            yet.
          </p>
          <form onSubmit={create} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Bucket name
              <input
                className={FIELD}
                required
                pattern="[a-z][a-z0-9-]{0,62}"
                maxLength={63}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="assets"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Environment scope
              <input
                className={FIELD}
                required
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                maxLength={40}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Region
              <select
                className={FIELD}
                value={region || data.default_region}
                onChange={(e) => setRegion(e.target.value)}
              >
                {data.regions.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
            <Button type="submit" disabled={mutation.isPending}>
              Create bucket
            </Button>
          </form>
        </>
      )}
      <div className="flex flex-col divide-y divide-border rounded-md border border-border">
        {data.items.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">No object buckets for this app yet.</p>
        )}
        {data.items.map((b) => (
          <div key={b.id} className="flex flex-wrap items-center gap-3 p-3">
            <Button
              variant={selected === b.id ? 'secondary' : 'ghost'}
              onClick={() => setSelected(b.id)}
            >
              {b.name}
            </Button>
            <span className="text-xs text-muted-foreground">
              {b.scope} · {b.region} · {b.state}
            </span>
            {b.state === 'provisioning' && (
              <Button
                variant="outline"
                size="sm"
                disabled={!data.enabled || mutation.isPending}
                onClick={() =>
                  mutation.mutate(() => createObjectBucket(slug, b.name, b.scope, b.region))
                }
              >
                Retry setup
              </Button>
            )}
            <Button
              className="ml-auto"
              variant="outline"
              size="sm"
              disabled={!data.enabled || mutation.isPending}
              onClick={async () => {
                if (
                  await confirm({
                    title: `Delete ${b.name}?`,
                    description:
                      'Only an empty bucket can be deleted. No objects will be automatically removed.',
                    confirmLabel: 'Delete bucket',
                    destructive: true,
                  })
                )
                  mutation.mutate(() => deleteObjectBucket(slug, b.id));
              }}
            >
              {b.state === 'deleting' ? 'Retry deletion' : 'Delete bucket'}
            </Button>
          </div>
        ))}
      </div>
      {data.enabled && bucket?.state === 'ready' && (
        <ObjectBrowser
          key={bucket.id}
          slug={slug}
          bucket={bucket}
          maxBytes={data.max_upload_bytes}
        />
      )}
      {bucket && bucket.state !== 'ready' && (
        <p className="text-sm text-muted-foreground">
          This bucket is {bucket.state}. Retry its operation to finish setup or deletion.
        </p>
      )}
    </div>
  );
}

function ObjectBrowser({
  slug,
  bucket,
  maxBytes,
}: {
  slug: string;
  bucket: ObjectBucket;
  maxBytes: number;
}) {
  const [prefix, setPrefix] = useState('');
  const [cursor, setCursor] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [key, setKey] = useState('');
  const query = useBucketObjects(slug, bucket.id, prefix, cursor);
  const cache = useQueryClient();
  const confirm = useConfirm();
  const { toast } = useToast();
  const mutation = useMutation({
    mutationFn: async (task: () => Promise<unknown>) => task(),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: objectKey(slug, bucket.id) });
    },
    onError: (error) =>
      toast({ kind: 'error', title: 'Object operation failed', description: errorMessage(error) }),
  });
  const upload = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) return;
    if (file.size > maxBytes) {
      toast({ kind: 'error', title: 'File exceeds the upload limit' });
      return;
    }
    if (
      !(await confirm({
        title: `Upload ${key}?`,
        description: 'An existing object with the same key will be overwritten.',
        confirmLabel: 'Upload',
      }))
    )
      return;
    mutation.mutate(async () => {
      const signed = await signStoredObject(slug, bucket.id, {
        method: 'PUT',
        expires_in: 300,
        key,
        size_bytes: file.size,
        content_type: file.type || 'application/octet-stream',
      });
      await uploadSignedObject(signed, file);
      toast({ kind: 'success', title: 'Object uploaded' });
    });
  };
  return (
    <section className="flex flex-col gap-3" aria-label={`Objects in ${bucket.name}`}>
      <h3 className="text-sm font-medium">Objects in {bucket.name}</h3>
      <form onSubmit={(e) => void upload(e)} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          File
          <input
            type="file"
            required
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              setKey(f?.name ?? '');
            }}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Object key
          <input className={FIELD} required value={key} onChange={(e) => setKey(e.target.value)} />
        </label>
        <Button type="submit" disabled={!file || mutation.isPending}>
          {mutation.isPending ? 'Working…' : 'Upload'}
        </Button>
      </form>
      <label className="flex items-center gap-2 text-sm">
        Key prefix
        <input
          className={FIELD}
          value={prefix}
          onChange={(e) => {
            setPrefix(e.target.value);
            setCursor('');
          }}
          placeholder="folder/"
        />
      </label>
      {query.isPending ? (
        <LoadingState message="Loading objects…" />
      ) : query.error ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          {query.data?.items.length === 0 && (
            <p className="text-sm text-muted-foreground">No objects on this page.</p>
          )}
          <ul className="divide-y divide-border">
            {query.data?.items.map((o) => (
              <li key={o.key} className="flex items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1 break-all font-mono text-xs">{o.key}</span>
                <span className="text-xs text-muted-foreground">
                  {o.size_bytes.toLocaleString()} B
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={mutation.isPending}
                  onClick={() =>
                    mutation.mutate(async () => {
                      const signed = await signStoredObject(slug, bucket.id, {
                        method: 'GET',
                        expires_in: 300,
                        key: o.key,
                      });
                      const link = document.createElement('a');
                      link.href = signed.url;
                      link.rel = 'noreferrer';
                      link.referrerPolicy = 'no-referrer';
                      link.click();
                    })
                  }
                >
                  Download
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={mutation.isPending}
                  onClick={async () => {
                    if (
                      await confirm({
                        title: `Delete ${o.key}?`,
                        description: 'This cannot be undone through Gregale.',
                        confirmLabel: 'Delete object',
                        destructive: true,
                      })
                    )
                      mutation.mutate(() => deleteStoredObject(slug, bucket.id, o.key));
                  }}
                >
                  Delete
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={!cursor} onClick={() => setCursor('')}>
              First page
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!query.data?.next_cursor}
              onClick={() => setCursor(query.data?.next_cursor ?? '')}
            >
              Next page
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void query.refetch()}>
              Refresh
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
