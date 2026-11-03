import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { problem, renderWithProviders, routeApi, type Answer } from '@/test/monetization';
import { ProjectVerificationRuns } from './project-verification-runs';

const RUNS = '/v1/projects/{slug}/environments/{environment}/release-sets/verification-runs';
const RUN = `${RUNS}/{run}`;
const DIAG = `${RUN}/diagnostics`;
const COMPLETE = `${RUN}/complete`;
const RESUME = `${RUN}/resume`;
const ADMIT = '/v1/apps/{slug}/bindings/verification-runs/{run}/steps/{step}/admit';

const GRAPH = '11111111-1111-4111-8111-111111111111';
const OLD = '22222222-2222-4222-8222-222222222222';
const API_RUN = '33333333-3333-4333-8333-333333333333';
const WORKER_RUN = '44444444-4444-4444-8444-444444444444';
const DEP = '55555555-5555-4555-8555-555555555555';

type Init = { params?: { path?: Record<string, unknown>; query?: Record<string, unknown> } };

const policy = {
  app_id: 'x',
  scope: 'production',
  mode: 'enforce',
  revision: 2,
  max_verification_age: '10m0s',
  require_application_ack: false,
};
const member = (app: string, id: string, steps: Record<string, unknown>[]) => ({
  id,
  app,
  deployment_id: DEP,
  scope: 'production',
  graph_run_id: GRAPH,
  status: 'pending',
  created_at: '2026-11-03T09:00:00Z',
  expires_at: '2026-11-03T09:10:00Z',
  object_storage_write: false,
  queue_publish: false,
  review_digest: 'a'.repeat(64),
  max_concurrency: 2,
  policy,
  inventory: { app, generated_at: '2026-11-03T09:00:00Z', complete: true, bindings: [] },
  steps,
});
const probe = (over: Record<string, unknown> = {}) => ({
  plan: {
    type: 'service',
    name: 'billing',
    binding: 'BILLING_URL',
    scope: 'app',
    action: 'probe',
    reason: 'verification_unknown',
  },
  owned: false,
  status: 'planned',
  ...over,
});
const reused = () => ({
  plan: {
    type: 'postgres',
    name: 'main',
    binding: 'DATABASE_URL',
    scope: 'production',
    action: 'reuse',
    reason: 'evidence_current',
  },
  resource_id: '66666666-6666-4666-8666-666666666666',
  resource_kind: 'task',
  owned: false,
  status: 'succeeded',
});

let graph: Record<string, unknown> & { members: Record<string, ReturnType<typeof member>> };
let summaries: Record<string, unknown>[];
let answers: Partial<Record<string, (init: Init) => Answer>>;
let spies: ReturnType<typeof routeApi>;
const confirm = vi.fn();

vi.mock('@/components/ui/confirm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ui/confirm')>()),
  useConfirm: () => confirm,
}));

beforeEach(() => {
  confirm.mockReset().mockResolvedValue(true);
  graph = {
    id: GRAPH,
    project: 'shop',
    environment: 'production',
    status: 'pending',
    created_at: '2026-11-03T09:00:00Z',
    expires_at: '2026-11-03T09:10:00Z',
    review_digest: 'b'.repeat(64),
    manifest: {
      project: 'shop',
      environment: 'production',
      ttl_seconds: 3600,
      deployments: { api: DEP, worker: DEP },
      expected_active_release_id: '',
      expected_fallback_deployments: {},
      expected_policy_revisions: { api: 2, worker: 2 },
      service_targets: {},
    },
    object_storage_write: false,
    queue_publish: false,
    max_concurrency: 2,
    members: {
      api: member('api', API_RUN, [probe(), reused()]),
      worker: member('worker', WORKER_RUN, [reused()]),
    },
  };
  summaries = [
    {
      id: GRAPH,
      project: 'shop',
      environment: 'production',
      status: 'pending',
      created_at: '2026-11-03T09:00:00Z',
      expires_at: '2026-11-03T09:10:00Z',
    },
    {
      id: OLD,
      project: 'shop',
      environment: 'production',
      status: 'expired',
      created_at: '2026-11-02T09:00:00Z',
      expires_at: '2026-11-02T09:10:00Z',
    },
  ];
  answers = {};
  const answer = (key: string, fallback: (init: Init) => Answer) => (init: Init) =>
    answers[key] ? answers[key](init) : fallback(init);
  spies = routeApi({
    [`GET ${RUNS}`]: (init: Init) => {
      const status = init.params?.query?.status;
      return {
        runs: summaries.filter((row) => !status || row.status === status),
        observed_at: '2026-11-03T09:02:00Z',
      };
    },
    [`GET ${RUN}`]: answer('get', () => graph),
    [`GET ${DIAG}`]: answer('diag', () => ({
      run_id: GRAPH,
      project: 'shop',
      environment: 'production',
      status: 'pending',
      checked_at: '2026-11-03T09:01:00Z',
      expires_at: '2026-11-03T09:10:00Z',
      complete: true,
      members: {
        api: {
          run_id: API_RUN,
          app: 'api',
          deployment_id: DEP,
          scope: 'production',
          status: 'pending',
          checked_at: '2026-11-03T09:01:00Z',
          expires_at: '2026-11-03T09:10:00Z',
          complete: true,
          check_passed: false,
          blockers: [
            {
              code: 'verification_unknown',
              message: 'billing has no current service verification.',
              recovery: 'resume',
              step_index: 0,
            },
          ],
          changes: [],
          recovery: [],
        },
      },
      blockers: [],
      changes: [],
      recovery: [{ action: 'resume', message: 'Admit the waiting member steps.' }],
    })),
    [`POST ${ADMIT}`]: answer('admit', (init) => {
      const path = init.params?.path ?? {};
      const run = graph.members[String(path.slug)];
      const index = Number(path.step);
      run.steps[index] = {
        ...run.steps[index],
        resource_id: '77777777-7777-4777-8777-777777777777',
        resource_kind: 'task',
        owned: true,
        status: 'queued',
      };
      return run.steps[index];
    }),
    [`POST ${COMPLETE}`]: answer('complete', () => ({ ...graph, status: 'passed' })),
    [`POST ${RESUME}`]: answer('resume', () => graph),
    [`DELETE ${RUN}`]: answer('cancel', () => ({ ...graph, status: 'cancelled' })),
  });
});

