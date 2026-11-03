import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { MultipartUploads } from './multipart-uploads';
import { UploadRoutes, draftProblem } from './upload-routes';
import { NotificationsSetting, notificationProblems } from './notifications-setting';
import { WriteReceipts } from './write-receipts';

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  uploads: vi.fn(),
  parts: vi.fn(),
  abort: vi.fn(),
  routes: vi.fn(),
  encryptionCaps: vi.fn(),
  saveRoute: vi.fn(),
  deleteRoute: vi.fn(),
  notifications: vi.fn(),
  setNotifications: vi.fn(),
  clearNotifications: vi.fn(),
  receipts: vi.fn(),
  receipt: vi.fn(),
  confirm: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('@/lib/api/capabilities', () => ({ useCapabilityAccess: mocks.access }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => mocks.confirm }));
vi.mock('@/lib/api/object-storage', async (original) => ({
  ...(await original<typeof import('@/lib/api/object-storage')>()),
  useMultipartUploads: mocks.uploads,
  useMultipartParts: mocks.parts,
  abortMultipartUpload: mocks.abort,
  useUploadRoutes: mocks.routes,
  useEncryptionCapabilities: mocks.encryptionCaps,
  saveUploadRoute: mocks.saveRoute,
  deleteUploadRoute: mocks.deleteRoute,
  useBucketNotifications: mocks.notifications,
  setBucketNotifications: mocks.setNotifications,
  clearBucketNotifications: mocks.clearNotifications,
  useWriteReceipts: mocks.receipts,
  useWriteReceipt: mocks.receipt,
}));

const bucket = {
  id: 'bucket-one',
  name: 'assets',
  scope: 'default',
  region: 'us-east-1',
  state: 'ready' as const,
  public: false,
  created_at: '2026-10-01T00:00:00Z',
};
const read = <T,>(data: T) => ({ data, isPending: false, error: null, refetch: vi.fn() });
const wrap = (node: ReactNode) =>
  render(<QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>);
const UPLOAD = 'f1e2d3c4-b5a6-4978-8a7b-6c5d4e3f2a04';
const FN = 'arn:gregale:lambda:us-east-1:acct:function:0b5c3a52-27a4-4b8e-9e3f-0f6c6c2c2a01';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockReturnValue({ access: 'on', refresh: vi.fn() });
  mocks.confirm.mockResolvedValue(true);
  mocks.abort.mockResolvedValue(undefined);
  mocks.uploads.mockReturnValue(
    read({
      items: [
        {
          id: UPLOAD,
          key: 'video.mp4',
          size_bytes: 200 * 1024 ** 2,
          part_size_bytes: 64 * 1024 ** 2,
          part_count: 4,
          content_type: 'video/mp4',
          state: 'active',
          expires_at: '2099-01-01T00:00:00Z',
          created_at: '2026-11-03T00:00:00Z',
        },
      ],
    })
  );
  mocks.parts.mockReturnValue(
    read({
      items: [{ part_number: 1, etag: '"a"', size_bytes: 64 * 1024 ** 2, last_modified: '' }],
    })
  );
  mocks.routes.mockReturnValue(read({ items: [] }));
  mocks.encryptionCaps.mockReturnValue(
    read({ algorithms: ['AES256'], key_ids: [], bucket_defaults: true })
  );
  mocks.saveRoute.mockResolvedValue({ name: 'avatar' });
  mocks.deleteRoute.mockResolvedValue(undefined);
  mocks.notifications.mockReturnValue(read({ bucket_id: 'bucket-one', revision: 0, rules: [] }));
  mocks.setNotifications.mockResolvedValue({ bucket_id: 'bucket-one', revision: 1, rules: [{}] });
  mocks.clearNotifications.mockResolvedValue({ bucket_id: 'bucket-one', revision: 2, rules: [] });
  mocks.receipts.mockReturnValue(read({ items: [] }));
  mocks.receipt.mockReturnValue({ data: undefined, isPending: false, error: null });
});

describe('uploads in parts', () => {
  it('shows how far an unfinished upload got, and aborts it only after a confirm', async () => {
    const user = userEvent.setup();
    wrap(<MultipartUploads slug="demo" bucket={bucket} />);
    expect(screen.getByText('Unfinished')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Parts of video.mp4' }));
    expect(screen.getByText(/Storage has confirmed 1 of 4 parts/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Abort upload of video.mp4' }));
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        destructive: true,
        description: expect.stringMatching(/cannot be resumed/),
      })
    );
    await waitFor(() => expect(mocks.abort).toHaveBeenCalledWith('demo', 'bucket-one', UPLOAD));
  });

  it('says what happens when there are none', () => {
    mocks.uploads.mockReturnValue(read({ items: [] }));
    wrap(<MultipartUploads slug="demo" bucket={bucket} />);
    expect(screen.getByText(/upload in parts automatically/)).toBeInTheDocument();
  });
});

