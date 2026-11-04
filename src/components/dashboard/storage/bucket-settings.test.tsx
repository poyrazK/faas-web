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
  encryption: vi.fn(),
  encryptionCaps: vi.fn(),
  setEncryption: vi.fn(),
  clearEncryption: vi.fn(),
  lock: vi.fn(),
  lockCaps: vi.fn(),
  setLock: vi.fn(),
  cors: vi.fn(),
  setCors: vi.fn(),
  clearCors: vi.fn(),
  notifications: vi.fn(),
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
  useBucketEncryption: mocks.encryption,
  useEncryptionCapabilities: mocks.encryptionCaps,
  setBucketEncryption: mocks.setEncryption,
  clearBucketEncryption: mocks.clearEncryption,
  useBucketObjectLock: mocks.lock,
  useObjectLockCapabilities: mocks.lockCaps,
  setBucketObjectLock: mocks.setLock,
  useBucketCors: mocks.cors,
  setBucketCors: mocks.setCors,
  clearBucketCors: mocks.clearCors,
  useBucketNotifications: mocks.notifications,
}));
const read = <T,>(data: T) => ({ data, isPending: false, error: null, refetch: vi.fn() });
const section = (name: string) => screen.getByRole('heading', { name }).closest('section')!;

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
  mocks.encryption.mockReturnValue(read({ bucket_id: 'bucket-one', state: 'ready', revision: 0 }));
  mocks.encryptionCaps.mockReturnValue(
    read({
      algorithms: ['AES256', 'aws:kms'],
      key_ids: ['arn:gregale:kms:us-east-1:acct:key/app-data'],
      bucket_defaults: true,
    })
  );
  mocks.lock.mockReturnValue(
    read({
      bucket_id: 'bucket-one',
      state: 'ready',
      revision: 0,
      enabled_required: false,
      observed_known: true,
    })
  );
  mocks.lockCaps.mockReturnValue(
    read({
      bucket_configuration: true,
      default_event_hold: false,
      version_event_hold: false,
      write_event_hold: false,
      version_retention: true,
      version_legal_hold: true,
    })
  );
  mocks.cors.mockReturnValue(read({ bucket_id: 'bucket-one', revision: 0, rules: [] }));
  mocks.notifications.mockReturnValue(read({ bucket_id: 'bucket-one', revision: 0, rules: [] }));
});

