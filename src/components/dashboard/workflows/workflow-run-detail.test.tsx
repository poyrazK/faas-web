import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { problem, renderWithProviders, routeApi, type Answer } from '@/test/monetization';
import { diagnostics, iso, run } from '@/test/workflows';
import { WorkflowRunDetail } from './workflow-run-detail';

const ID = '44444444-4444-4444-8444-444444444444';
const CB = '55555555-5555-4555-8555-555555555555';

type Handler = (init: { body?: unknown; params?: unknown }) => Answer;

function serve(overrides: Record<string, Handler>) {
  return routeApi({
    'GET /v1/apps/{slug}': () => ({ id: 'app-uuid', slug: 'billing' }),
    'GET /v1/workflows/runs/{id}': () => run(ID),
    'GET /v1/workflows/runs/{id}/steps': () => ({ steps: [] }),
    'GET /v1/workflows/runs/{id}/diagnostics': () => diagnostics(ID, { status: 'succeeded' }),
    'GET /v1/workflows/runs/{id}/callbacks': () => ({ callbacks: [] }),
    'GET /v1/workflows/runs/{id}/resumes': () => ({ resumes: [] }),
    ...overrides,
  });
}

const failedRun = run(ID, {
  status: 'failed',
  current_step: 'push',
  last_error: 'step push failed after 3 attempts',
  resume_count: 1,
});
const failedSteps = {
  steps: [
    { step_name: 'fetch', status: 'succeeded', attempt: 1, created_at: iso(-60_000) },
    {
      step_name: 'push',
      status: 'failed',
      attempt: 3,
      created_at: iso(-60_000),
      error: 'HTTP 502 from POST /invoices/push',
    },
    {
      step_name: 'notify',
      status: 'skipped',
      attempt: 0,
      created_at: iso(-60_000),
      skip_reason: 'dependency_failed',
    },
  ],
};

afterEach(() => vi.restoreAllMocks());

