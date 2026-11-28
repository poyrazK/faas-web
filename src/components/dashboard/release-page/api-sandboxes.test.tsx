import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ReleaseAPISandboxes } from './api-sandboxes';
import * as api from '@/lib/api/api-sandboxes';

vi.mock('@/lib/api/api-sandboxes', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  listReleaseSandboxes: vi.fn(),
  getReleaseSandboxScenario: vi.fn(),
  listSandboxLibraryScenarios: vi.fn(),
  getSandboxLibraryScenario: vi.fn(),
  saveSandboxLibraryScenario: vi.fn(),
  saveReleaseSandboxScenario: vi.fn(),
  ensureReleaseSandbox: vi.fn(),
  issueReleaseSandboxInvite: vi.fn(),
  issueReleaseSandboxPartnerInvite: vi.fn(),
  revokeReleaseSandboxPartner: vi.fn(),
  issueReleaseReceiverInvite: vi.fn(),
  issueReleaseSandboxRunInvite: vi.fn(),
  listReleaseSandboxRuns: vi.fn(),
  listReleaseSandboxComparisons: vi.fn(),
  startReleaseSandboxComparison: vi.fn(),
  startReleaseSandboxRun: vi.fn(),
  shareReleaseSandboxRun: vi.fn(),
  endReleaseSandbox: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.getReleaseSandboxScenario).mockResolvedValue({ scenario: null });
  vi.mocked(api.listSandboxLibraryScenarios).mockResolvedValue({ scenarios: [] });
  vi.mocked(api.listReleaseSandboxRuns).mockResolvedValue({ runs: [] });
  vi.mocked(api.listReleaseSandboxComparisons).mockResolvedValue({
    baselines: [],
    comparisons: [],
  });
});

it('reuses either named library scenario on a release without a release-local definition', async () => {
  const release = { slug: 'exports', deployment: 'candidate-release' };
  const first = {
    id: '37beb23c-1fe1-4487-acfc-3224a41a23ef',
    name: 'Download export',
    revision: 'export-revision',
  };
  const second = {
    id: '5162238f-79db-45b1-8925-354fc2d15551',
    name: 'View refund',
    revision: 'refund-revision',
  };
  vi.mocked(api.listReleaseSandboxes).mockResolvedValue({ sandboxes: [] });
  vi.mocked(api.listSandboxLibraryScenarios).mockResolvedValue({ scenarios: [first, second] });
  vi.mocked(api.getSandboxLibraryScenario).mockImplementation(async (_slug, id) => {
    const { name, revision } = id === first.id ? first : second;
    return {
      id,
      scenario: {
        name,
        revision,
        seed: {},
        requests: [{ title: name, method: 'GET', path: '/demo', expected_status: 200 }],
      },
    };
  });
  const baseline = { deployment_id: 'previous-release', created_at: '2026-11-26T11:00:00Z' };
  vi.mocked(api.listReleaseSandboxComparisons).mockResolvedValue({
    baselines: [baseline],
    comparisons: [],
  });
  vi.mocked(api.startReleaseSandboxRun).mockImplementation(async (_, id, revision) => {
    const run: api.APISandboxRunReport = {
      id,
      source_deployment_id: release.deployment,
      scenario_revision: revision,
      scenario_name: first.name,
      mode: 'automated',
      status: 'passed',
      steps: [],
      created_at: baseline.created_at,
    };
    vi.mocked(api.listReleaseSandboxRuns).mockResolvedValue({ runs: [run] });
    return run;
  });
  vi.mocked(api.startReleaseSandboxComparison).mockImplementation(async (_, id, input) => {
    const run: api.APISandboxRunReport = {
      id: 'baseline-run',
      source_deployment_id: baseline.deployment_id,
      scenario_revision: input.scenario_revision,
      scenario_name: second.name,
      mode: 'automated',
      status: 'passed',
      steps: [],
      created_at: baseline.created_at,
    };
    return {
      id,
      scenario_revision: input.scenario_revision,
      scenario_name: second.name,
      baseline_deployment_id: baseline.deployment_id,
      candidate_deployment_id: release.deployment,
      created_at: baseline.created_at,
      verdict: 'passed',
      baseline: run,
      candidate: { ...run, id: 'candidate-run', source_deployment_id: release.deployment },
    };
  });

  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <ReleaseAPISandboxes
        slug={release.slug}
        deployment={release.deployment}
        initialOpen
        initialScenario={first.id}
      />
    </QueryClientProvider>
  );
  const picker = await screen.findByRole('combobox', { name: 'Scenario for this release' });
  expect(picker).toHaveValue(first.id);
  fireEvent.click(await screen.findByRole('button', { name: 'Run scenario' }));
  await screen.findByText('Download export · Passed');
  expect(api.startReleaseSandboxRun).toHaveBeenCalledWith(
    release,
    expect.any(String),
    first.revision
  );
  fireEvent.change(picker, { target: { value: second.id } });
  await screen.findByText(second.name, { selector: 'p' });
  fireEvent.click(await screen.findByRole('button', { name: 'Compare with previous release' }));
  await waitFor(() =>
    expect(api.startReleaseSandboxComparison).toHaveBeenCalledWith(release, expect.any(String), {
      baseline_deployment_id: baseline.deployment_id,
      scenario_revision: second.revision,
    })
  );
  expect(api.saveReleaseSandboxScenario).not.toHaveBeenCalled();
});

