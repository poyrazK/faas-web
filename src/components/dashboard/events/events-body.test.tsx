import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '@/components/ui/confirm';
import { spyApi } from '@/test/api';

const toast = vi.fn();
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { id: 'acct-1', plan: 'pro' } }) }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));

const { EventsBody } = await import('./events-body');

const ACCEPTED = '2026-10-16T09:00:00.123456Z';
const ok = (data: unknown) => ({ data, response: new Response() });
const problem = (status: number, code: string) => ({
  error: { status, code, title: code, detail: `${code} detail` },
  response: new Response(null, { status }),
});

const waitingRecipient = {
  event_source: 'catalog',
  event_id: 'prod-8812-v14',
  event_type: 'product.updated',
  accepted_at: ACCEPTED,
  app_id: '00000000-0000-4000-8000-000000000001',
  app_slug: 'search-indexer',
  target_available: true,
  subscription_id: 'sub-indexer',
  consumer_kind: 'application',
  origin: 'acceptance',
  routing_mode: 'recipient',
  state: 'pending',
  attempts: 3,
  capacity_deferrals: 0,
  pending_age_seconds: 1080,
  waiting_reason: 'circuit_open',
  receipt_url: '/v1/events/receipt?source=catalog&id=prod-8812-v14',
};

const backlog = {
  observed_at: ACCEPTED,
  window_at: ACCEPTED,
  coverage: 'captured_and_backfill_recipients',
  recipients: [waitingRecipient],
  consumers: [
    {
      app_id: waitingRecipient.app_id,
      app_slug: 'search-indexer',
      target_available: true,
      subscription_id: 'sub-indexer',
      consumer_kind: 'application',
      waiting_recipients: 7,
      pending_recipients: 7,
      processing_recipients: 0,
      capacity_waiting_recipients: 0,
      ordering_waiting_recipients: 2,
      oldest_accepted_at: ACCEPTED,
      oldest_age_seconds: 1080,
      pending_waiting_reasons: { circuit_open: 5, ordering_blocked: 2, ready: 0 },
    },
  ],
  unattributed_receipts: 0,
};

const storage = {
  retained_events: 412,
  retained_bytes: 1_048_576,
  pending_events: 3,
  oldest_pending_at: ACCEPTED,
  limits: { retained_events: 16384, retained_bytes: 67108864 },
};

const retention = {
  held_receipts: 1,
  eligible_for_pruning: 4,
  expiring_receipts: 9,
};

const receipt = {
  event_id: 'inv-1',
  event_source: 'billing',
  event_type: 'invoice.paid',
  accepted_at: ACCEPTED,
  routing_settled_at: ACCEPTED,
  retain_until: '2026-11-15T09:00:00Z',
  snapshot_captured: true,
  routing_mode: 'recipient',
  recipient_count: 1,
  routing_summary: { enqueued: 1 },
  recipients: [
    {
      subscription_id: 'sub-router',
      app_id: '00000000-0000-4000-8000-000000000002',
      app_slug: 'webhook-router',
      routing: { state: 'enqueued', attempts: 1, retryable: true, replay_count: 0 },
      execution: {
        invocation_id: '00000000-0000-4000-8000-0000000000aa',
        state: 'completed',
        attempts: 1,
        replay_generation: 0,
        created_at: ACCEPTED,
      },
      recovery_actions: [],
    },
  ],
};

type Init = { params?: { query?: Record<string, unknown> }; body?: Record<string, unknown> };

let get: ReturnType<typeof spyApi>;
let post: ReturnType<typeof spyApi>;

beforeEach(() => {
  toast.mockReset();
  get = spyApi('GET').mockImplementation(async (path, init) => {
    const query = (init as Init | undefined)?.params?.query ?? {};
    switch (path) {
      case '/v1/events/backlog':
        return ok(backlog);
      case '/v1/events/storage':
        return ok(storage);
      case '/v1/events/retention':
        return ok(retention);
      case '/v1/events/receipt':
        return query.source === 'billing' && query.id === 'inv-1'
          ? ok(receipt)
          : problem(404, 'not_found');
      case '/v1/events/recipient-blocker':
        return ok({
          query,
          observed_at: ACCEPTED,
          status: 'available',
          routing_state: 'pending',
          recipient: { ...waitingRecipient, next_attempt_at: '2026-10-16T09:20:00Z' },
        });
      default:
        throw new Error(`unexpected GET ${path}`);
    }
  });
  post = spyApi('POST').mockImplementation(async (path, init) => {
    const body = (init as Init).body ?? {};
    if (path === '/v1/events:preview')
      return ok({
        event_id: 'preview-1',
        source: body.source,
        type: body.type,
        candidate_count: 2,
        matched_count: 1,
        filter_mismatch_count: 1,
        other_mismatch_count: 0,
        matches: [
          {
            app_slug: 'webhook-router',
            subscription_id: 'sub-router',
            source: 'billing',
            type: 'invoice.paid',
            filter: {},
            reason: 'would_deliver',
          },
        ],
        non_matches: [
          {
            app_slug: 'billing-recon',
            subscription_id: 'sub-recon',
            source: 'billing',
            type: 'invoice.*',
            filter: { currency: 'eur' },
            reason: 'content_filter_mismatch',
          },
        ],
        truncated: false,
      });
    if (path === '/v1/events:publish')
      return ok({
        id: body.id,
        accepted_at: ACCEPTED,
        account_id: '00000000-0000-4000-8000-0000000000ff',
        receipt_url: '/v1/events/receipt',
      });
    throw new Error(`unexpected POST ${path}`);
  });
});

