import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { problem, renderWithProviders, routeApi, type Answer } from '@/test/monetization';
import { iso } from '@/test/workflows';

const cap = vi.hoisted(() => ({ access: 'on' as string }));
vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: () => ({ access: cap.access, refresh: vi.fn() }),
  useCapabilityStage: () => 'Beta',
}));

const { RecoveryPolicyBody, draftToPolicy } = await import('./recovery-policy');

const UPDATED = '2026-11-01T09:00:00Z';
const automaticPolicy = {
  enabled: true,
  mode: 'automatic_retry',
  workflow_names: ['invoice-sync'],
  triggers: ['saved_failure'],
  failure_statuses: ['failed', 'dead'],
  max_resume_count: 3,
  cooldown_seconds: 300,
  hourly_action_budget: 10,
  hourly_execution_budget: 3,
  pause_after_failures: 2,
  rate_per_second: 1,
  reason: 'Retry invoice pushes',
};
const configured = {
  app_id: 'app',
  version: 2,
  policy: automaticPolicy,
  updated_at: UPDATED,
  actor_kind: 'account',
  actor_id: 'acct',
  status: 'monitoring',
  automatic_execution: { consecutive_failures: 0, pause_reason: '' },
};
const unconfigured = {
  app_id: 'app',
  version: 0,
  policy: {
    enabled: false,
    mode: 'preview',
    workflow_names: [],
    triggers: [],
    failure_statuses: [],
    max_resume_count: 0,
    cooldown_seconds: 0,
    hourly_action_budget: 0,
    rate_per_second: 0,
    reason: '',
  },
  updated_at: '1970-01-01T00:00:00Z',
  actor_kind: '',
  actor_id: '',
  status: 'disabled',
};
const health = {
  status: 'healthy',
  reason: 'no_blocker_observed',
  stall_after_seconds: 900,
  queue: {
    policy: configured,
    observed_at: iso(0),
    pending: 1,
    outstanding: 0,
    hourly_executions: 1,
    remaining_budget: 2,
    entries: [],
    truncated: false,
  },
};
const changePreview = {
  current: configured,
  proposed: automaticPolicy,
  observed_at: iso(0),
  next_version: 3,
  pending_suppressed: 1,
  outstanding_retained: 0,
  entries: [],
  entries_truncated: false,
  automatic_execution_enabled: true,
  hourly_executions: 1,
  remaining_execution_budget: 2,
  hourly_prepared_actions: 1,
  remaining_preparation_budget: 9,
  inspected_jobs: 2,
  jobs_truncated: false,
  candidates: [
    {
      job_id: 'job',
      decision: {
        position: 1,
        run_id: 'run',
        resume_count: 0,
        trigger: 'saved_failure',
        action: 'retry',
        outcome: 'would_prepare',
      },
    },
  ],
  candidates_truncated: false,
};

type Handler = (init: { body?: unknown }) => Answer;
function serve(policy: unknown, extra: Record<string, Handler> = {}) {
  return routeApi({
    'GET /v1/apps/{slug}/recovery-policy': () => policy,
    'GET /v1/apps/{slug}/recovery-policy/health': () => health,
    ...extra,
  });
}

beforeEach(() => {
  cap.access = 'on';
});
afterEach(() => vi.restoreAllMocks());

