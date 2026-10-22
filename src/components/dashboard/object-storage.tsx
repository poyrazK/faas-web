import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AppScope, AppSelect, useSelectedApp } from './app-select';
import { ErrorState, LoadingState } from './primitives';
import { Button } from '@/components/ui/button';
import { CopyableId } from '@/components/ui/copyable-id';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { Timestamp } from '@/components/ui/timestamp';
import { FIELD } from '@/components/ui/field';
import { BucketAccess } from './bucket-access';
import { useCapability } from '@/lib/api/capabilities';
import { CapabilityNotice } from './capability-notice';
import { Tabs, tabId } from './tabs';
import { AccessMap } from './storage/access-map';
import { CodeAccess } from './storage/code-access';
import { BucketSettings } from './storage/bucket-settings';
import { accessModel, type AccessConnection } from '@/lib/storage-access';
import { formatUsageBytes } from '@/lib/usage-format';
import { cn } from '@/lib/utils';
import { errorMessage } from '@/lib/api/errors';
import {
  bucketKey,
  objectKey,
  createObjectBucket,
  deleteObjectBucket,
  deleteStoredObject,
  signStoredObject,
  uploadSignedObject,
  useBucketAccessGrants,
  useBucketBindings,
  useBucketObjects,
  useBucketS3Credentials,
  useObjectBuckets,
  type ObjectBucket,
} from '@/lib/api/object-storage';
import './storage/storage.css';

const MAX_SINGLE_PUT_BYTES = 5 * 1024 ** 3;
/** Share links last as long as the API allows a signed URL to. */
const SHARE_SECONDS = 900;

export type StorageTab = 'objects' | 'code' | 'settings';
export interface StorageSelection {
  app?: string;
  bucket?: string;
  tab?: StorageTab;
  prefix?: string;
}
/**
 * `replace` marks a change the page made on its own (or a refinement of the
 * last one), which should not become a step of its own in Back.
 */
export type SelectionChange = (next: StorageSelection, options?: { replace?: boolean }) => void;

const TABS = [
  { key: 'objects', label: 'Objects' },
  { key: 'code', label: 'Use from code' },
  { key: 'settings', label: 'Settings' },
] as const;

function formatUploadLimit(bytes: number): string {
  if (bytes >= 1024 ** 3 && bytes % 1024 ** 3 === 0) return `${bytes / 1024 ** 3} GiB`;
  if (bytes >= 1024 ** 2) return `${Math.floor(bytes / 1024 ** 2)} MiB`;
  if (bytes >= 1024) return `${Math.floor(bytes / 1024)} KiB`;
  return `${bytes} B`;
}

/**
 * Object storage for one app: its buckets on the left, the open bucket on the
 * right — who can reach it, its objects, how code reaches it, its settings.
 *
 * The selection can be owned by the route (so it lives in the URL) or, when no
 * `selection` is passed, kept here.
 */
