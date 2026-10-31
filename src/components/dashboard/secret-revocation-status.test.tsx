import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { renderWithProviders, routeApi } from '@/test/monetization';
import type { SecretRevocation, SecretRevocationTarget } from '@/lib/api/secret-references';
import { SecretRevocationStatus } from './secret-revocation-status';

afterEach(() => vi.restoreAllMocks());

const PATH = 'GET /v1/apps/{slug}/secret-revocations/{revocation_id}';
const target = (over: Partial<SecretRevocationTarget> = {}): SecretRevocationTarget => ({
  instance_id: '1f9e7c3a-0b2d-4c5e-8f6a-7b8c9d0e1f2a',
  runtime_state: 'running',
  reload_support: 'enabled',
  status: 'pending',
  ...over,
});
const revocation = (over: Partial<SecretRevocation> = {}): SecretRevocation => ({
  id: '7b0c2a52-4e7f-4c1e-9d3a-0d2f5e7a9c11',
  scope: 'default',
  key: 'JWT_SIGNING_KEY',
  // Just deleted: the card stops waiting for acks two minutes after this.
  created_at: new Date().toISOString(),
  status: 'pending',
  target_count: 2,
  acknowledged_count: 0,
  pending_count: 2,
  targets: [
    target(),
    target({ instance_id: 'a2b3c4d5-0000-4000-8000-000000000002', workload_name: 'proxy' }),
  ],
  ...over,
});

it('says which running instances still hold the key and that live reload drops it', async () => {
  routeApi({ [PATH]: () => revocation() });
  renderWithProviders(
    <SecretRevocationStatus slug="api" revocation={revocation()} onDismiss={() => {}} />
  );
  expect(await screen.findByText(/waiting for 2 of 2 running instances/i)).toBeInTheDocument();
  expect(screen.getByText(/within about 10 seconds/i)).toBeInTheDocument();
  expect(screen.getByText('main')).toBeInTheDocument();
  expect(screen.getByText('proxy')).toBeInTheDocument();
  expect(screen.getAllByText(/live reload/i).length).toBeGreaterThan(0);
});

it('rereads the revocation by id and shows it settle', async () => {
  const done = revocation({
    status: 'complete',
    acknowledged_count: 2,
    pending_count: 0,
    targets: revocation().targets.map((t) => ({
      ...t,
      status: 'applied' as const,
      ack_revision: 'a'.repeat(64),
      ack_at: '2026-10-31T10:00:08Z',
    })),
  });
  const spies = routeApi({ [PATH]: () => done });
  renderWithProviders(
    <SecretRevocationStatus slug="api" revocation={revocation()} onDismiss={() => {}} />
  );
  expect(await screen.findByText(/all 2 running instances confirmed/i)).toBeInTheDocument();
  expect(spies.GET).toHaveBeenCalledWith(
    '/v1/apps/{slug}/secret-revocations/{revocation_id}',
    expect.objectContaining({
      params: { path: { slug: 'api', revocation_id: revocation().id } },
    })
  );
});

it('says a restart-only instance keeps the value in memory until it restarts', async () => {
  const blocked = revocation({
    status: 'blocked',
    target_count: 1,
    pending_count: 1,
    targets: [target({ reload_support: 'disabled' })],
  });
  routeApi({ [PATH]: () => blocked });
  renderWithProviders(
    <SecretRevocationStatus slug="api" revocation={blocked} onDismiss={() => {}} />
  );
  expect(await screen.findByText(/cannot reload secrets/i)).toBeInTheDocument();
  expect(
    screen.getByText(/keeps JWT_SIGNING_KEY in memory until it restarts/i)
  ).toBeInTheDocument();
  expect(screen.getByText(/restart only/i)).toBeInTheDocument();
});

it('treats an unknown reload support as restart-only, never as success', async () => {
  const unknown = revocation({
    status: 'blocked',
    target_count: 1,
    pending_count: 1,
    targets: [target({ reload_support: 'unknown' })],
  });
  routeApi({ [PATH]: () => unknown });
  renderWithProviders(
    <SecretRevocationStatus slug="api" revocation={unknown} onDismiss={() => {}} />
  );
  expect(await screen.findByText(/cannot reload secrets/i)).toBeInTheDocument();
  expect(screen.getByText(/reload unknown/i)).toBeInTheDocument();
});

it('says a failed application reload may still hold the key', async () => {
  const failed = revocation({
    status: 'failed',
    target_count: 1,
    pending_count: 1,
    targets: [
      target({
        status: 'failed',
        ack_revision: 'b'.repeat(64),
        ack_at: '2026-10-31T10:00:08Z',
        error_code: 'application_reload_failed',
      }),
    ],
  });
  routeApi({ [PATH]: () => failed });
  renderWithProviders(
    <SecretRevocationStatus slug="api" revocation={failed} onDismiss={() => {}} />
  );
  expect(await screen.findByText(/reported that its reload failed/i)).toBeInTheDocument();
  expect(screen.getByText(/may still hold JWT_SIGNING_KEY/i)).toBeInTheDocument();
});

it('says nothing held the key when no instance was running', async () => {
  const idle = revocation({ status: 'complete', target_count: 0, pending_count: 0, targets: [] });
  routeApi({ [PATH]: () => idle });
  renderWithProviders(<SecretRevocationStatus slug="api" revocation={idle} onDismiss={() => {}} />);
  expect(await screen.findByText(/no instance was running/i)).toBeInTheDocument();
});

it('can be dismissed', async () => {
  routeApi({ [PATH]: () => revocation() });
  const onDismiss = vi.fn();
  renderWithProviders(
    <SecretRevocationStatus slug="api" revocation={revocation()} onDismiss={onDismiss} />
  );
  await userEvent.setup().click(screen.getByRole('button', { name: /dismiss/i }));
  expect(onDismiss).toHaveBeenCalled();
});

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

it('stops waiting after two minutes and says a restart makes sure', async () => {
  const stale = revocation({ created_at: ago(3 * 60_000) });
  routeApi({ [PATH]: () => stale });
  renderWithProviders(
    <SecretRevocationStatus slug="api" revocation={stale} onDismiss={() => {}} />
  );
  expect(
    await screen.findByText(/no confirmation from 2 running instances in 2 minutes/i)
  ).toBeInTheDocument();
  expect(screen.getByText(/restart or redeploy the app to make sure/i)).toBeInTheDocument();
  expect(screen.getAllByText('no confirmation')).toHaveLength(2);
  expect(screen.queryByText(/within about 10 seconds/i)).not.toBeInTheDocument();
});

it('turns to the no-confirmation copy when the two minutes run out on screen', async () => {
  const almost = revocation({ created_at: ago(2 * 60_000 - 400) });
  routeApi({ [PATH]: () => almost });
  renderWithProviders(
    <SecretRevocationStatus slug="api" revocation={almost} onDismiss={() => {}} />
  );
  expect(await screen.findByText(/waiting for 2 of 2/i)).toBeInTheDocument();
  expect(
    await screen.findByText(/no confirmation from 2 running instances/i, {}, { timeout: 3000 })
  ).toBeInTheDocument();
});