afterEach(() => vi.restoreAllMocks());

const mount = () =>
  renderWithProviders(
    <ProjectVerificationRuns accountId="acct" project="shop" environment="production" />
  );

async function openGraph(user: ReturnType<typeof userEvent.setup>) {
  mount();
  const list = await screen.findByRole('list', { name: /graph verification runs/i });
  await user.click(within(list).getAllByRole('button', { name: /open graph run/i })[0]);
  return screen.findByRole('region', { name: /graph run 11111111/i });
}

it('lists the environment’s graph runs and filters them by status', async () => {
  const user = userEvent.setup();
  mount();
  const list = await screen.findByRole('list', { name: /graph verification runs/i });
  expect(within(list).getAllByRole('listitem')).toHaveLength(2);
  expect(within(list).getByText('Expired')).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Passed' }));
  expect(
    await screen.findByText('No passed graph verification runs are retained for production.')
  ).toBeInTheDocument();
  expect(spies.GET).toHaveBeenLastCalledWith(
    RUNS,
    expect.objectContaining({
      params: {
        path: { slug: 'shop', environment: 'production' },
        query: { limit: 20, status: 'passed' },
      },
    })
  );
});

it('hands creation to the CLI, since the console does not prepare release sets', async () => {
  mount();
  expect(
    await screen.findByText(
      'gregale environment release-sets verify --durable --file manifest.json shop production'
    )
  ).toBeInTheDocument();
});

it('shows each member with its steps and why one waits, and keeps Complete off', async () => {
  const user = userEvent.setup();
  const detail = await openGraph(user);
  const api = within(detail).getByRole('region', { name: 'Member api' });
  expect(within(api).getByText(/current results do not yet satisfy its policy/i)).toBeVisible();
  expect(
    await within(api).findByText('billing has no current service verification.')
  ).toBeVisible();
  expect(within(detail).getByRole('region', { name: 'Member worker' })).toBeInTheDocument();
  expect(within(detail).getByText('api: To complete, admit step 1 first.')).toBeInTheDocument();
  expect(within(detail).getByRole('button', { name: 'Complete' })).toBeDisabled();
});

it('admits a member’s step through that member app’s own admit route', async () => {
  const user = userEvent.setup();
  const detail = await openGraph(user);
  const api = within(detail).getByRole('region', { name: 'Member api' });
  await user.click(within(api).getByRole('button', { name: 'Admit step 1' }));
  await waitFor(() =>
    expect(spies.POST).toHaveBeenCalledWith(
      ADMIT,
      expect.objectContaining({ params: { path: { slug: 'api', run: API_RUN, step: 0 } } })
    )
  );
});

it('completes the graph and says what is still settling on a 202', async () => {
  const user = userEvent.setup();
  graph.members.api.steps = [
    probe({
      resource_id: '77777777-7777-4777-8777-777777777777',
      resource_kind: 'task',
      owned: true,
      status: 'succeeded',
    }),
  ];
  answers.complete = () => ({
    ...graph,
    qualification: {
      checked_at: '2026-11-03T09:03:00Z',
      conditions: [{ app: 'worker', code: 'runtime_updating' }],
    },
  });
  const detail = await openGraph(user);
  await user.click(within(detail).getByRole('button', { name: 'Complete' }));
  const status = await within(detail).findByText(/readiness conditions are still settling/i);
  expect(status.closest('[role="status"]')).toHaveTextContent('worker: runtime_updating');
});

it('explains a refused completion by its code', async () => {
  const user = userEvent.setup();
  graph.members.api.steps = [reused()];
  answers.complete = () => problem(409, 'binding_verification_run_changed');
  const detail = await openGraph(user);
  await user.click(within(detail).getByRole('button', { name: 'Complete' }));
  expect(await within(detail).findByRole('alert')).toHaveTextContent(
    /plan, policy, configuration, deadline or results changed/i
  );
});

it('cancels only after a destructive confirmation naming every member', async () => {
  const user = userEvent.setup();
  const detail = await openGraph(user);
  confirm.mockResolvedValueOnce(false);
  await user.click(within(detail).getByRole('button', { name: 'Cancel graph run' }));
  expect(spies.DELETE).not.toHaveBeenCalled();
  await user.click(within(detail).getByRole('button', { name: 'Cancel graph run' }));
  expect(confirm).toHaveBeenLastCalledWith(
    expect.objectContaining({
      destructive: true,
      description: expect.stringMatching(/every member/i),
    })
  );
  await waitFor(() => expect(spies.DELETE).toHaveBeenCalledWith(RUN, expect.anything()));
});

it('offers no actions on a graph that is no longer pending', async () => {
  const user = userEvent.setup();
  graph.status = 'expired';
  const detail = await openGraph(user);
  expect(within(detail).queryByRole('button', { name: 'Complete' })).toBeNull();
  expect(within(detail).queryByRole('button', { name: /admit step/i })).toBeNull();
});
