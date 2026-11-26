import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Route } from './api-sandbox.$sandboxId';
import {
  confirmSandboxReceiver,
  readSandboxInvite,
  readSandboxReceiverProof,
  redeemSandboxPartnerInvite,
  readSharedSandboxRun,
  verifySandboxReceiver,
} from '@/lib/api/api-sandboxes';

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({
    options,
    useParams: () => ({ sandboxId: 'example-copy' }),
  }),
}));

vi.mock('@/lib/api/api-sandboxes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/api-sandboxes')>()),
  confirmSandboxReceiver: vi.fn(),
  readSandboxInvite: vi.fn(),
  readSandboxReceiverProof: vi.fn(),
  redeemSandboxPartnerInvite: vi.fn(),
  readSharedSandboxRun: vi.fn(),
  verifySandboxReceiver: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/');
});

it('shows seeded IDs and runnable examples from the authenticated invite', async () => {
  window.history.replaceState({}, '', '/api-sandbox/example-copy#invite-secret');
  vi.mocked(readSandboxInvite).mockResolvedValue({
    id: 'example-copy',
    source_deployment_id: 'release',
    status: 'live',
    url: 'https://api-sbx-example.gregale.dev',
    openapi_url: 'https://api-sbx-example.gregale.dev/openapi.json',
    expires_at: '2030-01-02T12:00:00Z',
    scenario: {
      revision: 'example-revision',
      name: 'Test duplicate handling',
      seeded_ids: { 'Sample note': '42' },
      requests: [
        {
          title: 'Try the duplicate request',
          method: 'POST',
          path: "/notes?name=O'Reilly",
          body: { body: "O'Reilly" },
          expected_status: 409,
        },
      ],
    },
  });
  const Component = Route.options.component as React.ComponentType;
  const { container } = render(<Component />);

  expect(
    await screen.findByRole('heading', { name: 'Test duplicate handling' })
  ).toBeInTheDocument();
  expect(screen.getByText('Sample note')).toBeInTheDocument();
  expect(screen.getByText('42')).toBeInTheDocument();
  expect(screen.getByText('Expected HTTP 409')).toBeInTheDocument();
  const command = screen.getByText(/curl --silent/).textContent;
  expect(command).toContain('"Authorization: Bearer $SANDBOX_KEY"');
  expect(command).toContain(`--url 'https://api-sbx-example.gregale.dev/notes?name=O'"'"'Reilly'`);
  expect(command).toContain(`--data-binary '{"body":"O'"'"'Reilly"}'`);
  expect(command).not.toContain('--fail');
  expect(container).not.toHaveTextContent('invite-secret');
  expect(window.location.hash).toBe('');
  expect(readSandboxInvite).toHaveBeenCalledWith(
    'example-copy',
    'invite-secret',
    expect.anything()
  );
});

it('waits for explicit acceptance and only displays the exchanged key', async () => {
  const token = 'sbx_inv_one-time-link';
  window.history.replaceState({}, '', `/api-sandbox/example-copy#${token}`);
  vi.mocked(redeemSandboxPartnerInvite)
    .mockRejectedValueOnce(new Error('Sandbox verification is still running'))
    .mockResolvedValueOnce({
      token: 'ck_redeemed_key',
      sandbox: {
        id: 'example-copy',
        source_deployment_id: 'release',
        status: 'live',
        url: 'https://api-sbx-example.gregale.dev',
        openapi_url: 'https://api-sbx-example.gregale.dev/openapi.json',
        expires_at: '2030-01-02T12:00:00Z',
      },
    });

  const Component = Route.options.component as React.ComponentType;
  render(<Component />);
  const accept = screen.getByRole('button', { name: 'Accept invite' });
  expect(window.location.hash).toBe('');
  expect(redeemSandboxPartnerInvite).not.toHaveBeenCalled();
  expect(readSandboxInvite).not.toHaveBeenCalled();
  fireEvent.click(accept);
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  fireEvent.click(accept);
  fireEvent.click(await screen.findByRole('button', { name: 'Show key' }));
  expect(screen.getByLabelText('Sandbox bearer key')).toHaveValue('ck_redeemed_key');
  expect(redeemSandboxPartnerInvite).toHaveBeenCalledWith('example-copy', token);
});

