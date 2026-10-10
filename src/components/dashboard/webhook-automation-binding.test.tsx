import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

const put = vi.fn();
const remove = vi.fn();
const bindingRefetch = vi.fn();
const confirm = vi.fn();
const capability = { accountId: 'account-1', state: 'available' };
const automations = {
  data: {
    runtime_enabled: true,
    automations: [
      { name: 'published', published: { trigger: { type: 'manual' } }, enabled: true },
      { name: 'draft-only', enabled: false },
    ],
  },
  isPending: false,
  error: null as Error | null,
};
const binding = {
  data: undefined as
    | undefined
    | {
        version: number;
        workflow_name: string;
        event_type: string;
        filter?: Record<string, unknown>;
      },
  error: new ApiError({ status: 404, code: 'not_found', title: 'Not found' }) as Error | null,
  isPending: false,
  refetch: bindingRefetch,
};

vi.mock('@/lib/api/capabilities', () => ({ useCapability: () => capability }));
vi.mock('@/lib/api/automations', () => ({ useAutomations: () => automations }));
vi.mock('@/lib/api/inbound-webhooks', () => ({
  useWebhookBinding: () => binding,
  webhookBindingKey: (account: string, slug: string, id: string) => [
    'account',
    account,
    'app',
    slug,
    'inbound-webhooks',
    id,
    'automation-binding',
  ],
  putWebhookBinding: (...args: unknown[]) => put(...args),
  deleteWebhookBinding: (...args: unknown[]) => remove(...args),
}));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));
vi.mock('@/components/dashboard/primitives', () => ({
  Panel: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section aria-label={title}>{children}</section>
  ),
}));

const { WebhookAutomationBinding } = await import('./webhook-automation-binding');

function renderBinding(accountId = 'account-1', slug = 'app-a', endpointId = 'e1') {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <WebhookAutomationBinding accountId={accountId} slug={slug} endpointId={endpointId} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  put.mockReset().mockResolvedValue({ version: 1 });
  remove.mockReset().mockResolvedValue(undefined);
  bindingRefetch.mockReset();
  confirm.mockReset().mockResolvedValue(true);
  capability.accountId = 'account-1';
  capability.state = 'available';
  automations.data.runtime_enabled = true;
  automations.error = null;
  binding.data = undefined;
  binding.error = new ApiError({ status: 404, code: 'not_found', title: 'Not found' });
});

it('requires workflow availability and a published same-app automation', async () => {
  capability.state = 'runtime-unavailable';
  renderBinding();
  expect(screen.getByRole('button', { name: 'Review binding' })).toBeDisabled();
  expect(screen.getByText(/workflows unavailable/i)).toBeInTheDocument();
  expect(put).not.toHaveBeenCalled();
});

it('reviews delivery takeover and creates with expected version zero', async () => {
  renderBinding();
  const select = screen.getByRole('combobox', { name: 'Published automation' });
  expect(select).toHaveTextContent('published');
  expect(select).not.toHaveTextContent('draft-only');
  await userEvent.selectOptions(select, 'published');
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Stripe event type' }),
    'payment_intent.succeeded'
  );
  await userEvent.click(screen.getByRole('button', { name: 'Review binding' }));
  expect(confirm).toHaveBeenCalledWith(
    expect.objectContaining({ description: expect.stringMatching(/instead of app delivery/i) })
  );
  expect(put).toHaveBeenCalledWith(
    'app-a',
    'e1',
    {
      expected_version: 0,
      workflow_name: 'published',
      event_type: 'payment_intent.succeeded',
      take_over_delivery: true,
    },
    expect.any(String)
  );
});

it('refreshes after a version conflict and holds stale controls', async () => {
  binding.data = {
    version: 4,
    workflow_name: 'published',
    event_type: 'payment_intent.succeeded',
    filter: { object_id: 'pi_123' },
  };
  binding.error = null;
  put.mockRejectedValueOnce(
    new ApiError({ status: 409, code: 'webhook_automation_conflict', title: 'Conflict' })
  );
  renderBinding();
  await userEvent.selectOptions(
    screen.getByRole('combobox', { name: 'Published automation' }),
    'published'
  );
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Stripe event type' }),
    'charge.succeeded'
  );
  await userEvent.click(screen.getByRole('button', { name: 'Review binding' }));
  expect(put).toHaveBeenCalledTimes(1);
  expect(put.mock.calls[0][2].expected_version).toBe(4);
  expect(put.mock.calls[0][2].filter).toEqual({ object_id: 'pi_123' });
  expect(bindingRefetch).toHaveBeenCalled();
  expect(screen.getByText(/binding changed/i)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Review binding' }));
  expect(put).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole('button', { name: 'Remove binding' }));
  expect(remove).not.toHaveBeenCalled();
});

it('removes a binding with the observed version after explicit review', async () => {
  binding.data = { version: 4, workflow_name: 'published', event_type: 'payment_intent.succeeded' };
  binding.error = null;
  renderBinding();
  await userEvent.click(screen.getByRole('button', { name: 'Remove binding' }));
  expect(remove).toHaveBeenCalledWith('app-a', 'e1', 4);
});

it('does not save after account and app change while takeover review is pending', async () => {
  let finish!: (value: boolean) => void;
  confirm.mockReturnValue(new Promise((resolve) => (finish = resolve)));
  const view = renderBinding();
  await userEvent.selectOptions(
    screen.getByRole('combobox', { name: 'Published automation' }),
    'published'
  );
  await userEvent.type(screen.getByRole('textbox', { name: 'Stripe event type' }), '*');
  await userEvent.click(screen.getByRole('button', { name: 'Review binding' }));
  view.rerender(
    <QueryClientProvider client={new QueryClient()}>
      <WebhookAutomationBinding accountId="account-2" slug="app-b" endpointId="e2" />
    </QueryClientProvider>
  );
  finish(true);
  await waitFor(() => expect(put).not.toHaveBeenCalled());
});
