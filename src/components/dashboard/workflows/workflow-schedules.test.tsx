import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { problem, renderWithProviders, routeApi, type Answer } from '@/test/monetization';
import { iso } from '@/test/workflows';

const cap = vi.hoisted(() => ({ access: 'on' as string }));
vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: () => ({ access: cap.access, refresh: vi.fn() }),
  useCapabilityStage: () => 'Beta',
}));

const { WorkflowSchedulesBody } = await import('./workflow-schedules');

const SKIPPED = '66666666-6666-4666-8666-666666666666';
const OLD_DEPLOY = '77777777-7777-4777-8777-777777777777';
const STARTED = '88888888-8888-4888-8888-888888888888';
const RUN = '99999999-9999-4999-8999-999999999999';

const schedules = {
  runtime_enabled: true,
  schedules: [
    {
      workflow_name: 'nightly-report',
      deployment_id: 'dep',
      schedule: '0 2 * * *',
      timezone: 'Europe/Istanbul',
      overlap: 'skip',
      catch_up: 'latest',
      catch_up_window: '6h0m0s',
      enabled: true,
      next_fire_at: iso(5 * 3_600_000),
      last_scheduled_for: iso(-19 * 3_600_000),
      last_status: 'started',
      last_run_id: RUN,
    },
  ],
};

const occurrence = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
  id,
  app_id: 'app',
  workflow_name: 'invoice-sync',
  deployment_id: 'dep',
  scheduled_for: iso(-15 * 60_000),
  evaluated_at: iso(-15 * 60_000),
  status,
  ...extra,
});

const history = {
  occurrences: [
    occurrence(SKIPPED, 'skipped_overlap'),
    occurrence(OLD_DEPLOY, 'skipped_quota', { scheduled_for: iso(-30 * 60_000) }),
    occurrence(STARTED, 'started', { scheduled_for: iso(-45 * 60_000), run_id: RUN }),
  ],
  next_cursor: STARTED,
};

type Handler = (init: { body?: unknown; params?: { query?: Record<string, unknown> } }) => Answer;

function serve(extra: Record<string, Handler> = {}) {
  return routeApi({
    'GET /v1/apps/{slug}/workflows/schedules': () => schedules,
    'GET /v1/apps/{slug}/workflows/schedules/occurrences': (init) =>
      init.params?.query?.cursor
        ? { occurrences: [occurrence('older', 'started', { scheduled_for: iso(-86_400_000) })] }
        : history,
    ...extra,
  });
}

beforeEach(() => {
  cap.access = 'on';
});
afterEach(() => vi.restoreAllMocks());