describe('versioning', () => {
  it('turns versioning on after saying that writes pause', async () => {
    const user = userEvent.setup();
    mocks.setVersioning.mockResolvedValue(versioning({ desired_status: 'Enabled' }).data);
    show();
    expect(within(section('Versions')).getByText('Off')).toBeInTheDocument();
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
    expect(within(section('Versions')).getByText('On')).toBeInTheDocument();
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
    const progress = within(section('Versions')).getByRole('status');
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
    await user.click(within(section('Cleanup rules')).getByRole('button', { name: 'Add rules' }));
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
    await user.click(within(section('Cleanup rules')).getByRole('button', { name: 'Add rules' }));
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
    await user.click(within(section('Cleanup rules')).getByRole('button', { name: 'Add rules' }));
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

describe('encryption', () => {
  it('sets a KMS default from the enrolled keys', async () => {
    const user = userEvent.setup();
    mocks.setEncryption.mockResolvedValue({
      bucket_id: 'bucket-one',
      state: 'waiting',
      revision: 1,
      desired_encryption: {
        algorithm: 'aws:kms',
        key_id: 'arn:gregale:kms:us-east-1:acct:key/app-data',
      },
    });
    show();
    const panel = within(section('Encryption'));
    expect(panel.getByText('Provider default')).toBeInTheDocument();
    await user.click(panel.getByRole('button', { name: 'Set a default' }));
    await user.selectOptions(panel.getByLabelText('Algorithm'), 'aws:kms');
    await user.selectOptions(
      panel.getByLabelText('Key'),
      'arn:gregale:kms:us-east-1:acct:key/app-data'
    );
    await user.click(panel.getByLabelText('Use a bucket key (fewer KMS calls)'));
    await user.click(panel.getByRole('button', { name: 'Save default' }));
    await waitFor(() =>
      expect(mocks.setEncryption).toHaveBeenCalledWith('demo', 'bucket-one', {
        algorithm: 'aws:kms',
        key_id: 'arn:gregale:kms:us-east-1:acct:key/app-data',
        bucket_key_enabled: true,
      })
    );
  });

  it('clears a default only after a destructive confirm', async () => {
    const user = userEvent.setup();
    mocks.encryption.mockReturnValue(
      read({
        bucket_id: 'bucket-one',
        state: 'ready',
        revision: 2,
        encryption: { algorithm: 'AES256' },
      })
    );
    mocks.clearEncryption.mockResolvedValue({
      bucket_id: 'bucket-one',
      state: 'waiting',
      revision: 3,
    });
    show();
    const panel = within(section('Encryption'));
    expect(
      panel.getByText('New objects are encrypted with AES-256, managed by storage.')
    ).toBeInTheDocument();
    await user.click(panel.getByRole('button', { name: 'Clear default' }));
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ destructive: true }));
    await waitFor(() => expect(mocks.clearEncryption).toHaveBeenCalledWith('demo', 'bucket-one'));
  });

  it('explains itself and reads nothing when the capability is off', () => {
    mocks.access.mockImplementation((id: string) => ({
      access: id === 'bucket-encryption' ? 'off' : 'on',
      refresh: vi.fn(),
    }));
    show();
    expect(
      within(section('Encryption')).getByText('Not enabled for this account')
    ).toBeInTheDocument();
    expect(mocks.encryption).not.toHaveBeenCalled();
    expect(mocks.encryptionCaps).not.toHaveBeenCalled();
  });
});

describe('Object Lock', () => {
  it('says plainly that turning it on is permanent, and asks for the bucket name', async () => {
    const user = userEvent.setup();
    mocks.setLock.mockResolvedValue({
      bucket_id: 'bucket-one',
      state: 'waiting',
      revision: 1,
      enabled_required: true,
      observed_known: true,
    });
    show();
    const panel = within(section('Object Lock'));
    await user.click(panel.getByRole('button', { name: 'Turn on Object Lock…' }));
    await user.click(panel.getByRole('button', { name: 'Turn on Object Lock' }));
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        destructive: true,
        typeToConfirm: 'assets',
        description: expect.stringMatching(
          /This is permanent: Object Lock can never be turned off/
        ),
      })
    );
    await waitFor(() =>
      expect(mocks.setLock).toHaveBeenCalledWith('demo', 'bucket-one', { enabled: true })
    );
  });

  it('calls compliance mode irreversible before setting it as the default', async () => {
    const user = userEvent.setup();
    mocks.lock.mockReturnValue(
      read({
        bucket_id: 'bucket-one',
        state: 'ready',
        revision: 1,
        enabled_required: true,
        observed_known: true,
        observed_configuration: { enabled: true },
      })
    );
    mocks.setLock.mockResolvedValue({
      bucket_id: 'bucket-one',
      state: 'waiting',
      revision: 2,
      enabled_required: true,
      observed_known: true,
    });
    show();
    const panel = within(section('Object Lock'));
    expect(panel.getByText('On')).toBeInTheDocument();
    await user.click(panel.getByRole('button', { name: 'Change default retention' }));
    await user.selectOptions(
      panel.getByLabelText('Default retention for new versions'),
      'COMPLIANCE'
    );
    expect(panel.getByText(/This cannot be undone/)).toBeInTheDocument();
    await user.type(panel.getByLabelText('Keep each version for'), '30');
    await user.click(panel.getByRole('button', { name: 'Save default' }));
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        typeToConfirm: 'assets',
        description: expect.stringMatching(
          /Compliance mode cannot be undone.*not you, and not Gregale support/
        ),
      })
    );
    await waitFor(() =>
      expect(mocks.setLock).toHaveBeenCalledWith('demo', 'bucket-one', {
        enabled: true,
        default_retention: { mode: 'COMPLIANCE', days: 30 },
      })
    );
  });

  it('does nothing when the permanent confirm is dismissed', async () => {
    const user = userEvent.setup();
    mocks.confirm.mockResolvedValue(false);
    show();
    const panel = within(section('Object Lock'));
    await user.click(panel.getByRole('button', { name: 'Turn on Object Lock…' }));
    await user.click(panel.getByRole('button', { name: 'Turn on Object Lock' }));
    expect(mocks.setLock).not.toHaveBeenCalled();
  });

  it("says when the bucket's storage has no Object Lock", () => {
    mocks.lock.mockReturnValue({
      data: undefined,
      isPending: false,
      error: new ApiError({
        status: 501,
        code: 'object_storage_unsupported',
        title: 'Not Implemented',
      } as never),
      refetch: vi.fn(),
    });
    show();
    expect(
      within(section('Object Lock')).getByText(
        "Object Lock is not available for this bucket's storage."
      )
    ).toBeInTheDocument();
  });

  it('explains itself and reads nothing when the capability is off', () => {
    mocks.access.mockImplementation((id: string) => ({
      access: id === 'object-protection' ? 'off' : 'on',
      refresh: vi.fn(),
    }));
    show();
    expect(
      within(section('Object Lock')).getByText('Not enabled for this account')
    ).toBeInTheDocument();
    expect(mocks.lock).not.toHaveBeenCalled();
  });
});

