import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { StageQueueBindings } from './stage-queue-bindings';

const state = vi.hoisted(() => ({
  snapshot: {
    kind: 'ready',
    data: {
      environment: 'staging',
      workload: 'worker-1',
      revision: 2,
      workload_revision: 7,
      config_hash: 'a'.repeat(64),
      activation_state: 'unavailable',
      bindings: [
        {
          name: 'orders',
          queue_name: 'orders',
          mode: 'pull',
          workload_class: 'worker',
          enabled: true,
          max_concurrency: 2,
          retry_policy: { max_attempts: 3 },
        },
        {
          name: 'exports',
          queue_name: 'exports',
          mode: 'push',
          workload_class: 'worker',
          enabled: false,
          max_concurrency: 1,
        },
      ],
    },
  },
  readContext: vi.fn(),
  replace: vi.fn(),
  refetch: vi.fn(),
  uninitialized: false,
}));
vi.mock('@/lib/api/queue-bindings', () => ({
  useStageQueueBindings: () => ({
    data: state.uninitialized ? { kind: 'uninitialized', workloadRevision: 0 } : state.snapshot,
    isPending: false,
    error: null,
    refetch: state.refetch,
  }),
  readStageQueueWriteContext: state.readContext,
  replaceStageQueueBindings: state.replace,
  stageQueueBindingsKey: () => ['stage-queues'],
}));
vi.mock('@/lib/api/capabilities', () => ({
  useCapability: () => ({ accountId: 'a', state: 'available', refresh: vi.fn() }),
}));
const selection = {
  accountId: 'a',
  plan: 'hobby' as const,
  project: 'shop',
  projectId: 'p',
  environment: 'staging',
  environmentId: 'e',
  workload: 'worker-1',
  appId: 'app-1',
};
function mount(protectedStage = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let currentPlan: 'hobby' | 'free' = 'hobby';
  const content = (nextProtected: boolean) => (
    <QueryClientProvider client={client}>
      <StageQueueBindings
        selection={{ ...selection, plan: currentPlan }}
        protectedStage={nextProtected}
      />
    </QueryClientProvider>
  );
  const view = render(content(protectedStage));
  return {
    ...view,
    updateProtected: (next: boolean) => view.rerender(content(next)),
    updatePlan: (next: 'hobby' | 'free') => {
      currentPlan = next;
      view.rerender(content(protectedStage));
    },
  };
}
beforeEach(() => {
  state.uninitialized = false;
  state.readContext.mockReset().mockResolvedValue(state.snapshot);
  state.replace.mockReset().mockResolvedValue(state.snapshot.data);
  state.refetch.mockReset();
});