it('creates a reusable scenario and keeps the expected revision from the start of an edit', async () => {
  const slug = 'notes';
  const deployment = 'eligible-release';
  const firstRevision = '3a236bab-188e-47a5-b130-ff1c4bd19090';
  const newRevision = 'cf864dc9-3b76-4e49-884a-3c4e9671a0af';
  vi.mocked(api.listReleaseSandboxes).mockResolvedValue({ sandboxes: [] });
  vi.mocked(api.saveSandboxLibraryScenario).mockImplementationOnce(async (_slug, id, input) => {
    const scenario = {
      name: input.name,
      seed: input.seed,
      requests: input.requests,
      revision: firstRevision,
    };
    vi.mocked(api.listSandboxLibraryScenarios).mockResolvedValue({
      scenarios: [{ id, name: scenario.name, revision: scenario.revision }],
    });
    vi.mocked(api.getSandboxLibraryScenario).mockResolvedValue({ id, scenario });
    return { id, scenario };
  });
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <ReleaseAPISandboxes slug={slug} deployment={deployment} initialOpen />
    </QueryClientProvider>
  );
  const library = within(await screen.findByRole('region', { name: 'Scenario library' }));
  fireEvent.click(library.getByRole('button', { name: 'New library scenario' }));
  fireEvent.click(library.getByRole('button', { name: 'Load Notes example' }));
  fireEvent.click(library.getByRole('button', { name: 'Save to library' }));
  fireEvent.click(await library.findByRole('button', { name: 'Edit scenario' }));
  const id = library.getByRole<HTMLSelectElement>('combobox').value;
  expect(api.saveSandboxLibraryScenario).toHaveBeenCalledWith(
    slug,
    id,
    expect.objectContaining({
      expected_revision: '',
      name: 'Create a note',
    })
  );

  const key = api.sandboxLibraryScenarioKey(slug, id);
  act(() =>
    client.setQueryData<api.APISandboxLibraryScenario>(
      key,
      (previous) =>
        previous && { ...previous, scenario: { ...previous.scenario, revision: newRevision } }
    )
  );
  vi.mocked(api.saveSandboxLibraryScenario).mockRejectedValueOnce(
    new Error('Library scenario changed')
  );
  fireEvent.change(library.getByLabelText('Scenario name'), { target: { value: 'Edited note' } });
  fireEvent.click(library.getByRole('button', { name: 'Save scenario' }));
  expect(await library.findByRole('alert')).toHaveTextContent('Library scenario changed');
  expect(api.saveSandboxLibraryScenario).toHaveBeenLastCalledWith(
    slug,
    id,
    expect.objectContaining({
      expected_revision: firstRevision,
      name: 'Edited note',
    })
  );
});

