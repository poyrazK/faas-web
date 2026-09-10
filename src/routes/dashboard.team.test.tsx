import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invite = vi.fn();
const toast = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
}));
vi.mock('@/lib/api/queries', () => ({
  useOrgs: () => ({
    data: { orgs: [{ slug: 'acme' }] },
    isPending: false,
    error: null,
    refetch: vi.fn(),
  }),
  useOrgMembers: () => ({ data: { members: [] }, isPending: false, error: null, refetch: vi.fn() }),
  useOrgInvitations: () => ({
    data: { invitations: [] },
    isPending: false,
    error: null,
    refetch: vi.fn(),
  }),
  useInviteMember: () => ({ mutateAsync: invite, isPending: false }),
  useChangeMemberRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemoveMember: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRevokeInvitation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { email: 'owner@example.com' } }),
  isValidEmail: (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim()),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/components/dashboard/org-panels', () => ({
  OrgPanel: () => null,
  OrgKeysPanel: () => null,
}));
vi.mock('@/components/dashboard/resource-table', () => ({
  Pill: () => null,
  ResourceTable: () => null,
}));

const { Route } = await import('./dashboard.team');
const TeamPage = (Route as unknown as { component: React.ComponentType }).component;

beforeEach(() => {
  invite
    .mockReset()
    .mockRejectedValueOnce(new Error('network down'))
    .mockResolvedValue({ email: 'dev@example.com', token: 'invite-once' });
  toast.mockReset();
});

describe('invitation form validation', () => {
  it('handles empty keyboard submit, API failure, retry, and success without losing input', async () => {
    render(<TeamPage />);
    const email = screen.getByRole('textbox', { name: 'Email' });

    await userEvent.type(email, '{Enter}');
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveAccessibleDescription('Enter a valid email address.');
    expect(invite).not.toHaveBeenCalled();

    await userEvent.type(email, 'dev@example.com{Enter}');
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }))
    );
    expect(email).toHaveValue('dev@example.com');

    await userEvent.type(email, '{Enter}');
    expect(await screen.findByText('Invitation created')).toBeInTheDocument();
    expect(invite).toHaveBeenCalledTimes(2);
  });

  it('rejects a malformed address with an inline error instead of native validation UI', async () => {
    render(<TeamPage />);
    const email = screen.getByRole('textbox', { name: 'Email' });
    await userEvent.type(email, 'not-an-email{Enter}');

    expect(email).toHaveAccessibleDescription('Enter a valid email address.');
    expect(invite).not.toHaveBeenCalled();
  });

  it('enforces the API email length limit before sending', async () => {
    render(<TeamPage />);
    const email = screen.getByRole('textbox', { name: 'Email' });
    fireEvent.change(email, { target: { value: `${'a'.repeat(309)}@example.com` } });
    await userEvent.type(email, '{Enter}');

    expect(email).toHaveAccessibleDescription('Enter a valid email address (320 characters max).');
    expect(invite).not.toHaveBeenCalled();
  });
});
