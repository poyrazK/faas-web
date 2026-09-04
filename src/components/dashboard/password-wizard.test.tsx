import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PasswordWizard } from './password-wizard';
import { ApiError } from '@/lib/api/errors';

/**
 * The wizard's gates are the point: the old panel accepted a single unconfirmed
 * field, so a typo became a password nobody knew. These pin that Continue is
 * held until the rule is met, that Confirm is held until the retype matches,
 * and that the request goes out exactly once with the confirmed value.
 */

const EMAIL = 'design@gregale.dev';
const STRONG = 'correct-horse-battery';

function setup(overrides: Partial<Parameters<typeof PasswordWizard>[0]> = {}) {
  const setPassword = vi
    .fn<(password: string, opts?: { currentPassword?: string }) => Promise<void>>()
    .mockResolvedValue();
  const requestReset = vi.fn<(email: string) => Promise<void>>().mockResolvedValue();
  render(
    <PasswordWizard
      email={EMAIL}
      setPassword={setPassword}
      requestReset={requestReset}
      {...overrides}
    />
  );
  return { setPassword, requestReset, user: userEvent.setup() };
}

async function reachConfirm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /set a password/i }));
  await user.type(await screen.findByLabelText(/^new password$/i), STRONG);
  await user.click(screen.getByRole('button', { name: /continue/i }));
  return screen.findByLabelText(/confirm password/i);
}

