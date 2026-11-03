import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, routeApi, type Handlers } from '@/test/monetization';
import { WebhookDeliveries } from './webhook-deliveries';

const APP_ID = '8b1f5e5d273e5a18ae0058fceba4fe6c';
const delivery = (over: Record<string, unknown>) => ({
  id: 'd'.repeat(32),
  webhook_id: 'w'.repeat(32),
  app_id: APP_ID,
  account_id: '8b1f5e5d-273e-5a18-ae00-58fceba4fe6c',
  event: 'deployment.live',
  attempt: 1,
  status: 'succeeded',
  next_attempt_at: '2026-11-03T10:00:00Z',
  created_at: '2026-11-03T09:00:00Z',
  updated_at: '2026-11-03T09:00:01Z',
  ...over,
});
const HEALTH = {
  webhook_id: 'w',
  snapshot_at: '2026-11-03T10:00:00Z',
  pending_count: 0,
  in_flight_count: 0,
  dead_count: 1,
  receiver_state: 'ready',
  recent_succeeded_count: 3,
  recent_dead_count: 1,
  recent_success_rate: 0.75,
};
const DEAD = delivery({
  id: 'a'.repeat(32),
  status: 'dead',
  attempt: 7,
  last_error: 'HTTP 503',
  last_response_code: 503,
});
const RETRYING = delivery({ id: 'b'.repeat(32), status: 'failed', attempt: 2 });

function api(prefix: string, extra: Handlers = {}) {
  return routeApi({
    [`GET ${prefix}/health`]: () => HEALTH,
    [`GET ${prefix}/deliveries`]: () => ({ deliveries: [DEAD, RETRYING], next_token: 'page2' }),
    [`GET ${prefix}/deliveries/{did}/attempts`]: () => ({
      attempts: [
        {
          id: '1',
          delivery_id: DEAD.id,
          replay_generation: 0,
          attempt_number: 7,
          outcome: 'dead',
          response_code: 503,
          error: 'upstream unavailable',
          started_at: '2026-11-03T09:10:00Z',
          finished_at: '2026-11-03T09:10:01Z',
          duration_ms: 1000,
        },
      ],
    }),
    [`POST ${prefix}/deliveries/{did}/retry`]: () => ({ delivery: { ...DEAD, status: 'pending' } }),
    'GET /v1/apps': () => [{ id: APP_ID, slug: 'checkout' }],
    ...extra,
  });
}
afterEach(() => vi.restoreAllMocks());

describe('WebhookDeliveries', () => {
  it('shows an app webhook’s health, and retry only on dead deliveries', async () => {
    const spies = api('/v1/apps/{slug}/webhooks/{id}');
    renderWithProviders(<WebhookDeliveries scope={{ slug: 'api', id: 'w1' }} />);
    const health = await screen.findByRole('region', { name: 'Delivery health' });
    expect(await within(health).findByText('Ready')).toBeInTheDocument();
    expect(within(health).getByText('75.0% delivered')).toBeInTheDocument();
    const list = screen.getByRole('region', { name: 'Deliveries' });
    expect(await within(list).findByText('Dead')).toBeInTheDocument();
    expect(within(list).getByText('Retrying')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(spies.POST).toHaveBeenCalledWith(
        '/v1/apps/{slug}/webhooks/{id}/deliveries/{did}/retry',
        { params: { path: { slug: 'api', id: 'w1', did: DEAD.id } } }
      )
    );
    // An app webhook's rows need no source app.
    expect(screen.queryByText('checkout')).toBeNull();
  });

  it('lists an account receiver’s attempts and names each delivery’s app', async () => {
    const spies = api('/v1/account/release-webhooks/{id}', {
      'GET /v1/account/release-webhooks/{id}/health': () => ({
        ...HEALTH,
        receiver_state: 'cooling_down',
        receiver_cooldown_until: '2026-11-03T10:05:00Z',
        recent_success_rate: undefined,
      }),
    });
    renderWithProviders(<WebhookDeliveries scope={{ account: true, id: 'r1' }} />);
    expect(await screen.findByText('Cooling down')).toBeInTheDocument();
    expect(screen.getByText('No finished deliveries')).toBeInTheDocument();
    expect(await screen.findAllByText('checkout')).toHaveLength(2);
    await userEvent.click(
      screen.getByRole('button', { name: `Attempts for deployment.live delivery ${DEAD.id}` })
    );
    const attempts = await screen.findByRole('list', { name: 'Attempts' });
    expect(within(attempts).getByText('upstream unavailable')).toBeInTheDocument();
    expect(within(attempts).getByText('HTTP 503')).toBeInTheDocument();
    expect(spies.GET).toHaveBeenCalledWith(
      '/v1/account/release-webhooks/{id}/deliveries/{did}/attempts',
      expect.objectContaining({ params: { path: { id: 'r1', did: DEAD.id } } })
    );
    await userEvent.click(screen.getByRole('button', { name: 'Older' }));
    await waitFor(() =>
      expect(spies.GET).toHaveBeenCalledWith(
        '/v1/account/release-webhooks/{id}/deliveries',
        expect.objectContaining({
          params: { path: { id: 'r1' }, query: { page_size: 25, page_token: 'page2' } },
        })
      )
    );
  });
});
