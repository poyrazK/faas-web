import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { FirstResponse } from './first-response';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  plan: 'pro' as string,
}));

vi.mock('@/lib/api/queries', () => ({
  useInvokeApp: () => ({ mutateAsync: mocks.invoke, isPending: false }),
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { plan: mocks.plan } }) }));

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.plan = 'pro';
});

function problem(status: number, code: string) {
  return new ApiError({ type: 'about:blank', title: code, status, code, detail: code });
}

describe('first response', () => {
  it('makes no request until asked, then sends a GET through the invoke API', async () => {
    mocks.invoke.mockResolvedValue({ id: 'i1', status: 'completed', result: { ok: true } });
    render(<FirstResponse slug="hello-app" endpoint="https://api.example" />);
    expect(mocks.invoke).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText('Request path'), 'health');
    await userEvent.click(screen.getByRole('button', { name: 'Send GET request' }));
    expect(await screen.findByRole('heading', { name: 'First response received' })).toBeVisible();
    expect(screen.getByText(/"ok": true/)).toBeVisible();
    expect(mocks.invoke).toHaveBeenCalledWith({
      slug: 'hello-app',
      method: 'GET',
      path: '/health',
    });
  });

  it('shows a plain-text body as the app sent it', async () => {
    mocks.invoke.mockResolvedValue({ id: 'i1', status: 'completed', result: 'OK' });
    render(<FirstResponse slug="hello-app" endpoint="https://api.example" />);
    await userEvent.click(screen.getByRole('button', { name: 'Send GET request' }));
    expect(await screen.findByText('OK')).toBeVisible();
  });

  it('shows a failed invocation without calling it a successful verification', async () => {
    mocks.invoke.mockResolvedValue({ id: 'i1', status: 'failed', error: 'handler returned 404' });
    render(<FirstResponse slug="hello-app" endpoint="https://api.example" />);
    await userEvent.click(screen.getByRole('button', { name: 'Send GET request' }));
    expect(await screen.findByText(/failed: handler returned 404/)).toBeVisible();
    expect(screen.queryByText('First response received')).not.toBeInTheDocument();
  });

  it('explains a wait that ran out without claiming the app is down', async () => {
    mocks.invoke.mockRejectedValue(problem(504, 'long_poll_timeout'));
    render(<FirstResponse slug="hello-app" endpoint="https://api.example" />);
    await userEvent.click(screen.getByRole('button', { name: 'Send GET request' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/still be waking/);
    expect(screen.getByRole('link', { name: 'Open request URL' })).toHaveAttribute(
      'href',
      'https://api.example/'
    );
  });

  it('offers only the public URL on a plan that cannot invoke from the console', () => {
    mocks.plan = 'free';
    render(<FirstResponse slug="hello-app" endpoint="https://api.example" />);
    expect(screen.queryByRole('button', { name: 'Send GET request' })).not.toBeInTheDocument();
    expect(screen.getByText(/needs a paid plan/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open request URL' })).toBeVisible();
  });

  it('rejects paths that could target another host and clears a stale success', async () => {
    mocks.invoke.mockResolvedValue({ id: 'i1', status: 'completed', result: 'OK' });
    const user = userEvent.setup();
    render(<FirstResponse slug="hello-app" endpoint="https://api.example" />);
    await user.click(screen.getByRole('button', { name: 'Send GET request' }));
    await screen.findByText('First response received');
    await user.clear(screen.getByLabelText('Request path'));
    await user.type(screen.getByLabelText('Request path'), '//other.example');
    expect(screen.queryByText('First response received')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send GET request' })).toBeDisabled();
    expect(screen.queryByRole('link', { name: 'Open request URL' })).not.toBeInTheDocument();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
});