it('requires explicit acknowledgment to initialize an empty stage collection', async () => {
  state.uninitialized = true;
  state.readContext.mockResolvedValue({ kind: 'uninitialized', workloadRevision: 0 });
  mount();
  expect(screen.getByText(/collection not initialized/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Review complete stage replacement' }));
  const save = await screen.findByRole('button', { name: 'Save stage definitions' });
  expect(save).toBeDisabled();
  await userEvent.click(screen.getByLabelText('Remove all desired stage bindings'));
  expect(save).toBeEnabled();
  await userEvent.click(save);
  await waitFor(() =>
    expect(state.replace).toHaveBeenCalledWith(
      'shop',
      'staging',
      'worker-1',
      {
        expected_revision: 0,
        bindings: [],
      },
      expect.any(AbortSignal)
    )
  );
});

it('reviews the complete desired list and writes the workload revision, preserving unrelated rows', async () => {
  mount();
  expect(screen.getByText(/Activation unavailable/)).toBeInTheDocument();
  expect(screen.getByText(/workload revision 7/)).toBeInTheDocument();
  await userEvent.clear(screen.getByLabelText('Max concurrency orders'));
  await userEvent.type(screen.getByLabelText('Max concurrency orders'), '4');
  await userEvent.click(screen.getByRole('button', { name: 'Review complete stage replacement' }));
  await screen.findByText(/2 desired definitions/);
  await userEvent.click(screen.getByRole('button', { name: 'Save stage definitions' }));
  await waitFor(() => expect(state.replace).toHaveBeenCalledTimes(1));
  expect(state.replace).toHaveBeenCalledWith(
    'shop',
    'staging',
    'worker-1',
    {
      expected_revision: 7,
      bindings: [
        expect.objectContaining({
          name: 'orders',
          max_concurrency: 4,
          retry_policy: { max_attempts: 3 },
        }),
        expect.objectContaining({ name: 'exports', enabled: false }),
      ],
    },
    expect.any(AbortSignal)
  );
  expect(state.readContext).toHaveBeenCalledTimes(2);
});

it('keeps a protected stage read only', () => {
  mount(true);
  expect(screen.getByText(/Protected stage/)).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Review complete stage replacement' })
  ).not.toBeInTheDocument();
});

it('clears a stale review after a conflict without resubmitting', async () => {
  state.replace.mockRejectedValueOnce(
    new ApiError({ status: 409, code: 'conflict', title: 'Stale workload' })
  );
  mount();
  await userEvent.click(screen.getByRole('button', { name: 'Review complete stage replacement' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save stage definitions' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/changed.*review again/i);
  expect(state.replace).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: 'Save stage definitions' })).not.toBeInTheDocument();
});

it('allows correction after a definitive stage validation rejection', async () => {
  state.replace.mockRejectedValueOnce(
    new ApiError({ status: 422, code: 'validation_failed', title: 'Invalid queue' })
  );
  mount();
  await userEvent.click(screen.getByRole('button', { name: 'Review complete stage replacement' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save stage definitions' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/rejected/i);
  expect(
    screen.getByRole('button', { name: 'Review complete stage replacement' })
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Refresh and inspect stage' })
  ).not.toBeInTheDocument();
});

it('blocks a changed workload head before sending a reviewed replacement', async () => {
  state.readContext.mockResolvedValueOnce(state.snapshot).mockResolvedValueOnce({
    ...state.snapshot,
    data: { ...state.snapshot.data, workload_revision: 8 },
  });
  mount();
  await userEvent.click(screen.getByRole('button', { name: 'Review complete stage replacement' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save stage definitions' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/changed.*review again/i);
  expect(state.replace).not.toHaveBeenCalled();
  expect(
    screen.queryByRole('button', { name: 'Refresh and inspect stage' })
  ).not.toBeInTheDocument();
});

it('stops a delayed reviewed save when the selected stage becomes protected', async () => {
  let resolve!: (value: typeof state.snapshot) => void;
  const delayed = new Promise<typeof state.snapshot>((done) => {
    resolve = done;
  });
  state.readContext.mockResolvedValueOnce(state.snapshot).mockReturnValueOnce(delayed);
  const view = mount();
  await userEvent.click(screen.getByRole('button', { name: 'Review complete stage replacement' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save stage definitions' }));
  await waitFor(() => expect(state.readContext).toHaveBeenCalledTimes(2));
  view.updateProtected(true);
  await act(async () => resolve(state.snapshot));
  expect(state.replace).not.toHaveBeenCalled();
  expect(screen.getByText(/Protected stage/)).toBeInTheDocument();
});

it('stops a delayed reviewed save after the account drops to Free', async () => {
  let resolve!: (value: typeof state.snapshot) => void;
  const delayed = new Promise<typeof state.snapshot>((done) => {
    resolve = done;
  });
  state.readContext.mockResolvedValueOnce(state.snapshot).mockReturnValueOnce(delayed);
  const view = mount();
  await userEvent.click(screen.getByRole('button', { name: 'Review complete stage replacement' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save stage definitions' }));
  await waitFor(() => expect(state.readContext).toHaveBeenCalledTimes(2));
  view.updatePlan('free');
  await act(async () => resolve(state.snapshot));
  expect(state.replace).not.toHaveBeenCalled();
  expect(screen.getByText(/availability must be confirmed/)).toBeInTheDocument();
});
