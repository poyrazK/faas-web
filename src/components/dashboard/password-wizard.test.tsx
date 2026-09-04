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
  const setPassword = vi.fn<(password: string) => Promise<void>>().mockResolvedValue();
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
    expect(setPassword).toHaveBeenCalledWith(STRONG);
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
});
