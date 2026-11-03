import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { ObjectVersions } from './object-versions';

const mocks = vi.hoisted(() => ({
  versions: vi.fn(),
  versioning: vi.fn(),
  remove: vi.fn(),
  restore: vi.fn(),
  sign: vi.fn(),
  confirm: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => mocks.confirm }));
vi.mock('@/lib/api/object-storage', async (original) => ({
  ...(await original<typeof import('@/lib/api/object-storage')>()),
  useObjectVersions: mocks.versions,
  useBucketVersioning: mocks.versioning,
  deleteObjectVersion: mocks.remove,
  restoreObjectVersion: mocks.restore,
  signStoredObject: mocks.sign,
}));

const CURRENT = '0b5c3a52-27a4-4b8e-9e3f-0f6c6c2c2a01';
const OLDER = '6d1f0e1a-5b7c-4d2e-8a9b-1c2d3e4f5a02';
const MARKER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c03';
const KEPT = 'f1e2d3c4-b5a6-4978-8a7b-6c5d4e3f2a04';
const page = {
  items: [
    {
      key: 'manifest.json',
      version_id: CURRENT,
      is_latest: true,
      delete_marker: false,
      size_bytes: 734,
      last_modified: '2026-10-30T00:00:00Z',
    },
    {
      key: 'manifest.json',
      version_id: OLDER,
      is_latest: false,
      delete_marker: false,
      size_bytes: 702,
      last_modified: '2026-10-20T00:00:00Z',
    },
    {
      key: 'old-banner.png',
      version_id: MARKER,
      is_latest: true,
      delete_marker: true,
      size_bytes: 0,
      last_modified: '2026-10-29T00:00:00Z',
    },
    {
      key: 'old-banner.png',
      version_id: KEPT,
      is_latest: false,
      delete_marker: false,
      size_bytes: 9_000_000_000,
      last_modified: '2026-10-01T00:00:00Z',
    },
    {
      key: 'legacy.txt',
      version_id: 'null',
      is_latest: true,
      delete_marker: false,
      size_bytes: 12,
      last_modified: '2026-09-01T00:00:00Z',
    },
  ],
  common_prefixes: ['images/'],
};
const bucket = {
  id: 'bucket-one',
  name: 'assets',
  scope: 'default',
  region: 'us-east-1',
  state: 'ready' as const,
  public: false,
  created_at: '2026-10-01T00:00:00Z',
};

function show(onPrefix = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ObjectVersions
        slug="demo"
        bucket={bucket}
        prefix=""
        onPrefix={onPrefix}
        maxBytes={5 * 1024 ** 3}
        signingEnabled
      />
    </QueryClientProvider>
  );
  return onPrefix;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.confirm.mockResolvedValue(true);
  mocks.versions.mockReturnValue({ data: page, isPending: false, error: null, refetch: vi.fn() });
  mocks.versioning.mockReturnValue({
    data: { observed_status: 'Enabled', versions_required: true },
    isPending: false,
    error: null,
  });
  mocks.remove.mockResolvedValue({ version_id: MARKER, delete_marker: true });
  mocks.restore.mockResolvedValue(undefined);
});

it('groups versions by key with state as colour, icon and word', () => {
  show();
  const manifest = screen.getByRole('list', { name: 'Versions of manifest.json' });
  expect(within(manifest).getByText('Current')).toBeInTheDocument();
  expect(within(manifest).getByText('Older')).toBeInTheDocument();
  const banner = screen.getByRole('list', { name: 'Versions of old-banner.png' });
  expect(within(banner).getByText('Deleted')).toBeInTheDocument();
});

it('restores an older version after saying the current one is kept', async () => {
  const user = userEvent.setup();
  show();
  await user.click(
    screen.getByRole('button', { name: `Restore version ${OLDER} of manifest.json` })
  );
  expect(mocks.confirm).toHaveBeenCalledWith(
    expect.objectContaining({
      description: expect.stringMatching(/current version is kept/),
      destructive: false,
    })
  );
  await waitFor(() =>
    expect(mocks.restore).toHaveBeenCalledWith('demo', 'bucket-one', page.items[1])
  );
});

