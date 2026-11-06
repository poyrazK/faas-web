import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { MfaProvider, useMfa } from './mfa-provider';
import { ApiError } from '@/lib/api/errors';

const api = vi.hoisted(() => ({
  confirmMfa: vi.fn(),
  enrollMfa: vi.fn(),
  recoverMfa: vi.fn(),
  verifyMfa: vi.fn(),
  disableMfa: vi.fn(),
  requestMfaRecoveryEmail: vi.fn(),
}));
vi.mock('@/lib/api/queries', () => api);

// The handler the provider registers for an API answer of `mfa_required` —
// captured so a test can play the background requests a pending session makes.
const gate = vi.hoisted(() => ({ fire: null as null | ((startedAt: number) => void) }));
vi.mock('@/lib/api/client', () => ({
  setMfaRequiredHandler: (handler: ((startedAt: number) => void) | null) => {
    gate.fire = handler;
  },
}));

/** Another request failed with `mfa_required` (a poll, a focus refetch). */
function mfaRequiredAgain(startedAt = performance.now()) {
  act(() => gate.fire?.(startedAt));
}

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
  api.disableMfa.mockReset().mockResolvedValue({});
  api.requestMfaRecoveryEmail.mockReset().mockResolvedValue({});
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
  allowRecovery,
}: {
  mode: 'choose' | 'verify';
  reason?: string;
  onVerified: (via: string) => void;
  allowRecovery?: boolean;
}) {
  const { openMfa } = useMfa();
  return (
    <button type="button" onClick={() => openMfa(mode, { reason, onVerified, allowRecovery })}>
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
        reason="Plan changes need multi-factor authentication."
        onVerified={vi.fn()}
      />
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'open' }));
    expect(
      await screen.findByText('Plan changes need multi-factor authentication.')
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
        reason="Plan changes need multi-factor authentication."
        onVerified={vi.fn()}
      />
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'open' }));
    await screen.findByText('Plan changes need multi-factor authentication.');
    expect(screen.queryByText(/optional/i)).toBeNull();
    expect(screen.queryByText('Protect your account with MFA')).toBeNull();
    expect(screen.getByText('Multi-factor authentication required')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set up authenticator' })).toBeInTheDocument();
  });

  it('hides the recovery code for a gate that does not accept one', async () => {
    renderWith(
      <OpenerWith
        mode="choose"
        reason="Plan changes need multi-factor authentication."
        allowRecovery={false}
        onVerified={vi.fn()}
      />
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'open' }));
    await screen.findByText('Plan changes need multi-factor authentication.');
    expect(screen.queryByRole('button', { name: /recovery code/i })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Enter authenticator code' }));
    await screen.findByLabelText('Authenticator code');
    expect(screen.queryByRole('button', { name: /recovery code/i })).toBeNull();
    expect(screen.queryByText(/recovery code/i)).toBeNull();
  });

  it('keeps the recovery code for the session-level gate', async () => {
    renderWith(<OpenerWith mode="verify" onVerified={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'open' }));
    expect(await screen.findByRole('button', { name: /use a recovery code/i })).toBeInTheDocument();
  });

  it('names multi-factor authentication the same way on every screen', async () => {
    renderWith(
      <OpenerWith
        mode="choose"
        reason="Plan changes need multi-factor authentication."
        onVerified={vi.fn()}
      />
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'open' }));
    await user.click(await screen.findByRole('button', { name: 'Enter authenticator code' }));
    await screen.findByLabelText('Authenticator code');
    expect(
      screen.getByRole('heading', { name: /multi-factor authentication/i })
    ).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/two-factor/i);
  });
});