it('loads a shared scenario result while signed out and removes the token from the URL', async () => {
  const token = 'sbx_run_report-link';
  window.history.replaceState({}, '', `/api-sandbox/example-copy#${token}`);
  vi.mocked(readSharedSandboxRun).mockResolvedValue({
    id: 'example-copy',
    source_deployment_id: 'pinned-release',
    scenario_revision: 'pinned-scenario',
    scenario_name: 'Refund an order',
    mode: 'automated',
    status: 'passed',
    created_at: '2026-11-25T12:00:00Z',
    steps: [
      {
        index: 1,
        title: 'Create refund',
        method: 'POST',
        expected_status: 201,
        http_status: 201,
        duration_ms: 37,
        request_id: 'fixture-request',
      },
    ],
  });
  const Component = Route.options.component as React.ComponentType;
  const { container } = render(<Component />);
  expect(await screen.findByRole('heading', { name: 'Refund an order' })).toBeInTheDocument();
  expect(screen.getByText('Create refund · Passed')).toBeInTheDocument();
  expect(screen.getByText('fixture-request')).toBeInTheDocument();
  expect(window.location.hash).toBe('');
  expect(container).not.toHaveTextContent(token);
  expect(readSharedSandboxRun).toHaveBeenCalledWith('example-copy', token, expect.anything());
  expect(readSandboxInvite).not.toHaveBeenCalled();
});

it('shows only the requests the partner should send during a scenario run', async () => {
  window.history.replaceState({}, '', '/api-sandbox/example-copy#sbx_inv_partner-run');
  vi.mocked(redeemSandboxPartnerInvite).mockResolvedValue({
    token: 'ck_partner_run',
    sandbox: {
      id: 'example-copy',
      source_deployment_id: 'release',
      status: 'live',
      url: 'https://api-sbx-example.gregale.dev',
      openapi_url: 'https://api-sbx-example.gregale.dev/openapi.json',
      expires_at: '2030-01-02T12:00:00Z',
      partner_step_count: 1,
      scenario: {
        revision: 'example-revision',
        name: 'Refund an order',
        requests: [
          { title: 'Create refund', method: 'POST', path: '/refunds', expected_status: 201 },
          { title: 'Verify order state', method: 'GET', path: '/orders/42', expected_status: 200 },
        ],
      },
    },
  });
  const Component = Route.options.component as React.ComponentType;
  render(<Component />);
  fireEvent.click(screen.getByRole('button', { name: 'Accept invite' }));
  expect(await screen.findByRole('heading', { name: 'Create refund' })).toBeInTheDocument();
  expect(screen.getByText(/Gregale will check the final state/)).toBeInTheDocument();
  expect(screen.queryByText('Verify order state')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('First API request')).not.toBeInTheDocument();
});

it('verifies a partner webhook endpoint and requires explicit readiness after issuing credentials', async () => {
  const token = 'sbx_winv_receiver-link';
  const url = 'https://receiver.example.com/webhooks/jobs';
  const expires = '2030-01-02T12:00:00Z';
  window.history.replaceState({}, '', `/api-sandbox/example-copy#${token}`);
  vi.mocked(readSandboxReceiverProof).mockResolvedValue({
    proof: 'gregale-receiver-proof',
    expires_at: expires,
  });
  vi.mocked(verifySandboxReceiver).mockResolvedValue({
    signing_secret: 'fixture-signing-secret',
    outcome_token: 'sbx_wres_outcome',
    expires_at: expires,
  });
  vi.mocked(confirmSandboxReceiver).mockResolvedValue(undefined);
  const Component = Route.options.component as React.ComponentType;
  render(<Component />);
  expect(await screen.findByLabelText('Endpoint ownership proof')).toHaveValue(
    'gregale-receiver-proof'
  );
  expect(window.location.hash).toBe('');
  expect(readSandboxInvite).not.toHaveBeenCalled();
  expect(verifySandboxReceiver).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Test receiver URL'), { target: { value: url } });
  fireEvent.click(screen.getByRole('button', { name: 'Verify endpoint' }));
  expect(await screen.findByLabelText('Run signing secret')).toHaveValue('fixture-signing-secret');
  expect(screen.getByLabelText('Outcome token')).toHaveValue('sbx_wres_outcome');
  expect(verifySandboxReceiver).toHaveBeenCalledWith('example-copy', token, url);
  expect(screen.getByText(/curl --fail-with-body -X POST/)).toHaveTextContent('receiver-outcome');
  expect(screen.getByText(/curl --fail-with-body -X POST/)).not.toHaveTextContent(
    'sbx_wres_outcome'
  );
  expect(confirmSandboxReceiver).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm receiver is ready' }));
  expect(await screen.findByText(/The release owner can start the run/)).toBeInTheDocument();
  expect(confirmSandboxReceiver).toHaveBeenCalledWith('example-copy', 'sbx_wres_outcome');
});
