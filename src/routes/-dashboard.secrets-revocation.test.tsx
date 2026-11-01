import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderWithProviders, routeApi } from '@/test/monetization';

vi.mock('@/components/dashboard/secret-references', () => ({
  SecretReferences: ({ slug }: { slug: string }) => <p>references for {slug}</p>,
}));

const { SecretsBody } = await import('@/components/dashboard/secrets-page');

const REVOCATION = {
  id: '7b0c2a52-4e7f-4c1e-9d3a-0d2f5e7a9c11',
  scope: 'default',
  key: 'JWT_SIGNING_KEY',
  created_at: '2026-10-31T10:00:00Z',
  status: 'blocked',
  target_count: 1,
  acknowledged_count: 0,
  pending_count: 1,
  targets: [
    {
      instance_id: '1f9e7c3a-0b2d-4c5e-8f6a-7b8c9d0e1f2a',
      runtime_state: 'running',
      reload_support: 'disabled',
      status: 'pending',
    },
  ],
};

let spies: ReturnType<typeof routeApi>;
beforeEach(() => {
  spies = routeApi({
    'GET /v1/apps/{slug}/secrets': () => ({
      secrets: [
        {
          key: 'JWT_SIGNING_KEY',
          scope: 'default',
          updated_at: '2026-10-30T10:00:00Z',
          created_at: '2026-10-01T10:00:00Z',
        },
      ],
      quota_max: 64,
      count: 1,
    }),
    'DELETE /v1/apps/{slug}/secrets/{key}': () => REVOCATION,
    'GET /v1/apps/{slug}/secret-revocations/{revocation_id}': () => REVOCATION,
  });
});
afterEach(() => vi.restoreAllMocks());

it('shows the app’s secret references beside its secrets', async () => {
  renderWithProviders(<SecretsBody slug="api" />);
  expect(await screen.findByText('references for api')).toBeInTheDocument();
});

it('after a delete, shows what it means for the instances still running with the secret', async () => {
  const user = userEvent.setup();
  renderWithProviders(<SecretsBody slug="api" />);
  await user.click(await screen.findByRole('button', { name: 'Delete secret JWT_SIGNING_KEY' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(/until they restart/i)).toBeInTheDocument();
  await user.click(within(dialog).getByRole('button', { name: 'Delete secret' }));
  await waitFor(() =>
    expect(spies.DELETE).toHaveBeenCalledWith(
      '/v1/apps/{slug}/secrets/{key}',
      expect.objectContaining({ headers: { Prefer: 'return=representation' } })
    )
  );
  const status = await screen.findByRole('region', {
    name: /removing JWT_SIGNING_KEY from running instances/i,
  });
  expect(within(status).getByText(/cannot reload secrets/i)).toBeInTheDocument();
});
