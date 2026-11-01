import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { InvokePanel } from './app-core-panels';

const mocks = vi.hoisted(() => ({
  plan: 'free',
  sync: vi.fn(),
  async: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ account: { plan: mocks.plan }, loading: false }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));
vi.mock('@/lib/api/queries', async (original) => ({
  ...(await original<object>()),
  useInvokeApp: () => ({ mutateAsync: mocks.sync, isPending: false }),
  useInvokeAppAsync: () => ({ mutateAsync: mocks.async, isPending: false }),
  useInvocation: () => ({ data: undefined, error: null }),
}));

beforeEach(() => {
  mocks.sync.mockReset().mockResolvedValue({ status: 200 });
  mocks.async.mockReset().mockResolvedValue({ id: 'inv-1' });
});

it('does not offer either mode on Free, which apid refuses for both', async () => {
  // invokeApp and invokeAppAsync both check AsyncInvokeAllowed, false on Free
  // (faas handlers_invocations.go, limits.go:5083), and answer
  // plan_feature_gated.
  mocks.plan = 'free';
  const user = userEvent.setup();
  render(<InvokePanel slug="alpha" />);
  expect(screen.getByRole('button', { name: 'Wait for result' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Async' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Send request' })).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent(/hobby and above/i);
  expect(screen.getByRole('status')).not.toHaveTextContent(/available on the free plan/i);
  await user.click(screen.getByRole('button', { name: 'Send request' }));
  expect(mocks.sync).not.toHaveBeenCalled();
  expect(mocks.async).not.toHaveBeenCalled();
});

it('sends from a paid plan in both modes', async () => {
  mocks.plan = 'hobby';
  const user = userEvent.setup();
  render(<InvokePanel slug="alpha" />);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Send request' }));
  expect(mocks.sync).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole('button', { name: 'Async' }));
  await user.click(screen.getByRole('button', { name: 'Send request' }));
  expect(mocks.async).toHaveBeenCalledTimes(1);
});
