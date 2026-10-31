import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { problem, renderWithProviders, routeApi, type Answer } from '@/test/monetization';

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { id: 'acct-1', plan: 'pro' } }) }));

const { BindingVerificationRuns } = await import('./binding-verification-runs');

const RUNS = '/v1/apps/{slug}/bindings/verification-runs';
const RUN = '/v1/apps/{slug}/bindings/verification-runs/{run}';
const DIAG = '/v1/apps/{slug}/bindings/verification-runs/{run}/diagnostics';
const ADMIT = '/v1/apps/{slug}/bindings/verification-runs/{run}/steps/{step}/admit';
const COMPLETE = '/v1/apps/{slug}/bindings/verification-runs/{run}/complete';
const RESUME = '/v1/apps/{slug}/bindings/verification-runs/{run}/resume';
const REVIEW = '/v1/apps/{slug}/bindings/verification-runs/review';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const DEP = '22222222-2222-4222-8222-222222222222';
const TASK = '33333333-3333-4333-8333-333333333333';

type Run = Record<string, unknown> & { steps: Record<string, unknown>[] };

const pendingRun = (): Run => ({
  id: RUN_ID,
  app: 'api',
  deployment_id: DEP,
  scope: 'default',
  status: 'pending',
  created_at: '2026-10-31T09:00:00Z',
  expires_at: '2026-10-31T09:10:00Z',
  object_storage_write: false,
  queue_publish: true,
  review_digest: 'a'.repeat(64),
  max_concurrency: 2,
  policy: {
    app_id: 'x',
    scope: 'default',
    mode: 'enforce',
    revision: 3,
    max_verification_age: '10m0s',
    require_application_ack: false,
  },
  inventory: { app: 'api', generated_at: '2026-10-31T09:00:00Z', complete: true, bindings: [] },
  steps: [
    {
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
    },
    {
      plan: {
        type: 'queue',
        name: 'orders',
        binding: 'orders',
        scope: 'default',
        action: 'queue-canary',
        reason: 'handler_completion',
      },
      owned: false,
      status: 'planned',
    },
    {
      plan: {
        type: 'postgres',
        name: 'main',
        binding: 'DATABASE_URL',
        scope: 'default',
        action: 'reuse',
        reason: 'evidence_current',
      },
      resource_id: TASK,
      resource_kind: 'task',
      owned: false,
      status: 'succeeded',
    },
  ],
});

let runs: Record<string, Run>;
let summaries: Record<string, unknown>[];
type Init = { params?: { path?: Record<string, unknown> }; body?: unknown };
let answers: Partial<Record<string, (init: Init) => Answer>>;
let spies: ReturnType<typeof routeApi>;

const diagnostics = () => ({
  run_id: RUN_ID,
  app: 'api',
  deployment_id: DEP,
  scope: 'default',
  status: 'pending',
  checked_at: '2026-10-31T09:01:00Z',
  expires_at: '2026-10-31T09:10:00Z',
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
  changes: [{ field: 'policy_revision', reviewed: '3', current: '4' }],
  recovery: [{ action: 'resume', message: 'Continue the original run.' }],
  budget: {
    run_id: RUN_ID,
    max_concurrency: 2,
    active_resources: 0,
    waiting_steps: 2,
    full: false,
  },
});

beforeEach(() => {
  runs = { [RUN_ID]: pendingRun() };
  summaries = [
    {
      id: RUN_ID,
      app: 'api',
      deployment_id: DEP,
      scope: 'default',
      status: 'pending',
      created_at: '2026-10-31T09:00:00Z',
      expires_at: '2026-10-31T09:10:00Z',
    },
    {
      id: '44444444-4444-4444-8444-444444444444',
      app: 'api',
      deployment_id: DEP,
      scope: 'default',
      status: 'passed',
      created_at: '2026-10-30T09:00:00Z',
      expires_at: '2026-10-30T09:10:00Z',
    },
  ];
  answers = {};
  const runOf = (init: Init) => runs[String(init.params?.path?.run)];
  const answer = (key: string, fallback: (init: Init) => Answer) => (init: Init) =>
    answers[key] ? answers[key](init) : fallback(init);
  spies = routeApi(
    {
      [`GET ${RUNS}`]: () => ({ runs: summaries, observed_at: '2026-10-31T09:02:00Z' }),
      [`GET ${RUN}`]: answer('get', (init) => runOf(init) ?? problem(404, 'not_found')),
      [`GET ${DIAG}`]: answer('diag', () => diagnostics()),
      [`POST ${ADMIT}`]: answer('admit', (init) => {
        const run = runs[RUN_ID];
        const index = Number(init.params?.path?.step);
        const kind = run.steps[index].plan as { action: string };
        run.steps[index] = {
          ...run.steps[index],
          resource_id: '55555555-5555-4555-8555-55555555555' + index,
          resource_kind: kind.action === 'queue-canary' ? 'queue' : 'task',
          owned: true,
          status: kind.action === 'queue-canary' ? 'published' : 'queued',
        };
        return run.steps[index];
      }),
      [`POST ${COMPLETE}`]: answer('complete', () => {
        runs[RUN_ID] = { ...runs[RUN_ID], status: 'passed' };
        return runs[RUN_ID];
      }),
      [`POST ${RESUME}`]: answer('resume', () => runs[RUN_ID]),
      [`DELETE ${RUN}`]: answer('cancel', () => {
        runs[RUN_ID] = { ...runs[RUN_ID], status: 'cancelled' };
        return runs[RUN_ID];
      }),
      [`POST ${REVIEW}`]: answer('review', () => ({
        app: 'api',
        deployment_id: DEP,
        scope: 'default',
        service_targets: {},
        reviewed_at: '2026-10-31T09:05:00Z',
        ready: true,
        review_digest: 'b'.repeat(64),
        object_storage_write_required: false,
        queue_publish_required: true,
        inventory: runs[RUN_ID].inventory,
        policy: runs[RUN_ID].policy,
        plan: runs[RUN_ID].steps.map((step) => step.plan),
        blockers: [],
      })),
      [`POST ${RUNS}`]: answer('create', (init) => {
        const id = String((init.body as { id: string }).id);
        runs[id] = { ...pendingRun(), id };
        return runs[id];
      }),
    },
    {}
  );
});