export function ObjectStorage({
  selection,
  onSelectionChange,
}: {
  selection?: StorageSelection;
  onSelectionChange?: SelectionChange;
} = {}) {
  const app = useSelectedApp();
  const availability = useCapability('object-storage');
  const [local, setLocal] = useState<StorageSelection>({});
  const current = selection ?? local;
  const emit: SelectionChange = onSelectionChange ?? setLocal;
  // Every selection names its app, so a shared link opens the same bucket.
  const change: SelectionChange = (next, options) => emit({ app: app.slug, ...next }, options);
  const linked = current.app;
  const followed = useRef<string | undefined>(undefined);
  const known = app.apps.some((a) => a.slug === linked);
  useEffect(() => {
    // Follow a link once the app list can confirm it; afterwards the picker owns the app.
    if (!linked || !known || followed.current === linked) return;
    followed.current = linked;
    if (linked !== app.slug) app.select(linked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linked, known]);
  return (
    <div className="flex flex-col gap-5">
      {availability.state !== 'available' && (
        <CapabilityNotice
          capability={availability.capability}
          state={availability.state}
          onRetry={availability.refresh}
        />
      )}
      <AppSelect
        slug={app.slug}
        onSelect={(next) => {
          app.select(next);
          emit({ app: next });
        }}
        apps={app.apps}
      />
      <AppScope state={app} resource="buckets">
        <BucketManager
          key={`${availability.accountId}:${app.slug}`}
          slug={app.slug}
          selection={current}
          onSelectionChange={change}
        />
      </AppScope>
    </div>
  );
}

function BucketManager({
  slug,
  selection,
  onSelectionChange,
}: {
  slug: string;
  selection: StorageSelection;
  onSelectionChange: SelectionChange;
}) {
  const availability = useCapability('object-storage');
  const query = useObjectBuckets(slug);
  const cache = useQueryClient();
  const confirm = useConfirm();
  const { toast } = useToast();
  const refresh = () => cache.invalidateQueries({ queryKey: bucketKey(slug) });
  const mutation = useMutation({
    mutationFn: async (task: () => Promise<unknown>) => task(),
    onSuccess: () => void refresh(),
    onError: (error) => {
      toast({ kind: 'error', title: 'Storage operation failed', description: errorMessage(error) });
      void refresh();
    },
  });
  if (query.isPending) return <LoadingState message="Loading buckets…" />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const data = {
    ...query.data!,
    enabled: query.data!.enabled && availability.state === 'available',
  };
  // With nothing chosen, open the first ready bucket rather than a blank pane.
  const bucket = selection.bucket
    ? data.items.find((b) => b.id === selection.bucket)
    : data.items.find((b) => b.state === 'ready');
  const directUploadMaxBytes = Math.min(data.max_upload_bytes, MAX_SINGLE_PUT_BYTES);
  const select = (id: string) => onSelectionChange({ bucket: id });
  const create = (name: string, scope: string, region: string) =>
    mutation.mutate(async () => {
      const created = await createObjectBucket(slug, name, scope, region);
      toast({ kind: 'success', title: `Created ${created.name}` });
      select(created.id);
    });
  const limits = (
    <p className="text-xs text-muted-foreground">
      Preview. Up to {data.max_buckets_per_app} buckets per app. Direct uploads up to{' '}
      {formatUploadLimit(directUploadMaxBytes)}. Storage billing is not integrated yet.
    </p>
  );

  if (!data.enabled && data.items.length === 0)
    return availability.state === 'available' ? (
      <p className="text-sm text-muted-foreground">
        Object storage is unavailable on this installation. Contact support for availability.
      </p>
    ) : null;

  if (data.items.length === 0)
    return (
      <section className="storage-first rounded-2xl border border-border p-6 sm:p-10">
        <CreateBucket
          hero
          regions={data.regions}
          defaultRegion={data.default_region}
          busy={mutation.isPending}
          onCreate={create}
        />
        <div className="mt-6">{limits}</div>
      </section>
    );

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside aria-label="Buckets" className="flex flex-col gap-4">
        <ul className="flex flex-col gap-1">
          {data.items.map((b) => (
            <li
              key={b.id}
              className={cn(
                'storage-rail-item flex flex-col gap-1 rounded-xl border px-3 py-2.5',
                bucket?.id === b.id
                  ? 'storage-rail-item--open border-[color:color-mix(in_oklab,var(--brand)_45%,var(--border))] bg-card'
                  : 'border-transparent'
              )}
            >
              <button
                type="button"
                onClick={() => select(b.id)}
                aria-current={bucket?.id === b.id ? 'true' : undefined}
                className="pressable truncate text-left text-sm font-medium"
              >
                {b.name}
              </button>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span
                  aria-hidden="true"
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    b.state === 'ready'
                      ? 'bg-[color:var(--status-good)]'
                      : 'bg-[color:var(--status-warning)]'
                  )}
                />
                <span>{b.state === 'ready' ? b.scope : b.state}</span>
                <CopyableId value={b.id} label="bucket ID" />
              </div>
              {b.state === 'provisioning' && (
                <Button
                  variant="outline"
                  size="xs"
                  className="self-start"
                  disabled={!data.enabled || mutation.isPending}
                  onClick={() =>
                    mutation.mutate(() => createObjectBucket(slug, b.name, b.scope, b.region))
                  }
                >
                  Retry setup
                </Button>
              )}
              {b.state !== 'ready' && (
                <Button
                  variant="outline"
                  size="xs"
                  className="self-start"
                  disabled={mutation.isPending}
                  onClick={async () => {
                    if (await confirmDelete(confirm, b))
                      mutation.mutate(() => deleteObjectBucket(slug, b.id));
                  }}
                >
                  {b.state === 'deleting' ? 'Retry deletion' : 'Delete bucket'}
                </Button>
              )}
            </li>
          ))}
        </ul>
        {data.enabled && (
          <details className="storage-new group rounded-xl border border-dashed border-border px-3 py-2.5">
            <summary className="cursor-pointer text-sm text-muted-foreground group-open:mb-3 hover:text-foreground">
              New bucket
            </summary>
            <CreateBucket
              regions={data.regions}
              defaultRegion={data.default_region}
              busy={mutation.isPending}
              onCreate={create}
            />
          </details>
        )}
        {limits}
      </aside>

      <div className="min-w-0">
        {!bucket ? (
          <p className="storage-pick rounded-2xl border border-dashed border-border p-8 text-sm text-muted-foreground">
            Pick a bucket to see who can reach it, browse its objects, and connect it to your code.
          </p>
        ) : bucket.state !== 'ready' ? (
          <p className="text-sm text-muted-foreground">
            This bucket is {bucket.state}. Retry its operation to finish setup or deletion.
          </p>
        ) : (
          <BucketDetail
            key={bucket.id}
            slug={slug}
            bucket={bucket}
            tab={selection.tab ?? 'objects'}
            prefix={selection.prefix ?? ''}
            onChange={(next, options) => onSelectionChange({ bucket: bucket.id, ...next }, options)}
            enabled={data.enabled}
            maxBytes={directUploadMaxBytes}
            onDelete={async () => {
              if (await confirmDelete(confirm, bucket))
                mutation.mutate(async () => {
                  await deleteObjectBucket(slug, bucket.id);
                  // The deleted bucket's URL is dead; Back should not land on it.
                  onSelectionChange({}, { replace: true });
                });
            }}
            deleting={mutation.isPending}
          />
        )}
      </div>
    </div>
  );
}