describe('Workflow run detail', () => {
  it('resumes at the resume_count the diagnostics observed, after saying what reopens', async () => {
    const spies = serve({
      'GET /v1/workflows/runs/{id}': () => failedRun,
      'GET /v1/workflows/runs/{id}/steps': () => failedSteps,
      'GET /v1/workflows/runs/{id}/diagnostics': () =>
        diagnostics(ID, {
          resume: {
            eligible: true,
            expected_resume_count: 1,
            reopened_steps: ['push'],
            preserved_steps: ['fetch', 'notify'],
            blockers: [],
          },
        }),
      'POST /v1/workflows/runs/{id}/resume': () => ({ ...failedRun, status: 'pending' }),
    });
    renderWithProviders(<WorkflowRunDetail slug="billing" id={ID} onClose={vi.fn()} />);
    expect(await screen.findByText('step push failed after 3 attempts')).toBeInTheDocument();
    const resume = await screen.findByRole('button', { name: 'Resume run' });
    await waitFor(() => expect(resume).toBeEnabled());
    await userEvent.click(resume);
    const dialog = await screen.findByRole('dialog', { name: 'Resume this invoice-sync run?' });
    expect(within(dialog).getByText(/Reopens push with a fresh retry budget/)).toBeInTheDocument();
    expect(within(dialog).getByText(/resume 2 of 16/)).toBeInTheDocument();
    expect(spies.POST).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Resume run' }));
    expect(await screen.findByText('Run resumed')).toBeInTheDocument();
    expect(spies.POST).toHaveBeenCalledWith(
      '/v1/workflows/runs/{id}/resume',
      expect.objectContaining({ body: { expected_resume_count: 1 } })
    );
  });

  it('explains why a run cannot resume and offers no resume', async () => {
    serve({
      'GET /v1/workflows/runs/{id}': () => ({ ...failedRun, status: 'dead' }),
      'GET /v1/workflows/runs/{id}/diagnostics': () =>
        diagnostics(ID, {
          status: 'dead',
          resume: {
            eligible: false,
            expected_resume_count: 1,
            reopened_steps: [],
            preserved_steps: [],
            blockers: [
              {
                code: 'handler_executed',
                message: 'A failure or timeout handler already ran for this run.',
              },
            ],
          },
        }),
    });
    renderWithProviders(<WorkflowRunDetail slug="billing" id={ID} onClose={vi.fn()} />);
    expect(
      await screen.findByText('A failure or timeout handler already ran for this run.')
    ).toBeInTheDocument();
    expect(screen.getByText('handler_executed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume run' })).toBeDisabled();
  });

  it('names a stale resume as a conflict, by its code', async () => {
    serve({
      'GET /v1/workflows/runs/{id}': () => failedRun,
      'GET /v1/workflows/runs/{id}/diagnostics': () =>
        diagnostics(ID, {
          resume: {
            eligible: true,
            expected_resume_count: 1,
            reopened_steps: ['push'],
            preserved_steps: [],
            blockers: [],
          },
        }),
      'POST /v1/workflows/runs/{id}/resume': () =>
        problem(409, 'workflow_resume_conflict', 'expected_resume_count must match'),
    });
    renderWithProviders(<WorkflowRunDetail slug="billing" id={ID} onClose={vi.fn()} />);
    const resume = await screen.findByRole('button', { name: 'Resume run' });
    await waitFor(() => expect(resume).toBeEnabled());
    await userEvent.click(resume);
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Resume run' })
    );
    expect(await screen.findByText('The run changed since you looked')).toBeInTheDocument();
  });

  it('offers step retry only where diagnostics allow it, naming the steps it reopens', async () => {
    const spies = serve({
      'GET /v1/workflows/runs/{id}': () => failedRun,
      'GET /v1/workflows/runs/{id}/steps': () => failedSteps,
      'GET /v1/workflows/runs/{id}/diagnostics': () =>
        diagnostics(ID, {
          steps: [
            { step_name: 'fetch', status: 'succeeded', kind: 'action', attempt: 1, retry_base: 0 },
            {
              step_name: 'push',
              status: 'failed',
              kind: 'action',
              attempt: 3,
              retry_base: 0,
              retry_eligible: true,
              retry_reopened_steps: ['notify'],
            },
          ],
        }),
      'POST /v1/workflows/runs/{id}/steps/{step}/retry': () => ({
        ...failedRun,
        status: 'pending',
      }),
    });
    renderWithProviders(<WorkflowRunDetail slug="billing" id={ID} onClose={vi.fn()} />);
    const retry = await screen.findByRole('button', { name: 'Retry step push' });
    expect(screen.queryByRole('button', { name: 'Retry step fetch' })).not.toBeInTheDocument();
    expect(screen.getByText('Skipped: a dependency failed')).toBeInTheDocument();
    await userEvent.click(retry);
    const dialog = await screen.findByRole('dialog', { name: 'Retry step push?' });
    expect(within(dialog).getByText(/Skipped steps after it reopen: notify/)).toBeInTheDocument();
    expect(within(dialog).getByText(/automatic retry budget is not reset/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Retry step' }));
    expect(await screen.findByText('Retrying push')).toBeInTheDocument();
    expect(spies.POST).toHaveBeenCalledWith(
      '/v1/workflows/runs/{id}/steps/{step}/retry',
      expect.objectContaining({ params: { path: { id: ID, step: 'push' } } })
    );
  });

  it("lists a step's attempts on request", async () => {
    serve({
      'GET /v1/workflows/runs/{id}': () => failedRun,
      'GET /v1/workflows/runs/{id}/steps': () => failedSteps,
      'GET /v1/workflows/runs/{id}/steps/{step}/attempts': () => ({
        attempts: [
          {
            attempt: 1,
            status: 'failed',
            http_status: 502,
            started_at: iso(-90_000),
            error: 'bad gateway',
          },
        ],
      }),
    });
    renderWithProviders(<WorkflowRunDetail slug="billing" id={ID} onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Show attempts for push' }));
    const attempts = await screen.findByRole('region', { name: 'Attempts for push' });
    expect(await within(attempts).findByText('HTTP 502')).toBeInTheDocument();
    expect(within(attempts).getByText('bad gateway')).toBeInTheDocument();
  });

  it('cancels an active run only after a confirm that says what cancelling does', async () => {
    const waiting = run(ID, {
      status: 'awaiting_event',
      started_at: iso(-60_000),
      finished_at: null,
    });
    const spies = serve({
      'GET /v1/workflows/runs/{id}': () => waiting,
      'GET /v1/workflows/runs/{id}/diagnostics': () =>
        diagnostics(ID, { status: 'awaiting_event', state_reason: 'parked_wait' }),
      'POST /v1/workflows/runs/{id}/cancel': () => ({
        ...waiting,
        status: 'failed',
        cancelled_at: iso(0),
      }),
    });
    renderWithProviders(<WorkflowRunDetail slug="billing" id={ID} onClose={vi.fn()} />);
    expect(
      await screen.findByText(/Parked on a timer, event or callback wait/)
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel run' }));
    const dialog = await screen.findByRole('dialog', { name: 'Cancel this invoice-sync run?' });
    expect(within(dialog).getByText(/cannot be resumed/)).toBeInTheDocument();
    expect(spies.POST).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel run' }));
    expect(await screen.findByText('Run cancelled')).toBeInTheDocument();
  });

  it('sends an event under a key that stays fixed while the form is open', async () => {
    const keys: string[] = [];
    let n = 0;
    serve({
      'GET /v1/workflows/runs/{id}': () => run(ID, { status: 'awaiting_event', finished_at: null }),
      'POST /v1/workflows/runs/{id}/events': (init) => {
        keys.push(
          (init as { headers?: Record<string, string> }).headers?.['Idempotency-Key'] ?? ''
        );
        return n++ === 0
          ? problem(503, 'capacity', 'failed to record workflow event')
          : { status: 'received', event_name: 'approved' };
      },
    });
    renderWithProviders(<WorkflowRunDetail slug="billing" id={ID} onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Send event' }));
    const dialog = await screen.findByRole('dialog', { name: 'Send an event to this run' });
    await userEvent.type(within(dialog).getByLabelText('Event name'), 'approved');
    await userEvent.type(
      within(dialog).getByLabelText('Payload (JSON, optional)'),
      '{{"ok": true}'
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send event' }));
    expect(await within(dialog).findByText('failed to record workflow event')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send event' }));
    expect(await screen.findByText('Event approved received')).toBeInTheDocument();
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });

  it('refuses an event payload that is not JSON before sending anything', async () => {
    const spies = serve({
      'GET /v1/workflows/runs/{id}': () => run(ID, { status: 'running', finished_at: null }),
    });
    renderWithProviders(<WorkflowRunDetail slug="billing" id={ID} onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Send event' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Event name'), 'approved');
    await userEvent.type(within(dialog).getByLabelText('Payload (JSON, optional)'), 'nope');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send event' }));
    expect(within(dialog).getByText(/must be valid JSON/)).toBeInTheDocument();
    expect(spies.POST).not.toHaveBeenCalled();
  });

  it('completes a callback and says so when it was already received', async () => {
    serve({
      'GET /v1/workflows/runs/{id}': () => run(ID, { status: 'awaiting_event', finished_at: null }),
      'GET /v1/workflows/runs/{id}/steps': () => ({
        steps: [
          { step_name: 'manual_review', status: 'awaiting_event', attempt: 1, created_at: iso(0) },
        ],
      }),
      'GET /v1/workflows/runs/{id}/callbacks': () => ({
        callbacks: [{ id: CB, step_name: 'manual_review', expires_at: iso(3_600_000) }],
      }),
      'POST /v1/workflows/runs/{id}/callbacks/{callback_id}': () => ({
        status: 'received',
        duplicate: true,
      }),
    });
    renderWithProviders(<WorkflowRunDetail slug="billing" id={ID} onClose={vi.fn()} />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Complete callback manual_review' })
    );
    const dialog = await screen.findByRole('dialog', { name: 'Complete callback manual_review' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Complete callback' }));
    expect(await screen.findByText('Already completed')).toBeInTheDocument();
  });

  it('explains an expired callback by its code', async () => {
    serve({
      'GET /v1/workflows/runs/{id}': () => run(ID, { status: 'awaiting_event', finished_at: null }),
      'GET /v1/workflows/runs/{id}/callbacks': () => ({
        callbacks: [{ id: CB, step_name: 'manual_review' }],
      }),
      'POST /v1/workflows/runs/{id}/callbacks/{callback_id}': () =>
        problem(410, 'workflow_callback_expired', 'the callback wait deadline has elapsed.'),
    });
    renderWithProviders(<WorkflowRunDetail slug="billing" id={ID} onClose={vi.fn()} />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Complete callback manual_review' })
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Complete callback' }));
    expect(
      await within(dialog).findByText('The callback’s wait deadline has passed.')
    ).toBeInTheDocument();
  });

  it('refuses to show a run that belongs to another app', async () => {
    serve({ 'GET /v1/workflows/runs/{id}': () => run(ID, { app_id: 'other-app' }) });
    renderWithProviders(<WorkflowRunDetail slug="billing" id={ID} onClose={vi.fn()} />);
    expect(await screen.findByText(/This run belongs to another app/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel run' })).not.toBeInTheDocument();
  });

  it('shows a missing run as an error', async () => {
    serve({
      'GET /v1/workflows/runs/{id}': () =>
        problem(404, 'workflow_run_not_found', 'the requested workflow run was not found.'),
    });
    renderWithProviders(<WorkflowRunDetail slug="billing" id={ID} onClose={vi.fn()} />);
    expect(
      await screen.findByText('the requested workflow run was not found.')
    ).toBeInTheDocument();
  });
});
