import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { ObjectStorage, type StorageSelection } from './object-storage';

const mocks = vi.hoisted(() => ({
  buckets: vi.fn(),
  objects: vi.fn(),
  create: vi.fn(),
  sign: vi.fn(),
  toast: vi.fn(),
  capability: vi.fn(),
  access: vi.fn(),
  confirm: vi.fn(),
  upload: vi.fn(),
  versioning: vi.fn(),
  remove: vi.fn(),
  lifecycle: vi.fn(),
  versions: vi.fn(),
  multipart: vi.fn(),
  receipts: vi.fn(),
  grants: vi.fn(),
  bindings: vi.fn(),
  selected: 'demo',
  appState: null as null | { slug: string; apps: { slug: string }[]; select: () => void },
}));
vi.mock('@/lib/api/capabilities', () => ({
  useCapability: mocks.capability,
  useCapabilityAccess: mocks.access,
}));
vi.mock('./app-select', () => ({
  useSelectedApp: () =>
    mocks.appState ?? {
      slug: mocks.selected,
      apps: [{ slug: mocks.selected }],
      select: vi.fn(),
    },
  AppSelect: () => null,
  AppScope: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => mocks.confirm }));
vi.mock('@/lib/api/object-storage', async (original) => ({
  ...(await original<typeof import('@/lib/api/object-storage')>()),
  useObjectBuckets: mocks.buckets,
  useBucketObjects: mocks.objects,
  createObjectBucket: mocks.create,
  signStoredObject: mocks.sign,
  uploadSignedObject: mocks.upload,
  deleteObjectBucket: mocks.remove,
  useBucketBindings: mocks.bindings,
  useBucketAccessGrants: mocks.grants,
  useBucketS3Credentials: () => ({ data: { items: [] }, isPending: false, error: null }),
  useBucketVersioning: mocks.versioning,
  useBucketLifecycle: mocks.lifecycle,
  useObjectVersions: mocks.versions,
  useBucketCors: () => ({ data: { rules: [] }, isPending: false, error: null }),
  useBucketEncryption: () => ({ data: { state: 'ready' }, isPending: false, error: null }),
  useEncryptionCapabilities: () => ({
    data: { algorithms: ['AES256'], key_ids: [], bucket_defaults: true },
    isPending: false,
    error: null,
  }),
  useBucketObjectLock: () => ({
    data: { state: 'ready', enabled_required: false, observed_known: true },
    isPending: false,
    error: null,
  }),
  useObjectLockCapabilities: () => ({
    data: { bucket_configuration: true, version_legal_hold: true, version_retention: true },
    isPending: false,
    error: null,
  }),
  useObjectTags: () => ({ data: { tags: { team: 'web' } }, isPending: false, error: null }),
  uploadMultipartObject: mocks.multipart,
  useMultipartUploads: () => ({ data: { items: [] }, isPending: false, error: null }),
  useUploadRoutes: () => ({
    data: {
      items: [
        {
          id: 'route-1',
          name: 'avatar',
          bucket_id: 'bucket-one',
          key_prefix: 'avatars',
          max_bytes: 5242880,
          enabled: true,
          created_at: '2026-10-01T00:00:00Z',
          updated_at: '2026-10-01T00:00:00Z',
        },
      ],
    },
    isPending: false,
    error: null,
  }),
  useBucketNotifications: () => ({
    data: { bucket_id: 'bucket-one', revision: 0, rules: [] },
    isPending: false,
    error: null,
  }),
  useWriteReceipts: mocks.receipts,
  useWriteReceipt: () => ({ data: undefined, isPending: false, error: null }),
}));
vi.mock('@/lib/api/queries', async (original) => ({
  ...(await original<typeof import('@/lib/api/queries')>()),
  useApiKeys: () => ({ data: [], isPending: false, error: null }),
}));
const bucket = {
  id: 'bucket-one',
  name: 'assets',
  scope: 'default',
  region: 'us-east-1',
  state: 'ready',
};
const capabilities = {
  enabled: true,
  items: [bucket],
  regions: ['us-east-1'],
  default_region: 'us-east-1',
  max_upload_bytes: 104857600,
  max_buckets_per_app: 10,
};
/** The upload flow opens from the bucket's one primary action. */
async function openUpload() {
  await userEvent.click(screen.getByRole('button', { name: 'Upload files' }));
  return screen.getByRole('form', { name: 'Upload to assets' });
}
/** Every per-file action sits behind the file's ⋯ menu. */
async function fileAction(key: string, action: string) {
  await userEvent.click(screen.getByRole('button', { name: `Actions for ${key}` }));
  return within(await screen.findByRole('menu')).getByRole('menuitem', { name: action });
}
/** The preview's limits are in the page's "?". */
async function limits() {
  await userEvent.click(screen.getByRole('button', { name: 'About Object storage' }));
}
function show() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ObjectStorage />
    </QueryClientProvider>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.selected = 'demo';
  mocks.appState = null;
  mocks.confirm.mockResolvedValue(true);
  mocks.capability.mockReturnValue({ state: 'available', refresh: vi.fn() });
  mocks.access.mockReturnValue({ access: 'on', refresh: vi.fn() });
  mocks.multipart.mockResolvedValue({});
  mocks.grants.mockReturnValue({ data: { items: [] }, isPending: false, error: null });
  mocks.bindings.mockReturnValue({ data: { items: [] }, isPending: false, error: null });
  mocks.receipts.mockReturnValue({
    data: {
      items: [
        {
          id: '3f2b8c1e-5d4a-4e7b-9a10-6c2d8e4f1a77',
          bucket_id: 'bucket-one',
          key: 'avatars/42.png',
          operation: 'upload',
          bytes: 18231,
          content_type: 'image/png',
          etag: '',
          status: 'pending',
          created_at: '2026-10-01T00:00:00Z',
        },
      ],
    },
    isPending: false,
    error: null,
  });
  mocks.buckets.mockReturnValue({ data: capabilities, isPending: false, error: null });
  mocks.objects.mockReturnValue({
    data: { items: [{ key: 'file.txt', size_bytes: 3 }] },
    isPending: false,
    error: null,
  });
  mocks.create.mockResolvedValue(bucket);
  mocks.versions.mockReturnValue({
    data: {
      items: [
        {
          key: 'gone.txt',
          version_id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c03',
          is_latest: true,
          delete_marker: true,
          size_bytes: 0,
          last_modified: '2026-10-01T00:00:00Z',
        },
      ],
      common_prefixes: [],
    },
    isPending: false,
    error: null,
  });
  mocks.versioning.mockReturnValue({
    data: {
      bucket_id: 'bucket-one',
      desired_status: 'Enabled',
      observed_status: 'Enabled',
      state: 'ready',
      revision: 2,
      versions_required: true,
      updated_at: '2026-10-01T00:00:00Z',
    },
    isPending: false,
    error: null,
  });
  mocks.lifecycle.mockReturnValue({
    data: {
      bucket_id: 'bucket-one',
      revision: 1,
      rules: [
        {
          id: 'expire-tmp',
          status: 'Enabled',
          filter: { prefix: 'tmp/' },
          expiration: { days: 7 },
        },
        { id: 'abort', status: 'Enabled', abort_incomplete_multipart_days: 3 },
      ],
      updated_at: '2026-10-01T00:00:00Z',
    },
    isPending: false,
    error: null,
  });
});
it.each(['runtime-unavailable', 'registry-error', 'app-change', 'account-change'])(
  'blocks a delayed upload confirmation after %s',
  async (reason) => {
    let resolve!: (confirmed: boolean) => void;
    mocks.confirm.mockReturnValue(
      new Promise<boolean>((done) => {
        resolve = done;
      })
    );
    mocks.capability.mockReturnValue({ state: 'available', accountId: 'first', refresh: vi.fn() });
    const client = new QueryClient();
    const view = render(
      <QueryClientProvider client={client}>
        <ObjectStorage />
      </QueryClientProvider>
    );
    await userEvent.click(screen.getByRole('button', { name: 'assets' }));
    const form = await openUpload();
    fireEvent.change(screen.getByLabelText('File'), {
      target: { files: [new File(['x'], 'report.txt')] },
    });
    fireEvent.submit(form);
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    if (reason === 'app-change') mocks.selected = 'other';
    else
      mocks.capability.mockReturnValue({
        state: reason === 'account-change' ? 'available' : reason,
        accountId: reason === 'account-change' ? 'second' : 'first',
        refresh: vi.fn(),
      });
    view.rerender(
      <QueryClientProvider client={client}>
        <ObjectStorage />
      </QueryClientProvider>
    );
    await act(async () => resolve(true));
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  }
);
it('does not offer creation when the operator disables storage', () => {
  mocks.buckets.mockReturnValue({
    data: { ...capabilities, enabled: false, items: [] },
    isPending: false,
  });
  show();
  expect(
    screen.getByText(
      'Object storage is unavailable on this installation. Contact support for availability.'
    )
  ).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Create bucket' })).not.toBeInTheDocument();
});
it('does not create a bucket from stale available storage metadata after registry failure', () => {
  mocks.capability.mockReturnValue({ state: 'registry-error', refresh: vi.fn() });
  show();
  expect(screen.queryByRole('button', { name: 'Create bucket' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Retry capabilities' })).toBeInTheDocument();
  expect(mocks.create).not.toHaveBeenCalled();
});
it('explains runtime availability even if the bucket inventory read fails', () => {
  mocks.capability.mockReturnValue({ state: 'runtime-unavailable', refresh: vi.fn() });
  mocks.buckets.mockReturnValue({ error: new Error('Inventory unavailable'), isPending: false });
  show();
  expect(screen.getByText(/Unavailable on this installation/)).toBeInTheDocument();
});
it('keeps cleanup available when the operator disables storage', async () => {
  const user = userEvent.setup();
  mocks.buckets.mockReturnValue({
    data: {
      ...capabilities,
      enabled: false,
      items: [bucket, { ...bucket, id: 'bucket-two', name: 'pending', state: 'provisioning' }],
    },
    isPending: false,
    error: null,
  });
  show();
  await user.click(screen.getByRole('button', { name: 'assets' }));
  expect(screen.getByRole('region', { name: 'Objects in assets' })).toBeInTheDocument();
  for (const button of screen.getAllByRole('button', { name: 'Delete bucket' }))
    expect(button).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Retry setup' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Upload files' })).toBeDisabled();
  expect(await fileAction('file.txt', 'Delete')).not.toHaveAttribute('aria-disabled');
  const menu = screen.getByRole('menu');
  expect(within(menu).getByRole('menuitem', { name: 'Download' })).toHaveAttribute(
    'aria-disabled',
    'true'
  );
  expect(within(menu).getByRole('menuitem', { name: 'Copy link' })).toHaveAttribute(
    'aria-disabled',
    'true'
  );
});
it('describes a custom direct-upload limit without rounding it upward', async () => {
  mocks.buckets.mockReturnValue({
    data: { ...capabilities, max_upload_bytes: 1088 * 1024 ** 2 },
    isPending: false,
    error: null,
  });
  show();
  await limits();
  expect(screen.getByText(/Direct uploads up to 1088 MiB\./)).toBeInTheDocument();
});
it('creates a bucket using the selected app, scope and region', async () => {
  const user = userEvent.setup();
  show();
  await user.type(screen.getByLabelText('Bucket name'), 'uploads');
  await user.click(screen.getByRole('button', { name: 'Create bucket' }));
  await waitFor(() =>
    expect(mocks.create).toHaveBeenCalledWith('demo', 'uploads', 'default', 'us-east-1')
  );
});
it('opens a ready bucket and exposes object actions', async () => {
  const user = userEvent.setup();
  show();
  await user.click(screen.getByRole('button', { name: 'assets' }));
  expect(screen.getByRole('region', { name: 'Objects in assets' })).toBeInTheDocument();
  expect(screen.getByText('file.txt')).toBeInTheDocument();
  expect(await fileAction('file.txt', 'Download')).toBeInTheDocument();
});
it('rejects files above the single-PUT limit before requesting a signed URL', async () => {
  const user = userEvent.setup();
  mocks.access.mockImplementation((id: string) => ({
    access: id === 'multipart-uploads' ? 'off' : 'on',
    refresh: vi.fn(),
  }));
  mocks.buckets.mockReturnValue({
    data: { ...capabilities, max_upload_bytes: 5 * 1024 ** 4 },
    isPending: false,
    error: null,
  });
  show();
  await user.click(screen.getByRole('button', { name: 'assets' }));
  await limits();
  expect(screen.getByText(/Direct uploads up to 5 GiB\./)).toBeInTheDocument();
  await user.keyboard('{Escape}');
  const form = await openUpload();
  const file = new File(['x'], 'large.img');
  Object.defineProperty(file, 'size', { value: 5 * 1024 ** 3 + 1 });
  const input = screen.getByLabelText('File') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
  expect(input.files?.[0].size).toBe(5 * 1024 ** 3 + 1);
  expect(screen.getByRole('button', { name: 'Upload' })).toBeEnabled();
  fireEvent.submit(form);
  expect(mocks.toast).toHaveBeenCalledWith({
    kind: 'error',
    title: 'File exceeds the 5 GiB direct upload limit',
  });
  expect(mocks.sign).not.toHaveBeenCalled();
});
it('opens a bucket with what is in it and whether it is private, and Upload as the action', () => {
  show();
  expect(screen.getByText('It holds 1 file (3 B) and is private.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Upload files' })).toBeEnabled();
});

