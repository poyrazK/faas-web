import type { ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '@/components/ui/confirm';
import { ToastProvider } from '@/components/ui/toast';
import { spyApi } from '@/test/api';

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ account: { id: 'acct', plan: 'pro' }, loading: false }),
}));
const cap = vi.hoisted(() => ({ access: 'on' as string }));
vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: () => ({
    access: cap.access,
    capability: { key: 'async-invocations', maturity: 'beta' },
    refresh: vi.fn(),
  }),
}));

const { AppRetryDefaults } = await import('./app-retry-defaults');

const ok = (data: unknown) => Promise.resolve({ data, response: new Response() });
const problem = (status: number, code: string, detail: string) =>
  Promise.resolve({
    error: { type: 'about:blank', title: code, status, code, detail },
    response: new Response(null, { status }),
  });

function mount(children: ReactNode = <AppRetryDefaults slug="billing" />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ConfirmProvider>{children}</ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

function appRoute(retry_policy: unknown) {
  return spyApi('GET').mockImplementation((path: string) =>
    path === '/v1/apps/{slug}' ? ok({ slug: 'billing', retry_policy }) : ok(undefined)
  );
}

beforeEach(() => {
  cap.access = 'on';
});
afterEach(() => vi.restoreAllMocks());

it('says the plan decides when the app sets no default, labelled beta', async () => {
  appRoute(null);
  mount();
  expect(
    await screen.findByText(
      'Plan default: up to 10 attempts, first retry after 1 s, doubling each time'
    )
  ).toBeInTheDocument();
  expect(screen.getByText('Beta')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Use plan default' })).not.toBeInTheDocument();
});

it("shows the app's stored curve in its fields", async () => {
  appRoute({ max_attempts: 4, base_seconds: 1, max_seconds: 30, jitter_seconds: 0.2 });
  mount();
  expect(
    await screen.findByText(
      'Up to 4 attempts, first retry after 1 s, doubling to at most 30 s, ±20% jitter'
    )
  ).toBeInTheDocument();
  expect(screen.getByLabelText('Max attempts')).toHaveValue(4);
  expect(screen.getByLabelText('Jitter (±%)')).toHaveValue(20);
});

it('saves a new default with PATCH retry_policy', async () => {
  appRoute(null);
  const patch = spyApi('PATCH').mockImplementation(() =>
    ok({ slug: 'billing', retry_policy: { max_attempts: 5, max_seconds: 60 } })
  );
  mount();
  await userEvent.type(await screen.findByLabelText('Max attempts'), '5');
  await userEvent.type(screen.getByLabelText('Longest wait (s)'), '60');
  await userEvent.click(screen.getByRole('button', { name: 'Save default' }));
  await waitFor(() =>
    expect(patch).toHaveBeenCalledWith('/v1/apps/{slug}', {
      params: { path: { slug: 'billing' } },
      body: { retry_policy: { max_attempts: 5, max_seconds: 60 } },
    })
  );
  expect(await screen.findByText('Retry default saved')).toBeInTheDocument();
});

it('does not send a curve apid would refuse', async () => {
  appRoute(null);
  const patch = spyApi('PATCH');
  mount();
  await userEvent.type(await screen.findByLabelText('First retry after (s)'), '30');
  await userEvent.type(screen.getByLabelText('Longest wait (s)'), '5');
  await userEvent.tab();
  expect(screen.getByText(/at least the first one/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save default' })).toBeDisabled();
  expect(patch).not.toHaveBeenCalled();
});

it('clears the default with an empty object, after asking', async () => {
  appRoute({ max_attempts: 4 });
  const patch = spyApi('PATCH').mockImplementation(() =>
    ok({ slug: 'billing', retry_policy: null })
  );
  mount();
  await userEvent.click(await screen.findByRole('button', { name: 'Use plan default' }));
  const dialog = await screen.findByRole('dialog');
  expect(patch).not.toHaveBeenCalled();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Use plan default' }));
  await waitFor(() =>
    expect(patch).toHaveBeenCalledWith('/v1/apps/{slug}', {
      params: { path: { slug: 'billing' } },
      body: { retry_policy: {} },
    })
  );
});

it('names a refused curve by its code rather than a generic failure', async () => {
  appRoute(null);
  spyApi('PATCH').mockImplementation(() =>
    problem(422, 'trigger_invalid_retry_policy', 'max_attempts must be between 1 and 25 when set')
  );
  mount();
  await userEvent.type(await screen.findByLabelText('Max attempts'), '3');
  await userEvent.click(screen.getByRole('button', { name: 'Save default' }));
  expect(await screen.findByText('Retry policy refused')).toBeInTheDocument();
  expect(screen.getByText(/between 1 and 25/)).toBeInTheDocument();
});

it('reads nothing when async invocations are not available to the account', () => {
  cap.access = 'plan-not-entitled';
  const get = appRoute(null);
  mount();
  expect(get).not.toHaveBeenCalled();
  expect(screen.getByRole('status')).toHaveTextContent(/not included in your plan/i);
});

it('shows a failed read as an error, not as the plan default', async () => {
  spyApi('GET').mockImplementation(() => problem(503, 'store_unavailable', 'app read failed'));
  mount();
  expect(await screen.findByText(/app read failed/)).toBeInTheDocument();
  expect(screen.queryByText(/Plan default/)).not.toBeInTheDocument();
});