describe('upload routes', () => {
  it('creates a route for this bucket with its policy', async () => {
    const user = userEvent.setup();
    wrap(<UploadRoutes slug="demo" bucket={bucket} enabled />);
    await user.click(screen.getByRole('button', { name: 'New upload route' }));
    await user.type(screen.getByLabelText('Route name'), 'avatar');
    await user.type(screen.getByLabelText('Key prefix'), 'avatars');
    await user.type(screen.getByLabelText('Content types allowed'), 'image/*');
    expect(screen.getByText('/uploads/avatar')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save route' }));
    await waitFor(() =>
      expect(mocks.saveRoute).toHaveBeenCalledWith('demo', {
        name: 'avatar',
        bucket_id: 'bucket-one',
        key_prefix: 'avatars',
        max_bytes: 5 * 1024 ** 2,
        allowed_content_types: ['image/*'],
        enabled: true,
      })
    );
  });

  it('pauses a route without changing its limit, and deletes only after a confirm', async () => {
    const user = userEvent.setup();
    mocks.routes.mockReturnValue(
      read({
        items: [
          {
            id: 'r1',
            name: 'avatar',
            bucket_id: 'bucket-one',
            max_bytes: 5_000_000,
            enabled: true,
            created_at: '',
            updated_at: '',
          },
          {
            id: 'r2',
            name: 'elsewhere',
            bucket_id: 'other-bucket',
            max_bytes: 1,
            enabled: true,
            created_at: '',
            updated_at: '',
          },
        ],
      })
    );
    wrap(<UploadRoutes slug="demo" bucket={bucket} enabled />);
    expect(screen.queryByText('POST /uploads/elsewhere')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Pause upload route avatar' }));
    await waitFor(() =>
      expect(mocks.saveRoute).toHaveBeenCalledWith(
        'demo',
        expect.objectContaining({ name: 'avatar', max_bytes: 5_000_000, enabled: false })
      )
    );
    await user.click(screen.getByRole('button', { name: 'Delete upload route avatar' }));
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        destructive: true,
        description: expect.stringMatching(/stay in the bucket/),
      })
    );
    await waitFor(() => expect(mocks.deleteRoute).toHaveBeenCalledWith('demo', 'avatar'));
  });

  it('checks a route the way apid does', () => {
    const d = { name: 'Avatar', prefix: '', maxMiB: '5', types: '', enabled: true, encryption: '' };
    expect(draftProblem(d)).toMatch(/starts with a letter/);
    expect(draftProblem({ ...d, name: 'avatar', maxMiB: '0' })).toMatch(/above zero/);
    expect(draftProblem({ ...d, name: 'avatar' })).toBe('');
  });
});

