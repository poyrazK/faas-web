import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MigrationVerification } from './migration-verification';
import { ApiError } from '@/lib/api/errors';
import type { MigrationVerification as Verification } from '@/lib/api/migration-verification';

vi.mock('./migration-cutover', () => ({ MigrationCutover: () => null }));

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  advance: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock('@/lib/api/migration-verification', () => ({
  listMigrationVerifications: mocks.list,
  createMigrationVerification: mocks.create,
  advanceMigrationVerification: mocks.advance,
  cancelMigrationVerification: mocks.cancel,
}));

const run: Verification = {
  id: '33333333-3333-4333-8333-333333333333',
  app: 'shop-api',
  deployment_id: '11111111-1111-4111-8111-111111111111',
  scope: 'default',
  configuration_revision: 'a'.repeat(64),
  status: 'pending',
  phase: 'dependencies',
  created_at: '2026-10-17T12:00:00Z',
  expires_at: '2026-10-17T12:10:00Z',
  checks: [],
  request: {
    id: '33333333-3333-4333-8333-333333333333',
    deployment_id: '11111111-1111-4111-8111-111111111111',
    smoke_path: '/ready',
    cold_wake: true,
    checks: { postgres_env_key: 'DATABASE_URL' },
  },
};
const passed: Verification = {
  ...run,
  status: 'passed',
  phase: 'complete',
  checks: [
    { name: 'after_wake/postgres', status: 'passed', detail: 'Read-only SELECT 1 succeeded.' },
  ],
};
function setup(serviceConnections?: { env_key: string; service: string; deployment_id: string }[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MigrationVerification
        app={run.app}
        deployment={run.deployment_id}
        serviceConnections={serviceConnections}
      />
    </QueryClientProvider>
  );
}
beforeEach(() => {
  mocks.list.mockResolvedValue({ runs: [] });
  mocks.create.mockImplementation(async () => {
    mocks.list.mockResolvedValue({ runs: [passed] });
    return run;
  });
  mocks.cancel.mockResolvedValue({ ...run, cancel_requested_at: new Date().toISOString() });
});
afterEach(() => vi.resetAllMocks());

it('pins saved runtime connections and requires new evidence when old reports omit them', async () => {
  const connections = [
    { env_key: 'API_URL', service: 'api', deployment_id: '22222222-2222-4222-8222-222222222222' },
  ];
  mocks.list.mockResolvedValue({ runs: [passed] });
  setup(connections);
  expect(
    await screen.findByText(
      'Saved checks use different service connections. Run verification again.'
    )
  ).toBeInTheDocument();
  expect(screen.queryByText('Checks passed for this deployment')).not.toBeInTheDocument();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Run verification again' }));
  expect(mocks.create).toHaveBeenCalledWith(
    'shop-api',
    expect.objectContaining({
      checks: { postgres_env_key: 'DATABASE_URL', service_connections: connections },
    })
  );
});

it('submits names and a path, with explicit cold-wake consent', async () => {
  const user = userEvent.setup();
  setup();
  await user.type(
    await screen.findByLabelText('PostgreSQL environment key (optional)'),
    'DATABASE_URL'
  );
  const path = screen.getByLabelText('HTTP smoke test path');
  await user.clear(path);
  await user.type(path, '/ready');
  await user.click(screen.getByRole('button', { name: 'Start verification' }));
  expect(mocks.create).toHaveBeenCalledWith(
    'shop-api',
    expect.objectContaining({
      deployment_id: run.deployment_id,
      checks: { postgres_env_key: 'DATABASE_URL' },
      smoke_path: '/ready',
      cold_wake: true,
    })
  );
  await screen.findByText('Checks passed for this deployment', {}, { timeout: 4000 });
  expect(screen.getByRole('link', { name: 'Download verification report' })).toHaveAttribute(
    'download',
    `migration-${run.id}.json`
  );
});
it('polls saved progress, including unchanged reports, without advancing from the browser', async () => {
  mocks.list
    .mockResolvedValueOnce({ runs: [run] })
    .mockResolvedValueOnce({ runs: [run] })
    .mockResolvedValue({ runs: [passed] });
  setup();
  await screen.findByText('Checking dependencies from your deployment');
  await screen.findByText('Checks passed for this deployment', {}, { timeout: 8000 });
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.advance).not.toHaveBeenCalled();
  expect(mocks.list).toHaveBeenCalledTimes(3);
});
it('keeps saved progress visible when report polling fails', async () => {
  mocks.list.mockResolvedValueOnce({ runs: [run] }).mockRejectedValue(new Error('offline'));
  const user = userEvent.setup();
  setup();
  await screen.findByText(/The report could not refresh/, {}, { timeout: 4000 });
  expect(screen.getByText('Checking dependencies from your deployment')).toBeInTheDocument();
  expect(mocks.create).not.toHaveBeenCalled();
  mocks.list.mockResolvedValue({ runs: [passed] });
  await user.click(screen.getByRole('button', { name: 'Reload reports' }));
  await screen.findByText('Checks passed for this deployment');
  expect(mocks.advance).not.toHaveBeenCalled();
});
it('requires saved-report recovery after an uncertain creation response', async () => {
  mocks.create.mockRejectedValueOnce(new Error('lost creation'));
  const user = userEvent.setup();
  setup();
  await user.click(await screen.findByRole('button', { name: 'Start verification' }));
  await screen.findByText(/Could not confirm verification creation/);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Start verification' })).toBeDisabled()
  );
  expect(mocks.create).toHaveBeenCalledTimes(1);
});
it('shows coverage limits when cold wake and dependencies were omitted', async () => {
  mocks.list.mockResolvedValue({
    runs: [{ ...passed, request: { ...passed.request, cold_wake: false, checks: {} } }],
  });
  setup();
  await screen.findByText('Cold wake was not checked.');
  expect(
    screen.getByText('No dependency checks were selected. This report covers the HTTP route.')
  ).toBeInTheDocument();
});

