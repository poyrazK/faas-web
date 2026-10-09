import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '@/components/ui/confirm';
import { AppConfiguration } from './app-configuration';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { status } from '@/test/runtime-policy';

const mocks = vi.hoisted(() => ({
  remove: vi.fn(),
  navigate: vi.fn(),
  toast: vi.fn(),
  update: vi.fn(),
}));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@/lib/use-unsaved-guard', () => ({ useUnsavedGuard: () => {} }));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    account: { id: 'account', plan: 'scale', limits: { ram_mb: 1024 } },
    loading: false,
  }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('./app-core-panels', () => ({ RegistryCredentialsPanel: () => null }));
vi.mock('./supply-chain-panel', () => ({ SupplyChainPanel: () => null }));
vi.mock('./app-insights', () => ({ StaticEgressIP: () => null, StreamingCapNote: () => null }));
vi.mock('./app-lifecycle', () => ({ PurgeCacheControl: () => null }));
vi.mock('@/lib/api/queries', () => ({
  retryPolicy: () => false,
  useApp: () => ({
    data: {
      id: 'app-1',
      slug: 'alpha',
      type: 'function',
      runtime: 'node',
      url: 'https://alpha.example.test',
      ram_mb: 256,
      max_concurrency: 1,
      min_instances: 0,
      autoscale_target_rps: 1,
    },
    isPending: false,
    error: null,
  }),
  useUpdateApp: () => ({ mutateAsync: mocks.update, isPending: false }),
  useAppDiff: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRenameApp: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteApp: () => ({ mutateAsync: mocks.remove, isPending: false }),
}));
beforeEach(() => {
  vi.restoreAllMocks();
  mocks.update.mockReset().mockResolvedValue({
    id: 'app-1',
    slug: 'alpha',
    type: 'function',
    ram_mb: 256,
    max_concurrency: 2,
    min_instances: 0,
    autoscale_target_rps: 1,
  });
  mocks.remove.mockReset().mockResolvedValue(undefined);
  mocks.navigate.mockReset();
  mocks.toast.mockReset();
});

describe('App deletion contract copy', () => {
  it('sends only edited fields and reads a new request-policy revision after an accepted save', async () => {
    vi.spyOn(api, 'GET')
      .mockResolvedValueOnce({ data: status, response: new Response() } as never)
      .mockResolvedValue({
        data: {
          ...status,
          request_policy: {
            ...status.request_policy,
            desired_revision: 6,
            state: 'pending',
            pending_gateways: 1,
            applied_gateways: 1,
          },
        },
        response: new Response(),
      } as never);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ConfirmProvider>
          <AppConfiguration slug="alpha" />
        </ConfirmProvider>
      </QueryClientProvider>
    );
    fireEvent.change(screen.getByLabelText(/Max concurrency/), { target: { value: '2' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith({ max_concurrency: 2 }));
    expect(await screen.findByText('Pending')).toBeVisible();
    expect(screen.getByText('Desired revision 6 · App scope')).toBeVisible();
    expect(screen.queryByText('Active')).not.toBeInTheDocument();
  });
  it('explains live policy convergence separately from boot-time memory', () => {
    render(
      <ConfirmProvider>
        <AppConfiguration slug="alpha" />
      </ConfirmProvider>
    );
    expect(screen.queryByText(/Applied on the next wake/)).not.toBeInTheDocument();
    expect(screen.getByText(/Memory requires a fresh instance/)).toBeVisible();
  });
  it('disables memory sizes above the account limit in configuration', () => {
    render(
      <ConfirmProvider>
        <AppConfiguration slug="alpha" />
      </ConfirmProvider>
    );
    expect(screen.getByRole('button', { name: '2048 MB' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '1024 MB' })).toBeEnabled();
    expect(screen.getByText(/scale plan · up to 1024 MB per instance/)).toBeInTheDocument();
  });
  it('makes the API-assigned endpoint clickable in configuration', () => {
    render(
      <ConfirmProvider>
        <AppConfiguration slug="alpha" />
      </ConfirmProvider>
    );
    expect(
      screen.getByRole('link', { name: 'Open endpoint https://alpha.example.test' })
    ).toHaveAttribute('href', 'https://alpha.example.test/');
  });

  it('explains the restore window without weakening typed confirmation', async () => {
    render(
      <ConfirmProvider>
        <AppConfiguration slug="alpha" />
      </ConfirmProvider>
    );
    expect(screen.getByText(/7-day grace/)).toBeInTheDocument();
    expect(
      screen.queryByText(/no grace period|Every deployment, secret|Permanent\./)
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Delete app' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(/restore API/);
    const submit = within(dialog).getByRole('button', { name: 'Delete app' });
    expect(submit).toBeDisabled();
    await userEvent.type(within(dialog).getByRole('textbox'), 'alpha');
    await userEvent.click(submit);
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('alpha'));
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'App deletion scheduled' })
    );
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/dashboard/workflows' });
  });
});
