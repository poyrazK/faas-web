import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const openMfa = vi.fn();
const confirm = vi.fn(async () => true);
const revokeAll = vi.fn(async () => ({ revoked: 2 }));
const revoke = vi.fn(async () => undefined);
const toast = vi.fn();
const now = Date.now();
const ago = (minutes: number) => new Date(now - minutes * 60e3).toISOString();

vi.mock('@/components/auth/mfa-provider', () => ({ useMfa: () => ({ openMfa }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/dashboard/password-wizard', () => ({
  PasswordPanel: () => <h2>Email sign-in</h2>,
}));
vi.mock('@/lib/api/queries', () => ({
  useSessions: () => ({
    data: {
      sessions: [
        {
          id: 's1',
          issued_ip: '185.93.2.14',
          issued_ua: 'Chrome 128 · macOS',
          issued_at: ago(120),
          last_seen_at: ago(2),
          current_session: true,
        },
        {
          id: 's2',
          issued_ip: '78.180.11.9',
          issued_ua: 'gregale-cli/0.9.2',
          issued_at: ago(600),
          last_seen_at: ago(30),
          current_session: false,
        },
      ],
    },
    isPending: false,
    error: null,
    refetch: vi.fn(),
  }),
  useRevokeSession: () => ({ mutateAsync: revoke, isPending: false }),
  useRevokeAllSessions: () => ({ mutateAsync: revokeAll, isPending: false }),
  useAuthAuditEvents: () => ({
    data: {
      events: [
        {
          id: '1',
          kind: 'login.failed_password',
          actor: 'demo@acme-corp.dev',
          severity: 'warn',
          at: ago(60),
        },
        { id: '2', kind: 'stateless.advisory', actor: 'apid', severity: 'high', at: ago(5) },
        ...Array.from({ length: 6 }, (_, i) => ({
          id: `k${i}`,
          kind: 'api_key.created',
          actor: 'demo@acme-corp.dev',
          severity: 'info',
          at: ago(200 + i),
        })),
      ],
    },
    isPending: false,
    error: null,
    refetch: vi.fn(),
  }),
  useAccountSecrets: () => ({
    data: {
      secrets: [
        { app_slug: 'api-gateway', key: 'DATABASE_URL', updated_at: ago(90) },
        { app_slug: 'api-gateway', key: 'STRIPE_KEY', updated_at: ago(90) },
        { app_slug: 'nightly-etl', key: 'DATABASE_URL', updated_at: ago(90) },
      ],
    },
    isPending: false,
    error: null,
    refetch: vi.fn(),
  }),
  useAuditEvent: () => ({ isPending: true }),
}));

const { SecuritySettings } = await import('./security-settings');

beforeEach(() => {
  openMfa.mockReset();
  confirm.mockClear();
  revokeAll.mockClear();
  revoke.mockClear();
  toast.mockReset();
});

describe('Security in plain words', () => {
  it('opens with who is signed in and a failed sign-in, without claiming MFA state', () => {
    render(<SecuritySettings />);
    const summary = screen.getByRole('region', { name: 'Account security' });
    expect(summary).toHaveTextContent(
      '2 devices are signed in, including this one. Someone failed to sign in this week — check it was you.'
    );
    expect(summary).not.toHaveTextContent(/MFA is (on|off)/);
  });

  it('makes setting up two-factor sign-in the primary action', async () => {
    render(<SecuritySettings />);
    await userEvent.click(screen.getByRole('button', { name: 'Set up two-factor sign-in' }));
    expect(openMfa).toHaveBeenCalledWith('choose');
  });

  it('keeps the confirm in front of signing out everywhere', async () => {
    render(<SecuritySettings />);
    await userEvent.click(screen.getByRole('button', { name: 'Sign out everywhere' }));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Sign out everywhere?', destructive: true })
    );
    await waitFor(() => expect(revokeAll).toHaveBeenCalledTimes(1));
  });

  it('names devices in words, keeps the raw agent on hover and signs one out after a confirm', async () => {
    render(<SecuritySettings />);
    expect(screen.getByText('Chrome 128 on macOS')).toHaveAttribute('title', 'Chrome 128 · macOS');
    expect(screen.getByText('This browser')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Sign out Chrome 128 on macOS' })
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out Gregale CLI 0.9.2' }));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Sign out Gregale CLI 0.9.2?' })
    );
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('s2'));
  });

  it('says events in words with the code on hover, and holds the rest behind Show all', async () => {
    render(<SecuritySettings />);
    const wrong = screen.getByText('Someone tried a wrong password').closest('button')!;
    expect(wrong).toHaveAttribute('title', 'login.failed_password');
    expect(within(wrong).getByText('Worth a look')).toBeInTheDocument();
    expect(screen.queryByText('login.failed_password')).not.toBeInTheDocument();
    const advisory = screen
      .getByText('An app wrote files to local disk, which are lost when it sleeps')
      .closest('button')!;
    expect(within(advisory).getByText('Gregale')).toHaveAttribute('title', 'apid');
    expect(screen.getAllByText('API key created')).toHaveLength(4);
    await userEvent.click(screen.getByRole('button', { name: 'Show all 8' }));
    expect(screen.getAllByText('API key created')).toHaveLength(6);
  });

  it('counts saved secrets and lists them only on request', async () => {
    render(<SecuritySettings />);
    expect(
      screen.getByText('3 secrets are saved across 2 apps. Only those apps can read the values.')
    ).toBeInTheDocument();
    expect(screen.queryByText('STRIPE_KEY')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show every secret' }));
    expect(screen.getByText('STRIPE_KEY')).toBeInTheDocument();
  });
});