it('shows each bucket ID with a copy button that carries the full ID', () => {
  const id = '3f2b8c1e-5d4a-4e7b-9a10-6c2d8e4f1a77';
  mocks.buckets.mockReturnValue({
    data: { ...capabilities, items: [{ ...bucket, id }] },
    isPending: false,
    error: null,
  });
  show();
  // The address and ID sit behind one disclosure under the bucket's sentence.
  expect(screen.queryByText('3f2b8c1e-5d4…')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /address and id/i }));
  expect(screen.getByText('3f2b8c1e-5d4…')).toHaveAttribute('title', id);
  expect(screen.getByRole('button', { name: `Copy: bucket ID ${id}` })).toBeInTheDocument();
});

it('says who can reach the open bucket above its files, code access and settings', async () => {
  const user = userEvent.setup();
  show();
  await user.click(screen.getByRole('button', { name: 'assets' }));
  expect(screen.getByText('Nothing can reach these files yet.')).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Files' })).toHaveAttribute('aria-selected', 'true');
  await user.click(screen.getByRole('tab', { name: 'Use from code' }));
  expect(screen.getByRole('form', { name: 'Connect demo to assets' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'From outside Gregale' })).toBeInTheDocument();
});

it('reports the selection so the page can keep it in the URL', async () => {
  const user = userEvent.setup();
  const onSelectionChange = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ObjectStorage selection={{}} onSelectionChange={onSelectionChange} />
    </QueryClientProvider>
  );
  await user.click(screen.getByRole('button', { name: 'assets' }));
  expect(onSelectionChange.mock.lastCall).toEqual([
    { app: 'demo', bucket: 'bucket-one' },
    undefined,
  ]);
});