afterEach(() => {
  get.mockRestore();
  post.mockRestore();
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ConfirmProvider>
        <EventsBody />
      </ConfirmProvider>
    </QueryClientProvider>
  );
}

const calledPaths = (spy: ReturnType<typeof spyApi>) => spy.mock.calls.map(([path]) => path);

describe('Events page', () => {
  it('renders waiting consumers with counts, storage, and the dominant reason', async () => {
    renderPage();
    const row = (await screen.findByText('search-indexer')).closest('tr')!;
    expect(within(row).getByText('7')).toBeInTheDocument();
    expect(within(row).getByText('Circuit open')).toBeInTheDocument();
    expect(within(row).getByText('18m')).toBeInTheDocument();
    expect(await screen.findByText('of 16,384 allowed')).toBeInTheDocument();
    expect(screen.getByText(/4 eligible for pruning/)).toBeInTheDocument();
  });

  it('shows the routing blocker for a waiting recipient on demand', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByText('search-indexer'));
    const dialog = within(await screen.findByRole('dialog', { name: 'search-indexer' }));
    await user.click(await dialog.findByRole('button', { name: /prod-8812-v14/ }));
    expect(await dialog.findByText('Blocked by')).toBeInTheDocument();
    const blockerCall = get.mock.calls.find(([path]) => path === '/v1/events/recipient-blocker');
    expect((blockerCall?.[1] as Init).params?.query).toEqual({
      source: 'catalog',
      id: 'prod-8812-v14',
      subscription_id: 'sub-indexer',
      expected_accepted_at: ACCEPTED,
    });
  });

  it('looks up a receipt and shows acceptance, routing, and execution', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByRole('textbox', { name: 'Source' }), 'billing');
    await user.type(screen.getByRole('textbox', { name: 'Event ID' }), 'inv-1');
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    const evidence = within(await screen.findByLabelText('Receipt evidence'));
    expect(evidence.getByText('invoice.paid')).toBeInTheDocument();
    expect(evidence.getByText('webhook-router')).toBeInTheDocument();
    expect(evidence.getByText('Handed to handler')).toBeInTheDocument();
    expect(evidence.getByText('Completed')).toBeInTheDocument();
    // A settled receipt has nobody waiting, so no blocker read is made.
    expect(calledPaths(post)).not.toContain('/v1/events/recipient-blockers');
  });

  it('says plainly when no receipt is retained', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByRole('textbox', { name: 'Source' }), 'billing');
    await user.type(screen.getByRole('textbox', { name: 'Event ID' }), 'missing');
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    expect(await screen.findByText(/No retained receipt for/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Receipt evidence')).not.toBeInTheDocument();
  });

  it('previews routing without publishing anything', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Preview routing' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Preview routing' }));
    await user.type(dialog.getByRole('textbox', { name: 'Source' }), 'billing');
    await user.type(dialog.getByRole('textbox', { name: 'Type' }), 'invoice.paid');
    const payload = dialog.getByRole('textbox', { name: 'Payload (JSON)' });
    await user.clear(payload);
    await user.click(payload);
    await user.paste('{"currency":"usd"}');
    await user.click(dialog.getByRole('button', { name: 'Preview routing' }));

    expect(await dialog.findByText(/Would reach/)).toHaveTextContent(
      'Would reach 1 of 2 candidate subscriptions. 1 excluded by content filters.'
    );
    expect(dialog.getByText('Content filter does not match')).toBeInTheDocument();
    expect(dialog.getByText('Nothing was published.')).toBeInTheDocument();
    expect(calledPaths(post)).toEqual(['/v1/events:preview']);
    expect((post.mock.calls[0][1] as Init).body).toEqual({
      source: 'billing',
      type: 'invoice.paid',
      data: { currency: 'usd' },
    });
  });

  it('publishes only after an explicit confirmation', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Publish event' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Publish event' }));
    await user.type(dialog.getByRole('textbox', { name: 'Source' }), 'billing');
    await user.type(dialog.getByRole('textbox', { name: 'Type' }), 'invoice.paid');
    const id = dialog.getByRole('textbox', { name: 'Event ID' });
    await user.clear(id);
    await user.type(id, 'inv-77');

    await user.click(dialog.getByRole('button', { name: 'Publish…' }));
    const confirm = await screen.findByRole('dialog', { name: 'Publish invoice.paid?' });
    expect(post).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Publish invoice.paid?' })).toBeNull()
    );
    expect(post).not.toHaveBeenCalled();

    await user.click(dialog.getByRole('button', { name: 'Publish…' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Publish invoice.paid?' })).getByRole(
        'button',
        { name: 'Publish' }
      )
    );
    await waitFor(() => expect(calledPaths(post)).toEqual(['/v1/events:publish']));
    expect((post.mock.calls[0][1] as Init).body).toEqual({
      id: 'inv-77',
      source: 'billing',
      type: 'invoice.paid',
      data: {},
    });
    expect(await screen.findByText(/Accepted for routing/)).toBeInTheDocument();
    expect(toast).toHaveBeenCalledWith({ kind: 'success', title: 'Event accepted' });
  });
});