afterEach(() => vi.restoreAllMocks());

async function openRun(user: ReturnType<typeof userEvent.setup>) {
  renderWithProviders(<BindingVerificationRuns slug="api" />);
  const list = await screen.findByRole('list', { name: /verification runs/i });
  await user.click(within(list).getAllByRole('button', { name: /open run/i })[0]);
  return screen.findByRole('region', { name: /run 11111111/i });
}

it('lists retained runs with their stored status and says who drives them', async () => {
  renderWithProviders(<BindingVerificationRuns slug="api" />);
  const list = await screen.findByRole('list', { name: /verification runs/i });
  expect(within(list).getAllByRole('listitem')).toHaveLength(2);
  expect(within(list).getByText('Pending')).toBeInTheDocument();
  expect(within(list).getByText('Passed')).toBeInTheDocument();
  expect(screen.getByText(/never starts them on its own/i)).toBeInTheDocument();
});

it('says so when the app has no runs', async () => {
  summaries = [];
  renderWithProviders(<BindingVerificationRuns slug="api" />);
  expect(await screen.findByText(/no verification runs/i)).toBeInTheDocument();
});

it('shows each step’s state and why it is waiting, with the diagnostics', async () => {
  const user = userEvent.setup();
  const detail = await openRun(user);
  const steps = within(detail).getByRole('list', { name: /steps/i });
  const items = within(steps).getAllByRole('listitem');
  expect(items).toHaveLength(3);
  expect(within(items[0]).getByText(/waiting for you to admit/i)).toBeInTheDocument();
  expect(
    within(items[0]).getByText(/billing has no current service verification/i)
  ).toBeInTheDocument();
  expect(within(items[2]).getByText(/reuses it/i)).toBeInTheDocument();
  expect(within(items[2]).queryByRole('button', { name: /admit/i })).not.toBeInTheDocument();
  expect(within(detail).getByText(/policy_revision/)).toBeInTheDocument();
  expect(within(detail).getByText(/continue the original run/i)).toBeInTheDocument();
  expect(within(detail).getByText(/0 of 2 unfinished/i)).toBeInTheDocument();
});

it('admits a probe step by its index without asking', async () => {
  const user = userEvent.setup();
  const detail = await openRun(user);
  await user.click(within(detail).getByRole('button', { name: /admit step 1/i }));
  await waitFor(() => expect(spies.POST).toHaveBeenCalledWith(ADMIT, expect.anything()));
  const call = spies.POST.mock.calls.find(([path]) => path === ADMIT) as [
    string,
    { params: { path: Record<string, unknown> } },
  ];
  expect(call[1].params.path).toEqual({ slug: 'api', run: RUN_ID, step: 0 });
  expect(await within(detail).findByText(/probe task is queued/i)).toBeInTheDocument();
});

