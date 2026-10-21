import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CodeAccess } from './code-access';

const mocks = vi.hoisted(() => ({
  bindings: [] as unknown[],
  create: vi.fn(),
  rotate: vi.fn(),
  revoke: vi.fn(),
  confirm: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => mocks.confirm }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/lib/api/object-storage', async (original) => ({
  ...(await original<typeof import('@/lib/api/object-storage')>()),
  useBucketBindings: () => ({
    data: { items: mocks.bindings },
    isPending: false,
    error: null,
    refetch: vi.fn(),
  }),
  createBucketBinding: mocks.create,
  rotateBucketBinding: mocks.rotate,
  revokeBucketBinding: mocks.revoke,
}));

const keys = (prefix: string) => ({
  endpoint: `${prefix}_ENDPOINT`,
  region: `${prefix}_REGION`,
  bucket: `${prefix}_BUCKET`,
  access_key_id: `${prefix}_ACCESS_KEY_ID`,
  secret_access_key: `${prefix}_SECRET_ACCESS_KEY`,
  addressing_style: `${prefix}_ADDRESSING_STYLE`,
});

const binding = {
  id: 'b1',
  bucket_id: 'bkt',
  scope: 'default',
  prefix: 'GREGALE_S3_ASSETS',
  credential: {
    id: 'c1',
    bucket_id: 'bkt',
    access_key_id: 'GRGAAAAAAAAAAAAAAAAA',
    label: 'compute',
    permission: 'read',
    status: 'active',
    created_at: '2026-10-01T00:00:00Z',
  },
  secret_keys: keys('GREGALE_S3_ASSETS'),
  rotation_pending: false,
};

function mount() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CodeAccess slug="api-gateway" bucketId="bkt" bucketName="assets" />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  mocks.bindings = [];
  mocks.create.mockReset().mockResolvedValue({ ...binding, id: 'b2' });
  mocks.rotate.mockReset().mockResolvedValue({ ...binding, rotation_pending: true });
  mocks.revoke.mockReset().mockResolvedValue(undefined);
  mocks.confirm.mockReset().mockResolvedValue(true);
  mocks.toast.mockReset();
});

describe('Use from code', () => {
  it('previews the exact variable names before anything is created', async () => {
    const user = userEvent.setup();
    mount();
    const form = screen.getByRole('form', { name: 'Connect api-gateway to assets' });
    expect(within(form).getByText('GREGALE_S3_ASSETS_SECRET_ACCESS_KEY')).toBeInTheDocument();
    await user.type(within(form).getByLabelText(/Variable prefix/), 'MEDIA');
    expect(within(form).getByText('MEDIA_ENDPOINT')).toBeInTheDocument();
  });

  it('connects the app with least privilege by default, sending no prefix unless one is typed', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Connect api-gateway' }));
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith('api-gateway', 'bkt', { permission: 'read' })
    );
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringMatching(/connected/i) })
    );
  });

  it('refuses a prefix the API would reject, before sending it', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByLabelText(/Variable prefix/), 'media-1');
    await user.click(screen.getByRole('button', { name: 'Connect api-gateway' }));
    expect(screen.getByText(/UPPER_SNAKE_CASE/)).toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('shows code that reads the injected variables, in Node and Python', async () => {
    const user = userEvent.setup();
    mocks.bindings = [binding];
    mount();
    expect(screen.getByText(/process\.env\.GREGALE_S3_ASSETS_ENDPOINT/)).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Python' }));
    expect(screen.getByText(/os\.environ\["GREGALE_S3_ASSETS_BUCKET"\]/)).toBeInTheDocument();
  });

  it('rotates a binding after saying what happens to running instances', async () => {
    const user = userEvent.setup();
    mocks.bindings = [binding];
    mount();
    await user.click(screen.getByRole('button', { name: 'Rotate GREGALE_S3_ASSETS' }));
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringMatching(/previous key/i) })
    );
    await waitFor(() => expect(mocks.rotate).toHaveBeenCalledWith('api-gateway', 'bkt', 'b1'));
  });

  it('revokes a binding behind a destructive confirm', async () => {
    const user = userEvent.setup();
    mocks.bindings = [binding];
    mount();
    await user.click(screen.getByRole('button', { name: 'Disconnect GREGALE_S3_ASSETS' }));
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ destructive: true }));
    await waitFor(() => expect(mocks.revoke).toHaveBeenCalledWith('api-gateway', 'bkt', 'b1'));
  });
});
