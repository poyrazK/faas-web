import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const useBucketAccessGrants = vi.fn();
const useBucketS3Credentials = vi.fn();
const useApiKeys = vi.fn();
const setGrant = vi.fn();
const deleteGrant = vi.fn();
const createCredential = vi.fn();
const revokeCredential = vi.fn();
const toast = vi.fn();
const confirm = vi.fn();

vi.mock('@/lib/api/object-storage', () => ({
  grantKey: () => ['grants'],
  s3CredentialKey: () => ['s3'],
  useBucketAccessGrants: (slug: string, bucket: string) =>
    useBucketAccessGrants(slug, bucket) as unknown,
  useBucketS3Credentials: (slug: string, bucket: string) =>
    useBucketS3Credentials(slug, bucket) as unknown,
  setBucketAccessGrant: (...args: unknown[]) => setGrant(...args) as unknown,
  deleteBucketAccessGrant: (...args: unknown[]) => deleteGrant(...args) as unknown,
  createBucketS3Credential: (...args: unknown[]) => createCredential(...args) as unknown,
  revokeBucketS3Credential: (...args: unknown[]) => revokeCredential(...args) as unknown,
}));
vi.mock('@/lib/api/queries', () => ({ useApiKeys: () => useApiKeys() as unknown }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));

const { BucketAccess } = await import('./bucket-access');

const ready = (data: unknown) => ({ data, isPending: false, error: null });
const wrap = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {ui}
  </QueryClientProvider>
);

beforeEach(() => {
  useBucketAccessGrants.mockReset().mockReturnValue(
    ready({
      items: [
        {
          key_id: 'k1',
          key_label: 'ci-deploy',
          key_status: 'revoked',
          permission: 'read',
          created_at: '2026-09-01T00:00:00Z',
          updated_at: '2026-09-01T00:00:00Z',
        },
      ],
    })
  );
  useBucketS3Credentials.mockReset().mockReturnValue(ready({ items: [] }));
  useApiKeys.mockReset().mockReturnValue(
    ready([
      { id: 'k1', label: 'ci-deploy' },
      { id: 'k2', label: 'backup' },
    ])
  );
  setGrant.mockReset().mockResolvedValue({});
  deleteGrant.mockReset().mockResolvedValue({});
  createCredential.mockReset().mockResolvedValue({
    id: 'c1',
    access_key_id: 'GKABC123',
    secret_access_key: 'super-secret-value',
    label: 'backup-runner',
    permission: 'read',
    status: 'active',
  });
  revokeCredential.mockReset().mockResolvedValue({});
  toast.mockReset();
  confirm.mockReset().mockResolvedValue(true);
});

describe('BucketAccess', () => {
  it('disables new grants and credentials without blocking revocation when unavailable', () => {
    render(wrap(<BucketAccess slug="api" bucketId="bucket" provisioningEnabled={false} />));
    expect(screen.getByRole('button', { name: /^grant$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^create$/i })).toBeDisabled();
    expect(screen.getByLabelText('Permission for ci-deploy')).toBeDisabled();
    expect(screen.getByRole('button', { name: /revoke grant for ci-deploy/i })).toBeEnabled();
  });
  it('addresses the bucket by its id, which is what the API path takes', async () => {
    render(wrap(<BucketAccess slug="api" bucketId="b17c0ffee0000000000000000000dead" />));
    await waitFor(() =>
      expect(useBucketAccessGrants).toHaveBeenCalledWith('api', 'b17c0ffee0000000000000000000dead')
    );
    expect(useBucketS3Credentials).toHaveBeenCalledWith('api', 'b17c0ffee0000000000000000000dead');
  });
});

describe('BucketAccess S3 keys owned by an app binding', () => {
  it('leaves out a credential that belongs to an app binding, which is shown as that connection', () => {
    const credential = (id: string, label: string) => ({
      id,
      bucket_id: 'b',
      access_key_id: `GRGA${id}`,
      label,
      permission: 'read',
      status: 'active',
      created_at: '2026-10-01T00:00:00Z',
    });
    useBucketS3Credentials.mockReturnValue(
      ready({ items: [credential('bound', 'compute'), credential('mine', 'ci-backup')] })
    );
    render(wrap(<BucketAccess slug="api" bucketId="b" hiddenCredentials={new Set(['bound'])} />));
    expect(screen.getByText('ci-backup')).toBeInTheDocument();
    expect(screen.queryByText('compute')).not.toBeInTheDocument();
  });
});

