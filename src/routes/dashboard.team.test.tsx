import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invite = vi.fn();
const toast = vi.fn();
const confirm = vi.fn();
const revoke = vi.fn();
const changeRole = vi.fn();
const remove = vi.fn();
let reduce = true;

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
}));
vi.mock('motion/react', async (original) => ({
  ...(await original<object>()),
  useReducedMotion: () => reduce,
}));
vi.mock('@/lib/api/queries', () => ({
  useOrgs: () => ({
    data: { orgs: [{ slug: 'acme' }, { slug: 'other' }] },
    isPending: false,
    error: null,
    refetch: vi.fn(),
  }),
  useOrgMembers: () => ({
    data: {
      members: [
        {
          account_id: 'owner',
          email: 'owner@example.com',
          role: 'owner',
          joined_at: '2026-09-01T00:00:00Z',
        },
        {
          account_id: 'dev',
          email: 'member@example.com',
          role: 'developer',
          joined_at: '2026-09-01T00:00:00Z',
        },
      ],
    },
    isPending: false,
    error: null,
    refetch: vi.fn(),
  }),
  useOrgInvitations: () => ({
    data: {
      invitations: [
        {
          id: 'invite1',
          email: 'pending@example.com',
          role: 'viewer',
          status: 'pending',
          expires_at: '2026-09-18T00:00:00Z',
        },
      ],
    },
    isPending: false,
    error: null,
    refetch: vi.fn(),
  }),
  useInviteMember: () => ({ mutateAsync: invite, isPending: false, reset: vi.fn() }),
  useChangeMemberRole: () => ({ mutateAsync: changeRole, isPending: false }),
  useRemoveMember: () => ({ mutateAsync: remove, isPending: false }),
  useRevokeInvitation: () => ({ mutateAsync: revoke, isPending: false }),
}));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { email: 'owner@example.com' } }),
  isValidEmail: (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim()),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));
vi.mock('@/components/dashboard/org-panels', () => ({
  OrgPanel: () => null,
  OrgKeysPanel: () => null,
}));

const { Route } = await import('./dashboard.team');
const TeamPage = (Route as unknown as { component: React.ComponentType }).component;

beforeEach(() => {
  reduce = true;
  confirm.mockReset().mockResolvedValue(true);
  revoke.mockReset().mockResolvedValue(undefined);
  changeRole.mockReset().mockResolvedValue(undefined);
  remove.mockReset().mockResolvedValue(undefined);
  invite
    .mockReset()
    .mockRejectedValueOnce(new Error('network down'))
    .mockResolvedValue({ email: 'dev@example.com', token: 'invite-once' });
  toast.mockReset();
});