describe('PasswordWizard', () => {
  it('holds Continue until the password meets the length rule', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: /set a password/i }));

    const input = await screen.findByLabelText(/^new password$/i);
    const next = screen.getByRole('button', { name: /continue/i });
    expect(next).toBeDisabled();

    await user.type(input, 'short');
    expect(next).toBeDisabled();

    await user.type(input, '-but-now-long');
    expect(next).toBeEnabled();
  });

  it('holds Confirm until the retype matches', async () => {
    const { user, setPassword } = setup();
    const confirm = await reachConfirm(user);
    const submit = screen.getByRole('button', { name: /set password/i });
    expect(submit).toBeDisabled();

    await user.type(confirm, 'something-else-entirely');
    await user.tab();
    expect(await screen.findByText(/do not match/i)).toBeInTheDocument();
    expect(submit).toBeDisabled();

    await user.clear(confirm);
    await user.type(confirm, STRONG);
    expect(submit).toBeEnabled();
    expect(setPassword).not.toHaveBeenCalled();
  });

  it('sends the confirmed password once and lands on Done', async () => {
    const { user, setPassword } = setup();
    const confirm = await reachConfirm(user);
    await user.type(confirm, STRONG);
    await user.click(screen.getByRole('button', { name: /set password/i }));

    expect(await screen.findByText(/email sign-in is on/i)).toBeInTheDocument();
    expect(screen.getByText(EMAIL)).toBeInTheDocument();
    expect(setPassword).toHaveBeenCalledTimes(1);
    expect(setPassword).toHaveBeenCalledWith(STRONG, { currentPassword: undefined });
  });

  it('restates the length rule when the server refuses the password as weak', async () => {
    const weak = new ApiError({ status: 400, code: 'password_too_weak', title: 'Weak' });
    const { user } = setup({ setPassword: vi.fn().mockRejectedValue(weak) });
    const confirm = await reachConfirm(user);
    await user.type(confirm, STRONG);
    await user.click(screen.getByRole('button', { name: /set password/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/at least 12 characters/i);
    expect(screen.queryByText(/email sign-in is on/i)).not.toBeInTheDocument();
  });

  it('shows the server message for a 400 that is not the length rule', async () => {
    const stale = new ApiError({
      status: 400,
      code: 'validation_failed',
      title: 'Invalid CSRF token',
      detail: 'please reload the page and try again',
    });
    const { user } = setup({ setPassword: vi.fn().mockRejectedValue(stale) });
    const confirm = await reachConfirm(user);
    await user.type(confirm, STRONG);
    await user.click(screen.getByRole('button', { name: /set password/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/reload the page/i);
    expect(alert).not.toHaveTextContent(/at least 12/i);
  });

  it('offers a reset link for accounts that already have a password', async () => {
    const { user, requestReset } = setup();
    await user.click(screen.getByRole('button', { name: /reset link/i }));

    await waitFor(() => expect(requestReset).toHaveBeenCalledWith(EMAIL));
    // The server answers identically for an unknown address, so the copy must
    // hedge rather than promise.
    expect(await screen.findByText(/is registered/i)).toBeInTheDocument();
  });

  it('asks for the current password after invalid_credentials and retries with it', async () => {
    const denied = new ApiError({
      status: 401,
      code: 'invalid_credentials',
      title: 'Invalid credentials',
    });
    const setPassword = vi
      .fn<(password: string, opts?: { currentPassword?: string }) => Promise<void>>()
      .mockRejectedValueOnce(denied)
      .mockResolvedValueOnce();
    const { user } = setup({ setPassword });
    const confirm = await reachConfirm(user);
    await user.type(confirm, STRONG);
    await user.click(screen.getByRole('button', { name: /set password/i }));

    const current = await screen.findByLabelText(/current password/i);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.type(current, 'the-old-password-1');
    await user.click(screen.getByRole('button', { name: /change password/i }));

    expect(await screen.findByText(/email sign-in is on/i)).toBeInTheDocument();
    expect(setPassword).toHaveBeenCalledTimes(2);
    expect(setPassword).toHaveBeenNthCalledWith(1, STRONG, { currentPassword: undefined });
    expect(setPassword).toHaveBeenNthCalledWith(2, STRONG, {
      currentPassword: 'the-old-password-1',
    });
  });

  it('says the current password is wrong when the retry is refused again', async () => {
    const denied = new ApiError({
      status: 401,
      code: 'invalid_credentials',
      title: 'Invalid credentials',
    });
    const { user } = setup({ setPassword: vi.fn().mockRejectedValue(denied) });
    const confirm = await reachConfirm(user);
    await user.type(confirm, STRONG);
    await user.click(screen.getByRole('button', { name: /set password/i }));
    await user.type(await screen.findByLabelText(/current password/i), 'wrong-guess-here');
    await user.click(screen.getByRole('button', { name: /change password/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/current password is incorrect/i);
    expect(screen.getByLabelText(/current password/i)).toHaveValue('');
  });

  it('offers the reset link from the current-password step', async () => {
    const denied = new ApiError({
      status: 401,
      code: 'invalid_credentials',
      title: 'Invalid credentials',
    });
    const { user, requestReset } = setup({ setPassword: vi.fn().mockRejectedValue(denied) });
    const confirm = await reachConfirm(user);
    await user.type(confirm, STRONG);
    await user.click(screen.getByRole('button', { name: /set password/i }));
    await screen.findByLabelText(/current password/i);
    await user.click(screen.getByRole('button', { name: /reset link/i }));

    await waitFor(() => expect(requestReset).toHaveBeenCalledWith(EMAIL));
    expect(await screen.findByText(/is registered/i)).toBeInTheDocument();
  });

  it('runs the MFA step-up on step_up_required and retries once verified', async () => {
    const gated = new ApiError({ status: 403, code: 'step_up_required', title: 'Step-up' });
    const setPassword = vi
      .fn<(password: string, opts?: { currentPassword?: string }) => Promise<void>>()
      .mockRejectedValueOnce(gated)
      .mockResolvedValueOnce();
    const stepUp = vi.fn().mockResolvedValue(true);
    const { user } = setup({ setPassword, stepUp });
    const confirm = await reachConfirm(user);
    await user.type(confirm, STRONG);
    await user.click(screen.getByRole('button', { name: /set password/i }));

    expect(await screen.findByText(/email sign-in is on/i)).toBeInTheDocument();
    expect(stepUp).toHaveBeenCalledTimes(1);
    expect(stepUp).toHaveBeenCalledWith('step_up_required');
    expect(setPassword).toHaveBeenCalledTimes(2);
  });

  it('runs MFA enrolment on mfa_required and retries once confirmed', async () => {
    const policy = new ApiError({ status: 403, code: 'mfa_required', title: 'MFA required' });
    const setPassword = vi
      .fn<(password: string, opts?: { currentPassword?: string }) => Promise<void>>()
      .mockRejectedValueOnce(policy)
      .mockResolvedValueOnce();
    const stepUp = vi.fn().mockResolvedValue(true);
    const { user } = setup({ setPassword, stepUp });
    const confirm = await reachConfirm(user);
    await user.type(confirm, STRONG);
    await user.click(screen.getByRole('button', { name: /set password/i }));

    expect(await screen.findByText(/email sign-in is on/i)).toBeInTheDocument();
    expect(stepUp).toHaveBeenCalledWith('mfa_required');
    expect(setPassword).toHaveBeenCalledTimes(2);
  });

  it('explains when enrolment is dismissed', async () => {
    const policy = new ApiError({ status: 403, code: 'mfa_required', title: 'MFA required' });
    const { user } = setup({
      setPassword: vi.fn().mockRejectedValue(policy),
      stepUp: vi.fn().mockResolvedValue(false),
    });
    const confirm = await reachConfirm(user);
    await user.type(confirm, STRONG);
    await user.click(screen.getByRole('button', { name: /set password/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/set up two-factor/i);
  });

  it('stays on Confirm with a note when the step-up is dismissed', async () => {
    const gated = new ApiError({ status: 403, code: 'step_up_required', title: 'Step-up' });
    const setPassword = vi.fn().mockRejectedValue(gated);
    const stepUp = vi.fn().mockResolvedValue(false);
    const { user } = setup({ setPassword, stepUp });
    const confirm = await reachConfirm(user);
    await user.type(confirm, STRONG);
    await user.click(screen.getByRole('button', { name: /set password/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/verify with your authenticator/i);
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
    expect(setPassword).toHaveBeenCalledTimes(1);
  });

  it('explains when no step-up is available', async () => {
    const gated = new ApiError({ status: 403, code: 'step_up_required', title: 'Step-up' });
    const { user } = setup({ setPassword: vi.fn().mockRejectedValue(gated) });
    const confirm = await reachConfirm(user);
    await user.type(confirm, STRONG);
    await user.click(screen.getByRole('button', { name: /set password/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/verify with your authenticator/i);
  });

  it('tells the user to wait when the limiter answers 429', async () => {
    const limited = new ApiError({
      status: 429,
      code: 'rate_limited',
      title: 'Too Many Requests',
      detail: 'Too many attempts. Wait a minute and try again.',
    });
    const { user } = setup({ setPassword: vi.fn().mockRejectedValue(limited) });
    const confirm = await reachConfirm(user);
    await user.type(confirm, STRONG);
    await user.click(screen.getByRole('button', { name: /set password/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/too many attempts/i);
    expect(screen.getByRole('button', { name: /set password/i })).toBeDisabled();
  });

  it('asks for a reload when the CSRF token is stale', async () => {
    const stale = new ApiError({
      status: 400,
      code: 'validation_failed',
      title: 'Invalid CSRF token',
      detail: 'please reload the page and try again',
    });
    const { user } = setup({ setPassword: vi.fn().mockRejectedValue(stale) });
    const confirm = await reachConfirm(user);
    await user.type(confirm, STRONG);
    await user.click(screen.getByRole('button', { name: /set password/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/reload/i);
  });
});
