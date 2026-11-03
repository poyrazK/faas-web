import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { problem, renderWithProviders, routeApi, type Answer } from '@/test/monetization';
import { HOUR, iso, run } from '@/test/workflows';

const cap = vi.hoisted(() => ({ access: 'on' as string, maturity: 'beta' as string }));
vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: () => ({ access: cap.access, refresh: vi.fn() }),
  useCapabilityStage: () => (cap.maturity === 'beta' ? 'Beta' : ''),
}));

const { WorkflowsBody } = await import('./workflows-body');

const LIST = 'GET /v1/apps/{slug}/workflows/runs';
const QUEUED_A = '11111111-1111-4111-8111-111111111111';
const QUEUED_B = '22222222-2222-4222-8222-222222222222';
const FAILED = '33333333-3333-4333-8333-333333333333';

const page = {
  total: 3,
  runs: [
    run(QUEUED_A, {
      status: 'pending',
      started_at: null,
      finished_at: null,
      created_at: iso(-60_000),
    }),
    run(QUEUED_B, {
      status: 'pending',
      started_at: null,
      finished_at: null,
      created_at: iso(-120_000),
    }),
    run(FAILED, {
      workflow_name: 'order_followup',
      status: 'failed',
      cancelled_at: iso(-HOUR),
      current_step: 'refund_approval',
      input: { secret: 'never-listed' },
    }),
  ],
};

let spies: ReturnType<typeof routeApi>;
let queries: Record<string, unknown>[];

function serve(extra: Record<string, (init: { body?: unknown }) => Answer> = {}, list = page) {
  queries = [];
  spies = routeApi({
    [LIST]: (init) => {
      queries.push((init.params?.query ?? {}) as Record<string, unknown>);
      return list;
    },
    ...extra,
  });
}

beforeEach(() => {
  cap.access = 'on';
  cap.maturity = 'beta';
});
afterEach(() => vi.restoreAllMocks());

describe('Workflows › runs', () => {
  it('lists runs with their workflow, status and when they were created, labelled beta', async () => {
    serve();
    renderWithProviders(<WorkflowsBody slug="billing" onRun={vi.fn()} />);
    expect(await screen.findByText('order_followup')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getAllByText('Queued', { selector: 'span' })).toHaveLength(2);
    // A cancelled run is failed with cancelled_at upstream; it reads as cancelled.
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
    expect(screen.queryByText(/never-listed/)).not.toBeInTheDocument();
    expect(queries[0]).toEqual({ limit: 25, offset: 0 });
  });

  it('opens a run from its row', async () => {
    serve();
    const onRun = vi.fn();
    renderWithProviders(<WorkflowsBody slug="billing" onRun={onRun} />);
    await userEvent.click(await screen.findByText('order_followup'));
    expect(onRun).toHaveBeenCalledWith(FAILED);
  });

  it("sends the API's own filters: exact status, exact name and whole UTC days", async () => {
    serve();
    renderWithProviders(<WorkflowsBody slug="billing" onRun={vi.fn()} />);
    await screen.findByText('order_followup');
    await userEvent.selectOptions(screen.getByLabelText('Run status'), 'dead');
    await waitFor(() => expect(queries.at(-1)).toMatchObject({ status: 'dead', offset: 0 }));
    await userEvent.type(screen.getByLabelText('Workflow'), 'invoice-sync{Enter}');
    await waitFor(() => expect(queries.at(-1)).toMatchObject({ workflow_name: 'invoice-sync' }));
    await userEvent.type(screen.getByLabelText('Created from (UTC)'), '2026-11-01');
    await waitFor(() =>
      expect(queries.at(-1)).toMatchObject({ created_after: '2026-11-01T00:00:00Z' })
    );
  });

  it('says a filter matched nothing rather than that there are no runs', async () => {
    serve({}, { total: 0, runs: [] });
    renderWithProviders(<WorkflowsBody slug="billing" onRun={vi.fn()} />);
    expect(await screen.findByText(/no runs yet/i)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Run status'), 'failed');
    expect(await screen.findByText('No runs match these filters.')).toBeInTheDocument();
  });

  it('shows a failed read as an error, not an empty list', async () => {
    routeApi({ [LIST]: () => problem(503, 'capacity', 'failed to list workflow runs') });
    renderWithProviders(<WorkflowsBody slug="billing" onRun={vi.fn()} />);
    expect(await screen.findByText(/failed to list workflow runs/)).toBeInTheDocument();
    expect(screen.queryByText(/no runs yet/i)).not.toBeInTheDocument();
  });

  it('cancels selected queued runs only after a preview and a confirm that counts them', async () => {
    serve({
      'POST /v1/apps/{slug}/workflows/runs:cancel-preview': () => ({
        outcomes: [
          { run_id: QUEUED_A, outcome: 'eligible' },
          { run_id: QUEUED_B, outcome: 'already_started' },
        ],
      }),
      'POST /v1/apps/{slug}/workflows/runs:cancel-queued': () => ({
        outcomes: [{ run_id: QUEUED_A, outcome: 'cancelled' }],
      }),
    });
    renderWithProviders(<WorkflowsBody slug="billing" onRun={vi.fn()} />);
    await screen.findByText('order_followup');
    // Only never-started runs can be selected.
    expect(screen.getAllByRole('checkbox', { name: /select queued run/i })).toHaveLength(2);
    for (const box of screen.getAllByRole('checkbox', { name: /select queued run/i }))
      await userEvent.click(box);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel 2 queued' }));
    const dialog = await screen.findByRole('dialog', { name: 'Cancel 1 queued run?' });
    expect(within(dialog).getByText(/1 selected run has already started/)).toBeInTheDocument();
    expect(spies.POST).toHaveBeenCalledTimes(1);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel runs' }));
    expect(await screen.findByText('Cancelled 1 run')).toBeInTheDocument();
    expect(spies.POST).toHaveBeenLastCalledWith(
      '/v1/apps/{slug}/workflows/runs:cancel-queued',
      expect.objectContaining({ body: { run_ids: [QUEUED_A] } })
    );
  });

  it('starts a run under one key and reports a workflow the deployment does not declare', async () => {
    const keys: string[] = [];
    serve({
      'POST /v1/apps/{slug}/workflows/{name}/runs': (init) => {
        keys.push(
          (init as { params?: { header?: Record<string, string> } }).params?.header?.[
            'Idempotency-Key'
          ] ?? ''
        );
        return problem(404, 'workflow_definition_not_found', 'not defined');
      },
    });
    renderWithProviders(<WorkflowsBody slug="billing" onRun={vi.fn()} />);
    await screen.findByText('order_followup');
    await userEvent.click(screen.getByRole('button', { name: 'Start a run' }));
    const dialog = await screen.findByRole('dialog', { name: 'Start a workflow run' });
    await userEvent.type(within(dialog).getByLabelText('Workflow'), 'missing');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start run' }));
    expect(
      await within(dialog).findByText('The live deployment declares no workflow of that name.')
    ).toBeInTheDocument();
    expect(within(dialog).getByText('workflow_definition_not_found')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start run' }));
    await waitFor(() => expect(keys).toHaveLength(2));
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
  });

  it('reads nothing while the capability is off', async () => {
    cap.access = 'off';
    serve();
    renderWithProviders(<WorkflowsBody slug="billing" onRun={vi.fn()} />);
    expect(await screen.findByText('Not enabled for this account')).toBeInTheDocument();
    expect(spies.GET).not.toHaveBeenCalled();
  });
});
