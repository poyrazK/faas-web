import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { ObjectStorage } from './object-storage';

const mocks = vi.hoisted(() => ({
  buckets: vi.fn(),
  objects: vi.fn(),
  create: vi.fn(),
  sign: vi.fn(),
  toast: vi.fn(),
  capability: vi.fn(),
  confirm: vi.fn(),
  upload: vi.fn(),
  selected: 'demo',
}));
vi.mock('@/lib/api/capabilities', () => ({ useCapability: mocks.capability }));
vi.mock('./app-select', () => ({
  useSelectedApp: () => ({
    slug: mocks.selected,
    apps: [{ slug: mocks.selected }],
    select: vi.fn(),
  }),
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
  mocks.confirm.mockResolvedValue(true);
  mocks.capability.mockReturnValue({ state: 'available', refresh: vi.fn() });
  mocks.buckets.mockReturnValue({ data: capabilities, isPending: false, error: null });
  mocks.objects.mockReturnValue({
    data: { items: [{ key: 'folder/file.txt', size_bytes: 3 }] },
    isPending: false,
    error: null,
  });
  mocks.create.mockResolvedValue(bucket);
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
    fireEvent.change(screen.getByLabelText('File'), {
      target: { files: [new File(['x'], 'report.txt')] },
    });
    fireEvent.submit(screen.getByRole('button', { name: 'Upload' }).closest('form')!);
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
  expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Download' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled();
});
it('describes a custom direct-upload limit without rounding it upward', () => {
  mocks.buckets.mockReturnValue({
    data: { ...capabilities, max_upload_bytes: 1088 * 1024 ** 2 },
    isPending: false,
    error: null,
  });
  show();
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
  expect(screen.getByText('folder/file.txt')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
});
it('rejects files above the single-PUT limit before requesting a signed URL', async () => {
  const user = userEvent.setup();
  mocks.buckets.mockReturnValue({
    data: { ...capabilities, max_upload_bytes: 5 * 1024 ** 4 },
    isPending: false,
    error: null,
  });
  show();
  await user.click(screen.getByRole('button', { name: 'assets' }));
  expect(screen.getByText(/Direct uploads up to 5 GiB\./)).toBeInTheDocument();
  const file = new File(['x'], 'large.img');
  Object.defineProperty(file, 'size', { value: 5 * 1024 ** 3 + 1 });
  const input = screen.getByLabelText('File') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
  expect(input.files?.[0].size).toBe(5 * 1024 ** 3 + 1);
  const upload = screen.getByRole('button', { name: 'Upload' });
  expect(upload).toBeEnabled();
  fireEvent.submit(upload.closest('form')!);
  expect(mocks.toast).toHaveBeenCalledWith({
    kind: 'error',
    title: 'File exceeds the 5 GiB direct upload limit',
  });
  expect(mocks.sign).not.toHaveBeenCalled();
});
