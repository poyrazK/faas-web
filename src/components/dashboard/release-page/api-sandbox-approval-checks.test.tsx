import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { SandboxApprovalChecks } from './api-sandbox-approval-checks';
import {
  listSandboxApprovalChecks,
  startSandboxApprovalCheck,
  type APISandboxApprovalCheck,
  type APISandboxRunReport,
} from '@/lib/api/api-sandboxes';

vi.mock('@/lib/api/api-sandboxes', () => ({
  listSandboxApprovalChecks: vi.fn(),
  startSandboxApprovalCheck: vi.fn(),
}));
vi.mock('./api-sandbox-approval-suites', () => ({ SandboxApprovalSuites: () => null }));

it('runs the live baseline scenario and replaces a passing headline when its evidence is stale', async () => {
  const deploymentId = 'held-build';
  const baseline = 'live-release';
  const revision = 'saved-scenario';
  const scenarioName = 'Refund an order';
  const availability = {
    availability: 'ready' as const,
    baseline_deployment_id: baseline,
    scenario_revision: revision,
    scenario_name: scenarioName,
  };
  vi.mocked(listSandboxApprovalChecks).mockResolvedValue({ ...availability, checks: [] });
  const run: APISandboxRunReport = {
    id: 'baseline-run',
    source_deployment_id: baseline,
    scenario_revision: revision,
    scenario_name: scenarioName,
    mode: 'automated',
    status: 'passed',
    created_at: '2026-11-26T11:00:00Z',
    steps: [],
  };
  let passing: APISandboxApprovalCheck | undefined;
  vi.mocked(startSandboxApprovalCheck).mockImplementation(async (_, checkId) => {
    passing = {
      verdict: 'passed',
      comparison: {
        id: checkId,
        baseline_deployment_id: baseline,
        candidate_deployment_id: deploymentId,
        scenario_revision: revision,
        scenario_name: scenarioName,
        created_at: run.created_at,
        verdict: 'passed',
        baseline: run,
        candidate: { ...run, id: 'candidate-run', source_deployment_id: deploymentId },
      },
    };
    vi.mocked(listSandboxApprovalChecks).mockResolvedValue({ ...availability, checks: [passing] });
    return passing;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SandboxApprovalChecks deploymentId={deploymentId} slug="refunds" beforeReleaseCommand />
    </QueryClientProvider>
  );

  expect(startSandboxApprovalCheck).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole('button', { name: 'Run sandbox check' }));
  expect(await screen.findByText('Refund an order · Both passed')).toBeInTheDocument();
  expect(startSandboxApprovalCheck).toHaveBeenCalledWith(deploymentId, expect.any(String), {
    baseline_deployment_id: baseline,
    scenario_revision: revision,
  });
  if (!passing) throw new Error('The passing receipt was not recorded');
  vi.mocked(listSandboxApprovalChecks).mockResolvedValue({
    ...availability,
    baseline_deployment_id: 'new-serving-release',
    checks: [{ ...passing, verdict: 'stale', stale_reason: 'live_baseline_changed' }],
  });
  await act(() =>
    client.invalidateQueries({ queryKey: ['release-sandbox-approval-checks', deploymentId] })
  );

  const stale = await screen.findByText('Refund an order · Stale result');
  expect(screen.queryByText('Refund an order · Both passed')).not.toBeInTheDocument();
  expect(screen.getByText(/The serving baseline changed/)).toBeInTheDocument();
  stale.closest('details')!.open = true;
  expect(screen.getByRole('region', { name: 'Candidate' })).toHaveTextContent('Candidate · Passed');
});

it('runs the selected app scenario on a held build without a baseline scenario', async () => {
  vi.mocked(listSandboxApprovalChecks).mockResolvedValue({
    availability: 'ready',
    baseline_deployment_id: 'live',
    checks: [],
    library_scenarios: [
      { id: 'export', name: 'Download export', revision: 'export-revision' },
      { id: 'refund', name: 'View refund', revision: 'refund-revision' },
    ],
  });
  vi.mocked(startSandboxApprovalCheck)
    .mockReset()
    .mockRejectedValue(new Error('Backend unavailable'));
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SandboxApprovalChecks deploymentId="held" slug="exports" beforeReleaseCommand />
    </QueryClientProvider>
  );
  const picker = await screen.findByRole('combobox', { name: 'Scenario for this check' });
  fireEvent.change(picker, { target: { value: 'refund' } });
  fireEvent.click(screen.getByRole('button', { name: 'Run sandbox check' }));
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(startSandboxApprovalCheck).toHaveBeenCalledWith('held', expect.any(String), {
    baseline_deployment_id: 'live',
    scenario_revision: 'refund-revision',
  });
});
