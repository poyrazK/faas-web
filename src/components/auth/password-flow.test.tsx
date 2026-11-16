import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { withRouter } from '@/test/router';
import { ApiError } from '@/lib/api/errors';
import { PasswordFlow } from './password-flow';

const calls = vi.hoisted(() => ({ signUp: vi.fn(), select: vi.fn(), navigate: vi.fn() }));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ signUp: calls.signUp, signIn: vi.fn(), requestPasswordReset: vi.fn() }),
  isValidEmail: (email: string) => email.includes('@'),
  MIN_PASSWORD_LENGTH: 12,
  hasOnboarded: () => false,
  markOAuthPending: vi.fn(),
}));
vi.mock('@/lib/api/referrals', () => ({ selectReferralCode: calls.select }));
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

it('submits a manually entered code with password signup', async () => {
  render(withRouter(<PasswordFlow mode="signup" />));
  const user = await credentials();
  await user.type(screen.getByLabelText('Referral code (optional)'), 'poju43');
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  expect(calls.signUp).toHaveBeenCalledWith('new@example.com', 'a-long-password', 'POJU43');
});

it('keeps signup optional and leaves sign-in free of referral fields', async () => {
  const view = render(withRouter(<PasswordFlow mode="signup" />));
  const user = await credentials();
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  expect(calls.signUp).toHaveBeenCalledWith('new@example.com', 'a-long-password', '');
  view.unmount();
  render(withRouter(<PasswordFlow mode="signin" />));
  await screen.findByLabelText('Work email');
  expect(screen.queryByLabelText('Referral code (optional)')).not.toBeInTheDocument();
});

it('shows an invalid-code response without misreporting a password error', async () => {
  calls.signUp.mockRejectedValue(
    new ApiError({
      status: 400,
      code: 'referral_code_invalid',
      title: 'Invalid referral code',
      detail: 'This code is inactive.',
    })
  );
  render(withRouter(<PasswordFlow mode="signup" />));
  const user = await credentials();
  await user.type(screen.getByLabelText('Referral code (optional)'), 'poju43');
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('This code is inactive.');
});

it('validates the entered selection before OAuth navigation', async () => {
  calls.select.mockRejectedValue(
    new ApiError({ status: 400, code: 'referral_code_invalid', title: 'Invalid referral code' })
  );
  render(withRouter(<PasswordFlow mode="signup" />));
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Referral code (optional)'), 'poju43');
  await user.click(screen.getByRole('link', { name: 'GitHub' }));
  expect(calls.select).toHaveBeenCalledWith('POJU43');
  expect(await screen.findByRole('alert')).toHaveTextContent('Invalid referral code');
});