describe('invitation form validation', () => {
  it('handles empty keyboard submit, API failure, retry, and success without losing input', async () => {
    render(<TeamPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Invite member' }));
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
    await userEvent.click(screen.getByRole('button', { name: 'Invite member' }));
    const email = screen.getByRole('textbox', { name: 'Email' });
    await userEvent.type(email, 'not-an-email{Enter}');

    expect(email).toHaveAccessibleDescription('Enter a valid email address.');
    expect(invite).not.toHaveBeenCalled();
  });

  it('enforces the API email length limit before sending', async () => {
    render(<TeamPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Invite member' }));
    const email = screen.getByRole('textbox', { name: 'Email' });
    fireEvent.change(email, { target: { value: `${'a'.repeat(309)}@example.com` } });
    await userEvent.type(email, '{Enter}');

    expect(email).toHaveAccessibleDescription('Enter a valid email address (320 characters max).');
    expect(invite).not.toHaveBeenCalled();
  });
});

describe('invitation disclosure and one-time evidence', () => {
  it.each([false, true])('opens the shared disclosure with reduced motion=%s', (reduced) => {
    reduce = reduced;
    render(<TeamPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Invite member' }));
    const region = screen.getByRole('region', { name: 'Invite a member' });
    expect(region.style.opacity).toBe(reduced ? '1' : '0');
    fireEvent.click(screen.getByRole('button', { name: 'Close Invite a member' }));
    expect(region).not.toBeInTheDocument();
  });

  it('keeps role, removal and invitation revocation actions functional with confirmation', async () => {
    render(<TeamPage />);
    expect(
      screen.queryByRole('button', { name: 'Remove owner@example.com' })
    ).not.toBeInTheDocument();
    confirm.mockResolvedValueOnce(false);
    await userEvent.click(
      screen.getByRole('button', { name: 'Revoke invitation for pending@example.com' })
    );
    expect(revoke).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole('button', { name: 'Revoke invitation for pending@example.com' })
    );
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('invite1'));
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Role for member@example.com' }),
      'billing'
    );
    await waitFor(() =>
      expect(changeRole).toHaveBeenCalledWith({ userId: 'dev', role: 'billing' })
    );
    await userEvent.click(screen.getByRole('button', { name: 'Remove member@example.com' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('dev'));
  });

  it('starts with member/invitation lists and opens/closes with keyboard focus restoration', async () => {
    render(<TeamPage />);
    expect(screen.getByText('Members')).toBeVisible();
    expect(screen.getByText('Invitations')).toBeVisible();
    expect(screen.queryByRole('textbox', { name: 'Email' })).not.toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: 'Invite member' });
    trigger.focus();
    await userEvent.keyboard(' ');
    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Email' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('masks invitation tokens, copies without reveal and clears on dismiss/close', async () => {
    invite.mockReset().mockResolvedValue({ email: 'dev@example.com', token: 'invite-once' });
    const user = userEvent.setup();
    const copy = vi.spyOn(navigator.clipboard, 'writeText');
    const view = render(<TeamPage />);
    await user.click(screen.getByRole('button', { name: 'Invite member' }));
    await user.type(screen.getByRole('textbox', { name: 'Email' }), 'dev@example.com');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Role' }), 'viewer');
    await user.click(screen.getByRole('button', { name: 'Invite' }));
    await screen.findByText('Invitation created');
    expect(invite).toHaveBeenCalledWith({ email: 'dev@example.com', role: 'viewer' });
    expect(view.container.innerHTML).not.toContain('invite-once');
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(copy).toHaveBeenCalledWith('invite-once');
    expect(view.container.innerHTML).not.toContain('invite-once');
    await user.click(screen.getByRole('button', { name: 'Reveal' }));
    expect(screen.getByText('invite-once')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Hide' }));
    expect(view.container.innerHTML).not.toContain('invite-once');
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('button', { name: 'Reveal' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close Invite a member' }));
    await user.click(screen.getByRole('button', { name: 'Invite member' }));
    expect(screen.queryByRole('button', { name: 'Reveal' })).not.toBeInTheDocument();
  });

  it('discards tokens on organization change and unmount', async () => {
    invite.mockReset().mockResolvedValue({ email: 'dev@example.com', token: 'invite-once' });
    const view = render(<TeamPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Invite member' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Email' }), 'dev@example.com{Enter}');
    await userEvent.click(await screen.findByRole('button', { name: 'Reveal' }));
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Select an organisation' }),
      'other'
    );
    expect(view.container.innerHTML).not.toContain('invite-once');
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Select an organisation' }),
      'acme'
    );
    expect(screen.queryByRole('button', { name: 'Reveal' })).not.toBeInTheDocument();
    view.unmount();
    render(<TeamPage />);
    expect(screen.queryByRole('button', { name: 'Reveal' })).not.toBeInTheDocument();
  });

  it('discards a response arriving after the invitation surface closes', async () => {
    let resolve!: (result: { email: string; token: string }) => void;
    invite.mockReset().mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    render(<TeamPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Invite member' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Email' }), 'dev@example.com{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Close Invite a member' }));
    resolve({ email: 'dev@example.com', token: 'late-token' });
    await userEvent.click(screen.getByRole('button', { name: 'Invite member' }));
    expect(screen.queryByRole('button', { name: 'Reveal' })).not.toBeInTheDocument();
  });

  it.each([
    { draft: 'next@example.com', invalid: false },
    { draft: 'next-invalid-address', invalid: true },
  ])(
    'preserves a reopened invitation draft and validation when an old response arrives (invalid=$invalid)',
    async ({ draft, invalid }) => {
      let resolve!: (result: { email: string; token: string }) => void;
      invite.mockReset().mockImplementation(
        () =>
          new Promise((done) => {
            resolve = done;
          })
      );
      const view = render(<TeamPage />);
      await userEvent.click(screen.getByRole('button', { name: 'Invite member' }));
      await userEvent.type(
        screen.getByRole('textbox', { name: 'Email' }),
        'dev@example.com{Enter}'
      );
      await userEvent.click(screen.getByRole('button', { name: 'Close Invite a member' }));
      await userEvent.click(screen.getByRole('button', { name: 'Invite member' }));
      const email = screen.getByRole('textbox', { name: 'Email' });
      await userEvent.type(email, draft);
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Role' }), 'viewer');
      if (invalid) {
        await userEvent.click(screen.getByRole('button', { name: 'Invite' }));
        expect(email).toHaveAccessibleDescription('Enter a valid email address.');
      }
      await act(async () => {
        resolve({ email: 'dev@example.com', token: 'late-token' });
      });
      expect(email).toHaveValue(draft);
      if (invalid) expect(email).toHaveAccessibleDescription('Enter a valid email address.');
      expect(screen.getByRole('combobox', { name: 'Role' })).toHaveValue('viewer');
      expect(screen.queryByRole('button', { name: 'Reveal' })).not.toBeInTheDocument();
      expect(view.container.innerHTML).not.toContain('late-token');
      expect(invite).toHaveBeenCalledTimes(1);
    }
  );
});
