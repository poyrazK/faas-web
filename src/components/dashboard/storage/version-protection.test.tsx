import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { retentionActive, VersionProtection } from './version-protection';

const mocks = vi.hoisted(() => ({
  hold: vi.fn(),
  retention: vi.fn(),
  operation: vi.fn(),
  setHold: vi.fn(),
  setRetention: vi.fn(),
  confirm: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => mocks.confirm }));
vi.mock('@/lib/api/object-storage', async (original) => ({
  ...(await original<typeof import('@/lib/api/object-storage')>()),
  useVersionLegalHold: mocks.hold,
  useVersionRetention: mocks.retention,
  useProtectionOperation: mocks.operation,
  setVersionLegalHold: mocks.setHold,
  setVersionRetention: mocks.setRetention,
}));

const VERSION = '6d1f0e1a-5b7c-4d2e-8a9b-1c2d3e4f5a02';
const OP = '0b5c3a52-27a4-4b8e-9e3f-0f6c6c2c2a01';
const bucket = {
  id: 'bucket-one',
  name: 'assets',
  scope: 'default',
  region: 'us-east-1',
  state: 'ready' as const,
  public: false,
  created_at: '2026-10-01T00:00:00Z',
};
const version = {
  key: 'contracts/2026.pdf',
  version_id: VERSION,
  is_latest: true,
  delete_marker: false,
  size_bytes: 1000,
  last_modified: '2026-10-01T00:00:00Z',
};
const capabilities = {
  bucket_configuration: true,
  default_event_hold: false,
  version_event_hold: true,
  write_event_hold: false,
  version_retention: true,
  version_legal_hold: true,
};
const read = <T,>(data: T) => ({ data, isPending: false, error: null, refetch: vi.fn() });
const operation = (state: string) => ({
  id: OP,
  bucket_id: 'bucket-one',
  key: version.key,
  version_id: VERSION,
  kind: 'legal_hold',
  state,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
});

function show() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <VersionProtection
        slug="demo"
        bucket={bucket}
        version={version}
        capabilities={capabilities}
      />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.confirm.mockResolvedValue(true);
  mocks.hold.mockReturnValue(read({ version_id: VERSION, legal_hold: { status: 'OFF' } }));
  mocks.retention.mockReturnValue(read({ version_id: VERSION, retention: {} }));
  mocks.operation.mockReturnValue({ data: undefined, isPending: false, error: null });
  mocks.setHold.mockResolvedValue(operation('waiting'));
  mocks.setRetention.mockResolvedValue({ ...operation('waiting'), kind: 'retention' });
});

it('places a legal hold and follows the operation until it applies', async () => {
  const user = userEvent.setup();
  show();
  await user.click(screen.getByRole('button', { name: 'Place legal hold' }));
  await waitFor(() =>
    expect(mocks.setHold).toHaveBeenCalledWith('demo', 'bucket-one', version.key, VERSION, 'ON')
  );
  await waitFor(() => expect(mocks.operation).toHaveBeenLastCalledWith('demo', 'bucket-one', OP));
});

it('says when the operation is applied or failed, with colour, icon and word', () => {
  mocks.operation.mockReturnValue(
    read({ ...operation('failed'), last_error_code: 'provider_rejected' })
  );
  show();
  expect(screen.getByText('Failed')).toBeInTheDocument();
  expect(screen.getByText('The legal hold change failed: storage refused it.')).toBeInTheDocument();
});

it('asks before removing a legal hold', async () => {
  const user = userEvent.setup();
  mocks.hold.mockReturnValue(read({ version_id: VERSION, legal_hold: { status: 'ON' } }));
  show();
  await user.click(screen.getByRole('button', { name: 'Remove legal hold' }));
  expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ destructive: true }));
  await waitFor(() =>
    expect(mocks.setHold).toHaveBeenCalledWith('demo', 'bucket-one', version.key, VERSION, 'OFF')
  );
});

it('calls compliance retention irreversible and asks for the key', async () => {
  const user = userEvent.setup();
  show();
  await user.selectOptions(screen.getByLabelText('Mode'), 'COMPLIANCE');
  await user.type(screen.getByLabelText('Retain until (UTC)'), '2099-01-01');
  await user.click(screen.getByRole('button', { name: 'Set retention' }));
  expect(mocks.confirm).toHaveBeenCalledWith(
    expect.objectContaining({
      destructive: true,
      typeToConfirm: version.key,
      description: expect.stringMatching(/Compliance mode cannot be undone/),
    })
  );
  await waitFor(() =>
    expect(mocks.setRetention).toHaveBeenCalledWith('demo', 'bucket-one', version.key, VERSION, {
      mode: 'COMPLIANCE',
      retain_until_date: '2099-01-01T00:00:00Z',
    })
  );
});

it('will not shorten active retention or weaken compliance', async () => {
  const user = userEvent.setup();
  mocks.retention.mockReturnValue(
    read({
      version_id: VERSION,
      retention: { mode: 'COMPLIANCE', retain_until_date: '2099-06-01T00:00:00Z' },
    })
  );
  show();
  expect(screen.getByText('Retained, compliance')).toBeInTheDocument();
  await user.type(screen.getByLabelText('Retain until (UTC)'), '2099-01-01');
  expect(screen.getByText('Active retention cannot be shortened.')).toBeInTheDocument();
  await user.clear(screen.getByLabelText('Retain until (UTC)'));
  await user.type(screen.getByLabelText('Retain until (UTC)'), '2100-01-01');
  expect(
    screen.getByText('Compliance retention cannot be changed to governance.')
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Extend retention' })).toBeDisabled();
});

it('places and releases an event hold where storage is enrolled for it', async () => {
  const user = userEvent.setup();
  show();
  await user.type(screen.getByLabelText('Event hold, then keep for'), '30');
  await user.click(screen.getByRole('button', { name: 'Place event hold' }));
  await waitFor(() =>
    expect(mocks.setRetention).toHaveBeenCalledWith('demo', 'bucket-one', version.key, VERSION, {
      mode: 'GOVERNANCE',
      event_hold: 'ON',
      event_hold_duration: { days: 30 },
    })
  );
  expect(retentionActive({ event_hold: 'ON' })).toBe(true);
  expect(retentionActive({ retain_until_date: '2000-01-01T00:00:00Z' })).toBe(false);
});
