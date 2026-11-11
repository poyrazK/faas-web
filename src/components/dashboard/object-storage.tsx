import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Copy,
  Download,
  EditPencil,
  Folder,
  Label,
  MoreHoriz,
  Page,
  Plus,
  Refresh,
  Search,
  Trash,
  Upload,
} from 'iconoir-react';
import { AppScope, AppSelect, useSelectedApp } from './app-select';
import { ErrorState, LoadingState } from './primitives';
import { HelpTip } from './kit/help-tip';
import { Button } from '@/components/ui/button';
import { CopyIconButton } from '@/components/ui/copy-button';
import { CopyableId } from '@/components/ui/copyable-id';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { Timestamp } from '@/components/ui/timestamp';
import { FIELD, Select } from '@/components/ui/field';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { BucketAccess } from './bucket-access';
import { useCapability, useCapabilityAccess } from '@/lib/api/capabilities';
import { capabilityStage } from '@/lib/capability-state';
import { CapabilityNotice } from './capability-notice';
import { SegmentedControl, Tabs, tabId } from './tabs';
import { AccessSummary } from './storage/access-summary';
import { CodeAccess } from './storage/code-access';
import { BucketSettings } from './storage/bucket-settings';
import { ObjectVersions } from './storage/object-versions';
import { ObjectTags } from './storage/object-tags';
import { MultipartUploads } from './storage/multipart-uploads';
import { UploadRoutes } from './storage/upload-routes';
import { UploadSheet, formatUploadLimit } from './storage/upload-sheet';
import { WriteReceipts } from './storage/write-receipts';
import { CapabilityGate } from './capability-gate';
import { accessModel } from '@/lib/storage-access';
import { formatUsageBytes } from '@/lib/usage-format';
import { cn } from '@/lib/utils';
import {
  bucketKey,
  objectKey,
  createObjectBucket,
  deleteObjectBucket,
  deleteStoredObject,
  signStoredObject,
  useBucketAccessGrants,
  useBucketBindings,
  useBucketObjects,
  useBucketS3Credentials,
  useBucketVersioning,
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

// `objects` stays the URL key so shared links keep working; people read "Files".
const TABS = [
  { key: 'objects', label: 'Files' },
  { key: 'code', label: 'Use from code' },
  { key: 'settings', label: 'Settings' },
] as const;

interface BucketCatalog {
  max_upload_bytes: number;
  max_single_put_bytes?: number;
  max_buckets_per_app: number;
}

/**
 * One signed PUT takes up to the single-upload limit; larger files go in
 * parts, up to the object size limit, where multipart is released.
 */
function uploadLimits(data: BucketCatalog, multipartOn: boolean) {
  const direct = Math.min(
    data.max_single_put_bytes ?? data.max_upload_bytes,
    data.max_upload_bytes,
    MAX_SINGLE_PUT_BYTES
  );
  const parts = multipartOn && data.max_upload_bytes > direct ? data.max_upload_bytes : 0;
  return { direct, parts };
}

/** The preview's limits, in the page's "?" rather than as a line under it. */
function Limits({ data, multipartOn }: { data: BucketCatalog; multipartOn: boolean }) {
  const { direct, parts } = uploadLimits(data, multipartOn);
  return (
    <>
      Preview. Up to {data.max_buckets_per_app} buckets per app.{' '}
      {parts
        ? `Single uploads up to ${formatUploadLimit(direct)}; larger files upload in parts, up to ${formatUploadLimit(parts)}.`
        : `Direct uploads up to ${formatUploadLimit(direct)}.`}{' '}
      Storage billing is not integrated yet.
    </>
  );
}

/**
 * Object storage for one app: what it is and which app it is for, the app's
 * buckets in a side column, and the open bucket — its address, one Upload
 * action, who can reach it in a sentence, then its files, code access and
 * settings.
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
  const multipartOn = useCapabilityAccess('multipart-uploads').access === 'on';
  // The same read the bucket list makes (one request, shared by key): the
  // header's "?" carries the preview's limits once they are known.
  const catalog = useObjectBuckets(app.slug);
  const maturity = availability.capability?.maturity;
  // The page has always called itself a preview; the catalog decides once it says.
  const stage = maturity ? capabilityStage(maturity) : 'Preview';
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
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h1 className="text-xl font-semibold tracking-tight">Object storage</h1>
            {stage && (
              <span className="label-mono rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                {stage}
              </span>
            )}
            {catalog.data && (
              <HelpTip label="About Object storage">
                <Limits data={catalog.data} multipartOn={multipartOn} />
              </HelpTip>
            )}
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Store the files your apps read and write: images, user uploads, backups.
          </p>
        </div>
        {app.apps.length > 0 && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span aria-hidden="true">For</span>
            <AppSelect
              slug={app.slug}
              onSelect={(next) => {
                app.select(next);
                emit({ app: next });
              }}
              apps={app.apps}
            />
          </div>
        )}
      </header>
      {availability.state !== 'available' && (
        <CapabilityNotice
          capability={availability.capability}
          state={availability.state}
          onRetry={availability.refresh}
        />
      )}
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

/** One plain line under a bucket's name, from what the bucket list returns. */
function BucketLine({ bucket }: { bucket: ObjectBucket }) {
  if (bucket.state === 'provisioning') return <>Still being set up</>;
  if (bucket.state === 'deleting') return <>Being deleted</>;
  return (
    <>
      {bucket.public ? 'Public' : 'Private'}
      {bucket.scope && bucket.scope !== 'default' && ` · ${bucket.scope}`}
      {bucket.created_at && (
        <>
          {' · made '}
          <Timestamp value={bucket.created_at} />
        </>
      )}
    </>
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
  const multipartOn = useCapabilityAccess('multipart-uploads').access === 'on';
  const query = useObjectBuckets(slug);
  const cache = useQueryClient();
  const confirm = useConfirm();
  const { toast } = useToast();
  const listId = useId();
  const refresh = () => cache.invalidateQueries({ queryKey: bucketKey(slug) });
  const mutation = useMutation({
    mutationFn: async (task: () => Promise<unknown>) => task(),
    onSuccess: () => void refresh(),
    onError: (error) => {
      toast({ kind: 'error', title: 'Storage operation failed', error: error });
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
  const limits = uploadLimits(data, multipartOn);
  const select = (id: string) => onSelectionChange({ bucket: id });
  const create = (name: string, scope: string, region: string) =>
    mutation.mutate(async () => {
      const created = await createObjectBucket(slug, name, scope, region);
      toast({ kind: 'success', title: `Created ${created.name}` });
      select(created.id);
    });

  if (!data.enabled && data.items.length === 0)
    return availability.state === 'available' ? (
      <p className="text-sm text-muted-foreground">
        Object storage is unavailable on this installation. Contact support for availability.
      </p>
    ) : null;

  if (data.items.length === 0)
    return (
      <section className="storage-first surface rounded-[1.25rem] bg-card p-6 sm:p-10">
        <CreateBucket
          hero
          regions={data.regions}
          defaultRegion={data.default_region}
          busy={mutation.isPending}
          onCreate={create}
        />
      </section>
    );

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <aside aria-labelledby={listId} className="flex flex-col gap-2.5">
        <h2 id={listId} className="bento-label">
          Buckets
        </h2>
        <ul className="flex flex-col gap-2">
          {data.items.map((b) => {
            const open = bucket?.id === b.id;
            const line = `${listId}-${b.id}`;
            return (
              <li
                key={b.id}
                data-open={open ? '' : undefined}
                className="storage-bucket relative flex flex-col gap-1 surface rounded-[1.25rem] bg-card px-4 py-3"
              >
                <button
                  type="button"
                  onClick={() => select(b.id)}
                  aria-current={open ? 'true' : undefined}
                  aria-describedby={line}
                  className="pressable truncate text-left text-sm font-medium after:absolute after:inset-0 after:rounded-[1.25rem] focus-visible:outline-none"
                >
                  {b.name}
                </button>
                <p id={line} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span
                    aria-hidden="true"
                    className={cn(
                      'size-1.5 shrink-0 rounded-full',
                      b.state === 'ready'
                        ? 'bg-[color:var(--status-good)]'
                        : 'bg-[color:var(--status-warning)]'
                    )}
                  />
                  <span className="min-w-0 truncate">
                    <BucketLine bucket={b} />
                  </span>
                </p>
                {b.state !== 'ready' && (
                  <div className="relative z-10 mt-1 flex flex-wrap gap-1.5">
                    {b.state === 'provisioning' && (
                      <Button
                        variant="outline"
                        size="xs"
                        disabled={!data.enabled || mutation.isPending}
                        onClick={() =>
                          mutation.mutate(() => createObjectBucket(slug, b.name, b.scope, b.region))
                        }
                      >
                        Retry setup
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="xs"
                      disabled={mutation.isPending}
                      onClick={async () => {
                        if (await confirmDelete(confirm, b))
                          mutation.mutate(() => deleteObjectBucket(slug, b.id));
                      }}
                    >
                      {b.state === 'deleting' ? 'Retry deletion' : 'Delete bucket'}
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {data.enabled && (
          <details className="storage-new group rounded-[1.25rem] px-4 py-2.5 open:well open:bg-muted/40">
            <summary className="pressable flex w-fit cursor-pointer list-none items-center gap-1.5 rounded text-sm text-muted-foreground group-open:mb-3 hover:text-foreground [&::-webkit-details-marker]:hidden">
              <Plus aria-hidden="true" className="size-4" />
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
      </aside>

      <div className="min-w-0">
        {!bucket ? (
          <p className="storage-pick well rounded-xl bg-muted/40 p-8 text-sm text-muted-foreground">
            Pick a bucket to see its files, who can reach it, and how to use it from code.
          </p>
        ) : bucket.state !== 'ready' ? (
          <section
            aria-label={bucket.name}
            className="flex flex-col gap-2 surface rounded-[1.25rem] bg-card p-5"
          >
            <h2 className="text-2xl font-semibold tracking-tight">{bucket.name}</h2>
            <p className="text-sm text-muted-foreground">
              {bucket.state === 'provisioning'
                ? 'This bucket is still being set up. Retry setup from its card if it does not finish.'
                : 'This bucket is being deleted. Retry deletion from its card if it does not finish.'}
            </p>
            <CopyableId value={bucket.id} label="bucket ID" className="text-muted-foreground" />
          </section>
        ) : (
          <BucketDetail
            key={bucket.id}
            slug={slug}
            bucket={bucket}
            tab={selection.tab ?? 'objects'}
            prefix={selection.prefix ?? ''}
            onChange={(next, options) => onSelectionChange({ bucket: bucket.id, ...next }, options)}
            enabled={data.enabled}
            maxBytes={limits.direct}
            partsMaxBytes={limits.parts}
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
            <Select
              id={`${id}-region`}
              className={FIELD}
              value={region || defaultRegion}
              onChange={(e) => setRegion(e.target.value)}
            >
              {regions.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </Select>
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
  partsMaxBytes,
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
  /** The largest upload in parts, or 0 when multipart is not available. */
  partsMaxBytes: number;
  onDelete: () => void;
  deleting: boolean;
}) {
  const panelId = useId();
  const titleId = useId();
  const [uploading, setUploading] = useState(false);
  const [dropped, setDropped] = useState<File | null>(null);
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
  const openUpload = (file?: File) => {
    if (file) setDropped(file);
    setUploading(true);
  };

  return (
    <div className="flex flex-col gap-6">
      <section
        aria-labelledby={titleId}
        className="flex flex-col gap-4 surface rounded-[1.25rem] bg-card p-5 sm:p-6"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <h2
              id={titleId}
              className="storage-address text-2xl font-semibold leading-tight [overflow-wrap:anywhere] sm:text-3xl"
            >
              {bucket.name}
            </h2>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
              <span className="inline-flex items-center gap-0.5">
                <span className="font-mono text-xs">s3://{bucket.name}</span>
                <CopyIconButton text={`s3://${bucket.name}`} label={`s3://${bucket.name}`} />
              </span>
              <CopyableId value={bucket.id} label="bucket ID" />
            </div>
          </div>
          <Button
            onClick={() => openUpload()}
            disabled={!enabled}
            title={enabled ? undefined : 'Uploads are off while storage is unavailable'}
            className="gap-1.5"
          >
            <Upload aria-hidden="true" className="size-4" />
            Upload files
          </Button>
        </div>
        <div className="border-t border-border pt-4">
          <AccessSummary
            bucket={bucket.name}
            app={slug}
            connections={connections}
            loading={bindings.isPending || grants.isPending || credentials.isPending}
            failed={Boolean(bindings.error || grants.error || credentials.error)}
            onManage={() => onChange({ tab: 'code' })}
          />
        </div>
      </section>
      <UploadSheet
        slug={slug}
        bucket={bucket}
        prefix={prefix}
        open={uploading}
        onClose={() => setUploading(false)}
        initialFile={dropped}
        maxBytes={maxBytes}
        partsMaxBytes={partsMaxBytes}
        signingEnabled={enabled}
      />
      <div className="flex flex-col gap-5">
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
              partsMaxBytes={partsMaxBytes}
              signingEnabled={enabled}
              onUpload={openUpload}
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
              <CapabilityGate capability="signed-urls" title="Uploads from your users">
                <UploadRoutes slug={slug} bucket={bucket} enabled={enabled} />
              </CapabilityGate>
            </div>
          )}
          {tab === 'settings' && (
            <BucketSettings
              slug={slug}
              bucket={bucket}
              enabled={enabled}
              onDelete={onDelete}
              deleting={deleting}
            />
          )}
        </div>
      </div>
    </div>
  );
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

function ObjectBrowser({
  slug,
  bucket,
  prefix,
  onPrefix,
  maxBytes,
  partsMaxBytes,
  signingEnabled,
  onUpload,
}: {
  slug: string;
  bucket: ObjectBucket;
  prefix: string;
  onPrefix: (prefix: string, options?: { replace?: boolean }) => void;
  maxBytes: number;
  partsMaxBytes: number;
  signingEnabled: boolean;
  /** Opens the upload sheet, with a dropped file when there is one. */
  onUpload: (file?: File) => void;
}) {
  const [cursor, setCursor] = useState('');
  const [view, setView] = useState<'current' | 'versions' | 'writes'>('current');
  const [tagged, setTagged] = useState('');
  const [find, setFind] = useState('');
  const [editing, setEditing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const versionsOn = useCapabilityAccess('object-versioning').access === 'on';
  // Write receipts, Object Lock and legal holds share the object-protection capability.
  const protectionOn = useCapabilityAccess('object-protection').access === 'on';
  const showVersions = versionsOn && view === 'versions';
  const showWrites = protectionOn && view === 'writes';
  const views = [
    { key: 'current' as const, label: 'Current files' },
    ...(versionsOn ? [{ key: 'versions' as const, label: 'All versions' }] : []),
    ...(protectionOn ? [{ key: 'writes' as const, label: 'Writes' }] : []),
  ];
  // Read only behind the capability: apid answers its routes 404 when it is off.
  const versioning = useBucketVersioning(slug, versionsOn ? bucket.id : '');
  const deleteKeepsVersions = versioning.data?.observed_status === 'Enabled';
  const query = useBucketObjects(slug, bucket.id, prefix, cursor);
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
  const goTo = (next: string) => {
    setCursor('');
    setFind('');
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
  const more = Boolean(query.data?.next_cursor);
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
  // Find narrows what this page already shows; it does not search the bucket.
  const needle = find.trim().toLowerCase();
  const match = (key: string) => !needle || key.slice(prefix.length).toLowerCase().includes(needle);
  const shownFolders = folders.filter(([folder]) => match(folder));
  const shownFiles = files.filter((o) => match(o.key));

  const segments = prefix.split('/').filter(Boolean);
  const where = `${bucket.name}/${prefix}`;

  const copyLink = (key: string) =>
    mutation.mutate(async () => {
      const signed = await signStoredObject(slug, bucket.id, {
        method: 'GET',
        expires_in: SHARE_SECONDS,
        key,
      });
      await navigator.clipboard.writeText(signed.url);
      toast({
        kind: 'success',
        title: 'Link copied',
        description: `Anyone with it can download ${key} for the next 15 minutes.`,
      });
    });
  const download = (key: string) =>
    mutation.mutate(async () => {
      const signed = await signStoredObject(slug, bucket.id, {
        method: 'GET',
        expires_in: 300,
        key,
      });
      const link = document.createElement('a');
      link.href = signed.url;
      link.rel = 'noreferrer';
      link.referrerPolicy = 'no-referrer';
      link.click();
    });
  const remove = async (key: string) => {
    if (
      await confirm({
        title: `Delete ${key}?`,
        description: deleteKeepsVersions
          ? 'Versioning is on, so a delete marker hides it and its versions are kept. Undelete it from All versions.'
          : 'This cannot be undone through Gregale.',
        confirmLabel: 'Delete object',
        destructive: true,
      })
    )
      mutation.mutate(() => deleteStoredObject(slug, bucket.id, key));
  };

  return (
    <section className="flex flex-col gap-4" aria-label={`Objects in ${bucket.name}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {editing ? (
          <form
            className="flex min-w-0 flex-1 items-center gap-2"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              setEditing(false);
            }}
          >
            <label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground">
              <span className="shrink-0">Key prefix</span>
              <input
                aria-label="Key prefix"
                autoFocus
                className={cn(FIELD, 'min-w-0 flex-1 font-mono')}
                value={prefix}
                onFocus={() => (typing.current = false)}
                onChange={(e) => typeTo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setEditing(false);
                }}
                placeholder="folder/"
                spellCheck={false}
              />
            </label>
            <Button type="submit" size="sm" variant="ghost">
              Done
            </Button>
          </form>
        ) : (
          <div className="flex min-w-0 items-center gap-1">
            <nav
              aria-label="Path"
              className="storage-path flex min-w-0 flex-wrap items-center text-sm"
            >
              <button
                type="button"
                onClick={() => goTo('')}
                aria-label={`${bucket.name}, top level`}
                aria-current={segments.length === 0 ? 'location' : undefined}
                className={cn(
                  'pressable rounded px-1 font-medium',
                  segments.length
                    ? 'text-muted-foreground hover:text-foreground'
                    : 'text-foreground'
                )}
              >
                {bucket.name}
              </button>
              {segments.map((segment, i) => {
                const target = `${segments.slice(0, i + 1).join('/')}/`;
                const last = i === segments.length - 1;
                return (
                  <span key={target} className="flex items-center">
                    <span aria-hidden="true" className="px-0.5 text-muted-foreground/60">
                      /
                    </span>
                    <button
                      type="button"
                      aria-current={last ? 'location' : undefined}
                      onClick={() => goTo(target)}
                      className={cn(
                        'pressable rounded px-1 font-mono',
                        last ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {segment}
                    </button>
                  </span>
                );
              })}
            </nav>
            <button
              type="button"
              aria-label="Go to a key prefix"
              title="Go to a key prefix"
              onClick={() => setEditing(true)}
              className="pressable flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <EditPencil aria-hidden="true" className="size-3.5" />
            </button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {view === 'current' && (
            <label className="storage-find flex h-9 items-center gap-2 well rounded-xl bg-muted/40 px-3 text-sm">
              <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              <input
                aria-label="Find a file"
                placeholder="Find a file"
                value={find}
                onChange={(e) => setFind(e.target.value)}
                spellCheck={false}
                className="w-36 bg-transparent outline-none placeholder:text-muted-foreground sm:w-44"
              />
            </label>
          )}
          {views.length > 1 && (
            <SegmentedControl label="View" value={view} options={views} onChange={setView} />
          )}
        </div>
      </div>

      {showWrites ? (
        <WriteReceipts slug={slug} bucket={bucket} />
      ) : showVersions ? (
        <ObjectVersions
          slug={slug}
          bucket={bucket}
          prefix={prefix}
          onPrefix={goTo}
          maxBytes={maxBytes}
          signingEnabled={signingEnabled}
        />
      ) : query.isPending ? (
        <LoadingState message="Loading files…" />
      ) : query.error ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          {shownFolders.length > 0 && (
            <ul
              aria-label="Folders on this page"
              className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-2"
            >
              {shownFolders.map(([folder, count]) => (
                <li key={folder}>
                  <button
                    type="button"
                    aria-label={`Open folder ${folder.slice(prefix.length)}`}
                    onClick={() => goTo(folder)}
                    className="storage-folder pressable flex w-full items-center gap-3 surface rounded-xl bg-card px-3 py-2.5 text-left"
                  >
                    <Folder aria-hidden="true" className="size-4 shrink-0 text-brand" />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-mono text-xs text-foreground">
                        {folder.slice(prefix.length, -1)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {plural(count, 'file')}
                        {more ? ' on this page' : ''}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {prefix
                ? `Nothing under ${prefix} on this page.`
                : 'This bucket is empty. Upload a file to start.'}
            </p>
          ) : (
            needle &&
            shownFolders.length + shownFiles.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nothing on this page matches “{find.trim()}”.
              </p>
            )
          )}
          {shownFiles.length > 0 && (
            <div className="surface rounded-[1.25rem] bg-card">
              <div
                aria-hidden="true"
                className="storage-file-row hidden border-b border-border px-4 py-2 sm:grid"
              >
                <span />
                <span className="bento-label">Name</span>
                <span className="bento-label text-right">Size</span>
                <span className="bento-label">Changed</span>
                <span />
              </div>
              <ul aria-label={`Files in ${where}`} className="flex flex-col divide-y divide-border">
                {shownFiles.map((o) => (
                  <li key={o.key} className="flex flex-col">
                    <div className="storage-file-row grid items-center px-4 py-2.5 text-sm">
                      <Page aria-hidden="true" className="size-4 text-muted-foreground" />
                      <span className="min-w-0 break-all font-mono text-xs" title={o.key}>
                        {o.key.slice(prefix.length) || o.key}
                      </span>
                      <span className="text-right text-xs tabular-nums text-muted-foreground">
                        {formatUsageBytes(o.size_bytes)}
                      </span>
                      <Timestamp
                        value={o.last_modified}
                        className="hidden text-xs text-muted-foreground sm:block"
                      />
                      <FileActions
                        objectKey={o.key}
                        signingEnabled={signingEnabled}
                        busy={mutation.isPending}
                        tagsOpen={tagged === o.key}
                        onCopyLink={() => copyLink(o.key)}
                        onTags={() => setTagged(tagged === o.key ? '' : o.key)}
                        onDownload={() => download(o.key)}
                        onDelete={() => remove(o.key)}
                      />
                    </div>
                    {tagged === o.key && (
                      <div className="px-4 pb-3">
                        <ObjectTags
                          slug={slug}
                          bucket={bucket}
                          objectKey={o.key}
                          writable={signingEnabled}
                        />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              {(cursor || more) && (
                <>
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={!cursor}
                    onClick={() => setCursor('')}
                  >
                    First page
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={!more}
                    onClick={() => setCursor(query.data?.next_cursor ?? '')}
                  >
                    Next page
                  </Button>
                </>
              )}
            </div>
            <Button
              variant="ghost"
              size="xs"
              className="gap-1.5 text-muted-foreground"
              onClick={() => void query.refetch()}
            >
              <Refresh aria-hidden="true" className="size-3.5" />
              Refresh
            </Button>
          </div>
        </>
      )}
      {view === 'current' && signingEnabled && (
        <button
          type="button"
          onClick={() => onUpload()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) onUpload(file);
          }}
          className={cn(
            'storage-drop pressable rounded-xl border border-dashed px-4 py-4 text-center text-sm text-muted-foreground transition-colors',
            dragging ? 'border-[color:var(--brand)] text-foreground' : 'border-border'
          )}
        >
          Drop a file here to upload it to{' '}
          <span className="font-mono text-foreground">{where}</span>
        </button>
      )}
      {view === 'current' && partsMaxBytes > 0 && <MultipartUploads slug={slug} bucket={bucket} />}
    </section>
  );
}

/** A file's actions, behind one ⋯ so the list reads as files, not buttons. */
function FileActions({
  objectKey: key,
  signingEnabled,
  busy,
  tagsOpen,
  onCopyLink,
  onTags,
  onDownload,
  onDelete,
}: {
  objectKey: string;
  signingEnabled: boolean;
  busy: boolean;
  tagsOpen: boolean;
  onCopyLink: () => void;
  onTags: () => void;
  onDownload: () => void;
  onDelete: () => Promise<void>;
}) {
  // A confirm opened from an item would return focus to the vanished item;
  // send it back to the trigger once the dialog settles.
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        ref={trigger}
        aria-label={`Actions for ${key}`}
        className="pressable flex size-7 items-center justify-center justify-self-end rounded-md text-muted-foreground hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground"
      >
        <MoreHoriz aria-hidden="true" className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={!signingEnabled || busy} onSelect={onCopyLink}>
          <Copy aria-hidden="true" className="size-4" />
          Copy link
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onTags}>
          <Label aria-hidden="true" className="size-4" />
          {tagsOpen ? 'Hide tags' : 'Tags'}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!signingEnabled || busy} onSelect={onDownload}>
          <Download aria-hidden="true" className="size-4" />
          Download
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={busy}
          onSelect={() => void onDelete().finally(() => trigger.current?.focus())}
          className="data-[highlighted]:text-[color:var(--status-critical)]"
        >
          <Trash aria-hidden="true" className="size-4" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