it('confirms before a queue-canary admission publishes a message', async () => {
  const user = userEvent.setup();
  const detail = await openRun(user);
  await user.click(within(detail).getByRole('button', { name: /admit step 2/i }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(/publish a canary message to orders/i)).toBeInTheDocument();
  await user.click(within(dialog).getByRole('button', { name: /cancel/i }));
  expect(spies.POST.mock.calls.some(([path]) => path === ADMIT)).toBe(false);

  await user.click(within(detail).getByRole('button', { name: /admit step 2/i }));
  await user.click(
    within(await screen.findByRole('dialog')).getByRole('button', { name: /publish/i })
  );
  await waitFor(() => expect(spies.POST.mock.calls.some(([path]) => path === ADMIT)).toBe(true));
});

it('explains a full admission budget by its code', async () => {
  answers.admit = () => problem(429, 'binding_verification_budget_full', 'Observe the run.');
  const user = userEvent.setup();
  const detail = await openRun(user);
  await user.click(within(detail).getByRole('button', { name: /admit step 1/i }));
  expect(await within(detail).findByText(/budget is full/i)).toBeInTheDocument();
});

/** Every probe and queue-canary step admitted by this run and succeeded. */
function admitAll(status = 'succeeded') {
  const run = runs[RUN_ID];
  run.steps = run.steps.map((step, index) => {
    const action = (step.plan as { action: string }).action;
    if (action !== 'probe' && action !== 'queue-canary') return step;
    return {
      ...step,
      resource_id: '55555555-5555-4555-8555-55555555555' + index,
      resource_kind: action === 'queue-canary' ? 'queue' : 'task',
      owned: true,
      status,
    };
  });
}

it('keeps Complete off until every probe and canary step this run admitted succeeded', async () => {
  // faas bindings/verification_runs.go:239-246 refuses completion otherwise.
  const user = userEvent.setup();
  const detail = await openRun(user);
  expect(within(detail).getByRole('button', { name: /^complete/i })).toBeDisabled();
  expect(within(detail).getByText(/admit steps 1 and 2 first/i)).toBeInTheDocument();
});

it('keeps Complete off while an admitted step is still running', async () => {
  admitAll('running');
  const user = userEvent.setup();
  const detail = await openRun(user);
  expect(within(detail).getByRole('button', { name: /^complete/i })).toBeDisabled();
  expect(within(detail).getByText(/wait for steps 1 and 2 to succeed/i)).toBeInTheDocument();
});

it('says a failed step needs a new run, and offers no Complete', async () => {
  admitAll();
  (runs[RUN_ID].steps[0] as Record<string, unknown>).status = 'failed';
  const user = userEvent.setup();
  const detail = await openRun(user);
  expect(within(detail).getByRole('button', { name: /^complete/i })).toBeDisabled();
  expect(within(detail).getByText(/step 1 ended failed.*review a new run/i)).toBeInTheDocument();
});

it('completes a run and shows it passed, without implying traffic moved', async () => {
  admitAll();
  const user = userEvent.setup();
  const detail = await openRun(user);
  await user.click(within(detail).getByRole('button', { name: /^complete/i }));
  await waitFor(() => expect(within(detail).getAllByText('Passed').length).toBeGreaterThan(0));
  expect(within(detail).getByText(/promotion still rechecks/i)).toBeInTheDocument();
  expect(within(detail).queryByRole('button', { name: /^complete/i })).not.toBeInTheDocument();
});

it('says what it is waiting for when completion is still settling', async () => {
  admitAll();
  answers.complete = () => ({
    ...runs[RUN_ID],
    qualification: {
      checked_at: '2026-10-31T09:03:00Z',
      conditions: [{ app: 'api', code: 'queue_consumer_unobserved', name: 'orders' }],
    },
  });
  const user = userEvent.setup();
  const detail = await openRun(user);
  await user.click(within(detail).getByRole('button', { name: /^complete/i }));
  expect(await within(detail).findByText(/not passed yet/i)).toBeInTheDocument();
  expect(within(detail).getByText(/queue_consumer_unobserved/)).toBeInTheDocument();
});

it('explains a 409 after every step succeeded as the final policy check, not a dead run', async () => {
  admitAll();
  answers.complete = () => problem(409, 'binding_verification_run_changed', 'Changed.');
  const user = userEvent.setup();
  const detail = await openRun(user);
  await user.click(within(detail).getByRole('button', { name: /^complete/i }));
  expect(await within(detail).findByText(/final policy check/i)).toBeInTheDocument();
  expect(within(detail).getByText(/check the diagnostics/i)).toBeInTheDocument();
});

it('explains a 409 after a step failed meanwhile as needing a new run', async () => {
  admitAll();
  answers.complete = () => {
    (runs[RUN_ID].steps[1] as Record<string, unknown>).status = 'failed';
    return problem(409, 'binding_verification_run_changed', 'Changed.');
  };
  const user = userEvent.setup();
  const detail = await openRun(user);
  await user.click(within(detail).getByRole('button', { name: /^complete/i }));
  expect(await within(detail).findByText(/step 2 ended failed/i)).toBeInTheDocument();
});

it('cancels only after a destructive confirmation naming the effect', async () => {
  const user = userEvent.setup();
  const detail = await openRun(user);
  await user.click(within(detail).getByRole('button', { name: /cancel run/i }));
  const dialog = await screen.findByRole('dialog');
  expect(
    within(dialog).getByText(/cancels the unfinished probes and canary messages/i)
  ).toBeInTheDocument();
  expect(spies.DELETE).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole('button', { name: /cancel run/i }));
  await waitFor(() => expect(spies.DELETE).toHaveBeenCalledWith(RUN, expect.anything()));
  expect(await within(detail).findAllByText('Cancelled')).not.toHaveLength(0);
});

