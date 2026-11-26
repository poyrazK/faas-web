import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import * as suiteAPI from '@/lib/api/api-sandbox-suites';
import type { APISandboxRunReport } from '@/lib/api/api-sandboxes';
import { SandboxApprovalSuites } from './api-sandbox-approval-suites';

vi.mock('@/lib/api/api-sandbox-suites', () => ({
  getSandboxSuite: vi.fn(),
  saveSandboxSuite: vi.fn(),
  listSandboxSuiteRuns: vi.fn(),
  getSandboxSuiteRun: vi.fn(),
  startSandboxSuiteRun: vi.fn(),
}));

const library = [
  { id: 'charge', name: 'Charge an order', revision: 'charge-revision' },
  { id: 'refund', name: 'Refund an order', revision: 'refund-revision' },
];
const createdAt = '2026-11-26T11:00:00Z';

function fixture(id: string): suiteAPI.APISandboxSuiteRunReport {
  const baseline: APISandboxRunReport = {
    id: 'baseline-refund',
    source_deployment_id: 'live',
    scenario_name: library[1].name,
    scenario_revision: library[1].revision,
    status: 'passed',
    mode: 'automated',
    steps: [],
    created_at: createdAt,
  };
  const step = {
    index: 1,
    title: 'Read refund status',
    method: 'GET',
    http_status: 200,
    duration_ms: 20,
    failure_code: 'json_assertion_failed',
    failed_pointer: '/status',
  };
  const comparison = {
    id: 'compare-refund',
    baseline_deployment_id: 'live',
    candidate_deployment_id: 'held',
    scenario_name: library[1].name,
    scenario_revision: library[1].revision,
    baseline,
    candidate: {
      ...baseline,
      id: 'candidate-refund',
      source_deployment_id: 'held',
      status: 'failed' as const,
      steps: [step],
    },
    verdict: 'regression' as const,
    failure_side: 'candidate' as const,
    first_failing_step: step,
    created_at: createdAt,
  };
  return {
    id,
    baseline_deployment_id: 'live',
    candidate_deployment_id: 'held',
    suite_revision: 'saved-suite',
    completed_count: 2,
    scenario_count: 2,
    created_at: createdAt,
    finished_at: createdAt,
    verdict: 'regression',
    scenarios: [
      {
        scenario_id: library[0].id,
        scenario_name: library[0].name,
        scenario_revision: library[0].revision,
        status: 'passed',
        comparison: {
          ...comparison,
          id: 'compare-charge',
          scenario_name: library[0].name,
          scenario_revision: library[0].revision,
          verdict: 'passed',
          baseline: {
            ...baseline,
            id: 'baseline-charge',
            scenario_name: library[0].name,
            scenario_revision: library[0].revision,
          },
          candidate: {
            ...baseline,
            id: 'candidate-charge',
            source_deployment_id: 'held',
            scenario_name: library[0].name,
            scenario_revision: library[0].revision,
          },
          failure_side: undefined,
          first_failing_step: undefined,
        },
      },
      {
        scenario_id: library[1].id,
        scenario_name: library[1].name,
        scenario_revision: library[1].revision,
        status: 'regression',
        comparison,
      },
    ],
  };
}

function mount(beforeReleaseCommand = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SandboxApprovalSuites
        slug="payments"
        deploymentId="held"
        baseline="live"
        beforeReleaseCommand={beforeReleaseCommand}
        library={library}
      />
    </QueryClientProvider>
  );
  return client;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(suiteAPI.getSandboxSuite).mockResolvedValue({ suite: null });
  vi.mocked(suiteAPI.listSandboxSuiteRuns).mockResolvedValue({ runs: [] });
});

it('saves a suite, launches once, and shows every comparison in the same report', async () => {
  vi.mocked(suiteAPI.saveSandboxSuite).mockResolvedValue({
    suite: { revision: 'saved-suite', scenario_ids: ['charge', 'refund'] },
  });
  vi.mocked(suiteAPI.startSandboxSuiteRun).mockImplementation(async (_, id) => {
    const report = fixture(id);
    vi.mocked(suiteAPI.listSandboxSuiteRuns).mockResolvedValue({ runs: [report] });
    vi.mocked(suiteAPI.getSandboxSuiteRun).mockResolvedValue(report);
    return report;
  });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Set up suite' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Charge an order' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Refund an order' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save suite' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Run regression suite' }));
  expect(
    await screen.findByText('Regression detected · 2 of 2 scenarios completed')
  ).toBeInTheDocument();
  expect(suiteAPI.saveSandboxSuite).toHaveBeenCalledWith('payments', {
    expected_revision: '',
    scenario_ids: ['charge', 'refund'],
  });
  expect(suiteAPI.startSandboxSuiteRun).toHaveBeenCalledExactlyOnceWith(
    'held',
    expect.any(String),
    {
      suite_revision: 'saved-suite',
      baseline_deployment_id: 'live',
    }
  );
  expect(screen.getByText('Charge an order · Both passed')).toBeVisible();
  const regression = screen.getByText('Refund an order · Regression detected');
  regression.closest('details')!.open = true;
  expect(screen.getByText(/Candidate step 1/)).toHaveTextContent('/status');
});