function confirmDelete(confirm: ReturnType<typeof useConfirm>, bucket: ObjectBucket) {
  return confirm({
    title: `Delete ${bucket.name}?`,
    description: 'Only an empty bucket can be deleted. No objects will be automatically removed.',
    confirmLabel: 'Delete bucket',
    destructive: true,
  });
}

/** A bucket's name is its address; the form shows the address as it is typed. */
function CreateBucket({
  hero = false,
  regions,
  defaultRegion,
  busy,
  onCreate,
}: {
  hero?: boolean;
  regions: string[];
  defaultRegion: string;
  busy: boolean;
  onCreate: (name: string, scope: string, region: string) => void;
}) {
  const [name, setName] = useState('');
  const [scope, setScope] = useState('default');
  const [region, setRegion] = useState('');
  const id = useId();
  return (
    <form
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        onCreate(name, scope, region || defaultRegion);
        setName('');
      }}
      className="flex flex-col gap-3"
    >
      {hero && (
        <div className="mb-2 flex flex-col gap-2">
          <h2 className="text-lg font-medium">Make your first bucket</h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            A private bucket for this app. Connect it to the app&apos;s code in one step, or reach
            it from any tool that speaks S3.
          </p>
        </div>
      )}
      <p
        aria-live="polite"
        className={cn(
          'storage-address font-mono [overflow-wrap:anywhere]',
          hero ? 'text-3xl sm:text-5xl' : 'text-sm',
          !name && 'text-muted-foreground'
        )}
      >
        s3://{name || 'your-bucket'}
      </p>
      <label className="flex flex-col gap-1 text-sm">
        Bucket name
        <input
          className={cn(FIELD, 'font-mono')}
          required
          pattern="[a-z][a-z0-9-]{0,62}"
          maxLength={63}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="assets"
          spellCheck={false}
        />
      </label>
      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-muted-foreground">Scope and region</summary>
        <div className="mt-3 flex flex-col gap-3">
          <label htmlFor={`${id}-scope`} className="flex flex-col gap-1">
            Environment scope
            <input
              id={`${id}-scope`}
              className={FIELD}
              required
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              maxLength={40}
            />
          </label>
          <label htmlFor={`${id}-region`} className="flex flex-col gap-1">
            Region
            <select
              id={`${id}-region`}
              className={FIELD}
              value={region || defaultRegion}
              onChange={(e) => setRegion(e.target.value)}
            >
              {regions.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
        </div>
      </details>
      <Button type="submit" disabled={busy} className="self-start">
        Create bucket
      </Button>
    </form>
  );
}

