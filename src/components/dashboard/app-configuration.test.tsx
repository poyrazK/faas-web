import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '@/components/ui/confirm';
import { AppConfiguration } from './app-configuration';

const mocks = vi.hoisted(() => ({ remove: vi.fn(), navigate: vi.fn(), toast: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@/lib/use-unsaved-guard', () => ({ useUnsavedGuard: () => {} }));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ account: { plan: 'scale', limits: { ram_mb: 1024 } }, loading: false }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('./app-core-panels', () => ({ RegistryCredentialsPanel: () => null }));
vi.mock('./supply-chain-panel', () => ({ SupplyChainPanel: () => null }));
vi.mock('./app-insights', () => ({ StaticEgressIP: () => null, StreamingCapNote: () => null }));
vi.mock('./app-lifecycle', () => ({ PurgeCacheControl: () => null }));
vi.mock('@/lib/api/queries', () => ({
  useApp: () => ({
    data: {
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
  useUpdateApp: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAppDiff: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRenameApp: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteApp: () => ({ mutateAsync: mocks.remove, isPending: false }),
}));
beforeEach(() => {
  mocks.remove.mockReset().mockResolvedValue(undefined);
  mocks.navigate.mockReset();
  mocks.toast.mockReset();
});

describe('App deletion contract copy', () => {
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