it('creates a sandbox for the exact release, shares it, and ends it after confirmation', async () => {
  const release = { slug: 'notes', deployment: 'b34561e9-1001-4726-99e8-4cc8b762ae79' };
  const sandbox = {
    id: '3c948c2a-a13f-4b13-9d34-733ad75fe262',
    source_deployment_id: release.deployment,
    deployment_id: 'be4eaa30-a6d1-43a4-9c93-8ebb7034527f',
    status: 'live' as const,
    smoke_path: '/notes',
    verification: {
      deployment_id: 'be4eaa30-a6d1-43a4-9c93-8ebb7034527f',
      checked_at: '2030-01-01T12:01:00Z',
      openapi_status: 200,
      smoke_status: 200,
    },
    expires_at: '2030-01-02T12:00:00Z',
    url: 'https://api-sbx-example.gregale.dev',
    openapi_url: 'https://api-sbx-example.gregale.dev/openapi.json',
  };
  vi.mocked(api.listReleaseSandboxes)
    .mockResolvedValueOnce({ sandboxes: [] })
    .mockResolvedValueOnce({ sandboxes: [sandbox] })
    .mockResolvedValue({ sandboxes: [] });
  vi.mocked(api.ensureReleaseSandbox).mockResolvedValue(sandbox);
  vi.mocked(api.issueReleaseSandboxInvite).mockResolvedValue({
    sandbox,
    token: 'sandbox-only-credential',
  });
  vi.mocked(api.endReleaseSandbox).mockResolvedValue(undefined);

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ReleaseAPISandboxes slug={release.slug} deployment={release.deployment} />
    </QueryClientProvider>
  );
  const details = screen.getByText('API sandboxes').closest('details')!;
  details.open = true;
  fireEvent(details, new Event('toggle'));
  await waitFor(() => expect(api.listReleaseSandboxes).toHaveBeenCalled());
  fireEvent.change(screen.getByLabelText('Smoke test path (optional)'), {
    target: { value: '/notes' },
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Create sandbox' }));
  expect(await screen.findByText('OpenAPI verified · GET /notes passed')).toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: 'Create invite' }));
  expect(await screen.findByLabelText('Private sandbox invitation link')).toHaveValue(
    `${window.location.origin}/api-sandbox/${sandbox.id}#sandbox-only-credential`
  );
  expect(api.ensureReleaseSandbox).toHaveBeenCalledWith(
    release,
    expect.any(String),
    '/notes',
    undefined
  );
  expect(api.issueReleaseSandboxInvite).toHaveBeenCalledWith(release, sandbox.id);

  fireEvent.click(screen.getByRole('button', { name: 'End sandbox' }));
  expect(api.endReleaseSandbox).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'End and revoke' }));
  await waitFor(() => expect(api.endReleaseSandbox).toHaveBeenCalledWith(release, sandbox.id));
  await waitFor(() =>
    expect(screen.queryByLabelText('Private sandbox invitation link')).not.toBeInTheDocument()
  );
});

