import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { withRouter } from '@/test/router';
import { PasswordFlow } from './password-flow';

const calls = vi.hoisted(() => ({ signUp: vi.fn(), navigate: vi.fn(), markOAuthPending: vi.fn() }));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ signUp: calls.signUp, signIn: vi.fn(), requestPasswordReset: vi.fn() }),
  isValidEmail: (email: string) => email.includes('@'),
  MIN_PASSWORD_LENGTH: 12,
  hasOnboarded: () => false,
  markOAuthPending: calls.markOAuthPending,
}));
vi.mock('@/components/sweep-link', () => ({ useSweepNavigate: () => calls.navigate }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

beforeEach(() => {
  vi.clearAllMocks();
  calls.signUp.mockResolvedValue({ name: 'New Customer' });
});

async function credentials() {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Work email'), 'new@example.com');
  await user.type(screen.getByLabelText('Password'), 'a-long-password');
  return user;
}

it('creates an account with only email and password', async () => {
  render(withRouter(<PasswordFlow mode="signup" />));
  const user = await credentials();
  expect(screen.queryByLabelText(/referral code/i)).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  expect(calls.signUp).toHaveBeenCalledWith('new@example.com', 'a-long-password');
});

it.each(['GitHub', 'Google'])(
  'starts %s signup directly and preserves the redirect',
  async (provider) => {
    render(withRouter(<PasswordFlow mode="signup" redirectTo="/cli-auth" />));
    const link = await screen.findByRole('link', { name: provider });
    expect(link).toHaveAttribute('href', '/v1/auth/' + provider.toLowerCase());
    // Intercept navigation after the component has handled the click.
    let navigationPrevented = true;
    window.addEventListener(
      'click',
      (event) => {
        navigationPrevented = event.defaultPrevented;
        event.preventDefault();
      },
      { once: true }
    );
    fireEvent.click(link);
    expect(navigationPrevented).toBe(false);
    expect(calls.markOAuthPending).toHaveBeenCalledWith('/cli-auth');
  }
);