type Change = (next: StorageSelection, options?: { replace?: boolean }) => void;
function Routed({ onChange, start }: { onChange: Change; start: StorageSelection }) {
  const [selection, setSelection] = useState(start);
  return (
    <QueryClientProvider client={new QueryClient()}>
      <ObjectStorage
        selection={selection}
        onSelectionChange={(next, options) => {
          onChange(next, options);
          setSelection(next);
        }}
      />
    </QueryClientProvider>
  );
}
const replaced = (change: ReturnType<typeof vi.fn>) =>
  change.mock.calls.map(([, options]) => Boolean(options?.replace));

it('makes a Back step for every folder opened, and one per typed prefix', async () => {
  const user = userEvent.setup();
  mocks.objects.mockReturnValue({
    data: { items: [{ key: 'images/logo.svg', size_bytes: 2048 }] },
    isPending: false,
    error: null,
  });
  const change = vi.fn();
  render(<Routed onChange={change} start={{ bucket: 'bucket-one' }} />);
  await user.click(screen.getByRole('button', { name: 'Open folder images/' }));
  expect(change.mock.lastCall?.[0]).toEqual({
    app: 'demo',
    bucket: 'bucket-one',
    tab: 'objects',
    prefix: 'images/',
  });
  expect(replaced(change)).toEqual([false]);

  change.mockClear();
  await user.click(screen.getByRole('button', { name: 'Go to a key prefix' }));
  const field = screen.getByLabelText('Key prefix');
  await user.clear(field);
  await user.type(field, 'tmp/');
  // The first keystroke steps away from the folder; the rest refine that step.
  expect(replaced(change)).toEqual([false, true, true, true, true]);
  expect(change).toHaveBeenLastCalledWith(
    { app: 'demo', bucket: 'bucket-one', tab: 'objects', prefix: 'tmp/' },
    { replace: true }
  );

  change.mockClear();
  await user.tab();
  await user.click(field);
  await user.type(field, 'x');
  expect(replaced(change)).toEqual([false]);
});

