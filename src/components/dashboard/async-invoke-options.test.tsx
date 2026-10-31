import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NO_ASYNC_OPTIONS, type AsyncInvokeOptions } from '@/lib/api/async-invocations';
import { spyApi } from '@/test/api';

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
  await userEvent.click(screen.getByText(/Work policy, deadline and destinations/));

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
  await userEvent.click(screen.getByText(/Work policy, deadline and destinations/));
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
  await userEvent.click(screen.getByText(/Work policy, deadline and destinations/));
  expect(await screen.findByLabelText('On failure')).toBeInTheDocument();
  expect(screen.queryByLabelText('Work policy')).not.toBeInTheDocument();
  expect(get).not.toHaveBeenCalledWith('/v1/apps/{slug}/work-policies', expect.anything());
});