describe('enrollment and recovery', () => {
  it('sends the current password with the enrollment code and completes once', async () => {
    const onVerified = vi.fn();
    renderWith(<OpenerWith mode="choose" onVerified={onVerified} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'open' }));
    await user.click(screen.getByRole('button', { name: 'Set up authenticator' }));
    await user.type(await screen.findByLabelText('Current password'), 'my-current-password');
    await user.type(screen.getByLabelText('Authenticator code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Confirm MFA' }));
    await waitFor(() => expect(onVerified).toHaveBeenCalledWith('enrolment'));
    expect(api.confirmMfa).toHaveBeenCalledWith('123456', 'my-current-password');
    expect(api.verifyMfa).not.toHaveBeenCalled();
  });

  it('offers email recovery without pretending the email request verified MFA', async () => {
    const onVerified = vi.fn();
    renderWith(<OpenerWith mode="choose" onVerified={onVerified} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'open' }));
    await user.click(screen.getByRole('button', { name: 'Recover by email' }));
    expect(await screen.findByText(/24-hour waiting period/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send recovery email' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Check your email');
    expect(api.requestMfaRecoveryEmail).toHaveBeenCalledTimes(1);
    expect(onVerified).not.toHaveBeenCalled();
  });

  it('lets the last saved code reset the authenticator', async () => {
    api.recoverMfa.mockRejectedValueOnce(
      new ApiError({ status: 409, code: 'mfa_last_recovery_code', title: 'Last recovery code' })
    );
    const onVerified = vi.fn();
    renderWith(<OpenerWith mode="choose" onVerified={onVerified} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'open' }));
    await user.click(screen.getByRole('button', { name: /use a recovery code/i }));
    await user.type(screen.getByLabelText('Recovery code'), 'LAST-CODE');
    await user.click(screen.getByRole('button', { name: 'Recover access' }));
    await user.click(
      await screen.findByRole('button', { name: 'Reset authenticator with this code' })
    );
    expect(api.disableMfa).toHaveBeenCalledWith({ recovery_code: 'LAST-CODE' });
    expect(await screen.findByRole('button', { name: 'Confirm MFA' })).toBeInTheDocument();
    expect(onVerified).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Authenticator code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Confirm MFA' }));
    await waitFor(() => expect(onVerified).toHaveBeenCalledWith('enrolment'));
  });

  it('offers replacement setup if enrollment fails after the last code was consumed', async () => {
    api.recoverMfa.mockRejectedValueOnce(
      new ApiError({ status: 409, code: 'mfa_last_recovery_code', title: 'Last recovery code' })
    );
    api.enrollMfa.mockRejectedValueOnce(new Error('Setup is temporarily unavailable.'));
    const onVerified = vi.fn();
    renderWith(<OpenerWith mode="choose" onVerified={onVerified} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'open' }));
    await user.click(screen.getByRole('button', { name: /use a recovery code/i }));
    await user.type(screen.getByLabelText('Recovery code'), 'LAST-CODE');
    await user.click(screen.getByRole('button', { name: 'Recover access' }));
    await user.click(
      await screen.findByRole('button', { name: 'Reset authenticator with this code' })
    );
    expect(await screen.findByText('Setup is temporarily unavailable.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set up authenticator' })).toBeEnabled();
    expect(
      screen.queryByRole('button', { name: 'Reset authenticator with this code' })
    ).not.toBeInTheDocument();
    expect(onVerified).not.toHaveBeenCalled();
  });
});