it('swaps the URL of a deleted bucket rather than leaving it one Back away', async () => {
  const user = userEvent.setup();
  mocks.remove.mockResolvedValue(undefined);
  const change = vi.fn();
  render(<Routed onChange={change} start={{ bucket: 'bucket-one', tab: 'settings' }} />);
  await user.click(screen.getByRole('button', { name: 'Delete bucket' }));
  await waitFor(() => expect(change).toHaveBeenLastCalledWith({ app: 'demo' }, { replace: true }));
});

it('opens folders found on the loaded page and shows readable sizes', async () => {
  const user = userEvent.setup();
  mocks.objects.mockReturnValue({
    data: {
      items: [
        { key: 'images/logo.svg', size_bytes: 2048, last_modified: '2026-10-01T00:00:00Z' },
        { key: 'robots.txt', size_bytes: 68, last_modified: '2026-10-01T00:00:00Z' },
      ],
    },
    isPending: false,
    error: null,
  });
  show();
  await user.click(screen.getByRole('button', { name: 'assets' }));
  expect(screen.getByText('68 B')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Open folder images/' }));
  expect(mocks.objects).toHaveBeenLastCalledWith('demo', 'bucket-one', 'images/', '');
});

it('copies a share link that works for 15 minutes', async () => {
  const user = userEvent.setup();
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  mocks.sign.mockResolvedValue({
    url: 'https://s3.example/assets/file.txt?sig',
    method: 'GET',
  });
  show();
  await user.click(screen.getByRole('button', { name: 'assets' }));
  await user.click(await fileAction('file.txt', 'Copy link'));
  await waitFor(() =>
    expect(mocks.sign).toHaveBeenCalledWith('demo', 'bucket-one', {
      method: 'GET',
      expires_in: 900,
      key: 'file.txt',
    })
  );
  await waitFor(() =>
    expect(writeText).toHaveBeenCalledWith('https://s3.example/assets/file.txt?sig')
  );
  expect(mocks.toast).toHaveBeenCalledWith(
    expect.objectContaining({
      title: 'Link copied',
      description: expect.stringMatching(/15 minutes/),
    })
  );
});

it('reads versioning and lifecycle rules in plain words', async () => {
  const user = userEvent.setup();
  show();
  await user.click(screen.getByRole('button', { name: 'assets' }));
  await user.click(screen.getByRole('tab', { name: 'Settings' }));
  expect(screen.getByText('Versioning is on')).toBeInTheDocument();
  expect(
    screen.getByText('Delete objects under tmp/ 7 days after they are written')
  ).toBeInTheDocument();
  expect(screen.getByText('Abort unfinished multipart uploads after 3 days')).toBeInTheDocument();
});

it('invites the first bucket with its address taking shape as you type', async () => {
  const user = userEvent.setup();
  mocks.buckets.mockReturnValue({
    data: { ...capabilities, items: [] },
    isPending: false,
    error: null,
  });
  show();
  expect(screen.getByText('s3://your-bucket')).toBeInTheDocument();
  await user.type(screen.getByLabelText('Bucket name'), 'media');
  expect(screen.getByText('s3://media')).toBeInTheDocument();
});

it('lists a nested object inside its folder, named relative to it', async () => {
  const user = userEvent.setup();
  mocks.objects.mockImplementation((_slug: string, _bucket: string, prefix: string) => ({
    data: {
      items: [
        { key: 'images/logo.svg', size_bytes: 2048, last_modified: '2026-10-01T00:00:00Z' },
      ].filter((o) => o.key.startsWith(prefix)),
    },
    isPending: false,
    error: null,
  }));
  show();
  await user.click(screen.getByRole('button', { name: 'assets' }));
  expect(screen.queryByText('logo.svg')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Open folder images/' }));
  expect(screen.getByText('logo.svg')).toHaveAttribute('title', 'images/logo.svg');
  expect(screen.getByRole('button', { name: 'Actions for images/logo.svg' })).toBeInTheDocument();
});

it('keeps deleting a bucket in its Settings, away from everyday tabs', async () => {
  const user = userEvent.setup();
  mocks.remove.mockResolvedValue(undefined);
  show();
  await user.click(screen.getByRole('button', { name: 'assets' }));
  expect(screen.queryByRole('button', { name: 'Delete bucket' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('tab', { name: 'Settings' }));
  await user.click(screen.getByRole('button', { name: 'Delete bucket' }));
  await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('demo', 'bucket-one'));
});

it('takes a dropped file and names it under the open folder', () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ObjectStorage
        selection={{ bucket: 'bucket-one', prefix: 'images/' }}
        onSelectionChange={vi.fn()}
      />
    </QueryClientProvider>
  );
  const file = new File(['png'], 'photo.png', { type: 'image/png' });
  fireEvent.drop(screen.getByText(/Drop a file here/), { dataTransfer: { files: [file] } });
  // Dropping on the page opens the upload flow with the file already chosen.
  expect(screen.getByRole('form', { name: 'Upload to assets' })).toBeInTheDocument();
  expect(screen.getByLabelText('Object key')).toHaveValue('images/photo.png');
  expect(screen.getByRole('button', { name: 'Upload' })).toBeEnabled();
});

it('opens the first ready bucket when none is chosen yet', () => {
  show();
  expect(screen.getByRole('heading', { name: 'assets' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'assets' })).toHaveAttribute('aria-current', 'true');
});

it('follows a linked app once the app list has loaded', () => {
  const select = vi.fn();
  const apps = [{ slug: 'demo' }];
  mocks.appState = { slug: 'demo', apps, select };
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <ObjectStorage selection={{ app: 'shop' }} onSelectionChange={vi.fn()} />
    </QueryClientProvider>
  );
  expect(select).not.toHaveBeenCalled();
  mocks.appState = { slug: 'demo', apps: [...apps, { slug: 'shop' }], select };
  view.rerender(
    <QueryClientProvider client={new QueryClient()}>
      <ObjectStorage selection={{ app: 'shop' }} onSelectionChange={vi.fn()} />
    </QueryClientProvider>
  );
  expect(select).toHaveBeenCalledWith('shop');
});