function BucketDetail({
  slug,
  bucket,
  tab,
  prefix,
  onChange,
  enabled,
  maxBytes,
  onDelete,
  deleting,
}: {
  slug: string;
  bucket: ObjectBucket;
  tab: StorageTab;
  prefix: string;
  onChange: (next: Omit<StorageSelection, 'bucket'>, options?: { replace?: boolean }) => void;
  enabled: boolean;
  maxBytes: number;
  onDelete: () => void;
  deleting: boolean;
}) {
  const panelId = useId();
  const bindings = useBucketBindings(slug, bucket.id);
  const grants = useBucketAccessGrants(slug, bucket.id);
  const credentials = useBucketS3Credentials(slug, bucket.id);
  const connections = useMemo(
    () =>
      accessModel({
        bindings: bindings.data?.items ?? [],
        grants: grants.data?.items ?? [],
        credentials: credentials.data?.items ?? [],
      }),
    [bindings.data, grants.data, credentials.data]
  );
  const bindingCredentials = useMemo(
    () => new Set((bindings.data?.items ?? []).map((b) => b.credential.id)),
    [bindings.data]
  );
  const openConnection = (_connection: AccessConnection) => onChange({ tab: 'code' });

  return (
    <div className="flex flex-col gap-6">
      <AccessMap
        bucket={bucket.name}
        app={slug}
        connections={connections}
        onSelect={openConnection}
        onConnect={() => onChange({ tab: 'code' })}
      />
      <Tabs
        label={`${bucket.name} sections`}
        value={tab}
        options={TABS}
        onChange={(next) => onChange({ tab: next })}
        panelId={panelId}
      />
      <div id={panelId} role="tabpanel" aria-labelledby={tabId(panelId, tab)}>
        {tab === 'objects' && (
          <ObjectBrowser
            slug={slug}
            bucket={bucket}
            prefix={prefix}
            onPrefix={(next, options) =>
              onChange({ tab: 'objects', prefix: next || undefined }, options)
            }
            maxBytes={maxBytes}
            signingEnabled={enabled}
          />
        )}
        {tab === 'code' && (
          <div className="flex flex-col gap-10">
            <CodeAccess slug={slug} bucketId={bucket.id} bucketName={bucket.name} />
            <section className="flex flex-col gap-4">
              <div>
                <h3 className="text-base font-medium">From outside Gregale</h3>
                <p className="mt-1 max-w-prose text-sm text-muted-foreground">
                  For a laptop, CI or another cloud: give an API key access, or make an S3 key for
                  any tool that speaks S3.
                </p>
              </div>
              <BucketAccess
                slug={slug}
                bucketId={bucket.id}
                provisioningEnabled={enabled}
                hiddenCredentials={bindingCredentials}
              />
            </section>
          </div>
        )}
        {tab === 'settings' && (
          <BucketSettings slug={slug} bucket={bucket} onDelete={onDelete} deleting={deleting} />
        )}
      </div>
    </div>
  );
}