it('offers no actions on a run that is no longer pending', async () => {
  runs[RUN_ID] = { ...pendingRun(), status: 'expired', reason: 'run_expired' };
  const user = userEvent.setup();
  const detail = await openRun(user);
  await within(detail).findAllByText('Expired');
  expect(within(detail).queryByRole('button', { name: /admit/i })).not.toBeInTheDocument();
  expect(within(detail).queryByRole('button', { name: /cancel run/i })).not.toBeInTheDocument();
});

it('reviews the live deployment, then creates a run only with the consent it needs', async () => {
  const user = userEvent.setup();
  renderWithProviders(<BindingVerificationRuns slug="api" />);
  await user.click(await screen.findByRole('button', { name: /review a new run/i }));
  await user.click(screen.getByRole('button', { name: /review plan/i }));
  const review = await screen.findByRole('region', { name: /reviewed plan/i });
  expect(spies.POST).toHaveBeenCalledWith(
    REVIEW,
    expect.objectContaining({ params: { path: { slug: 'api' } }, body: {} })
  );
  const create = within(review).getByRole('button', { name: /create run/i });
  expect(create).toBeDisabled();
  await user.click(within(review).getByRole('checkbox', { name: /publish queue canary/i }));
  expect(create).toBeEnabled();
  await user.click(create);

  await waitFor(() => expect(spies.POST).toHaveBeenCalledWith(RUNS, expect.anything()));
  const [, init] = spies.POST.mock.calls.find(([path]) => path === RUNS) as [
    string,
    { body: Record<string, unknown> },
  ];
  expect(init.body).toMatchObject({
    deployment_id: DEP,
    review_digest: 'b'.repeat(64),
    ttl_seconds: 600,
    max_concurrency: 2,
    queue_publish: true,
    object_storage_write: false,
  });
  expect(String(init.body.id)).toMatch(/^[0-9a-f-]{36}$/);
  expect(await screen.findByRole('region', { name: /run [0-9a-f]{8}/i })).toBeInTheDocument();
});

it('explains a review the server refused with every condition faas checks', async () => {
  answers.review = () => problem(409, 'binding_verification_run_changed', 'Changed.');
  const user = userEvent.setup();
  renderWithProviders(<BindingVerificationRuns slug="api" />);
  await user.click(await screen.findByRole('button', { name: /review a new run/i }));
  await user.click(screen.getByRole('button', { name: /review plan/i }));
  // validVerificationRunInventory (faas bindings/verification_runs.go:102-104).
  const message = await screen.findByText(/enforced release policy/i);
  expect(message).toHaveTextContent(/complete binding inventory/i);
  expect(message).toHaveTextContent(/deployment you named/i);
  expect(message).toHaveTextContent(/instance.*started since its configuration/i);
});

it('shows plan blockers and offers no creation when the review is not ready', async () => {
  answers.review = () => ({
    app: 'api',
    deployment_id: DEP,
    scope: 'default',
    service_targets: {},
    reviewed_at: '2026-10-31T09:05:00Z',
    ready: false,
    review_digest: '',
    object_storage_write_required: false,
    queue_publish_required: false,
    inventory: runs[RUN_ID].inventory,
    policy: runs[RUN_ID].policy,
    plan: [],
    blockers: [{ code: 'task_probes_unavailable', message: 'The task API is unavailable.' }],
  });
  const user = userEvent.setup();
  renderWithProviders(<BindingVerificationRuns slug="api" />);
  await user.click(await screen.findByRole('button', { name: /review a new run/i }));
  await user.click(screen.getByRole('button', { name: /review plan/i }));
  expect(await screen.findByText(/task API is unavailable/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /create run/i })).not.toBeInTheDocument();
});

it('explains the per-app run limit by its code', async () => {
  answers.create = () => problem(429, 'binding_verification_run_limit', 'Cancel a run.');
  const user = userEvent.setup();
  renderWithProviders(<BindingVerificationRuns slug="api" />);
  await user.click(await screen.findByRole('button', { name: /review a new run/i }));
  await user.click(screen.getByRole('button', { name: /review plan/i }));
  const review = await screen.findByRole('region', { name: /reviewed plan/i });
  await user.click(within(review).getByRole('checkbox', { name: /publish queue canary/i }));
  await user.click(within(review).getByRole('button', { name: /create run/i }));
  expect(await screen.findByText(/8 unfinished runs/i)).toBeInTheDocument();
});