it('restores saved check choices for a rerun after reload', async () => {
  mocks.list.mockResolvedValue({ runs: [passed] });
  setup();
  await screen.findByText('Checks passed for this deployment');
  await waitFor(() => expect(screen.getByLabelText('HTTP smoke test path')).toHaveValue('/ready'));
  expect(screen.getByLabelText('PostgreSQL environment key (optional)')).toHaveValue(
    'DATABASE_URL'
  );
});

it('lets a rejected field be corrected without treating it as a lost creation', async () => {
  mocks.create.mockRejectedValueOnce(
    new ApiError({
      status: 400,
      code: 'validation_failed',
      title: 'Invalid checks',
      detail: 'Dependency environment key is invalid.',
    })
  );
  const user = userEvent.setup();
  setup();
  const field = await screen.findByLabelText('PostgreSQL environment key (optional)');
  await user.type(field, 'invalid key');
  await user.click(screen.getByRole('button', { name: 'Start verification' }));
  await screen.findByText('Dependency environment key is invalid.');
  await user.clear(field);
  await user.type(field, 'DATABASE_URL');
  expect(screen.getByRole('button', { name: 'Start verification' })).toBeEnabled();
  await user.click(screen.getByRole('button', { name: 'Start verification' }));
  expect(mocks.create).toHaveBeenCalledTimes(2);
});

it('discovers the original receipt after its creation response is lost', async () => {
  mocks.create.mockImplementationOnce(async (_app, request) => {
    mocks.list.mockResolvedValue({ runs: [{ ...run, id: request.id, request }] });
    throw new Error('response lost after commit');
  });
  const user = userEvent.setup();
  setup();
  await user.click(await screen.findByRole('button', { name: 'Start verification' }));
  await screen.findByText('Checking dependencies from your deployment');
  await waitFor(() =>
    expect(screen.queryByText(/Could not confirm verification creation/)).not.toBeInTheDocument()
  );
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: 'Start verification' })).not.toBeInTheDocument();
});

it('can leave a pending run and return to its completed server report', async () => {
  mocks.list.mockResolvedValue({ runs: [run] });
  const view = setup();
  await screen.findByText('Checking dependencies from your deployment');
  expect(screen.getByText(/You can close this page/)).toBeInTheDocument();
  view.unmount();
  mocks.list.mockResolvedValue({ runs: [passed] });
  setup();
  await screen.findByText('Checks passed for this deployment');
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.advance).not.toHaveBeenCalled();
});

it('persists cancellation and waits for restoration before offering another run', async () => {
  mocks.list.mockResolvedValue({ runs: [{ ...run, phase: 'drain' }] });
  const user = userEvent.setup();
  setup();
  await user.click(await screen.findByRole('button', { name: 'Cancel verification' }));
  await screen.findByText('Cancelling verification');
  expect(mocks.cancel).toHaveBeenCalledWith('shop-api', run.id);
  expect(screen.queryByRole('button', { name: 'Run verification again' })).not.toBeInTheDocument();
  mocks.list.mockResolvedValue({
    runs: [
      {
        ...run,
        status: 'cancelled',
        phase: 'complete',
        recovery_status: 'restored',
        cancel_requested_at: new Date().toISOString(),
      },
    ],
  });
  await screen.findByText('The Gregale service is running again.', {}, { timeout: 4000 });
  expect(screen.getByRole('button', { name: 'Run verification again' })).toBeEnabled();
  expect(mocks.advance).not.toHaveBeenCalled();
});

it('shows blocked recovery without claiming the service is running', async () => {
  mocks.list.mockResolvedValue({
    runs: [{ ...run, status: 'expired', phase: 'complete', recovery_status: 'blocked' }],
  });
  setup();
  await screen.findByText(/Service recovery is blocked/);
  expect(screen.queryByText('The Gregale service is running again.')).not.toBeInTheDocument();
});

it('reconciles an uncertain cancellation through the saved report', async () => {
  mocks.list.mockResolvedValue({ runs: [run] });
  mocks.cancel.mockImplementation(async () => {
    mocks.list.mockResolvedValue({
      runs: [{ ...run, cancel_requested_at: new Date().toISOString() }],
    });
    throw new Error('lost cancellation response');
  });
  const user = userEvent.setup();
  setup();
  await user.click(await screen.findByRole('button', { name: 'Cancel verification' }));
  await screen.findByText('Cancelling verification');
  expect(mocks.cancel).toHaveBeenCalledTimes(1);
  expect(mocks.create).not.toHaveBeenCalled();
  expect(screen.queryByText(/Could not confirm cancellation/)).not.toBeInTheDocument();
});
