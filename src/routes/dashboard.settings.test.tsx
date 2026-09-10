import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const setEgressExtra = vi.fn();
const deleteAccount = vi.fn();
const signOut = vi.fn();
const refreshAccount = vi.fn();
const clearWorkspace = vi.fn();
const navigate = vi.fn();
const toast = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
  useNavigate: () => navigate,
  Link: ({ children, to, ...props }: React.ComponentProps<'a'> & { to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/lib/auth', () => ({
  readWorkspace: () => 'acme-corp',
  saveWorkspace: vi.fn(),
  clearWorkspace,
  useAuth: () => ({
    account: { email: 'owner@example.com', status: 'active' },
    signOut,
    refreshAccount,
  }),
}));
vi.mock('@/lib/api/queries', () => ({
  useAccountExport: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useEgressExtra: () => ({ data: { extra: 0, plan_cap: 8, max_extra: 32 } }),
  useSetEgressExtra: () => ({ mutateAsync: setEgressExtra, isPending: false }),
  useRestoreAccount: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteAccount: () => ({ mutateAsync: deleteAccount, isPending: false }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));

const { Route } = await import('./dashboard.settings');
const SettingsPage = (Route as unknown as { component: React.ComponentType }).component;

beforeEach(() => {
  setEgressExtra
    .mockReset()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ extra: 12, plan_cap: 8, max_extra: 32 });
  deleteAccount.mockReset().mockResolvedValue({
    status: 'deleted_pending',
    scheduled_at: '2026-09-11T00:00:00Z',
    restore_until: '2026-10-11T00:00:00Z',
  });
  signOut.mockReset().mockResolvedValue(undefined);
  refreshAccount.mockReset().mockResolvedValue(undefined);
  clearWorkspace.mockReset();
  navigate.mockReset();
  toast.mockReset();
});

describe('settings form trust and validation', () => {
  it('does not turn an empty egress-budget submission into zero', async () => {
    render(<SettingsPage />);
    const extra = screen.getByRole('spinbutton', { name: 'Extra entries' });
    await userEvent.type(extra, '{Enter}');

    expect(extra).toHaveAccessibleDescription('Enter a whole number from 0 to 32.');
    expect(setEgressExtra).not.toHaveBeenCalled();
  });

  it('blocks non-integer and over-limit egress budgets, then supports API retry and success', async () => {
    render(<SettingsPage />);
    const extra = screen.getByRole('spinbutton', { name: 'Extra entries' });

    await userEvent.clear(extra);
    await userEvent.type(extra, '33');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(extra).toHaveAccessibleDescription('Enter a whole number from 0 to 32.');
    expect(setEgressExtra).not.toHaveBeenCalled();

    await userEvent.clear(extra);
    await userEvent.type(extra, '12{Enter}');
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }))
    );
    expect(extra).toHaveValue(12);
    await userEvent.type(extra, '{Enter}');
    await waitFor(() => expect(setEgressExtra).toHaveBeenCalledTimes(2));
  });

  it('labels browser-only reset separately and never calls account deletion', async () => {
    render(<SettingsPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Clear browser data and sign out' }));

    expect(clearWorkspace).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(deleteAccount).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith({ to: '/' });
  });

  it('stages real account deletion through the API and leaves restoration available', async () => {
    render(<SettingsPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Schedule account deletion' }));
    expect(screen.getByRole('heading', { name: 'Schedule account deletion?' })).toBeInTheDocument();

    await userEvent.type(
      screen.getByRole('textbox', { name: /type owner@example.com/i }),
      'owner@example.com'
    );
    await userEvent.click(screen.getByRole('button', { name: 'Schedule deletion' }));

    await waitFor(() => expect(deleteAccount).toHaveBeenCalledTimes(1));
    expect(refreshAccount).toHaveBeenCalledTimes(1);
    expect(signOut).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Account deletion scheduled' })
    );
  });
});
