import type { ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '@/components/ui/confirm';
import { ToastProvider } from '@/components/ui/toast';
import { spyApi } from '@/test/api';
import { WebhookDeliveries } from './webhook-deliveries';

const HOOK = 'a'.repeat(32);
const DEAD = 'd'.repeat(32);
const DONE = 'e'.repeat(32);
const APP = 'f'.repeat(32);
const iso = (offset: number) => new Date(Date.now() + offset).toISOString();
const ok = (data: unknown) => Promise.resolve({ data, response: new Response() });
const problem = (status: number, code: string, detail: string) =>
  Promise.resolve({
    error: { type: 'about:blank', title: code, status, code, detail },
    response: new Response(null, { status }),
  });

function delivery(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    webhook_id: HOOK,
    app_id: APP,
    account_id: '00000000-0000-4000-8000-000000000000',
    event: 'deployment.live',
    attempt: 1,
    status: 'succeeded',
    next_attempt_at: iso(-60_000),
    created_at: iso(-3_600_000),
    updated_at: iso(-3_500_000),
    ...extra,
  };
}

const health = {
  webhook_id: HOOK,
  snapshot_at: iso(0),
  pending_count: 2,
  in_flight_count: 0,
  dead_count: 1,
  receiver_state: 'cooling_down',
  receiver_cooldown_until: iso(4 * 60_000),
  recent_succeeded_count: 3,
  recent_dead_count: 1,
  recent_success_rate: 0.75,
};

const attempts = {
  attempts: [
    {
      id: '1',
      delivery_id: DEAD,
      replay_generation: 0,
      attempt_number: 7,
      outcome: 'dead',
      response_code: 503,
      error: 'HTTP 503',
      started_at: iso(-60_000),
      finished_at: iso(-59_000),
      duration_ms: 412,
    },
    {
      id: '2',
      delivery_id: DEAD,
      replay_generation: 0,
      attempt_number: 6,
      outcome: 'retrying',
      response_code: 0,
      error: 'timeout after 10s',
      started_at: iso(-7_200_000),
      finished_at: iso(-7_190_000),
      duration_ms: 10_000,
      next_attempt_at: iso(-60_000),
    },
  ],
};

const PATHS = {
  account: {
    health: '/v1/account/release-webhooks/{id}/health',
    deliveries: '/v1/account/release-webhooks/{id}/deliveries',
    attempts: '/v1/account/release-webhooks/{id}/deliveries/{did}/attempts',
    retry: '/v1/account/release-webhooks/{id}/deliveries/{did}/retry',
  },
  app: {
    health: '/v1/apps/{slug}/webhooks/{id}/health',
    deliveries: '/v1/apps/{slug}/webhooks/{id}/deliveries',
    attempts: '/v1/apps/{slug}/webhooks/{id}/deliveries/{did}/attempts',
    retry: '/v1/apps/{slug}/webhooks/{id}/deliveries/{did}/retry',
  },
};

function routes(
  scope: 'account' | 'app',
  pages: unknown[] = [
    {
      deliveries: [
        delivery(DEAD, {
          status: 'dead',
          attempt: 7,
          last_response_code: 503,
          last_error: 'HTTP 503',
        }),
        delivery(DONE),
      ],
    },
  ]
) {
  const get = spyApi('GET');
  let page = 0;
  get.mockImplementation((path: string) => {
    if (path === PATHS[scope].health) return ok(health);
    if (path === PATHS[scope].deliveries) return ok(pages[Math.min(page++, pages.length - 1)]);
    if (path === PATHS[scope].attempts) return ok(attempts);
    return ok(undefined);
  });
  return get;
}