describe('BucketAccess grants', () => {
  it('shows the key’s own status beside the grant, since a revoked key grants nothing', () => {
    render(wrap(<BucketAccess slug="api" bucketId="b17c0ffee0000000000000000000dead" />));
    expect(screen.getByText('ci-deploy')).toBeInTheDocument();
    expect(screen.getByText('revoked')).toBeInTheDocument();
  });

  it('offers only keys that do not already have a grant', async () => {
    render(wrap(<BucketAccess slug="api" bucketId="b17c0ffee0000000000000000000dead" />));
    const picker = screen.getByLabelText('API key to grant');
    expect(picker).toHaveValue('k2');
    await userEvent.click(screen.getByRole('button', { name: /^grant$/i }));
    await waitFor(() =>
      expect(setGrant).toHaveBeenCalledWith('api', 'b17c0ffee0000000000000000000dead', 'k2', 'read')
    );
  });

  it('confirms before revoking a grant', async () => {
    render(wrap(<BucketAccess slug="api" bucketId="b17c0ffee0000000000000000000dead" />));
    await userEvent.click(screen.getByRole('button', { name: /revoke grant for ci-deploy/i }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    await waitFor(() =>
      expect(deleteGrant).toHaveBeenCalledWith('api', 'b17c0ffee0000000000000000000dead', 'k1')
    );
  });
});

describe('BucketAccess S3 credentials', () => {
  it('shows the secret once, with a warning that it is not kept', async () => {
    render(wrap(<BucketAccess slug="api" bucketId="b17c0ffee0000000000000000000dead" />));
    await userEvent.type(screen.getByLabelText('Credential label'), 'backup-runner');
    await userEvent.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() =>
      expect(createCredential).toHaveBeenCalledWith(
        'api',
        'b17c0ffee0000000000000000000dead',
        'backup-runner',
        'read'
      )
    );
    expect(await screen.findByText('super-secret-value')).toBeInTheDocument();
    expect(screen.getByText(/shown once/i)).toBeInTheDocument();
  });

  describe('connection details', () => {
    const created = (extra: Record<string, unknown> = {}) => ({
      id: 'c1',
      access_key_id: 'GKABC123',
      secret_access_key: 'super-secret-value',
      label: 'backup-runner',
      permission: 'read',
      status: 'active',
      ...extra,
    });
    async function createOne() {
      const user = userEvent.setup();
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      render(wrap(<BucketAccess slug="api" bucketId="b17c0ffee0000000000000000000dead" />));
      await user.type(screen.getByLabelText('Credential label'), 'backup-runner');
      await user.click(screen.getByRole('button', { name: /create/i }));
      await screen.findByText('super-secret-value');
      return { user, writeText };
    }
    afterEach(() => vi.restoreAllMocks());

    it('shows the endpoint, region and addressing style next to the secret', async () => {
      createCredential.mockResolvedValue(
        created({
          endpoint: 'https://s3.gregale.dev',
          region: 'us-east-1',
          addressing_style: 'path',
        })
      );
      await createOne();
      const status = screen.getByRole('status');
      expect(within(status).getByText('https://s3.gregale.dev')).toBeInTheDocument();
      expect(within(status).getByText('us-east-1')).toBeInTheDocument();
      expect(within(status).getByText('path')).toBeInTheDocument();
    });

    it('copies one env block with the key, secret, endpoint and region', async () => {
      createCredential.mockResolvedValue(
        created({
          endpoint: 'https://s3.gregale.dev',
          region: 'us-east-1',
          addressing_style: 'path',
        })
      );
      const { user, writeText } = await createOne();
      await user.click(screen.getByRole('button', { name: 'Copy: S3 environment variables' }));
      expect(writeText).toHaveBeenCalledWith(
        [
          'AWS_ACCESS_KEY_ID=GKABC123',
          'AWS_SECRET_ACCESS_KEY=super-secret-value',
          'AWS_ENDPOINT_URL_S3=https://s3.gregale.dev',
          'AWS_REGION=us-east-1',
        ].join('\n')
      );
    });

    it('leaves out the lines and fields the response did not include', async () => {
      createCredential.mockResolvedValue(created({ region: 'us-east-1' }));
      const { user, writeText } = await createOne();
      await user.click(screen.getByRole('button', { name: 'Copy: S3 environment variables' }));
      expect(writeText).toHaveBeenCalledWith(
        [
          'AWS_ACCESS_KEY_ID=GKABC123',
          'AWS_SECRET_ACCESS_KEY=super-secret-value',
          'AWS_REGION=us-east-1',
        ].join('\n')
      );
      expect(screen.queryByText('Endpoint')).not.toBeInTheDocument();
      expect(screen.queryByText('Addressing style')).not.toBeInTheDocument();
    });
  });
});