describe('change notifications', () => {
  it('adds a rule sending writes under a prefix to a function', async () => {
    const user = userEvent.setup();
    mocks.setNotifications.mockResolvedValue({
      bucket_id: 'bucket-one',
      revision: 1,
      rules: [{ destination: FN, events: ['s3:ObjectCreated:*'] }],
    });
    wrap(<NotificationsSetting slug="demo" bucket={bucket} enabled onEditing={vi.fn()} />);
    expect(screen.getByText('None')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add rules' }));
    await user.click(screen.getByRole('button', { name: 'Add notification rule' }));
    await user.type(screen.getByLabelText('Destination ARN'), FN);
    await user.click(screen.getByLabelText('Deletes'));
    await user.type(screen.getByLabelText('Only keys starting with'), 'uploads/');
    await user.click(screen.getByRole('button', { name: 'Save notification rules' }));
    await waitFor(() =>
      expect(mocks.setNotifications).toHaveBeenCalledWith('demo', 'bucket-one', [
        {
          destination: FN,
          events: ['s3:ObjectCreated:*', 's3:ObjectRemoved:Delete'],
          prefix: 'uploads/',
        },
      ])
    );
  });

  it('keeps managed rules and says saving takes them over', async () => {
    const user = userEvent.setup();
    const managed = { id: 'gregale-compute-1', destination: FN, events: ['s3:ObjectCreated:*'] };
    mocks.notifications.mockReturnValue(
      read({
        bucket_id: 'bucket-one',
        revision: 3,
        managed_rule_ids: ['gregale-compute-1'],
        rules: [managed],
      })
    );
    wrap(<NotificationsSetting slug="demo" bucket={bucket} enabled onEditing={vi.fn()} />);
    expect(screen.getByText("From your app's compute triggers")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add rules' }));
    await user.click(screen.getByRole('button', { name: 'Save notification rules' }));
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ destructive: true, title: 'Take over the rules your app manages?' })
    );
    await waitFor(() =>
      expect(mocks.setNotifications).toHaveBeenCalledWith('demo', 'bucket-one', [managed])
    );
  });

  it('explains a refused destination by its code', async () => {
    const user = userEvent.setup();
    mocks.notifications.mockReturnValue(
      read({
        bucket_id: 'bucket-one',
        revision: 1,
        rules: [{ destination: FN, events: ['s3:ObjectCreated:*'] }],
      })
    );
    mocks.setNotifications.mockRejectedValue(
      new ApiError({ status: 400, code: 'validation_failed', title: 'Validation failed' } as never)
    );
    wrap(<NotificationsSetting slug="demo" bucket={bucket} enabled onEditing={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Edit rules' }));
    await user.click(screen.getByRole('button', { name: 'Save notification rules' }));
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({
          description: expect.stringMatching(/your own function or queue/),
        })
      )
    );
  });

  it('removing every rule asks first', async () => {
    const user = userEvent.setup();
    mocks.notifications.mockReturnValue(
      read({
        bucket_id: 'bucket-one',
        revision: 1,
        rules: [{ destination: FN, events: ['s3:ObjectCreated:*'] }],
      })
    );
    wrap(<NotificationsSetting slug="demo" bucket={bucket} enabled onEditing={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Edit rules' }));
    await user.click(screen.getByRole('button', { name: 'Remove notification rule 1' }));
    await user.click(screen.getByRole('button', { name: 'Save notification rules' }));
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ destructive: true }));
    await waitFor(() =>
      expect(mocks.clearNotifications).toHaveBeenCalledWith('demo', 'bucket-one')
    );
  });

  it('refuses a destination that is not a Gregale function or queue', () => {
    const [problems] = notificationProblems([
      { id: '', destination: 'arn:aws:lambda:x', events: [], prefix: '', suffix: '' },
    ]);
    expect(problems[0]).toMatch(/function ARN/);
    expect(problems).toContain('Choose at least one event.');
  });
});

describe('write receipts', () => {
  it('filters by status and explains a failed write by its code', async () => {
    const user = userEvent.setup();
    mocks.receipts.mockImplementation((_s: string, _b: string, status: string) =>
      read({
        items:
          status === 'failed'
            ? [
                {
                  id: 'r-1',
                  bucket_id: 'bucket-one',
                  key: 'avatars/1.png',
                  operation: 'put',
                  bytes: 10,
                  content_type: 'image/png',
                  etag: '',
                  status: 'failed',
                  error_code: 'provider_write_rejected',
                  created_at: '2026-11-03T00:00:00Z',
                },
              ]
            : [],
      })
    );
    wrap(<WriteReceipts slug="demo" bucket={bucket} />);
    expect(screen.getByText('No writes are waiting on storage.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Failed' }));
    const list = screen.getByRole('list', { name: 'Failed receipts' });
    expect(within(list).getByText('Storage refused the write.')).toBeInTheDocument();
    expect(mocks.receipts).toHaveBeenLastCalledWith('demo', 'bucket-one', 'failed', '');
  });

  it('looks up one receipt by its ID', async () => {
    const user = userEvent.setup();
    mocks.receipt.mockImplementation((_s: string, _b: string, id: string) =>
      id
        ? read({
            id,
            bucket_id: 'bucket-one',
            key: 'big.bin',
            operation: 'upload',
            bytes: 10,
            content_type: '',
            etag: '"e"',
            status: 'completed',
            created_at: '2026-11-03T00:00:00Z',
          })
        : { data: undefined, isPending: false, error: null }
    );
    wrap(<WriteReceipts slug="demo" bucket={bucket} />);
    await user.type(screen.getByLabelText('Receipt ID'), 'abc');
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    const found = screen.getByRole('list', { name: 'Receipt found' });
    expect(within(found).getByText('Completed')).toBeInTheDocument();
    expect(mocks.receipt).toHaveBeenLastCalledWith('demo', 'bucket-one', 'abc');
  });
});