function mount(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ConfirmProvider>{children}</ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

afterEach(() => vi.restoreAllMocks());

describe('WebhookDeliveries', () => {
  it('reads the receiver state, queue and last-24-hour outcomes from health', async () => {
    routes('account');
    mount(<WebhookDeliveries source={{ id: HOOK }} target="https://hooks.example.com" />);
    const summary = await screen.findByRole('region', { name: 'Delivery health' });
    expect(within(summary).getByText('Cooling down')).toBeInTheDocument();
    expect(summary).toHaveTextContent(/answered 429 or 503/i);
    expect(within(summary).getByText('75%')).toBeInTheDocument();
    expect(summary).toHaveTextContent('2 pending');
    expect(summary).toHaveTextContent('1 dead');
  });

  it('opens a delivery attempt history from the account route', async () => {
    const get = routes('account');
    mount(
      <WebhookDeliveries
        source={{ id: HOOK }}
        target="https://hooks.example.com"
        appName={(id) => (id === APP ? 'billing' : undefined)}
      />
    );
    const dead = await screen.findByRole('listitem', { name: /deployment.live, dead/ });
    expect(within(dead).getByText('billing')).toBeInTheDocument();
    await userEvent.click(within(dead).getByRole('button', { name: 'Attempts' }));
    const history = await within(dead).findByRole('list', { name: 'Attempts' });
    expect(within(history).getByText('#7')).toBeInTheDocument();
    expect(within(history).getByText('503')).toBeInTheDocument();
    expect(within(history).getByText('no response')).toBeInTheDocument();
    expect(within(history).getByText('timeout after 10s')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith(
      PATHS.account.attempts,
      expect.objectContaining({
        params: expect.objectContaining({ path: { id: HOOK, did: DEAD } }),
      })
    );
  });

  it('offers Send again only on a dead delivery, and only after confirming', async () => {
    routes('account');
    const post = spyApi('POST').mockImplementation(() =>
      ok({ delivery: delivery(DEAD, { status: 'pending', attempt: 0 }) })
    );
    mount(<WebhookDeliveries source={{ id: HOOK }} target="https://hooks.example.com" />);
    const done = await screen.findByRole('listitem', { name: /deployment.live, succeeded/ });
    expect(within(done).queryByRole('button', { name: 'Send again' })).toBeNull();

    const dead = screen.getByRole('listitem', { name: /deployment.live, dead/ });
    await userEvent.click(within(dead).getByRole('button', { name: 'Send again' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/https:\/\/hooks.example.com/);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(post).not.toHaveBeenCalled();

    await userEvent.click(within(dead).getByRole('button', { name: 'Send again' }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Send again' })
    );
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        PATHS.account.retry,
        expect.objectContaining({ params: { path: { id: HOOK, did: DEAD } } })
      )
    );
  });

  it('explains a delivery that is no longer dead by its code', async () => {
    routes('account');
    spyApi('POST').mockImplementation(() =>
      problem(400, 'app_webhook_invalid', "delivery is not in 'dead' state")
    );
    mount(<WebhookDeliveries source={{ id: HOOK }} target="https://hooks.example.com" />);
    const dead = await screen.findByRole('listitem', { name: /deployment.live, dead/ });
    await userEvent.click(within(dead).getByRole('button', { name: 'Send again' }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Send again' })
    );
    expect(await screen.findByText(/no longer dead/i)).toBeInTheDocument();
  });

  it('reads an app webhook through the app routes, and pages with next_token', async () => {
    const get = routes('app', [
      { deliveries: [delivery(DONE)], next_token: 'cursor-2' },
      { deliveries: [delivery(DEAD, { status: 'dead', attempt: 7 })] },
    ]);
    mount(
      <WebhookDeliveries source={{ slug: 'billing', id: HOOK }} target="https://h.example.com" />
    );
    await screen.findByRole('listitem', { name: /succeeded/ });
    expect(get).toHaveBeenCalledWith(
      PATHS.app.health,
      expect.objectContaining({ params: { path: { slug: 'billing', id: HOOK } } })
    );
    await userEvent.click(screen.getByRole('button', { name: 'Load older deliveries' }));
    await screen.findByRole('listitem', { name: /dead/ });
    expect(get).toHaveBeenLastCalledWith(
      PATHS.app.deliveries,
      expect.objectContaining({
        params: expect.objectContaining({ query: { page_token: 'cursor-2' } }),
      })
    );
    expect(screen.queryByRole('button', { name: 'Load older deliveries' })).toBeNull();
  });

  it('says so when nothing has been delivered', async () => {
    routes('account', [{ deliveries: [] }]);
    mount(<WebhookDeliveries source={{ id: HOOK }} target="https://hooks.example.com" />);
    expect(await screen.findByText(/nothing has been delivered yet/i)).toBeInTheDocument();
  });
});