it('shows every version, deleted objects included, from the Objects tab', async () => {
  const user = userEvent.setup();
  show();
  expect(screen.queryByText('gone.txt')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'All versions' }));
  expect(screen.getByRole('button', { name: 'Undelete gone.txt' })).toBeInTheDocument();
  expect(mocks.versions).toHaveBeenLastCalledWith('demo', 'bucket-one', '', null);
});

it('offers no version view, and reads no versioning, when the capability is off', () => {
  mocks.access.mockImplementation((id: string) => ({
    access: id === 'object-versioning' ? 'off' : 'on',
    refresh: vi.fn(),
  }));
  show();
  expect(screen.queryByRole('button', { name: 'All versions' })).not.toBeInTheDocument();
  expect(mocks.versioning).not.toHaveBeenCalledWith('demo', 'bucket-one');
});

it('says a delete is undoable when versioning keeps the versions', async () => {
  const user = userEvent.setup();
  mocks.confirm.mockResolvedValue(false);
  show();
  await user.click(await fileAction('file.txt', 'Delete'));
  expect(mocks.confirm).toHaveBeenCalledWith(
    expect.objectContaining({ description: expect.stringMatching(/a delete marker hides it/) })
  );
});

it("opens an object's tags under its row", async () => {
  const user = userEvent.setup();
  show();
  await user.click(await fileAction('file.txt', 'Tags'));
  const tags = screen.getByRole('group', { name: 'Tags on file.txt' });
  expect(within(tags).getByText('team=web')).toBeInTheDocument();
});