it('keeps invites hidden while the API is checked and shows actionable failures', async () => {
  const release = { slug: 'notes', deployment: 'release-1' };
  const sandbox: api.APISandbox = {
    id: 'sandbox-1',
    source_deployment_id: release.deployment,
    deployment_id: 'sandbox-release-1',
    status: 'verifying_api',
    expires_at: '2030-01-02T12:00:00Z',
    url: 'https://api-sbx-example.gregale.dev',
    openapi_url: 'https://api-sbx-example.gregale.dev/openapi.json',
  };
  vi.mocked(api.listReleaseSandboxes).mockResolvedValue({ sandboxes: [sandbox] });

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ReleaseAPISandboxes slug={release.slug} deployment={release.deployment} />
    </QueryClientProvider>
  );
  const details = screen.getByText('API sandboxes').closest('details')!;
  details.open = true;
  fireEvent(details, new Event('toggle'));
  expect(await screen.findByText('Checking API')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Create invite' })).not.toBeInTheDocument();

  vi.mocked(api.listReleaseSandboxes).mockResolvedValue({
    sandboxes: [
      {
        ...sandbox,
        status: 'failed',
        failure: {
          code: 'smoke_http_status',
          detail: 'The smoke route must return a 2xx response directly.',
          http_status: 404,
        },
      },
    ],
  });
  await client.invalidateQueries();
  expect(await screen.findByText(/The smoke route must return.*HTTP 404/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Create invite' })).not.toBeInTheDocument();
  expect(api.ensureReleaseSandbox).not.toHaveBeenCalled();
});

it('saves a scenario and starts each fresh copy with its own UUID and the saved revision', async () => {
  const release = { slug: 'notes', deployment: 'release-1' };
  const scenario: api.APISandboxScenario = {
    revision: 'example-revision',
    name: 'Create a note',
    seed: { notes: [{ id: 42, body: 'A note for integration testing' }] },
    seeded_ids: { 'Sample note': '42' },
    requests: [
      {
        title: 'Find the sample note',
        method: 'GET',
        path: '/notes',
        expected_status: 200,
        assertions: [{ pointer: '/notes/0/id', equals: 42 }],
      },
      {
        title: 'Create another note',
        method: 'POST',
        path: '/notes',
        body: { body: 'My integration test' },
        expected_status: 201,
      },
    ],
  };
  vi.mocked(api.listReleaseSandboxes).mockResolvedValue({ sandboxes: [] });
  vi.mocked(api.saveReleaseSandboxScenario).mockResolvedValue({ scenario });
  vi.mocked(api.ensureReleaseSandbox).mockResolvedValue({
    id: 'copy',
    source_deployment_id: release.deployment,
    status: 'preparing_database',
    expires_at: '2030-01-02T12:00:00Z',
    url: 'https://api-sbx-example.gregale.dev',
    openapi_url: 'https://api-sbx-example.gregale.dev/openapi.json',
  });

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ReleaseAPISandboxes slug={release.slug} deployment={release.deployment} />
    </QueryClientProvider>
  );
  const details = screen.getByText('API sandboxes').closest('details')!;
  details.open = true;
  fireEvent(details, new Event('toggle'));
  fireEvent.click(await screen.findByRole('button', { name: 'Define scenario' }));
  fireEvent.click(screen.getByRole('button', { name: 'Load Notes example' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save scenario' }));

  const { revision, ...input } = scenario;
  const create = await screen.findByRole('button', { name: 'Create fresh copy' });
  expect(api.saveReleaseSandboxScenario).toHaveBeenCalledWith(release, input);
  expect(await screen.findByText('Create a note')).toBeInTheDocument();
  fireEvent.click(create);
  await waitFor(() => expect(api.ensureReleaseSandbox).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(create).toBeEnabled());
  fireEvent.click(create);
  await waitFor(() => expect(api.ensureReleaseSandbox).toHaveBeenCalledTimes(2));

  const [
    [firstRelease, firstID, firstSmoke, firstRevision],
    [secondRelease, secondID, secondSmoke, secondRevision],
  ] = vi.mocked(api.ensureReleaseSandbox).mock.calls;
  expect([firstRelease, firstSmoke, firstRevision]).toEqual([release, '', revision]);
  expect([secondRelease, secondSmoke, secondRevision]).toEqual([release, '', revision]);
  expect(firstID).not.toBe(secondID);
});

it('creates a private scenario copy and offers its one-time link during provisioning', async () => {
  const release = { slug: 'notes', deployment: 'release-1' };
  const partner = { label: 'Partner team', invited_at: '2026-11-25T15:00:00Z' };
  const sandbox: api.APISandbox = {
    id: 'partner-copy',
    source_deployment_id: release.deployment,
    status: 'preparing_database',
    expires_at: '2030-01-02T12:00:00Z',
    url: 'https://api-sbx-example.gregale.dev',
    openapi_url: 'https://api-sbx-example.gregale.dev/openapi.json',
    partner,
  };
  let visible: api.APISandbox[] = [];
  vi.mocked(api.listReleaseSandboxes).mockImplementation(async () => ({ sandboxes: visible }));
  vi.mocked(api.getReleaseSandboxScenario).mockResolvedValue({
    scenario: {
      revision: 'revision-1',
      name: 'Create a note',
      seed: {},
      requests: [{ title: 'List notes', method: 'GET', path: '/notes', expected_status: 200 }],
    },
  });
  vi.mocked(api.ensureReleaseSandbox).mockResolvedValue(sandbox);
  vi.mocked(api.issueReleaseSandboxPartnerInvite).mockImplementation(async () => {
    visible = [sandbox];
    return { partner, token: 'sbx_inv_example' };
  });
  vi.mocked(api.revokeReleaseSandboxPartner).mockImplementation(async () => {
    visible = [{ ...sandbox, partner: { ...partner, revoked_at: '2026-11-25T15:01:00Z' } }];
  });

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ReleaseAPISandboxes slug={release.slug} deployment={release.deployment} />
    </QueryClientProvider>
  );
  const details = screen.getByText('API sandboxes').closest('details')!;
  details.open = true;
  fireEvent(details, new Event('toggle'));
  fireEvent.change(await screen.findByLabelText('Partner label'), {
    target: { value: partner.label },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Invite partner' }));

  expect(await screen.findByLabelText('Private sandbox invitation link')).toHaveValue(
    `${window.location.origin}/api-sandbox/partner-copy#sbx_inv_example`
  );
  expect(api.ensureReleaseSandbox).toHaveBeenCalledWith(
    release,
    expect.any(String),
    '',
    'revision-1',
    partner.label
  );
  expect(await screen.findByText('Partner team · Waiting for redemption')).toBeInTheDocument();
  expect(api.issueReleaseSandboxInvite).not.toHaveBeenCalled();
  visible = [
    {
      ...sandbox,
      status: 'live',
      partner: {
        ...partner,
        redeemed_at: '2026-11-25T15:00:10Z',
        first_success_at: '2026-11-25T15:00:20Z',
      },
    },
  ];
  await client.invalidateQueries({ queryKey: ['release-api-sandboxes'] });
  expect(await screen.findByText('Partner team · Invite redeemed')).toBeInTheDocument();
  expect(screen.getByText(/First successful request/)).toBeInTheDocument();
  expect(screen.queryByLabelText('Private sandbox invitation link')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Revoke partner access' }));
  expect(await screen.findByText('Partner team · Access revoked')).toBeInTheDocument();
  expect(screen.queryByLabelText('Private sandbox invitation link')).not.toBeInTheDocument();
});

it('runs the current scenario and lets the owner share its finished report', async () => {
  const release = { slug: 'notes', deployment: 'release-1' };
  vi.mocked(api.listReleaseSandboxes).mockResolvedValue({ sandboxes: [] });
  vi.mocked(api.getReleaseSandboxScenario).mockResolvedValue({
    scenario: { revision: 'saved-revision', name: 'Refund an order', seed: {}, requests: [] },
  });
  const run: api.APISandboxRunReport = {
    id: 'run-1',
    source_deployment_id: release.deployment,
    scenario_revision: 'saved-revision',
    scenario_name: 'Refund an order',
    mode: 'automated',
    status: 'failed',
    created_at: '2026-11-25T15:00:00Z',
    steps: [
      {
        index: 1,
        title: 'Read order',
        method: 'GET',
        expected_status: 200,
        http_status: 200,
        duration_ms: 48,
        failure_code: 'json_assertion_failed',
        failed_assertion: 1,
        failed_pointer: '/status',
        request_id: 'request-42',
      },
    ],
  };
  vi.mocked(api.startReleaseSandboxRun).mockImplementation(async () => {
    vi.mocked(api.listReleaseSandboxRuns).mockResolvedValue({ runs: [run] });
    return { ...run, status: 'queued', steps: [] };
  });
  vi.mocked(api.shareReleaseSandboxRun).mockResolvedValue({
    token: 'sbx_run_example',
    expires_at: '2030-01-02T12:00:00Z',
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ReleaseAPISandboxes slug={release.slug} deployment={release.deployment} />
    </QueryClientProvider>
  );
  const details = screen.getByText('API sandboxes').closest('details')!;
  details.open = true;
  fireEvent(details, new Event('toggle'));
  fireEvent.click(await screen.findByRole('button', { name: 'Run scenario' }));
  fireEvent.click(await screen.findByText('Refund an order · Failed'));

  expect(api.startReleaseSandboxRun).toHaveBeenCalledWith(
    release,
    expect.any(String),
    'saved-revision'
  );
  expect(screen.getByText(/JSON assertion 1 failed/)).toBeInTheDocument();
  expect(screen.getByText('/status')).toBeInTheDocument();
  expect(screen.getByText('request-42')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Share report' }));
  expect(await screen.findByLabelText('Scenario report link')).toHaveValue(
    `${window.location.origin}/api-sandbox/run-1#sbx_run_example`
  );
});

it('starts a partner scenario run and creates an invitation for its copy', async () => {
  const release = { slug: 'notes', deployment: 'release-1' };
  vi.mocked(api.listReleaseSandboxes).mockResolvedValue({ sandboxes: [] });
  vi.mocked(api.getReleaseSandboxScenario).mockResolvedValue({
    scenario: {
      revision: 'saved-revision',
      name: 'Refund an order',
      seed: {},
      requests: [
        { title: 'Create refund', method: 'POST', path: '/refunds', expected_status: 201 },
        {
          title: 'Verify order',
          method: 'GET',
          path: '/orders/42',
          expected_status: 200,
          assertions: [{ pointer: '/status', equals: 'refunded' }],
        },
      ],
    },
  });
  vi.mocked(api.startReleaseSandboxRun).mockImplementation(async (_release, id) => {
    const run: api.APISandboxRunReport = {
      id,
      source_deployment_id: release.deployment,
      scenario_revision: 'saved-revision',
      scenario_name: 'Refund an order',
      mode: 'partner',
      status: 'awaiting_partner',
      partner_step_count: 1,
      created_at: '2026-11-25T15:00:00Z',
      steps: [],
    };
    vi.mocked(api.listReleaseSandboxRuns).mockResolvedValue({ runs: [run] });
    return run;
  });
  vi.mocked(api.issueReleaseSandboxRunInvite).mockResolvedValue({
    token: 'sbx_inv_run',
    partner: { label: 'Scenario partner', invited_at: '2026-11-25T15:01:00Z' },
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ReleaseAPISandboxes slug={release.slug} deployment={release.deployment} />
    </QueryClientProvider>
  );
  const details = screen.getByText('API sandboxes').closest('details')!;
  details.open = true;
  fireEvent(details, new Event('toggle'));
  fireEvent.click(await screen.findByRole('button', { name: 'Start partner run' }));
  const run = await screen.findByText(
    'Refund an order · Partner run · Waiting for partner requests'
  );
  run.closest('details')!.open = true;
  fireEvent.click(await screen.findByRole('button', { name: 'Create partner invite' }));
  expect(screen.getByText('0 of 1 partner requests passed')).toBeInTheDocument();
  const id = vi.mocked(api.startReleaseSandboxRun).mock.calls[0][1];
  expect(api.startReleaseSandboxRun).toHaveBeenCalledWith(release, id, 'saved-revision', 'partner');
  expect(await screen.findByLabelText('Partner invite link')).toHaveValue(
    `${window.location.origin}/api-sandbox/${id}#sbx_inv_run`
  );
  expect(api.issueReleaseSandboxRunInvite).toHaveBeenCalledWith(release, id);
});

it('runs a saved Stripe fixture and shows the duplicate and delivery evidence', async () => {
  const release = { slug: 'billing', deployment: 'release-1' };
  vi.mocked(api.listReleaseSandboxes).mockResolvedValue({ sandboxes: [] });
  vi.mocked(api.getReleaseSandboxScenario).mockResolvedValue({ scenario: null });
  vi.mocked(api.saveReleaseSandboxScenario).mockImplementation(async (_release, input) => ({
    scenario: { ...input, revision: 'stripe-revision' },
  }));
  const run: api.APISandboxRunReport = {
    id: 'run-1',
    source_deployment_id: release.deployment,
    scenario_revision: 'stripe-revision',
    scenario_name: 'Apply a paid Stripe invoice once',
    mode: 'automated',
    status: 'passed',
    created_at: '2026-11-26T09:00:00Z',
    steps: [
      {
        kind: 'webhook_duplicate',
        index: 2,
        title: 'Resend the same event',
        method: 'POST',
        duration_ms: 2,
        path: '/internal/stripe',
        expected_status: 202,
        http_status: 202,
        event_type: 'invoice.paid',
        invocation_id: 'fixture-receipt',
      },
      {
        kind: 'webhook_processing',
        index: 3,
        title: 'Wait for webhook processing',
        method: 'POST',
        duration_ms: 250,
        invocation_id: 'fixture-receipt',
        invocation_state: 'completed',
        delivery_attempts: 1,
      },
    ],
  };
  vi.mocked(api.startReleaseSandboxRun).mockImplementation(async () => {
    vi.mocked(api.listReleaseSandboxRuns).mockResolvedValue({ runs: [run] });
    return run;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ReleaseAPISandboxes slug={release.slug} deployment={release.deployment} />
    </QueryClientProvider>
  );
  const panel = screen.getByText('API sandboxes').closest('details')!;
  panel.open = true;
  fireEvent(panel, new Event('toggle'));
  fireEvent.click(await screen.findByRole('button', { name: 'Define scenario' }));
  fireEvent.click(screen.getByRole('button', { name: 'Load Stripe example' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save scenario' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Run webhook scenario' }));
  expect(screen.queryByRole('button', { name: 'Start partner run' })).not.toBeInTheDocument();
  fireEvent.click(await screen.findByText('Apply a paid Stripe invoice once · Passed'));
  expect(screen.getByText('Resend the same event · Passed')).toBeInTheDocument();
  expect(screen.getByText('invoice.paid')).toBeInTheDocument();
  expect(screen.getByText(/completed · Attempts 1/)).toBeInTheDocument();
  expect(api.saveReleaseSandboxScenario).toHaveBeenCalledWith(
    release,
    expect.objectContaining({
      stripe_webhook: expect.objectContaining({ event_type: 'invoice.paid' }),
    })
  );
  expect(api.startReleaseSandboxRun).toHaveBeenCalledWith(
    release,
    expect.any(String),
    'stripe-revision'
  );
});

it('saves an outbound webhook scenario and shows both attempts of one delivery', async () => {
  const release = { slug: 'exports', deployment: 'release-1' };
  const title = 'Retry the export completion webhook';
  vi.mocked(api.listReleaseSandboxes).mockResolvedValue({ sandboxes: [] });
  vi.mocked(api.getReleaseSandboxScenario).mockResolvedValue({ scenario: null });
  vi.mocked(api.saveReleaseSandboxScenario).mockImplementation(async (_release, input) => ({
    scenario: { ...input, revision: 'outbound-revision' },
  }));
  const run: api.APISandboxRunReport = {
    id: 'run-1',
    source_deployment_id: release.deployment,
    scenario_revision: 'outbound-revision',
    scenario_name: title,
    mode: 'automated',
    status: 'passed',
    created_at: '2026-11-26T09:00:00Z',
    steps: [
      {
        index: 3,
        title: 'Verify callback will retry',
        kind: 'outbound_webhook_attempt',
        method: 'POST',
        event_type: 'job.finished',
        duration_ms: 12,
        attempt_number: 1,
        expected_status: 503,
        http_status: 503,
        delivery_id: 'delivery-demo',
        observed_at: '2026-11-26T09:00:01Z',
      },
      {
        index: 4,
        title: 'Deliver completion webhook',
        kind: 'outbound_webhook_attempt',
        method: 'POST',
        event_type: 'job.finished',
        duration_ms: 8,
        attempt_number: 2,
        expected_status: 204,
        http_status: 204,
        delivery_id: 'delivery-demo',
        observed_at: '2026-11-26T09:00:17Z',
      },
    ],
  };
  vi.mocked(api.startReleaseSandboxRun).mockImplementation(async () => {
    vi.mocked(api.listReleaseSandboxRuns).mockResolvedValue({ runs: [run] });
    return run;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ReleaseAPISandboxes slug={release.slug} deployment={release.deployment} />
    </QueryClientProvider>
  );
  const panel = screen.getByText('API sandboxes').closest('details')!;
  panel.open = true;
  fireEvent(panel, new Event('toggle'));
  fireEvent.click(await screen.findByRole('button', { name: 'Define scenario' }));
  fireEvent.click(screen.getByRole('button', { name: 'Load outbound webhook example' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save scenario' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Run outbound webhook scenario' }));
  fireEvent.click(await screen.findByText(`${title} · Passed`));

  expect(api.saveReleaseSandboxScenario).toHaveBeenCalledWith(
    release,
    expect.objectContaining({ outbound_webhook: expect.objectContaining({ retry_once: true }) })
  );
  expect(api.startReleaseSandboxRun).toHaveBeenCalledWith(
    release,
    expect.any(String),
    'outbound-revision'
  );
  expect(screen.getByText(/Received HTTP 503/)).toBeInTheDocument();
  expect(screen.getByText(/Received HTTP 204/)).toBeInTheDocument();
  expect(screen.getAllByText('delivery-demo')).toHaveLength(2);
  expect(screen.getByText(/Attempt 2/)).toBeInTheDocument();
});

it('starts the reserved outbound run after its partner receiver is ready', async () => {
  const release = { slug: 'exports', deployment: 'release-1' };
  const revision = 'outbound-revision';
  vi.mocked(api.listReleaseSandboxes).mockResolvedValue({ sandboxes: [] });
  vi.mocked(api.getReleaseSandboxScenario).mockResolvedValue({
    scenario: { revision, name: 'Export completion', seed: {}, requests: [], outbound_webhook: {} },
  });
  vi.mocked(api.issueReleaseReceiverInvite).mockImplementation(async (_release, runID) => {
    const setup = {
      run_id: runID,
      scenario_revision: revision,
      expires_at: '2030-01-02T12:00:00Z',
      status: 'pending' as const,
    };
    vi.mocked(api.listReleaseSandboxRuns).mockResolvedValue({
      runs: [],
      receiver_invites: [setup],
    });
    return { ...setup, token: 'sbx_winv_new' };
  });
  vi.mocked(api.startReleaseSandboxRun).mockImplementation(async (_release, id) => {
    const report: api.APISandboxRunReport = {
      id,
      source_deployment_id: release.deployment,
      scenario_revision: revision,
      scenario_name: 'Export completion',
      mode: 'automated',
      partner_webhook: true,
      status: 'awaiting_partner_outcome',
      partner_outcome_until: '2030-01-01T12:05:00Z',
      created_at: '2030-01-01T12:00:00Z',
      steps: [],
    };
    vi.mocked(api.listReleaseSandboxRuns).mockResolvedValue({ runs: [report] });
    return report;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ReleaseAPISandboxes slug={release.slug} deployment={release.deployment} />
    </QueryClientProvider>
  );
  const panel = screen.getByText('API sandboxes').closest('details')!;
  panel.open = true;
  fireEvent(panel, new Event('toggle'));
  fireEvent.click(await screen.findByRole('button', { name: 'Invite webhook partner' }));
  const inviteLink = await screen.findByLabelText('Webhook receiver invite link');
  const runID = vi.mocked(api.issueReleaseReceiverInvite).mock.calls[0][1];
  expect(inviteLink).toHaveValue(`${window.location.origin}/api-sandbox/${runID}#sbx_winv_new`);
  expect(
    screen.queryByRole('button', { name: 'Run with partner receiver' })
  ).not.toBeInTheDocument();
  vi.mocked(api.listReleaseSandboxRuns).mockResolvedValue({
    runs: [],
    receiver_invites: [
      {
        run_id: runID,
        scenario_revision: revision,
        status: 'ready',
        expires_at: '2030-01-02T12:00:00Z',
      },
    ],
  });
  await act(() =>
    client.invalidateQueries({
      queryKey: ['release-sandbox-runs', release.slug, release.deployment],
    })
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Run with partner receiver' }));
  expect(
    await screen.findByText(/Partner webhook · Waiting for partner outcome/)
  ).toBeInTheDocument();
  expect(api.startReleaseSandboxRun).toHaveBeenCalledWith(
    release,
    runID,
    revision,
    'automated',
    true
  );
  expect(screen.queryByRole('button', { name: 'Share report' })).not.toBeInTheDocument();
});

it('compares the selected retained baseline on the same scenario and shows the first regression', async () => {
  const release = { slug: 'refunds', deployment: 'candidate-release' };
  const revision = 'saved-revision';
  const baselines = [
    {
      deployment_id: 'baseline-previous',
      commit_sha: 'a1111111',
      created_at: '2026-11-24T10:00:00Z',
    },
    {
      deployment_id: 'baseline-known-good',
      commit_sha: 'b2222222',
      created_at: '2026-11-23T10:00:00Z',
    },
  ];
  vi.mocked(api.listReleaseSandboxes).mockResolvedValue({ sandboxes: [] });
  vi.mocked(api.getReleaseSandboxScenario).mockResolvedValue({
    scenario: { revision, name: 'Refund an order', seed: {}, requests: [] },
  });
  vi.mocked(api.listReleaseSandboxComparisons).mockResolvedValue({ baselines, comparisons: [] });
  vi.mocked(api.startReleaseSandboxComparison).mockImplementation(async (_, id) => {
    const step = {
      index: 1,
      title: 'Read refund status',
      method: 'GET',
      http_status: 200,
      duration_ms: 42,
      failure_code: 'json_assertion_failed',
      failed_assertion: 1,
      failed_pointer: '/status',
      request_id: 'candidate-request-id',
    };
    const baseline: api.APISandboxRunReport = {
      id: 'baseline-run',
      source_deployment_id: baselines[1].deployment_id,
      scenario_revision: revision,
      scenario_name: 'Refund an order',
      mode: 'automated',
      status: 'passed',
      steps: [],
      created_at: '2026-11-26T11:00:00Z',
    };
    const report: api.APISandboxComparisonReport = {
      id,
      baseline_deployment_id: baseline.source_deployment_id,
      candidate_deployment_id: release.deployment,
      scenario_revision: revision,
      scenario_name: baseline.scenario_name,
      verdict: 'regression',
      reason: 'candidate_check_failed',
      failure_side: 'candidate',
      first_failing_step: step,
      baseline,
      candidate: {
        ...baseline,
        id: 'candidate-run',
        source_deployment_id: release.deployment,
        status: 'failed',
        steps: [step],
      },
      created_at: baseline.created_at,
    };
    vi.mocked(api.listReleaseSandboxComparisons).mockResolvedValue({
      baselines,
      comparisons: [report],
    });
    return report;
  });

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ReleaseAPISandboxes slug={release.slug} deployment={release.deployment} />
    </QueryClientProvider>
  );
  const panel = screen.getByText('API sandboxes').closest('details')!;
  panel.open = true;
  fireEvent(panel, new Event('toggle'));
  const select = await screen.findByRole('combobox', { name: 'Baseline release' });
  expect(select).toHaveValue('baseline-previous');
  fireEvent.change(select, { target: { value: 'baseline-known-good' } });
  fireEvent.click(screen.getByRole('button', { name: 'Compare with previous release' }));

  const result = await screen.findByText('Refund an order · Regression detected');
  result.closest('details')!.open = true;
  expect(api.startReleaseSandboxComparison).toHaveBeenCalledWith(release, expect.any(String), {
    baseline_deployment_id: 'baseline-known-good',
    scenario_revision: revision,
  });
  expect(screen.getByRole('region', { name: 'Baseline' })).toHaveTextContent('Baseline · Passed');
  expect(screen.getByRole('region', { name: 'Candidate' })).toHaveTextContent('Candidate · Failed');
  expect(screen.getByText(/Candidate step 1/)).toHaveTextContent('/status');
  expect(
    screen.getByRole('button', { name: 'Copy: request ID candidate-request-id' })
  ).toBeVisible();
});
