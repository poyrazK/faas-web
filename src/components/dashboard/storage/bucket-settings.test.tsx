import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { BucketSettings } from './bucket-settings';

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  versioning: vi.fn(),
  lifecycle: vi.fn(),
  setVersioning: vi.fn(),
  setLifecycle: vi.fn(),
  clearLifecycle: vi.fn(),
  confirm: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('@/lib/api/capabilities', () => ({ useCapabilityAccess: mocks.access }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => mocks.confirm }));
vi.mock('@/lib/api/object-storage', async (original) => ({
  ...(await original<typeof import('@/lib/api/object-storage')>()),
  useBucketVersioning: mocks.versioning,
  useBucketLifecycle: mocks.lifecycle,
  setBucketVersioning: mocks.setVersioning,
  setBucketLifecycle: mocks.setLifecycle,
  clearBucketLifecycle: mocks.clearLifecycle,
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
const versioning = (over: Record<string, unknown> = {}) => ({
  data: {
    bucket_id: 'bucket-one',
    desired_status: '',
    observed_status: '',
    state: 'ready',
    revision: 0,
    versions_required: false,
    updated_at: '2026-10-01T00:00:00Z',
    ...over,
  },
  isPending: false,
  error: null,
  refetch: vi.fn(),
});
const policy = (rules: unknown[]) => ({
  data: { bucket_id: 'bucket-one', revision: 1, rules, updated_at: '2026-10-01T00:00:00Z' },
  isPending: false,
  error: null,
  refetch: vi.fn(),
});

function show(props: { enabled?: boolean } = {}) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <BucketSettings bucket={bucket} slug="demo" onDelete={vi.fn()} deleting={false} {...props} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockReturnValue({ access: 'on', refresh: vi.fn() });
  mocks.confirm.mockResolvedValue(true);
  mocks.versioning.mockReturnValue(versioning());
  mocks.lifecycle.mockReturnValue(policy([]));
});

describe('versioning', () => {
  it('turns versioning on after saying that writes pause', async () => {
    const user = userEvent.setup();
    mocks.setVersioning.mockResolvedValue(versioning({ desired_status: 'Enabled' }).data);
    show();
    expect(screen.getByText('Off')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Turn on versioning' }));
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Turn on versioning for assets?',
        description: expect.stringMatching(/pause for at least fifteen minutes/),
      })
    );
    await waitFor(() =>
      expect(mocks.setVersioning).toHaveBeenCalledWith('demo', 'bucket-one', 'Enabled')
    );
  });

  it('asks before suspending, as a destructive change', async () => {
    const user = userEvent.setup();
    mocks.versioning.mockReturnValue(
      versioning({ desired_status: 'Enabled', observed_status: 'Enabled' })
    );
    mocks.setVersioning.mockResolvedValue(versioning({ desired_status: 'Suspended' }).data);
    show();
    expect(screen.getByText('On')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Suspend versioning' }));
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ destructive: true, confirmLabel: 'Suspend versioning' })
    );
    await waitFor(() =>
      expect(mocks.setVersioning).toHaveBeenCalledWith('demo', 'bucket-one', 'Suspended')
    );
  });

  it('does nothing when the confirm is dismissed', async () => {
    const user = userEvent.setup();
    mocks.confirm.mockResolvedValue(false);
    show();
    await user.click(screen.getByRole('button', { name: 'Turn on versioning' }));
    expect(mocks.setVersioning).not.toHaveBeenCalled();
  });

  it('follows a change in progress instead of offering another', () => {
    mocks.versioning.mockReturnValue(
      versioning({
        desired_status: 'Enabled',
        state: 'propagating',
        propagation_until: '2026-10-01T00:15:00Z',
        last_error_code: 'provider_uncertain',
      })
    );
    show();
    expect(screen.getByText('Changing')).toBeInTheDocument();
    expect(screen.getByText('Versioning is off, changing to on')).toBeInTheDocument();
    const progress = screen.getByRole('status');
    expect(within(progress).getByText('Propagating the change to storage.')).toBeInTheDocument();
    expect(within(progress).getByText('provider_uncertain')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /versioning/ })).not.toBeInTheDocument();
  });

  it('explains a conflict by its code, not its prose', async () => {
    const user = userEvent.setup();
    const conflict = new ApiError({
      status: 409,
      code: 'object_storage_conflict',
      title: 'Conflict',
      detail: 'Bucket is busy.',
    } as never);
    mocks.versioning.mockReturnValue(
      versioning({ desired_status: 'Enabled', observed_status: 'Enabled' })
    );
    mocks.setVersioning.mockRejectedValue(conflict);
    show();
    await user.click(screen.getByRole('button', { name: 'Suspend versioning' }));
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'error',
          description: expect.stringMatching(/Object Lock keeps versioning on/),
        })
      )
    );
  });

  it('reads but does not change versioning while storage is off', () => {
    show({ enabled: false });
    expect(screen.getByRole('button', { name: 'Turn on versioning' })).toBeDisabled();
  });

  it('explains itself and reads nothing when the capability is off', () => {
    mocks.access.mockImplementation((id: string) => ({
      access: id === 'object-versioning' ? 'off' : 'on',
      refresh: vi.fn(),
    }));
    show();
    const panel = screen.getByRole('heading', { name: 'Versions' }).closest('section')!;
    expect(within(panel).getByText('Not enabled for this account')).toBeInTheDocument();
    expect(mocks.versioning).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Cleanup rules' })).toBeInTheDocument();
  });
});

