import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NO_ASYNC_OPTIONS, type AsyncInvokeOptions } from '@/lib/api/async-invocations';
import { spyApi } from '@/test/api';

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ account: { id: 'acct', plan: 'pro' }, loading: false }),
}));
const cap = vi.hoisted(() => ({ access: 'on' as string, workPolicies: 'on' as string }));
vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: (id: string) => ({
    access: id === 'work-policies' ? cap.workPolicies : cap.access,
    capability: { key: id, maturity: id === 'work-policies' ? 'preview' : 'beta' },
    refresh: vi.fn(),
  }),
}));

const { AsyncInvokeOptionsFields } = await import('./async-invoke-options');

const ok = (data: unknown) => Promise.resolve({ data, response: new Response() });
const HOOK = '11111111-1111-4111-8111-111111111111';
const latest = vi.fn<(value: AsyncInvokeOptions) => void>();

function Harness() {
  const [value, setValue] = useState(NO_ASYNC_OPTIONS);
  return (
    <AsyncInvokeOptionsFields
      slug="docs"
      value={value}
      onChange={(next) => {
        latest(next);
        setValue(next);
      }}
    />
  );
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>
  );
}

function routes(policies: unknown[]) {
  return spyApi('GET').mockImplementation((path: string) => {
    if (path === '/v1/apps/{slug}/work-policies') return ok({ policies });
    if (path === '/v1/apps/{slug}/webhooks')
      return ok([{ id: HOOK, target_url: 'https://hooks.example.com/done' }]);
    return ok(undefined);
  });
}

beforeEach(() => {
  cap.access = 'on';
  cap.workPolicies = 'on';
  latest.mockReset();
});
afterEach(() => vi.restoreAllMocks());

it('reads nothing until opened, and is labelled from the capability maturity', () => {
  const get = routes([]);
  mount();
  expect(screen.getByText('Beta')).toBeInTheDocument();
  expect(get).not.toHaveBeenCalled();
});

it('picks a work policy, key, deadline and destinations', async () => {
  routes([{ name: 'document-index', revision: 3 }]);
  mount();
  await userEvent.click(
    screen.getByText(/Retries, retention, deadline, work policy and destinations/)
  );

  const policy = await screen.findByLabelText('Work policy');
  await waitFor(() =>
    expect(screen.getByRole('option', { name: 'document-index' })).toBeInTheDocument()
  );
  expect(screen.queryByLabelText('Work key')).not.toBeInTheDocument();
  await userEvent.selectOptions(policy, 'document-index');
  await userEvent.type(screen.getByLabelText('Work key'), 'd1');
  await userEvent.type(screen.getByLabelText(/Fairness key/), 'tenant-42');

  await waitFor(() =>
    expect(screen.getAllByRole('option', { name: 'https://hooks.example.com/done' })).toHaveLength(
      2
    )
  );
  await userEvent.selectOptions(screen.getByLabelText('On failure'), HOOK);

  expect(latest).toHaveBeenLastCalledWith(
    expect.objectContaining({
      policy: 'document-index',
      key: 'd1',
      fairnessKey: 'tenant-42',
      onFailure: HOOK,
      onSuccess: '',
    })
  );
  expect(screen.getByLabelText(/Deadline/)).toHaveAttribute('type', 'datetime-local');
});

it('explains where policies come from when the app has none', async () => {
  routes([]);
  mount();
  await userEvent.click(
    screen.getByText(/Retries, retention, deadline, work policy and destinations/)
  );
  expect(await screen.findByText(/no work policies/)).toBeInTheDocument();
});

it('renders nothing when async invocations are not available to the account', () => {
  cap.access = 'plan-not-entitled';
  const get = routes([]);
  mount();
  expect(screen.queryByText(/Work policy/)).not.toBeInTheDocument();
  expect(get).not.toHaveBeenCalled();
});

it('leaves out work policies, and never reads them, while that capability is hidden', async () => {
  cap.workPolicies = 'off';
  const get = routes([{ name: 'document-index', revision: 3 }]);
  mount();
  await userEvent.click(
    screen.getByText(/Retries, retention, deadline, work policy and destinations/)
  );
  expect(await screen.findByLabelText('On failure')).toBeInTheDocument();
  expect(screen.queryByLabelText('Work policy')).not.toBeInTheDocument();
  expect(get).not.toHaveBeenCalledWith('/v1/apps/{slug}/work-policies', expect.anything());
});

it('sets a retry curve and a shorter retention for this one invocation', async () => {
  routes([]);
  mount();
  await userEvent.click(screen.getByText(/Retries, retention, deadline/));
  const attempts = await screen.findByLabelText('Max attempts');
  expect(attempts).toHaveAttribute('placeholder', 'Plan cap (10)');
  await userEvent.type(attempts, '4');
  await userEvent.type(screen.getByLabelText('First retry after (s)'), '2');
  await userEvent.type(screen.getByLabelText('Jitter (±%)'), '20');
  await userEvent.type(screen.getByLabelText('Keep the result for'), '12');
  await userEvent.selectOptions(screen.getByLabelText('Keep the result for unit'), 'hours');
  expect(latest).toHaveBeenLastCalledWith(
    expect.objectContaining({
      retry: { maxAttempts: '4', baseSeconds: '2', maxSeconds: '', jitter: '20' },
      retention: { amount: '12', unit: 'hours' },
    })
  );
  expect(screen.getByText(/up to 30 days on your plan/i)).toBeInTheDocument();
});

it('says what is wrong with a retry field once it is left', async () => {
  routes([]);
  mount();
  await userEvent.click(screen.getByText(/Retries, retention, deadline/));
  const attempts = await screen.findByLabelText('Max attempts');
  await userEvent.type(attempts, '40');
  expect(screen.queryByText(/whole number from 1 to 25/)).not.toBeInTheDocument();
  await userEvent.tab();
  expect(screen.getByText(/whole number from 1 to 25/)).toBeInTheDocument();
  expect(attempts).toHaveAttribute('aria-invalid', 'true');
});
