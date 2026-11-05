import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

const access = vi.hoisted(() => ({ values: {} as Record<string, string> }));
const subscriptions = vi.fn();
const control = vi.fn();
const deliveries = vi.fn();
const ack = vi.fn();
const pause = vi.fn();
const resume = vi.fn();
const confirm = vi.fn();
const toast = vi.fn();

vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: (id: string) => ({ access: access.values[id] ?? 'on', refresh: vi.fn() }),
}));
vi.mock('@/components/dashboard/app-select', () => ({
  useSelectedApp: () => ({ slug: 'billing-recon', select: vi.fn(), apps: [] }),
  AppScope: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  AppSelect: () => <span>app picker</span>,
}));
vi.mock('@/lib/api/event-consumers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/event-consumers')>()),
  useEventSubscriptions: (slug: string) => subscriptions(slug) as unknown,
  useDeliveryControl: (slug: string, id: string) => control(slug, id) as unknown,
  useEventDeliveries: (slug: string, state: string) => deliveries(slug, state) as unknown,
  useAcknowledgment: (slug: string, id: string) => ack(slug, id) as unknown,
  usePauseSubscription: () => ({ mutateAsync: pause, isPending: false }),
  useResumeSubscription: () => ({ mutateAsync: resume, isPending: false }),
}));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));

const { EventConsumers } = await import('./event-consumers');

const SUB = '5f2b7c1e-1d0a-4c55-9d0e-6a1f1e0b3c02';
const INV = '7d1c0000-0b3a-4c2e-9f10-5e6d7c8b9a0f';
const read = (data: unknown, extra: Record<string, unknown> = {}) => ({
  data,
  isPending: false,
  error: null,
  refetch: vi.fn(),
  ...extra,
});
const controlState = (paused: boolean) => ({
  subscription_id: SUB,
  app_id: 'app',
  paused,
  rate_per_second: 10,
  pending_recipients: 42,
  processing_recipients: 0,
  oldest_age_seconds: 1260,
  max_pending_deliveries: 0,
  effective_max_pending_deliveries: 64,
  live_deliveries: 0,
});
const delivery = {
  invocation_id: INV,
  invocation_source: 'async_invoke',
  event_id: 'evt-4102',
  event_source: 'billing',
  event_type: 'invoice.paid',
  subscription_id: SUB,
  state: 'dispatching',
  attempts: 1,
  created_at: '2026-11-03T10:00:00Z',
};

beforeEach(() => {
  access.values = {};
  for (const fn of [subscriptions, control, deliveries, ack, pause, resume, confirm, toast])
    fn.mockReset();
  subscriptions.mockReturnValue(
    read({
      app_slug: 'billing-recon',
      subscriptions: [
        {
          id: SUB,
          app_id: 'app',
          source: 'billing',
          type: 'invoice.*',
          filter: { currency: 'eur' },
          enabled: true,
          ordered: true,
          created_at: '2026-10-01T00:00:00Z',
          updated_at: '2026-10-01T00:00:00Z',
        },
      ],
    })
  );
  control.mockReturnValue(read(controlState(false)));
  deliveries.mockReturnValue(
    read(
      {
        pages: [
          {
            app_slug: 'billing-recon',
            deliveries: [delivery],
            fanout_failures: [
              {
                event_id: 'evt-4099',
                event_source: 'billing',
                event_type: 'invoice.paid',
                subscription_id: SUB,
                state: 'failed',
                attempts: 12,
                failure_code: 'target_unavailable',
                last_error: 'gone',
                created_at: '2026-11-03T09:00:00Z',
                failed_at: '2026-11-03T09:30:00Z',
              },
            ],
          },
        ],
      },
      { hasNextPage: false, isFetchingNextPage: false, fetchNextPage: vi.fn() }
    )
  );
  ack.mockReturnValue(
    read({
      invocation_id: INV,
      attempt: 1,
      replay_generation: 0,
      state: 'dispatching',
      processing_state: 'processing',
      lease_expires_at: '2026-11-03T10:04:00Z',
      deadline_at: '2026-11-03T10:59:00Z',
    })
  );
  confirm.mockResolvedValue(true);
});

const openSubscription = () =>
  userEvent.click(screen.getByRole('button', { name: 'Subscription billing invoice.*' }));

