import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';

const app = {
  id: 'app-1',
  slug: 'worker-1',
  workload_class: 'worker',
  scaling_policy: { target: { metric: 'queue_depth', value: 10 } },
};
const binding = {
  id: 'binding-1',
  app_id: 'app-1',
  account_id: 'account-1',
  name: 'default',
  queue_name: 'old-queue',
  mode: 'push',
  workload_class: 'worker',
  enabled: true,
  max_concurrency: 1,
  created_at: '2026-10-10T00:00:00Z',
  updated_at: '2026-10-10T00:00:00Z',
};
const state = vi.hoisted(() => ({
  context: vi.fn(),
  configure: vi.fn(),
  initialApp: null as unknown,
  remoteApp: null as unknown,
}));
vi.mock('@/lib/api/queries', async () => {
  const { useQuery } = await import('@tanstack/react-query');
  return {
    useApp: () =>
      useQuery({
        queryKey: ['apps', 'account', 'account-1', 'worker-1'],
        queryFn: async () => state.remoteApp,
        initialData: state.initialApp,
      }),
    keys: { apps: ['apps'] },
  };
});
vi.mock('@/lib/api/queue-bindings', () => ({
  readQueueBindingContext: state.context,
  configureQueueWorkload: state.configure,
  queueBindingsKey: (account: string, slug: string) => [account, slug, 'bindings'],
}));
const { QueueWorkloadProfile } = await import('./queue-workload-profile');

function mount(bindings = [binding]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <QueueWorkloadProfile
        accountId="account-1"
        plan="hobby"
        slug="worker-1"
        bindings={bindings as never}
      />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  sessionStorage.clear();
  state.initialApp = app;
  state.remoteApp = app;
  state.context.mockReset().mockResolvedValue({ app, bindings: [binding] });
  state.configure.mockReset().mockResolvedValue({
    app,
    binding: { ...binding, queue_name: 'new-queue' },
    scaling_policy: app.scaling_policy,
    created: false,
  });
});

it('does not replace an existing default push queue without explicit consent', async () => {
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole('button', { name: 'Configure platform push profile' }));
  await user.clear(screen.getByLabelText('Profile queue'));
  await user.type(screen.getByLabelText('Profile queue'), 'new-queue');
  await user.click(screen.getByRole('button', { name: 'Review push profile' }));
  expect(await screen.findByText(/replace the current default queue old-queue/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Apply push profile' })).toBeDisabled();
  await user.click(screen.getByLabelText(/I approve replacing the default queue/));
  await user.click(screen.getByRole('button', { name: 'Apply push profile' }));
  await waitFor(() => expect(state.configure).toHaveBeenCalledTimes(1));
  expect(state.configure.mock.calls[0][1]).toMatchObject({
    queue_name: 'new-queue',
    force: true,
    workload_class: 'worker',
  });
});

it('uses force false when there is no conflicting default binding', async () => {
  const user = userEvent.setup();
  state.context.mockResolvedValue({ app, bindings: [] });
  mount([]);
  await user.click(screen.getByRole('button', { name: 'Configure platform push profile' }));
  await user.click(screen.getByRole('button', { name: 'Review push profile' }));
  await user.click(await screen.findByRole('button', { name: 'Apply push profile' }));
  expect(state.configure.mock.calls[0][1].force).toBe(false);
});

it('requires takeover review when a same-queue default binding is pull', async () => {
  const user = userEvent.setup();
  const pullDefault = { ...binding, mode: 'pull' };
  state.context.mockResolvedValue({ app, bindings: [pullDefault] });
  mount([pullDefault]);
  await user.click(screen.getByRole('button', { name: 'Configure platform push profile' }));
  await user.click(screen.getByRole('button', { name: 'Review push profile' }));
  expect(await screen.findByText(/replace the current default binding/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Apply push profile' })).toBeDisabled();
  await user.click(screen.getByLabelText(/I approve replacing the default binding/));
  await user.click(screen.getByRole('button', { name: 'Apply push profile' }));
  expect(state.configure.mock.calls[0][1].force).toBe(false);
});

it('keeps a lost profile response frozen after reload until inspection', async () => {
  const user = userEvent.setup();
  state.context.mockResolvedValue({ app, bindings: [] });
  state.configure.mockRejectedValueOnce(new TypeError('connection lost'));
  mount([]);
  await user.click(screen.getByRole('button', { name: 'Configure platform push profile' }));
  await user.click(screen.getByRole('button', { name: 'Review push profile' }));
  await user.click(await screen.findByRole('button', { name: 'Apply push profile' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/outcome is unconfirmed/i);
  cleanup();
  mount([]);
  expect(screen.getByRole('button', { name: 'Inspect profile outcome' })).toBeVisible();
  expect(state.configure).toHaveBeenCalledTimes(1);
});

it('refreshes app policy after inspecting a lost accepted profile before another review', async () => {
  const user = userEvent.setup();
  state.context.mockResolvedValue({ app, bindings: [] });
  state.configure.mockRejectedValueOnce(new TypeError('connection lost'));
  mount([]);
  await user.click(screen.getByRole('button', { name: 'Configure platform push profile' }));
  await user.click(screen.getByRole('button', { name: 'Review push profile' }));
  await user.click(await screen.findByRole('button', { name: 'Apply push profile' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/unconfirmed/i);
  const changed = {
    ...app,
    scaling_policy: { target: { metric: 'queue_depth', value: 20 } },
  };
  state.remoteApp = changed;
  state.context.mockResolvedValue({ app: changed, bindings: [] });
  await user.click(screen.getByRole('button', { name: 'Inspect profile outcome' }));
  expect(await screen.findByText(/Current scaling target: queue_depth 20/)).toBeVisible();
  await user.click(screen.getByLabelText(/I inspected the default binding/));
  await user.click(screen.getByRole('button', { name: 'Start a new reviewed profile' }));
  await user.click(screen.getByRole('button', { name: 'Configure platform push profile' }));
  await user.click(screen.getByRole('button', { name: 'Review push profile' }));
  expect(await screen.findByRole('button', { name: 'Apply push profile' })).toBeVisible();
});

it('requires review of warm-floor and advanced scaling removal', async () => {
  const user = userEvent.setup();
  const advanced = {
    ...app,
    scaling_policy: {
      min_instances: 2,
      targets: [{ metric: 'cpu', value: 70 }],
      timezone: 'Europe/Istanbul',
      schedules: [{ cron: '0 8 * * 1-5', duration_s: 3600, min_instances: 2 }],
    },
  };
  state.initialApp = advanced;
  state.remoteApp = advanced;
  state.context.mockResolvedValue({ app: advanced, bindings: [] });
  mount([]);
  await user.click(screen.getByRole('button', { name: 'Configure platform push profile' }));
  await user.click(screen.getByRole('button', { name: 'Review push profile' }));
  expect(await screen.findByText(/warm floor from 2 to 0/i)).toBeVisible();
  expect(screen.getByText(/remove 1 multi-signal target/i)).toBeVisible();
  expect(screen.getByText(/remove 1 scheduled capacity window/i)).toBeVisible();
  expect(screen.getByText(/timezone Europe\/Istanbul/i)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Apply push profile' })).toBeDisabled();
  await user.click(screen.getByLabelText(/I approve these scaling policy changes/));
  expect(screen.getByRole('button', { name: 'Apply push profile' })).toBeEnabled();
});
