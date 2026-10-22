import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MfaProvider, useMfa } from './mfa-provider';

const api = vi.hoisted(() => ({
  confirmMfa: vi.fn(),
  enrollMfa: vi.fn(),
  recoverMfa: vi.fn(),
  verifyMfa: vi.fn(),
}));
vi.mock('@/lib/api/queries', () => api);

function Opener({ onVerified, onDismissed }: { onVerified: () => void; onDismissed: () => void }) {
  const { openMfa } = useMfa();
  return (
    <button type="button" onClick={() => openMfa('verify', { onVerified, onDismissed })}>
      step up
    </button>
  );
}

beforeEach(() => {
  api.confirmMfa.mockReset().mockResolvedValue({});
  api.recoverMfa.mockReset().mockResolvedValue({});
  api.verifyMfa.mockReset().mockResolvedValue({});
  api.enrollMfa.mockReset().mockResolvedValue({
    qr_code_png_base64: '',
    secret: 'SECRET',
    recovery_codes: ['AAAA-1111'],
  });
});

function OpenerWith({
  mode,
  reason,
  onVerified,
}: {
  mode: 'choose' | 'verify';
  reason?: string;
  onVerified: (via: string) => void;
}) {
  const { openMfa } = useMfa();
  return (
    <button type="button" onClick={() => openMfa(mode, { reason, onVerified })}>
      open
    </button>
  );
}

function renderWith(ui: React.ReactNode) {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MfaProvider>{ui}</MfaProvider>
    </QueryClientProvider>
  );
}

describe('openMfa completion callbacks', () => {
  it('calls onVerified once after a successful verify', async () => {
    const onVerified = vi.fn();
    const onDismissed = vi.fn();
    renderWith(<Opener onVerified={onVerified} onDismissed={onDismissed} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /step up/i }));

    const code = await screen.findByRole('textbox');
    await user.type(code, '123456');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(onVerified).toHaveBeenCalledTimes(1));
    expect(onDismissed).not.toHaveBeenCalled();
  });

  it('calls onDismissed when the modal is closed without verifying', async () => {
    const onVerified = vi.fn();
    const onDismissed = vi.fn();
    renderWith(<Opener onVerified={onVerified} onDismissed={onDismissed} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /step up/i }));
    await screen.findByRole('textbox');
    await user.keyboard('{Escape}');

    await waitFor(() => expect(onDismissed).toHaveBeenCalledTimes(1));
    expect(onVerified).not.toHaveBeenCalled();
  });
});

describe('openMfa completion method and reason', () => {
  it('shows the reason the caller gives', async () => {
    renderWith(
      <OpenerWith
        mode="choose"
        reason="Plan changes need two-factor authentication."
        onVerified={vi.fn()}
      />
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'open' }));
    expect(
      await screen.findByText('Plan changes need two-factor authentication.')
    ).toBeInTheDocument();
  });

  it('reports an authenticator code as "authenticator"', async () => {
    const onVerified = vi.fn();
    renderWith(<OpenerWith mode="verify" onVerified={onVerified} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'open' }));
    await user.type(await screen.findByRole('textbox'), '123456');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onVerified).toHaveBeenCalledWith('authenticator'));
  });

  it('reports a recovery code as "recovery"', async () => {
    const onVerified = vi.fn();
    renderWith(<OpenerWith mode="verify" onVerified={onVerified} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'open' }));
    await user.click(await screen.findByRole('button', { name: /use a recovery code/i }));
    await user.type(await screen.findByLabelText('Recovery code'), 'aaaa-1111');
    await user.click(screen.getByRole('button', { name: 'Recover access' }));
    await waitFor(() => expect(onVerified).toHaveBeenCalledWith('recovery'));
  });

  it('reports finishing enrolment as "enrolment"', async () => {
    const onVerified = vi.fn();
    renderWith(<OpenerWith mode="choose" onVerified={onVerified} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'open' }));
    await user.click(await screen.findByRole('button', { name: 'Set up authenticator' }));
    await user.type(await screen.findByLabelText('Authenticator code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Confirm MFA' }));
    await waitFor(() => expect(onVerified).toHaveBeenCalledWith('enrolment'));
  });

  it('says MFA is optional when nothing gated the open', async () => {
    renderWith(<OpenerWith mode="choose" onVerified={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'open' }));
    expect(await screen.findByText(/MFA is optional/)).toBeInTheDocument();
    expect(screen.getByText('Protect your account with MFA')).toBeInTheDocument();
  });

  it('drops every "optional" claim when a gate asked for the modal', async () => {
    renderWith(
      <OpenerWith
        mode="choose"
        reason="Plan changes need two-factor authentication."
        onVerified={vi.fn()}
      />
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'open' }));
    await screen.findByText('Plan changes need two-factor authentication.');
    expect(screen.queryByText(/optional/i)).toBeNull();
    expect(screen.queryByText('Protect your account with MFA')).toBeNull();
    expect(screen.getByText('Two-factor authentication required')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set up authenticator' })).toBeInTheDocument();
  });
});