describe('cleanup rules', () => {
  it('adds a rule and saves the whole policy after a destructive confirm', async () => {
    const user = userEvent.setup();
    mocks.setLifecycle.mockResolvedValue(policy([{ id: 'r', status: 'Enabled' }]).data);
    show();
    await user.click(screen.getByRole('button', { name: 'Add rules' }));
    await user.click(screen.getByRole('button', { name: 'Add rule' }));
    await user.type(screen.getByLabelText('Only keys starting with'), 'tmp/');
    await user.selectOptions(screen.getByLabelText('Current objects'), 'days');
    await user.type(screen.getByLabelText('Days after writing'), '7');
    expect(
      screen.getByText('Delete objects under tmp/ 7 days after they are written')
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save rules' }));
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        destructive: true,
        description: expect.stringMatching(/cannot be recovered/),
      })
    );
    await waitFor(() =>
      expect(mocks.setLifecycle).toHaveBeenCalledWith('demo', 'bucket-one', [
        { status: 'Enabled', filter: { prefix: 'tmp/' }, expiration: { days: 7 } },
      ])
    );
  });

  it('saves a rule that only aborts uploads without asking', async () => {
    const user = userEvent.setup();
    mocks.setLifecycle.mockResolvedValue(policy([]).data);
    show();
    await user.click(screen.getByRole('button', { name: 'Add rules' }));
    await user.click(screen.getByRole('button', { name: 'Add rule' }));
    await user.click(screen.getByLabelText('Abort unfinished multipart uploads'));
    await user.type(screen.getByLabelText('Days after starting'), '3');
    await user.click(screen.getByRole('button', { name: 'Save rules' }));
    expect(mocks.confirm).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(mocks.setLifecycle).toHaveBeenCalledWith('demo', 'bucket-one', [
        { status: 'Enabled', abort_incomplete_multipart_days: 3 },
      ])
    );
  });

  it('shows what is wrong with a rule instead of sending it', async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole('button', { name: 'Add rules' }));
    await user.click(screen.getByRole('button', { name: 'Add rule' }));
    await user.click(screen.getByRole('button', { name: 'Save rules' }));
    expect(screen.getByText('Choose at least one thing for this rule to do.')).toBeInTheDocument();
    expect(mocks.setLifecycle).not.toHaveBeenCalled();
  });

  it('edits the rules it read, and clearing them all asks first', async () => {
    const user = userEvent.setup();
    mocks.lifecycle.mockReturnValue(
      policy([{ id: 'expire-tmp', status: 'Enabled', expiration: { days: 7 } }])
    );
    mocks.clearLifecycle.mockResolvedValue(policy([]).data);
    show();
    await user.click(screen.getByRole('button', { name: 'Edit rules' }));
    expect(screen.getByLabelText('Rule ID')).toHaveValue('expire-tmp');
    await user.click(screen.getByRole('button', { name: 'Remove rule 1' }));
    await user.click(screen.getByRole('button', { name: 'Save rules' }));
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Remove every cleanup rule from assets?',
        destructive: true,
      })
    );
    await waitFor(() => expect(mocks.clearLifecycle).toHaveBeenCalledWith('demo', 'bucket-one'));
  });

  it('names a running scan when apid answers a conflict', async () => {
    const user = userEvent.setup();
    mocks.lifecycle.mockReturnValue(
      policy([{ id: 'abort', status: 'Enabled', abort_incomplete_multipart_days: 2 }])
    );
    mocks.setLifecycle.mockRejectedValue(
      new ApiError({ status: 409, code: 'object_storage_conflict', title: 'Conflict' } as never)
    );
    show();
    await user.click(screen.getByRole('button', { name: 'Edit rules' }));
    await user.click(screen.getByRole('button', { name: 'Save rules' }));
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({ description: expect.stringMatching(/cleanup scan is running/) })
      )
    );
  });

  it('explains itself and reads nothing when the capability is off', () => {
    mocks.access.mockImplementation((id: string) => ({
      access: id === 'object-lifecycle' ? 'off' : 'on',
      refresh: vi.fn(),
    }));
    show();
    const panel = screen.getByRole('heading', { name: 'Cleanup rules' }).closest('section')!;
    expect(within(panel).getByText('Not enabled for this account')).toBeInTheDocument();
    expect(mocks.lifecycle).not.toHaveBeenCalled();
  });
});