describe('Recovery policy', () => {
  it('shows a configured policy, its health as figures, and the CLI for reviews', async () => {
    serve(configured);
    renderWithProviders(<RecoveryPolicyBody slug="billing" />);
    expect(await screen.findByText('Retry saved failures automatically')).toBeInTheDocument();
    expect(screen.getByText('Watching')).toBeInTheDocument();
    expect(screen.getByText('5 min')).toBeInTheDocument();
    expect(screen.getByText('2 failed retries in a row')).toBeInTheDocument();
    expect(await screen.findByText('Budget left this hour')).toBeInTheDocument();
    expect(
      screen.getByText('gregale automation recovery-policy history --app billing')
    ).toBeInTheDocument();
  });

  it('says plainly when there is no policy, and reads no health for it', async () => {
    const spies = serve(unconfigured);
    renderWithProviders(<RecoveryPolicyBody slug="billing" />);
    expect(await screen.findByText(/No policy yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set up policy' })).toBeInTheDocument();
    expect(spies.GET).not.toHaveBeenCalledWith(
      '/v1/apps/{slug}/recovery-policy/health',
      expect.anything()
    );
  });

  it('previews a change at the observed version before saving it', async () => {
    const spies = serve(configured, {
      'POST /v1/apps/{slug}/recovery-policy/change-preview': () => changePreview,
      'PUT /v1/apps/{slug}/recovery-policy': () => ({ ...configured, version: 3 }),
    });
    renderWithProviders(<RecoveryPolicyBody slug="billing" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit policy' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit the recovery policy' });
    const save = within(dialog).getByRole('button', { name: 'Save policy' });
    expect(save).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Review change' }));
    const impact = await within(dialog).findByRole('region', { name: 'What saving changes' });
    expect(within(impact).getByText('Saving creates version 3')).toBeInTheDocument();
    expect(within(impact).getByText(/1 pending automatic retry is suppressed/)).toBeInTheDocument();
    expect(spies.POST).toHaveBeenCalledWith(
      '/v1/apps/{slug}/recovery-policy/change-preview',
      expect.objectContaining({ body: { expected_version: 2, policy: automaticPolicy } })
    );
    await userEvent.click(save);
    expect(await screen.findByText('Recovery policy saved as version 3')).toBeInTheDocument();
    expect(spies.PUT).toHaveBeenCalledWith(
      '/v1/apps/{slug}/recovery-policy',
      expect.objectContaining({ body: { expected_version: 2, policy: automaticPolicy } })
    );
  });

  it('stops at the form when the draft breaks a rule, and sends nothing', async () => {
    const spies = serve(unconfigured);
    renderWithProviders(<RecoveryPolicyBody slug="billing" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Set up policy' }));
    const dialog = await screen.findByRole('dialog', { name: 'Set up a recovery policy' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Review change' }));
    expect(within(dialog).getByText('Name 1 to 10 workflows.')).toBeInTheDocument();
    expect(within(dialog).getByText('Give a reason of up to 512 characters.')).toBeInTheDocument();
    expect(spies.POST).not.toHaveBeenCalled();
  });

  it('explains a stale version by its code', async () => {
    serve(configured, {
      'POST /v1/apps/{slug}/recovery-policy/change-preview': () =>
        problem(409, 'conflict', 'recovery policy version changed'),
    });
    renderWithProviders(<RecoveryPolicyBody slug="billing" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit policy' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Review change' }));
    expect(
      await within(dialog).findByText(/The policy changed since you opened it/)
    ).toBeInTheDocument();
  });

  it('pauses automatic recovery with a reason, fenced to what it read', async () => {
    const spies = serve(configured, {
      'POST /v1/apps/{slug}/recovery-policy/control': () => ({ ...configured, status: 'paused' }),
    });
    renderWithProviders(<RecoveryPolicyBody slug="billing" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Pause automatic recovery' }));
    const dialog = await screen.findByRole('dialog', { name: 'Pause automatic recovery?' });
    expect(within(dialog).getByText(/retries already started continue/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Pause' }));
    expect(within(dialog).getByText(/Say why/)).toBeInTheDocument();
    expect(spies.POST).not.toHaveBeenCalled();
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'provider incident');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Pause' }));
    expect(await screen.findByText('Automatic recovery paused')).toBeInTheDocument();
    expect(spies.POST).toHaveBeenCalledWith(
      '/v1/apps/{slug}/recovery-policy/control',
      expect.objectContaining({
        body: {
          expected_version: 2,
          expected_updated_at: UPDATED,
          operation: 'pause',
          reason: 'provider incident',
        },
      })
    );
  });

  it('reads nothing while the capability is off', async () => {
    cap.access = 'off';
    const spies = serve(configured);
    renderWithProviders(<RecoveryPolicyBody slug="billing" />);
    expect(await screen.findByText('Not enabled for this account')).toBeInTheDocument();
    expect(spies.GET).not.toHaveBeenCalled();
  });
});

describe('draftToPolicy', () => {
  const draft = {
    enabled: true,
    mode: 'preview' as const,
    workflows: 'a, b',
    triggers: ['saved_failure', 'stalled'] as ('saved_failure' | 'stalled')[],
    statuses: [] as ('failed' | 'dead')[],
    maxResume: '3',
    cooldown: '300',
    hourlyActions: '10',
    rate: '1',
    hourlyExecutions: '3',
    pauseAfter: '2',
    alerts: false,
    stallAfter: '900',
    alertAfter: '900',
    reason: 'why',
  };

  it('leaves automatic limits out of a preview policy', () => {
    const { policy, problems } = draftToPolicy(draft);
    expect(problems).toEqual([]);
    expect(policy).toMatchObject({
      workflow_names: ['a', 'b'],
      triggers: ['saved_failure', 'stalled'],
    });
    expect(policy).not.toHaveProperty('hourly_execution_budget');
  });

  it('gives an automatic mode its one trigger and requires failure statuses', () => {
    expect(draftToPolicy({ ...draft, mode: 'automatic_initial' }).problems).toContain(
      'Choose which failure statuses count.'
    );
    const { policy } = draftToPolicy({ ...draft, mode: 'automatic_initial', statuses: ['dead'] });
    expect(policy).toMatchObject({
      triggers: ['initial_failure'],
      hourly_execution_budget: 3,
      pause_after_failures: 2,
    });
  });

  it('holds limits to the ranges apid accepts', () => {
    expect(draftToPolicy({ ...draft, cooldown: '59' }).problems).toContain(
      'Cooldown must be 60 to 604,800 seconds (7 days).'
    );
    expect(draftToPolicy({ ...draft, maxResume: '17' }).problems).toContain(
      'Resumes per run must be 1 to 16.'
    );
    expect(draftToPolicy({ ...draft, workflows: 'a, a' }).problems).toContain(
      'A workflow is named twice.'
    );
  });
});