it('manages every bucket setting here, with nothing left for a CLI panel', async () => {
  const user = userEvent.setup();
  show();
  await user.click(screen.getByRole('tab', { name: 'Settings' }));
  for (const heading of [
    'Versions',
    'Cleanup rules',
    'Encryption',
    'Object Lock',
    'Browser access (CORS)',
    'Change notifications',
  ])
    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'More in the CLI' })).not.toBeInTheDocument();
});

it('uploads a file above the single-upload limit in parts', async () => {
  mocks.buckets.mockReturnValue({
    data: {
      ...capabilities,
      max_upload_bytes: 5 * 1024 ** 4,
      max_single_put_bytes: 64 * 1024 ** 2,
    },
    isPending: false,
    error: null,
  });
  show();
  await limits();
  expect(
    screen.getByText(/Single uploads up to 64 MiB; larger files upload in parts, up to 5120 GiB\./)
  ).toBeInTheDocument();
  await userEvent.keyboard('{Escape}');
  const form = await openUpload();
  const file = new File(['x'], 'video.mp4', { type: 'video/mp4' });
  Object.defineProperty(file, 'size', { value: 200 * 1024 ** 2 });
  fireEvent.change(screen.getByLabelText('File'), { target: { files: [file] } });
  // A file input cannot be filled by userEvent past `required`; submit the form itself.
  fireEvent.submit(form);
  await waitFor(() =>
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringMatching(/uploads in parts/) })
    )
  );
  await waitFor(() =>
    expect(mocks.multipart).toHaveBeenCalledWith(
      'demo',
      'bucket-one',
      file,
      'video.mp4',
      expect.objectContaining({ protection: undefined })
    )
  );
  expect(mocks.sign).not.toHaveBeenCalled();
});

