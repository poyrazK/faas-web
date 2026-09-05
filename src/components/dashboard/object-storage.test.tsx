import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { ObjectStorage } from './object-storage';

const mocks = vi.hoisted(() => ({
  buckets: vi.fn(),
  objects: vi.fn(),
  create: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('./app-select', () => ({
  useSelectedApp: () => ({ slug: 'demo', apps: [{ slug: 'demo' }], select: vi.fn() }),
  AppSelect: () => null,
  AppScope: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/api/object-storage', async (original) => ({
  ...(await original<typeof import('@/lib/api/object-storage')>()),
  useObjectBuckets: mocks.buckets,
  useBucketObjects: mocks.objects,
  createObjectBucket: mocks.create,
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
  mocks.buckets.mockReturnValue({ data: capabilities, isPending: false, error: null });
  mocks.objects.mockReturnValue({
    data: { items: [{ key: 'folder/file.txt', size_bytes: 3 }] },
    isPending: false,
    error: null,
  });
  mocks.create.mockResolvedValue(bucket);
});
it('does not offer creation when the operator disables storage', () => {
  mocks.buckets.mockReturnValue({
    data: { ...capabilities, enabled: false, items: [] },
    isPending: false,
  });
  show();
  expect(
    screen.getByText('Object storage has not been enabled by the operator.')
  ).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Create bucket' })).not.toBeInTheDocument();
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