describe('EventConsumers', () => {
  it.each(['off', 'plan-not-entitled', 'runtime-unavailable'])(
    'reads nothing while event-subscriptions is %s',
    (state) => {
      access.values['event-subscriptions'] = state;
      render(<EventConsumers />);
      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(subscriptions).not.toHaveBeenCalled();
      expect(deliveries).not.toHaveBeenCalled();
    }
  );

  it('lists the manifest-declared subscriptions and says a deploy owns them', () => {
    render(<EventConsumers />);
    expect(screen.getByText('Enabled')).toBeInTheDocument();
    expect(screen.getByText('billing · invoice.*')).toBeInTheDocument();
    expect(screen.getByText('ordered')).toBeInTheDocument();
    expect(screen.getByText(/event_triggers in the app's gregale.yaml/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete|create|new subscription/i })).toBeNull();
  });

  it('points an app with no subscriptions at its manifest', () => {
    subscriptions.mockReturnValue(read({ app_slug: 'billing-recon', subscriptions: [] }));
    render(<EventConsumers />);
    expect(screen.getByText(/subscribes to no events/i)).toBeInTheDocument();
  });

  it('pauses a subscription after a confirmation that says what keeps running', async () => {
    pause.mockResolvedValue(controlState(true));
    render(<EventConsumers />);
    await openSubscription();
    expect(control).toHaveBeenCalledWith('billing-recon', SUB);
    expect(screen.getByText('Routing')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /pause/i }));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringMatching(/already admitted/i) })
    );
    await waitFor(() => expect(pause).toHaveBeenCalled());
  });

  it('resumes at a chosen drain rate and refuses a rate outside 0 to 100', async () => {
    control.mockReturnValue(read(controlState(true)));
    resume.mockResolvedValue(controlState(false));
    render(<EventConsumers />);
    await openSubscription();
    expect(screen.getByText('Paused')).toBeInTheDocument();
    const rate = screen.getByLabelText('Drain rate (per second)');
    await userEvent.clear(rate);
    await userEvent.type(rate, '250');
    expect(screen.getByRole('button', { name: /resume/i })).toBeDisabled();
    await userEvent.clear(rate);
    await userEvent.type(rate, '25');
    await userEvent.click(screen.getByRole('button', { name: /resume/i }));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringMatching(/42 waiting .* 25 admissions/) })
    );
    await waitFor(() => expect(resume).toHaveBeenCalledWith(25));
  });

  it('reports a refused control by its problem', async () => {
    const error = new ApiError({ status: 404, code: 'not_found', title: 'Gone' });
    pause.mockRejectedValue(error);
    render(<EventConsumers />);
    await openSubscription();
    await userEvent.click(screen.getByRole('button', { name: /pause/i }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error', error }))
    );
  });

  it('hides delivery controls while event-delivery-controls is off', async () => {
    access.values['event-delivery-controls'] = 'off';
    render(<EventConsumers />);
    await openSubscription();
    expect(control).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /pause/i })).toBeNull();
  });

  it('filters deliveries by state and shows routing failures', async () => {
    render(<EventConsumers />);
    expect(
      within(screen.getByRole('button', { name: `Delivery invoice.paid ${INV}` })).getByText(
        'Dispatching'
      )
    ).toBeInTheDocument();
    expect(screen.getByText('Routing failed')).toBeInTheDocument();
    expect(screen.getByText('target_unavailable')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Delivery state'), 'failed');
    expect(deliveries).toHaveBeenLastCalledWith('billing-recon', 'failed');
  });

  it('reads a delivery acknowledgment lease without offering token-only actions', async () => {
    render(<EventConsumers />);
    await userEvent.click(screen.getByRole('button', { name: `Delivery invoice.paid ${INV}` }));
    expect(ack).toHaveBeenCalledWith('billing-recon', INV);
    expect(screen.getByText('Processing')).toBeInTheDocument();
    expect(screen.getByText(/never holds that token/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /complete|renew|dead-letter/i })).toBeNull();
  });

  it('hides the acknowledgment lease while event-acknowledgments is off', async () => {
    access.values['event-acknowledgments'] = 'off';
    render(<EventConsumers />);
    await userEvent.click(screen.getByRole('button', { name: `Delivery invoice.paid ${INV}` }));
    expect(ack).not.toHaveBeenCalled();
  });

  it('keeps loading and error apart from empty for deliveries', () => {
    deliveries.mockReturnValue(
      read(undefined, {
        isPending: false,
        error: new ApiError({ status: 500, code: 'internal', title: 'Boom' }),
        hasNextPage: false,
      })
    );
    render(<EventConsumers />);
    expect(screen.queryByText(/no event has been delivered/i)).toBeNull();
  });
});