it('warns that a restore replaces the object for good when versioning is off', async () => {
  const user = userEvent.setup();
  mocks.versioning.mockReturnValue({
    data: { observed_status: 'Suspended', versions_required: true },
    isPending: false,
    error: null,
  });
  show();
  await user.click(
    screen.getByRole('button', { name: `Restore version ${OLDER} of manifest.json` })
  );
  expect(mocks.confirm).toHaveBeenCalledWith(
    expect.objectContaining({
      description: expect.stringMatching(/replaced for good/),
      destructive: true,
    })
  );
});

it('undeletes an object by removing its delete marker', async () => {
  const user = userEvent.setup();
  show();
  await user.click(screen.getByRole('button', { name: 'Undelete old-banner.png' }));
  await waitFor(() =>
    expect(mocks.remove).toHaveBeenCalledWith('demo', 'bucket-one', 'old-banner.png', MARKER)
  );
});

it('deletes a version for good only after a destructive confirm', async () => {
  const user = userEvent.setup();
  show();
  await user.click(
    screen.getByRole('button', { name: `Delete version ${OLDER} of manifest.json` })
  );
  expect(mocks.confirm).toHaveBeenCalledWith(
    expect.objectContaining({
      destructive: true,
      description: expect.stringMatching(/cannot be undone or restored/),
    })
  );
  await waitFor(() =>
    expect(mocks.remove).toHaveBeenCalledWith('demo', 'bucket-one', 'manifest.json', OLDER)
  );
});

it('keeps a dismissed delete from reaching the API', async () => {
  const user = userEvent.setup();
  mocks.confirm.mockResolvedValue(false);
  show();
  await user.click(
    screen.getByRole('button', { name: `Delete version ${OLDER} of manifest.json` })
  );
  expect(mocks.remove).not.toHaveBeenCalled();
});

it('downloads an exact version through a signed URL', async () => {
  const user = userEvent.setup();
  mocks.sign.mockResolvedValue({ url: 'https://s3.example/x?sig', method: 'GET' });
  show();
  await user.click(
    screen.getByRole('button', { name: `Download version ${OLDER} of manifest.json` })
  );
  await waitFor(() =>
    expect(mocks.sign).toHaveBeenCalledWith('demo', 'bucket-one', {
      method: 'GET',
      expires_in: 300,
      key: 'manifest.json',
      version_id: OLDER,
    })
  );
});

it('does not offer a signed read of data written while versioning was off', () => {
  show();
  const legacy = screen.getByRole('list', { name: 'Versions of legacy.txt' });
  expect(within(legacy).getByText('Written while versioning was off')).toBeInTheDocument();
  expect(within(legacy).queryByRole('button', { name: /Download|Restore/ })).toBeNull();
});

it('points a version too large for one upload away from restore', () => {
  show();
  expect(screen.getByText('Too large to restore here')).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: `Restore version ${KEPT} of old-banner.png` })
  ).toBeNull();
});

it('opens folders from the common prefixes', async () => {
  const user = userEvent.setup();
  const onPrefix = show();
  await user.click(screen.getByRole('button', { name: 'Open folder images/' }));
  expect(onPrefix).toHaveBeenCalledWith('images/');
});

it('pages with both continuation markers', async () => {
  const user = userEvent.setup();
  mocks.versions.mockReturnValue({
    data: { ...page, next_key_marker: 'manifest.json', next_version_id_marker: OLDER },
    isPending: false,
    error: null,
    refetch: vi.fn(),
  });
  show();
  await user.click(screen.getByRole('button', { name: 'Next page' }));
  expect(mocks.versions).toHaveBeenLastCalledWith('demo', 'bucket-one', '', {
    key: 'manifest.json',
    version: OLDER,
  });
});

it('says why there is nothing older when versioning was never on', () => {
  mocks.versioning.mockReturnValue({
    data: { observed_status: '', versions_required: false },
    isPending: false,
    error: null,
  });
  show();
  expect(screen.getByText(/Versioning is off for this bucket/)).toBeInTheDocument();
});