it('shows a finished suite after approval and highlights stale evidence', async () => {
  const report = {
    ...fixture('previous-run'),
    verdict: 'stale' as const,
    stale_reason: 'suite_scenario_changed' as const,
  };
  vi.mocked(suiteAPI.listSandboxSuiteRuns).mockResolvedValue({ runs: [report] });
  vi.mocked(suiteAPI.getSandboxSuiteRun).mockResolvedValue(report);
  mount(false);
  expect(await screen.findByText('Stale result · 2 of 2 scenarios completed')).toBeInTheDocument();
  expect(screen.getByText('A saved scenario in the suite changed or was removed.')).toBeVisible();
  await waitFor(() =>
    expect(suiteAPI.getSandboxSuiteRun).toHaveBeenCalledWith(
      'held',
      'previous-run',
      expect.any(AbortSignal)
    )
  );
});

it('can opt into automatic runs and follows one from the queue to its report', async () => {
  const suite = { revision: 'saved-suite', scenario_ids: ['charge', 'refund'] };
  vi.mocked(suiteAPI.getSandboxSuite).mockResolvedValue({ suite });
  vi.mocked(suiteAPI.saveSandboxSuite).mockImplementation(async () => {
    vi.mocked(suiteAPI.listSandboxSuiteRuns).mockResolvedValue({
      runs: [],
      automatic_status: 'waiting_for_capacity',
    });
    return { suite: { ...suite, revision: 'automatic-suite', run_before_approval: true } };
  });
  const client = mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit suite' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Run suite before approval' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save suite' }));
  expect(await screen.findByText(/waiting for the app’s active suite/)).toBeVisible();
  expect(suiteAPI.saveSandboxSuite).toHaveBeenCalledWith('payments', {
    expected_revision: suite.revision,
    scenario_ids: suite.scenario_ids,
    run_before_approval: true,
  });
  expect(screen.queryByRole('button', { name: 'Run regression suite' })).toBeNull();
  const report = {
    ...fixture('automatic-run'),
    suite_revision: 'automatic-suite',
    automatic: true,
    completed_count: 0,
    finished_at: undefined,
    verdict: 'running' as const,
    waiting_for_capacity: true,
  };
  vi.mocked(suiteAPI.listSandboxSuiteRuns).mockResolvedValue({
    runs: [report],
    automatic_status: 'started',
  });
  vi.mocked(suiteAPI.getSandboxSuiteRun).mockResolvedValue(report);
  await act(() => client.invalidateQueries({ queryKey: ['release-sandbox-suite-runs', 'held'] }));
  expect(await screen.findByText('Started automatically at approval.')).toBeVisible();
  expect(screen.getByText('Waiting for available sandbox capacity.')).toBeVisible();
  expect(suiteAPI.startSandboxSuiteRun).not.toHaveBeenCalled();
});

it('shows the suite blocking admission and the accepted run once the command is queued', async () => {
  const stale = { ...fixture('stale-run'), verdict: 'stale' as const };
  const passed = { ...fixture('accepted-run'), verdict: 'passed' as const };
  vi.mocked(suiteAPI.getSandboxSuite).mockResolvedValue({
    suite: { revision: 'saved-suite', scenario_ids: ['charge', 'refund'] },
  });
  vi.mocked(suiteAPI.getSandboxSuiteRun).mockImplementation(async (_, id) =>
    id === passed.id ? passed : stale
  );
  vi.mocked(suiteAPI.listSandboxSuiteRuns).mockResolvedValue({
    runs: [stale],
    release_gate: { status: 'stale', suite_run_id: stale.id },
  });
  const client = mount();
  expect(await screen.findByText(/the latest suite is stale/i)).toBeVisible();
  expect(await screen.findByRole('button', { name: 'Run suite again' })).toBeEnabled();
  vi.mocked(suiteAPI.listSandboxSuiteRuns).mockResolvedValue({
    runs: [stale, passed],
    release_gate: { status: 'admitted', suite_run_id: passed.id },
  });
  await act(() => client.invalidateQueries({ queryKey: ['release-sandbox-suite-runs', 'held'] }));
  expect(await screen.findByText(/the production release command accepted/i)).toBeVisible();
  expect(screen.getByText('accepted-run')).toBeVisible();
  expect(screen.getByRole('combobox', { name: 'Suite run' })).toHaveValue(passed.id);
});