describe('CORS', () => {
  it('adds a rule for a site and saves every rule', async () => {
    const user = userEvent.setup();
    mocks.setCors.mockResolvedValue({ bucket_id: 'bucket-one', revision: 1, rules: [] });
    show();
    const panel = within(section('Browser access (CORS)'));
    expect(panel.getByText('Console only')).toBeInTheDocument();
    await user.click(panel.getByRole('button', { name: 'Add rules' }));
    await user.click(panel.getByRole('button', { name: 'Add CORS rule' }));
    await user.type(
      panel.getByLabelText('Allowed origins, one per line'),
      'https://app.example.com'
    );
    await user.type(panel.getByLabelText('Response headers exposed'), 'ETag');
    await user.click(panel.getByRole('button', { name: 'Save CORS rules' }));
    await waitFor(() =>
      expect(mocks.setCors).toHaveBeenCalledWith('demo', 'bucket-one', [
        {
          allowed_origins: ['https://app.example.com'],
          allowed_methods: ['GET', 'PUT'],
          expose_headers: ['ETag'],
        },
      ])
    );
  });

  it('refuses an origin apid would refuse', async () => {
    const user = userEvent.setup();
    show();
    const panel = within(section('Browser access (CORS)'));
    await user.click(panel.getByRole('button', { name: 'Add rules' }));
    await user.click(panel.getByRole('button', { name: 'Add CORS rule' }));
    await user.type(panel.getByLabelText('Allowed origins, one per line'), 'app.example.com');
    await user.click(panel.getByRole('button', { name: 'Save CORS rules' }));
    expect(panel.getByText(/Not an origin: app.example.com/)).toBeInTheDocument();
    expect(mocks.setCors).not.toHaveBeenCalled();
  });

  it('asks before removing every rule, then deletes them', async () => {
    const user = userEvent.setup();
    mocks.cors.mockReturnValue(
      read({
        bucket_id: 'bucket-one',
        revision: 1,
        rules: [{ allowed_origins: ['https://app.example.com'], allowed_methods: ['GET'] }],
      })
    );
    mocks.clearCors.mockResolvedValue(undefined);
    show();
    const panel = within(section('Browser access (CORS)'));
    expect(panel.getByText('GET from https://app.example.com')).toBeInTheDocument();
    await user.click(panel.getByRole('button', { name: 'Edit rules' }));
    await user.click(panel.getByRole('button', { name: 'Remove CORS rule 1' }));
    await user.click(panel.getByRole('button', { name: 'Save CORS rules' }));
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ destructive: true }));
    await waitFor(() => expect(mocks.clearCors).toHaveBeenCalledWith('demo', 'bucket-one'));
  });

  it('explains itself and reads nothing when the capability is off', () => {
    mocks.access.mockImplementation((id: string) => ({
      access: id === 'bucket-cors' ? 'off' : 'on',
      refresh: vi.fn(),
    }));
    show();
    expect(
      within(section('Browser access (CORS)')).getByText('Not enabled for this account')
    ).toBeInTheDocument();
    expect(mocks.cors).not.toHaveBeenCalled();
  });
});

describe('change notifications', () => {
  it('explains itself and reads nothing when the capability is off', () => {
    mocks.access.mockImplementation((id: string) => ({
      access: id === 'object-storage-compute' ? 'off' : 'on',
      refresh: vi.fn(),
    }));
    show();
    expect(
      within(section('Change notifications')).getByText('Not enabled for this account')
    ).toBeInTheDocument();
    expect(mocks.notifications).not.toHaveBeenCalled();
  });
});
