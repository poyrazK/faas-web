import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

const state = vi.hoisted(() => ({
  app: {
    data: { require_signed: false } as { require_signed: boolean } | undefined,
    isPending: false,
  },
  signers: {
    data: undefined as
      { signers: { name: string; added_at: string; added_by: string }[] } | undefined,
    isPending: false,
    error: null as unknown,
    refetch: vi.fn(),
  },
  setSecurity: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  confirm: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('@/lib/api/queries', () => ({
  useApp: () => state.app,
  useTrustedSigners: () => state.signers,
  useSetAppSecurity: () => ({ mutateAsync: state.setSecurity, isPending: false }),
  usePutTrustedSigner: () => ({ mutateAsync: state.put, isPending: false }),
  useDeleteTrustedSigner: () => ({ mutateAsync: state.del, isPending: false }),
}));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => state.confirm }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: state.toast }) }));

const { SupplyChainPanel } = await import('./supply-chain-panel');

const publisher = {
  name: 'release-ci',
  added_at: '2026-10-30T09:00:00Z',
  added_by: 'demo@acme-corp.dev',
};

function show(requireSigned: boolean, signers = [publisher]) {
  state.app = { data: { require_signed: requireSigned }, isPending: false };
  state.signers = { ...state.signers, data: { signers }, isPending: false, error: null };
  return render(<SupplyChainPanel slug="alpha" />);
}

beforeEach(() => {
  state.setSecurity.mockReset().mockResolvedValue(undefined);
  state.put.mockReset().mockResolvedValue(undefined);
  state.del.mockReset().mockResolvedValue(undefined);
  state.confirm.mockReset().mockResolvedValue(true);
  state.toast.mockReset();
});

it('opens with the state: any image, and how many publishers are set up', () => {
  show(false);
  expect(
    screen.getByText('Any image can be deployed. 1 trusted publisher is set up.')
  ).toBeInTheDocument();
  expect(screen.getByRole('list', { name: 'Trusted publishers' })).toHaveTextContent('release-ci');
});

it('says only signed images deploy when signatures are required', () => {
  show(true);
  expect(
    screen.getByText('Only images signed by a trusted publisher can be deployed.')
  ).toBeInTheDocument();
});

it('warns before the toggle is turned on with no publisher', () => {
  show(false, []);
  expect(
    screen.getByText('Any image can be deployed. No trusted publisher is set up yet.')
  ).toBeInTheDocument();
  expect(screen.getByText(/Add a trusted publisher first/)).toBeInTheDocument();
});

it('says every deploy is refused when required with no publisher', () => {
  show(true, []);
  expect(screen.getByText(/so every image deploy is refused/)).toBeInTheDocument();
});

it('keeps the add form in a sheet behind "Add publisher"', async () => {
  show(false);
  expect(screen.queryByLabelText('Public key (PEM)')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Add publisher' }));
  const sheet = await screen.findByRole('dialog');
  await userEvent.type(within(sheet).getByLabelText('Name'), 'ci');
  await userEvent.type(within(sheet).getByLabelText('Public key (PEM)'), 'PEM');
  await userEvent.click(within(sheet).getByRole('button', { name: 'Add publisher' }));
  await waitFor(() => expect(state.put).toHaveBeenCalledWith({ name: 'ci', publicKeyPem: 'PEM' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

it('removes a publisher only after a destructive confirm', async () => {
  show(true);
  await userEvent.click(screen.getByRole('button', { name: 'Remove publisher release-ci' }));
  expect(state.confirm).toHaveBeenCalledWith(expect.objectContaining({ destructive: true }));
  await waitFor(() => expect(state.del).toHaveBeenCalledWith('release-ci'));
});

it('turns signed deploys on from the switch', async () => {
  show(false);
  await userEvent.click(screen.getByRole('switch', { name: 'Require signed deploys' }));
  await waitFor(() => expect(state.setSecurity).toHaveBeenCalledWith(true));
});

it('reports a failed publisher read, with a retry', () => {
  state.app = { data: { require_signed: false }, isPending: false };
  state.signers = {
    ...state.signers,
    data: undefined,
    isPending: false,
    error: new ApiError({ status: 500, code: 'internal', title: 'boom', detail: 'boom' }),
  };
  render(<SupplyChainPanel slug="alpha" />);
  expect(screen.getByText('Any image can be deployed.')).toBeInTheDocument();
  expect(screen.getByRole('alert')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
});