describe('a session waiting on MFA', () => {
  // While the session is mfa_pending every request fails with mfa_required —
  // polls, retries, and the refetch of every query when the window regains
  // focus, which is exactly when someone comes back from their authenticator
  // app. Only the first may open the modal; the rest must leave it alone.

  it('keeps the code being typed when more requests are refused', async () => {
    renderWith(null);
    const user = userEvent.setup();
    mfaRequiredAgain();
    await user.click(await screen.findByRole('button', { name: 'Enter authenticator code' }));
    await user.type(screen.getByLabelText('Authenticator code'), '123');

    mfaRequiredAgain();
    mfaRequiredAgain();

    expect(screen.getByLabelText('Authenticator code')).toHaveValue('123');
    await user.type(screen.getByLabelText('Authenticator code'), '456');
    await user.click(screen.getByRole('button', { name: 'Verify and continue' }));
    expect(api.verifyMfa).toHaveBeenCalledWith('123456');
  });

  it('keeps the setup QR code, so the scanned secret stays the one being confirmed', async () => {
    renderWith(null);
    const user = userEvent.setup();
    mfaRequiredAgain();
    await user.click(await screen.findByRole('button', { name: 'Set up authenticator' }));
    await screen.findByAltText('Authenticator setup QR code');
    await user.type(screen.getByLabelText('Authenticator code'), '12');

    mfaRequiredAgain();

    expect(screen.getByAltText('Authenticator setup QR code')).toBeInTheDocument();
    expect(screen.getByLabelText('Authenticator code')).toHaveValue('12');
    expect(api.enrollMfa).toHaveBeenCalledTimes(1);
  });

  it("keeps a step-up's reason and callback when the session gate also fires", async () => {
    const onVerified = vi.fn();
    renderWith(
      <OpenerWith mode="verify" reason="Deleting needs a code." onVerified={onVerified} />
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'open' }));
    await user.type(await screen.findByLabelText('Authenticator code'), '123');

    mfaRequiredAgain();

    expect(screen.getByText('Deleting needs a code.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Authenticator code'), '456');
    await user.click(screen.getByRole('button', { name: 'Verify and continue' }));
    await waitFor(() => expect(onVerified).toHaveBeenCalledWith('authenticator'));
  });

  it('stays closed when requests sent before the code was verified are refused', async () => {
    renderWith(null);
    const user = userEvent.setup();
    const sentWhilePending = performance.now();
    mfaRequiredAgain(sentWhilePending);
    await user.click(await screen.findByRole('button', { name: 'Enter authenticator code' }));
    await user.type(screen.getByLabelText('Authenticator code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify and continue' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // The rest of the burst, sent with the pending cookie, lands afterwards.
    mfaRequiredAgain(sentWhilePending);
    expect(screen.queryByRole('dialog')).toBeNull();

    // A request sent after verifying that is still refused is a real one.
    mfaRequiredAgain();
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('refetches a read that was already in flight with the pending cookie', async () => {
    // A poll that leaves just before the verify answer lands still carries the
    // pending cookie and comes back refused. Invalidating alone reuses an
    // in-flight request for a query with no data yet, so that refusal would
    // become the page's state until its next poll — or for good.
    let rejectStale: (error: Error) => void = () => {};
    const reads = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('mfa_required'))
      .mockImplementationOnce(() => new Promise((_, reject) => (rejectStale = reject)))
      .mockResolvedValue('fresh apps');
    function Apps() {
      const query = useQuery({ queryKey: ['apps'], queryFn: reads, retry: false });
      return <p>{query.data ?? (query.error ? 'refused' : 'loading')}</p>;
    }
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <MfaProvider>
          <Apps />
        </MfaProvider>
      </QueryClientProvider>
    );
    expect(await screen.findByText('refused')).toBeInTheDocument();
    mfaRequiredAgain();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Enter authenticator code' }));
    await user.type(screen.getByLabelText('Authenticator code'), '123456');

    void client.refetchQueries({ queryKey: ['apps'] }); // the poll, sent while pending
    await user.click(screen.getByRole('button', { name: 'Verify and continue' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    act(() => rejectStale(new Error('mfa_required'))); // its refusal lands late

    expect(await screen.findByText('fresh apps')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByText('fresh apps')).toBeInTheDocument();
  });

  it('opens again on the next refusal after it was dismissed', async () => {
    renderWith(null);
    const user = userEvent.setup();
    mfaRequiredAgain();
    await user.click(await screen.findByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    mfaRequiredAgain();

    expect(await screen.findByRole('dialog')).toHaveAccessibleName(
      'Additional verification required'
    );
  });
});