it('shows tracked writes, pending first, from the Objects tab', async () => {
  const user = userEvent.setup();
  show();
  await user.click(screen.getByRole('button', { name: 'Writes' }));
  const list = screen.getByRole('list', { name: 'Pending receipts' });
  expect(within(list).getByText('avatars/42.png')).toBeInTheDocument();
  expect(within(list).getByText('Pending')).toBeInTheDocument();
  expect(mocks.receipts).toHaveBeenLastCalledWith('demo', 'bucket-one', 'pending', '');
});

it('offers no writes view when object protection is off', () => {
  mocks.access.mockImplementation((id: string) => ({
    access: id === 'object-protection' ? 'off' : 'on',
    refresh: vi.fn(),
  }));
  show();
  expect(screen.queryByRole('button', { name: 'Writes' })).not.toBeInTheDocument();
  expect(mocks.receipts).not.toHaveBeenCalled();
});

it("lists the bucket's upload routes with the code access", async () => {
  const user = userEvent.setup();
  show();
  await user.click(screen.getByRole('tab', { name: 'Use from code' }));
  const routes = screen.getByRole('list', { name: 'Upload routes for assets' });
  expect(within(routes).getByText('POST /uploads/avatar')).toBeInTheDocument();
});

it('explains upload routes, and reads none, when signed URLs are off', async () => {
  const user = userEvent.setup();
  mocks.access.mockImplementation((id: string) => ({
    access: id === 'signed-urls' ? 'off' : 'on',
    refresh: vi.fn(),
  }));
  show();
  await user.click(screen.getByRole('tab', { name: 'Use from code' }));
  const panel = screen
    .getByRole('heading', { name: 'Uploads from your users' })
    .closest('section')!;
  expect(within(panel).getByText('Not enabled for this account')).toBeInTheDocument();
  expect(screen.queryByRole('list', { name: 'Upload routes for assets' })).toBeNull();
});

it('lists unfinished uploads in parts only where multipart is released', async () => {
  mocks.buckets.mockReturnValue({
    data: {
      ...capabilities,
      max_upload_bytes: 5 * 1024 ** 4,
      max_single_put_bytes: 64 * 1024 ** 2,
    },
    isPending: false,
    error: null,
  });
  const view = show();
  expect(screen.getByText('Unfinished uploads (0)')).toBeInTheDocument();
  view.unmount();
  mocks.access.mockImplementation((id: string) => ({
    access: id === 'multipart-uploads' ? 'off' : 'on',
    refresh: vi.fn(),
  }));
  show();
  expect(screen.queryByText(/Unfinished uploads/)).toBeNull();
  await limits();
  expect(screen.getByText(/Direct uploads up to 64 MiB\./)).toBeInTheDocument();
});