describe('Workflow schedules', () => {
  it('lists deployed schedules with their cron, zone, policies and last fire', async () => {
    serve();
    const onOpenRun = vi.fn();
    renderWithProviders(<WorkflowSchedulesBody slug="billing" onOpenRun={onOpenRun} />);
    expect(await screen.findByText('0 2 * * *')).toBeInTheDocument();
    expect(screen.getByText('Europe/Istanbul')).toBeInTheDocument();
    expect(screen.getByText('in 5h')).toBeInTheDocument();
    expect(screen.getByText(/run latest within 6h0m0s/)).toBeInTheDocument();
    expect(screen.getByText('Started a run')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Open run' })[0]);
    expect(onOpenRun).toHaveBeenCalledWith(RUN);
  });

  it('says why nothing fires when scheduling is unavailable', async () => {
    routeApi({
      'GET /v1/apps/{slug}/workflows/schedules': () => ({
        runtime_enabled: false,
        unavailable_reason: 'runtime_disabled',
        schedules: [],
      }),
      'GET /v1/apps/{slug}/workflows/schedules/occurrences': () => ({ occurrences: [] }),
    });
    renderWithProviders(<WorkflowSchedulesBody slug="billing" onOpenRun={vi.fn()} />);
    expect(await screen.findByText(/workflow runtime is off/)).toBeInTheDocument();
    expect(screen.getByText(/No scheduled workflows on the live deployment/)).toBeInTheDocument();
    expect(screen.getByText(/No schedule has fired in the last 30 days/)).toBeInTheDocument();
  });

  it('previews the next fires of a schedule on request', async () => {
    serve({
      'GET /v1/apps/{slug}/workflows/schedules/{name}/preview': () => ({
        workflow_name: 'nightly-report',
        deployment_id: 'dep',
        schedule: '0 2 * * *',
        timezone: 'Europe/Istanbul',
        overlap: 'skip',
        enabled: true,
        observed_at: iso(0),
        evaluation_at: iso(0),
        dst_behavior: {
          mode: 'fixed_wall_time',
          spring_gap: 'shift_to_first_valid_minute',
          fall_fold: 'run_once_at_first_occurrence',
        },
        upcoming: [
          {
            scheduled_for: iso(5 * 3_600_000),
            local_time: '2026-11-04T02:00:00+03:00',
            dst_adjustment: 'shifted_forward',
          },
        ],
        catch_up: {
          policy: 'latest',
          outcome: 'coalesce_latest',
          eligible_occurrences: 3,
          coalesced_occurrences: 2,
          missed_occurrences_not_recovered: false,
          missed_outside_window: false,
        },
      }),
    });
    renderWithProviders(<WorkflowSchedulesBody slug="billing" onOpenRun={vi.fn()} />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Preview nightly-report schedule' })
    );
    const preview = await screen.findByRole('region', { name: 'Next fires of nightly-report' });
    expect(within(preview).getByText('2026-11-04T02:00:00+03:00 local')).toBeInTheDocument();
    expect(within(preview).getByText(/Moved forward by a daylight-saving gap/)).toBeInTheDocument();
    expect(within(preview).getByText(/2 older fires are folded into it/)).toBeInTheDocument();
  });

  it('replays skipped minutes only after a preview and a confirm naming what will not replay', async () => {
    const spies = serve({
      'POST /v1/apps/{slug}/workflows/schedules/occurrences:replay-preview': () => ({
        outcomes: [
          { occurrence_id: SKIPPED, outcome: 'eligible' },
          { occurrence_id: OLD_DEPLOY, outcome: 'deployment_changed' },
        ],
      }),
      'POST /v1/apps/{slug}/workflows/schedules/occurrences:replay': () => ({
        outcomes: [{ occurrence_id: SKIPPED, outcome: 'replayed', replay_run_id: RUN }],
      }),
    });
    renderWithProviders(<WorkflowSchedulesBody slug="billing" onOpenRun={vi.fn()} />);
    const boxes = await screen.findAllByRole('checkbox', { name: /Select skipped/ });
    // A started minute cannot be replayed, so it has no checkbox.
    expect(boxes).toHaveLength(2);
    for (const box of boxes) await userEvent.click(box);
    await userEvent.click(screen.getByRole('button', { name: 'Replay 2 skipped' }));
    const dialog = await screen.findByRole('dialog', { name: 'Replay 1 skipped minute?' });
    expect(
      within(dialog).getByText(/1 selected will not: 1 the live deployment has changed since/)
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Replay' }));
    expect(await screen.findByText('Started 1 replay run')).toBeInTheDocument();
    expect(spies.POST).toHaveBeenLastCalledWith(
      '/v1/apps/{slug}/workflows/schedules/occurrences:replay',
      expect.objectContaining({ body: { occurrence_ids: [SKIPPED] } })
    );
  });

  it('replays nothing when no selected minute is eligible', async () => {
    const spies = serve({
      'POST /v1/apps/{slug}/workflows/schedules/occurrences:replay-preview': () => ({
        outcomes: [{ occurrence_id: OLD_DEPLOY, outcome: 'quota_full' }],
      }),
    });
    renderWithProviders(<WorkflowSchedulesBody slug="billing" onOpenRun={vi.fn()} />);
    const boxes = await screen.findAllByRole('checkbox', { name: /Select skipped/ });
    await userEvent.click(boxes[1]);
    await userEvent.click(screen.getByRole('button', { name: 'Replay 1 skipped' }));
    expect(await screen.findByText('Nothing can be replayed')).toBeInTheDocument();
    expect(spies.POST).toHaveBeenCalledTimes(1);
  });

  it('loads older minutes with the cursor', async () => {
    const spies = serve();
    renderWithProviders(<WorkflowSchedulesBody slug="billing" onOpenRun={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Load older minutes' }));
    await waitFor(() =>
      expect(spies.GET).toHaveBeenCalledWith(
        '/v1/apps/{slug}/workflows/schedules/occurrences',
        expect.objectContaining({
          params: { path: { slug: 'billing' }, query: { limit: 50, cursor: STARTED } },
        })
      )
    );
  });

  it('shows a failed read as an error', async () => {
    routeApi({
      'GET /v1/apps/{slug}/workflows/schedules': () =>
        problem(503, 'capacity', 'failed to read workflow schedules'),
      'GET /v1/apps/{slug}/workflows/schedules/occurrences': () => ({ occurrences: [] }),
    });
    renderWithProviders(<WorkflowSchedulesBody slug="billing" onOpenRun={vi.fn()} />);
    expect(await screen.findByText('failed to read workflow schedules')).toBeInTheDocument();
  });

  it('reads nothing while the capability is off', async () => {
    cap.access = 'plan-not-entitled';
    const spies = serve();
    renderWithProviders(<WorkflowSchedulesBody slug="billing" onOpenRun={vi.fn()} />);
    expect(await screen.findByText('Not included in your plan')).toBeInTheDocument();
    expect(spies.GET).not.toHaveBeenCalled();
  });
});
