import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './auth';
import { useFinancialBudgets, useFinancialCosts } from './api/financial';

const server = vi.hoisted(() => ({
  principal: '',
  unauthorized: null as (() => void) | null,
  delayCosts: false,
  delayAccount: false,
  resolveCosts: null as (() => void) | null,
  resolveAccount: null as (() => void) | null,
  GET: vi.fn(),
}));
vi.mock('./api/client', () => ({
  setUnauthorizedHandler: (handler: (() => void) | null) => {
    server.unauthorized = handler;
  },
  unwrap: async (result: Promise<unknown>) => await result,
  api: {
    POST: vi.fn(async (path: string, request?: { body?: { email?: string } }) => {
      if (path === '/login') server.principal = request?.body?.email ?? '';
      if (path === '/v1/auth/logout') server.principal = '';
      return {};
    }),
    GET: server.GET,
  },
}));

function FinancialData() {
  const costs = useFinancialCosts('2026-10');
  const budgets = useFinancialBudgets();
  return (
    <>
      <span data-testid="cost-account">{costs.data?.account_id}</span>
      <span data-testid="budget-account">{budgets.data?.budgets[0]?.account_id}</span>
    </>
  );
}
function Harness() {
  const auth = useAuth();
  return (
    <>
      <button onClick={() => void auth.signIn('a@example.com', 'password')}>Sign in A</button>
      <button onClick={() => void auth.signIn('b@example.com', 'password')}>Sign in B</button>
      <button onClick={() => void auth.signOut()}>Sign out</button>
      <span data-testid="signed-in">{auth.user?.email}</span>
      {auth.user && <FinancialData />}
    </>
  );
}
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <Harness />
      </AuthProvider>
    </QueryClientProvider>
  );
  return client;
}
beforeEach(() => {
  server.principal = '';
  server.delayCosts = false;
  server.delayAccount = false;
  server.resolveCosts = null;
  server.resolveAccount = null;
  server.GET.mockReset().mockImplementation(async (path: string) => {
    const principal = server.principal;
    if (path === '/v1/account') {
      const account = { id: principal, email: principal, plan: 'hobby' };
      if (server.delayAccount)
        return new Promise((resolve) => {
          server.resolveAccount = () => resolve(account);
        });
      return account;
    }
    if (path === '/v1/billing/costs') {
      const report = { account_id: principal, known_usage_millicents: 12345 };
      if (server.delayCosts)
        return new Promise((resolve) => {
          server.resolveCosts = () => resolve(report);
        });
      return report;
    }
    if (path === '/v1/billing/budgets')
      return { budgets: [{ id: `budget-${principal}`, account_id: principal }] };
    throw new Error(`unexpected route ${path}`);
  });
});

it('fetches the new account costs and budgets even while the old cache was fresh', async () => {
  const client = mount();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Sign in A' }));
  await waitFor(() =>
    expect(screen.getByTestId('cost-account')).toHaveTextContent('a@example.com')
  );
  await user.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(client.getQueryCache().getAll()).toHaveLength(0);
  await user.click(screen.getByRole('button', { name: 'Sign in B' }));
  await waitFor(() =>
    expect(screen.getByTestId('cost-account')).toHaveTextContent('b@example.com')
  );
  expect(screen.getByTestId('budget-account')).toHaveTextContent('b@example.com');
  expect(screen.queryByText('a@example.com')).not.toBeInTheDocument();
});

it('drops cached financial data when the session expires', async () => {
  const client = mount();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Sign in A' }));
  await waitFor(() =>
    expect(screen.getByTestId('cost-account')).toHaveTextContent('a@example.com')
  );
  act(() => server.unauthorized?.());
  expect(screen.queryByTestId('cost-account')).not.toBeInTheDocument();
  expect(client.getQueryCache().getAll()).toHaveLength(0);
});

it('cannot restore an old account from an account request completed after logout', async () => {
  server.delayAccount = true;
  const client = mount();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Sign in A' }));
  await waitFor(() => expect(server.resolveAccount).not.toBeNull());
  expect(server.GET.mock.calls.some(([path]) => path === '/v1/billing/costs')).toBe(false);
  await user.click(screen.getByRole('button', { name: 'Sign out' }));
  await act(async () => {
    server.resolveAccount?.();
  });
  expect(screen.getByTestId('signed-in')).toBeEmptyDOMElement();
  expect(screen.queryByTestId('cost-account')).not.toBeInTheDocument();
  expect(client.getQueryCache().getAll()).toHaveLength(0);
});

it('cannot repopulate the new session cache from an old financial request', async () => {
  server.delayCosts = true;
  const client = mount();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Sign in A' }));
  await waitFor(() => expect(server.resolveCosts).not.toBeNull());
  const completeOldRequest = server.resolveCosts;
  await user.click(screen.getByRole('button', { name: 'Sign out' }));
  server.delayCosts = false;
  await user.click(screen.getByRole('button', { name: 'Sign in B' }));
  await waitFor(() =>
    expect(screen.getByTestId('cost-account')).toHaveTextContent('b@example.com')
  );
  await act(async () => {
    completeOldRequest?.();
  });
  expect(screen.getByTestId('cost-account')).toHaveTextContent('b@example.com');
  expect(client.getQueriesData({ queryKey: ['financial', 'a@example.com'] })).toHaveLength(0);
});