it('opens the upload flow from the one primary action, not the page', async () => {
  show();
  expect(screen.queryByLabelText('Object key')).not.toBeInTheDocument();
  const form = await openUpload();
  expect(within(form).getByLabelText('File')).toBeInTheDocument();
  expect(within(form).getByLabelText('Object key')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('File'), {
    target: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] },
  });
  expect(screen.getByLabelText('Object key')).toHaveValue('notes.txt');
  mocks.sign.mockResolvedValue({ url: 'https://s3.example/put', method: 'PUT' });
  mocks.upload.mockResolvedValue(undefined);
  fireEvent.submit(form);
  await waitFor(() =>
    expect(mocks.sign).toHaveBeenCalledWith(
      'demo',
      'bucket-one',
      expect.objectContaining({ method: 'PUT', key: 'notes.txt', size_bytes: 1 })
    )
  );
  await waitFor(() => expect(mocks.upload).toHaveBeenCalled());
  expect(mocks.toast).toHaveBeenCalledWith({ kind: 'success', title: 'Object uploaded' });
});

it('says who can reach the bucket from its grants, keys and binding', () => {
  mocks.bindings.mockReturnValue({
    data: {
      items: [
        {
          id: 'bind-1',
          prefix: 'GREGALE_S3_ASSETS',
          credential: { id: 'cred-1', label: 'app', permission: 'read', status: 'active' },
        },
      ],
    },
    isPending: false,
    error: null,
  });
  mocks.grants.mockReturnValue({
    data: {
      items: [
        { key_id: 'k1', key_label: 'CI deploy', key_status: 'active', permission: 'read' },
        {
          key_id: 'k2',
          key_label: 'nightly-backup',
          key_status: 'active',
          permission: 'read_write',
        },
        { key_id: 'k3', key_label: 'old', key_status: 'revoked', permission: 'read_write' },
      ],
    },
    isPending: false,
    error: null,
  });
  show();
  expect(
    screen.getByText((_, node) =>
      node?.tagName === 'P'
        ? node.textContent ===
          'Your app and two keys can read these files. One key can also change them.'
        : false
    )
  ).toBeInTheDocument();
  const chips = screen.getByRole('list', { name: 'What can reach assets' });
  expect(within(chips).getByText("demo's code")).toBeInTheDocument();
  expect(within(chips).getByText('nightly-backup')).toBeInTheDocument();
  expect(within(chips).getByText('· reads and writes')).toBeInTheDocument();
  expect(within(chips).queryByText('old')).not.toBeInTheDocument();
});

it('keeps the access map one click away and sends Manage access to the code tab', async () => {
  const user = userEvent.setup();
  const change = vi.fn();
  mocks.grants.mockReturnValue({
    data: {
      items: [{ key_id: 'k1', key_label: 'CI deploy', key_status: 'active', permission: 'read' }],
    },
    isPending: false,
    error: null,
  });
  render(<Routed onChange={change} start={{ bucket: 'bucket-one' }} />);
  expect(screen.queryByRole('figure', { name: 'Who can reach assets' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Show map' }));
  expect(screen.getByRole('figure', { name: 'Who can reach assets' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Hide map' })).toHaveAttribute('aria-expanded', 'true');
  await user.click(screen.getByRole('button', { name: 'Manage access' }));
  expect(change).toHaveBeenLastCalledWith(
    { app: 'demo', bucket: 'bucket-one', tab: 'code' },
    undefined
  );
});

it('opens a file menu from the keyboard', async () => {
  const user = userEvent.setup();
  mocks.confirm.mockResolvedValue(false);
  show();
  screen.getByRole('button', { name: 'Actions for file.txt' }).focus();
  await user.keyboard('{Enter}');
  const menu = await screen.findByRole('menu');
  expect(
    within(menu)
      .getAllByRole('menuitem')
      .map((item) => item.textContent)
  ).toEqual(['Copy link', 'Tags', 'Download', 'Delete']);
});

it('finds a file among the ones this page shows', async () => {
  const user = userEvent.setup();
  mocks.objects.mockReturnValue({
    data: {
      items: [
        { key: 'robots.txt', size_bytes: 68 },
        { key: 'manifest.json', size_bytes: 734 },
      ],
    },
    isPending: false,
    error: null,
  });
  show();
  await user.type(screen.getByRole('textbox', { name: 'Find a file' }), 'robot');
  expect(screen.getByText('robots.txt')).toBeInTheDocument();
  expect(screen.queryByText('manifest.json')).not.toBeInTheDocument();
  await user.clear(screen.getByRole('textbox', { name: 'Find a file' }));
  await user.type(screen.getByRole('textbox', { name: 'Find a file' }), 'zzz');
  expect(screen.getByText('Nothing on this page matches “zzz”.')).toBeInTheDocument();
});