function ObjectBrowser({
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
  onPrefix: (prefix: string, options?: { replace?: boolean }) => void;
  maxBytes: number;
  signingEnabled: boolean;
}) {
  const [cursor, setCursor] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [key, setKey] = useState('');
  const [dragging, setDragging] = useState(false);
  const choose = (f: File | null) => {
    setFile(f);
    setKey(f ? `${prefix}${f.name}` : '');
  };
  const writable = useRef(signingEnabled);
  useLayoutEffect(() => {
    writable.current = signingEnabled;
    return () => {
      writable.current = false;
    };
  }, [signingEnabled]);
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
  const goTo = (next: string) => {
    setCursor('');
    onPrefix(next);
  };
  // Typing a prefix is one Back step, not one per keystroke: the first change
  // after the field gains focus pushes, the rest refine that entry.
  const typing = useRef(false);
  const typeTo = (next: string) => {
    setCursor('');
    onPrefix(next, { replace: typing.current });
    typing.current = true;
  };
  const items = useMemo(() => query.data?.items ?? [], [query.data]);
  // The API lists flat keys. Folders are the next path segment among the keys
  // on this page, so a folder with no objects on this page is not shown.
  const folders = useMemo(() => {
    const seen = new Map<string, number>();
    for (const o of items) {
      const rest = o.key.slice(prefix.length);
      const cut = rest.indexOf('/');
      if (cut > 0) {
        const folder = `${prefix}${rest.slice(0, cut + 1)}`;
        seen.set(folder, (seen.get(folder) ?? 0) + 1);
      }
    }
    return [...seen.entries()];
  }, [items, prefix]);
  const files = items.filter((o) => !o.key.slice(prefix.length).includes('/'));

  const upload = async (event: FormEvent) => {
    event.preventDefault();
    if (!file || !signingEnabled) return;
    if (file.size > maxBytes) {
      toast({
        kind: 'error',
        title: `File exceeds the ${formatUploadLimit(maxBytes)} direct upload limit`,
      });
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
    if (!writable.current) return;
    mutation.mutate(async () => {
      if (!writable.current) return;
      const signed = await signStoredObject(slug, bucket.id, {
        method: 'PUT',
        expires_in: 300,
        key,
        size_bytes: file.size,
        content_type: file.type || 'application/octet-stream',
      });
      if (!writable.current)
        throw new Error('Storage availability or selection changed. Upload was not sent.');
      await uploadSignedObject(signed, file);
      toast({ kind: 'success', title: 'Object uploaded' });
    });
  };

  const segments = prefix.split('/').filter(Boolean);

  return (
    <section className="flex flex-col gap-4" aria-label={`Objects in ${bucket.name}`}>
      <nav aria-label="Path" className="storage-path flex flex-wrap items-center font-mono text-sm">
        <button
          type="button"
          onClick={() => goTo('')}
          className="pressable rounded px-1 hover:text-[color:var(--brand)]"
        >
          s3://{bucket.name}/
        </button>
        {segments.map((segment, i) => {
          const target = `${segments.slice(0, i + 1).join('/')}/`;
          const last = i === segments.length - 1;
          return (
            <button
              key={target}
              type="button"
              aria-current={last ? 'location' : undefined}
              onClick={() => goTo(target)}
              className={cn(
                'pressable rounded px-1',
                last ? 'text-foreground' : 'text-muted-foreground hover:text-[color:var(--brand)]'
              )}
            >
              {segment}/
            </button>
          );
        })}
      </nav>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Key prefix
          <input
            className={cn(FIELD, 'font-mono')}
            value={prefix}
            onFocus={() => (typing.current = false)}
            onChange={(e) => typeTo(e.target.value)}
            placeholder="folder/"
            spellCheck={false}
          />
        </label>
        <form
          onSubmit={(e) => void upload(e)}
          className="flex w-full flex-wrap items-end gap-3 lg:ml-auto lg:w-auto"
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
              'storage-drop flex min-w-56 flex-1 cursor-pointer flex-col gap-0.5 rounded-xl border border-dashed px-4 py-2.5 text-xs text-muted-foreground transition-colors',
              dragging ? 'border-[color:var(--brand)] text-foreground' : 'border-border',
              !signingEnabled && 'cursor-not-allowed opacity-60'
            )}
          >
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
                ? `${formatUsageBytes(file.size)}, up to ${formatUploadLimit(maxBytes)}`
                : `Up to ${formatUploadLimit(maxBytes)} in one upload`}
            </span>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Object key
            <input
              className={cn(FIELD, 'font-mono')}
              required
              disabled={!signingEnabled}
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          </label>
          <Button type="submit" disabled={!signingEnabled || !file || mutation.isPending}>
            {mutation.isPending ? 'Working…' : 'Upload'}
          </Button>
        </form>
      </div>

      {query.isPending ? (
        <LoadingState message="Loading objects…" />
      ) : query.error ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          {folders.length > 0 && (
            <ul aria-label="Folders on this page" className="flex flex-wrap gap-2">
              {folders.map(([folder, count]) => (
                <li key={folder}>
                  <button
                    type="button"
                    aria-label={`Open folder ${folder.slice(prefix.length)}`}
                    onClick={() => goTo(folder)}
                    className="storage-folder pressable flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 font-mono text-xs hover:border-[color:var(--brand)]"
                  >
                    {folder.slice(prefix.length)}
                    <span className="text-muted-foreground">{count}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {items.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {prefix
                ? `Nothing under ${prefix} on this page.`
                : 'This bucket is empty. Upload a file to start.'}
            </p>
          )}
          {files.length > 0 && (
            <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
              {files.map((o) => (
                <li
                  key={o.key}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm"
                >
                  <span className="min-w-0 flex-1 break-all font-mono text-xs" title={o.key}>
                    {o.key.slice(prefix.length) || o.key}
                  </span>
                  <span className="w-20 text-right text-xs tabular-nums text-muted-foreground">
                    {formatUsageBytes(o.size_bytes)}
                  </span>
                  <Timestamp
                    value={o.last_modified}
                    className="w-20 text-xs text-muted-foreground"
                  />
                  <span className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Copy link to ${o.key}`}
                      disabled={!signingEnabled || mutation.isPending}
                      onClick={() =>
                        mutation.mutate(async () => {
                          const signed = await signStoredObject(slug, bucket.id, {
                            method: 'GET',
                            expires_in: SHARE_SECONDS,
                            key: o.key,
                          });
                          await navigator.clipboard.writeText(signed.url);
                          toast({
                            kind: 'success',
                            title: 'Link copied',
                            description: `Anyone with it can download ${o.key} for the next 15 minutes.`,
                          });
                        })
                      }
                    >
                      Copy link
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!signingEnabled || mutation.isPending}
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
                  </span>
                </li>
              ))}
            </ul>
          )}
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
