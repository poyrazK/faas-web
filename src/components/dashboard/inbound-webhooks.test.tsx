import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';

const create = vi.fn();
const setEnabled = vi.fn();
const setDeliveryPath = vi.fn();
const rotate = vi.fn();
const remove = vi.fn();
const confirm = vi.fn();
const refetch = vi.fn();
const capability = {
  accountId: 'account-1',
  state: 'available',
  capability: { maturity: 'preview' },
  refresh: vi.fn(),
};
const list = { data: [] as unknown[], isPending: false, error: null as Error | null, refetch };

vi.mock('@/lib/api/inbound-webhooks', () => ({
  createInboundEndpointOnce: (...args: unknown[]) => create(...args),
  setInboundEndpointEnabled: (...args: unknown[]) => setEnabled(...args),
  setInboundEndpointDeliveryPath: (...args: unknown[]) => setDeliveryPath(...args),
  rotateInboundEndpointSecret: (...args: unknown[]) => rotate(...args),
  deleteInboundEndpoint: (...args: unknown[]) => remove(...args),
  inboundWebhookKey: (account: string, slug: string) => [
    'account',
    account,
    'app',
    slug,
    'inbound-webhooks',
  ],
  useInboundEndpoints: () => list,
}));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));
vi.mock('@/components/dashboard/webhook-automation-binding', () => ({
  WebhookAutomationBinding: ({ endpointId }: { endpointId: string }) => (
    <div>Automation binding for {endpointId}</div>
  ),
}));
vi.mock('@/lib/api/capabilities', () => ({ useCapability: () => capability }));
vi.mock('@/components/dashboard/capability-notice', () => ({
  CapabilityNotice: ({ state }: { state: string }) => <span>Capability: {state}</span>,
}));
vi.mock('@/components/dashboard/primitives', () => ({
  Panel: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section aria-label={title}>{children}</section>
  ),
}));
vi.mock('@/components/ui/modal', () => ({
  Modal: ({
    open,
    title,
    children,
    footer,
    onClose,
  }: {
    open: boolean;
    title: string;
    children: React.ReactNode;
    footer: React.ReactNode;
    onClose: () => void;
  }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        <button onClick={onClose}>Close dialog</button>
        {children}
        {footer}
      </div>
    ) : null,
}));

const { InboundWebhooks } = await import('./inbound-webhooks');

function renderInbound(accountId = 'account-1', slug = 'app-a') {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <InboundWebhooks accountId={accountId} slug={slug} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  create.mockReset();
  setEnabled.mockReset().mockResolvedValue({});
  setDeliveryPath.mockReset().mockResolvedValue({});
  rotate.mockReset().mockResolvedValue({});
  remove.mockReset().mockResolvedValue(undefined);
  confirm.mockReset().mockResolvedValue(true);
  refetch.mockReset().mockResolvedValue({ data: [] });
  capability.accountId = 'account-1';
  capability.state = 'available';
  list.data = [];
  list.error = null;
});

async function fillForm() {
  await userEvent.type(screen.getByRole('textbox', { name: 'Endpoint name' }), 'stripe-primary');
  await userEvent.type(screen.getByLabelText('Stripe signing secret'), 'whsec_private');
  const path = screen.getByRole('textbox', { name: 'Delivery path' });
  await userEvent.clear(path);
  await userEvent.type(path, '/stripe');
}

it('gates creation on the current account capability and keeps existing metadata readable', async () => {
  capability.state = 'plan-not-entitled';
  list.data = [
    { id: 'e1', name: 'existing', provider: 'stripe', enabled: true, delivery_path: '/' },
  ];
  renderInbound();
  expect(screen.getByText('Capability: plan-not-entitled')).toBeInTheDocument();
  expect(screen.getByText('existing')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Create Stripe endpoint' })).toBeDisabled();
  expect(create).not.toHaveBeenCalled();
});

it('shows the created URL only in an acknowledged disclosure and leaves manual copy after clipboard failure', async () => {
  create.mockResolvedValue({
    id: 'e1',
    name: 'stripe-primary',
    endpoint_url: 'https://api.example.test/v1/hooks/secret-token',
  });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockRejectedValue(new Error('clipboard denied')) },
  });
  renderInbound();
  await fillForm();
  await userEvent.click(screen.getByRole('button', { name: 'Create Stripe endpoint' }));
  const dialog = await screen.findByRole('dialog', { name: 'Copy Stripe endpoint URL' });
  expect(screen.getByRole('textbox', { name: 'One-time endpoint URL' })).toHaveValue(
    'https://api.example.test/v1/hooks/secret-token'
  );
  await userEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
  expect(dialog).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Copy URL' }));
  expect(dialog).toHaveTextContent('Select and copy the URL manually');
  await userEvent.click(screen.getByRole('checkbox', { name: 'I saved this URL in Stripe' }));
  await userEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(screen.queryByRole('textbox', { name: 'One-time endpoint URL' })).not.toBeInTheDocument();
  expect(create).toHaveBeenCalledTimes(1);
});

it('does not repeat an ambiguous create and requires inspection of same-name metadata', async () => {
  create.mockRejectedValue(new TypeError('NetworkError'));
  list.data = [
    {
      id: 'other',
      name: 'stripe-primary',
      provider: 'stripe',
      enabled: true,
      delivery_path: '/stripe',
    },
  ];
  renderInbound();
  await fillForm();
  await userEvent.click(screen.getByRole('button', { name: 'Create Stripe endpoint' }));
  expect(await screen.findByText(/outcome is unknown/i)).toBeInTheDocument();
  expect(refetch).toHaveBeenCalled();
  expect(screen.getByRole('combobox', { name: 'Inaccessible endpoint' })).toHaveTextContent(
    'other'
  );
  await userEvent.click(screen.getByRole('button', { name: 'Create Stripe endpoint' }));
  expect(create).toHaveBeenCalledTimes(1);
});

it('never discloses a delayed response after switching app or account', async () => {
  let finish!: (value: unknown) => void;
  create.mockReturnValue(new Promise((resolve) => (finish = resolve)));
  const view = renderInbound();
  await fillForm();
  await userEvent.click(screen.getByRole('button', { name: 'Create Stripe endpoint' }));
  view.rerender(
    <QueryClientProvider client={new QueryClient()}>
      <InboundWebhooks accountId="account-2" slug="app-b" />
    </QueryClientProvider>
  );
  finish({ id: 'e1', endpoint_url: 'https://api.example.test/v1/hooks/secret-token' });
  await waitFor(() => expect(refetch).not.toHaveBeenCalled());
  expect(screen.queryByText(/secret-token/)).not.toBeInTheDocument();
});

it('replaces only an explicitly selected inaccessible endpoint after review', async () => {
  create.mockRejectedValue(new TypeError('NetworkError'));
  list.data = [
    {
      id: 'e1',
      name: 'stripe-primary',
      provider: 'stripe',
      enabled: true,
      delivery_path: '/stripe',
    },
  ];
  renderInbound();
  await fillForm();
  await userEvent.click(screen.getByRole('button', { name: 'Create Stripe endpoint' }));
  await screen.findByText(/outcome is unknown/i);
  refetch.mockResolvedValue({ data: list.data });
  expect(remove).not.toHaveBeenCalled();
  await userEvent.selectOptions(
    screen.getByRole('combobox', { name: 'Inaccessible endpoint' }),
    'e1'
  );
  await userEvent.click(screen.getByRole('button', { name: 'Review replacement' }));
  expect(confirm).toHaveBeenCalledWith(
    expect.objectContaining({ description: expect.stringContaining('e1') })
  );
  expect(remove).toHaveBeenCalledWith('app-a', 'e1');
  expect(create).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('textbox', { name: 'Endpoint name' })).toHaveValue('stripe-primary');
  expect(screen.getByLabelText('Stripe signing secret')).toHaveValue('');
});

it('does not submit a reviewed endpoint action after the app changes during confirmation', async () => {
  let finish!: (value: boolean) => void;
  confirm.mockReturnValue(new Promise((resolve) => (finish = resolve)));
  list.data = [
    {
      id: 'e1',
      name: 'stripe-primary',
      provider: 'stripe',
      enabled: true,
      delivery_path: '/stripe',
    },
  ];
  const view = renderInbound();
  await userEvent.click(screen.getByRole('button', { name: 'Disable stripe-primary' }));
  view.rerender(
    <QueryClientProvider client={new QueryClient()}>
      <InboundWebhooks accountId="account-2" slug="app-b" />
    </QueryClientProvider>
  );
  finish(true);
  await waitFor(() => expect(setEnabled).not.toHaveBeenCalled());
});

it('rotates a Stripe secret without promising or displaying the endpoint URL', async () => {
  list.data = [
    {
      id: 'e1',
      name: 'stripe-primary',
      provider: 'stripe',
      enabled: true,
      delivery_path: '/stripe',
    },
  ];
  renderInbound();
  await userEvent.click(screen.getByRole('button', { name: 'Manage stripe-primary' }));
  await userEvent.type(screen.getByLabelText('New Stripe signing secret'), 'whsec_new');
  await userEvent.click(screen.getByRole('button', { name: 'Rotate signing secret' }));
  expect(rotate).toHaveBeenCalledWith('app-a', 'e1', 'whsec_new');
  expect(screen.queryByRole('textbox', { name: 'One-time endpoint URL' })).not.toBeInTheDocument();
  expect(screen.getByText(/does not recover the endpoint URL/i)).toBeInTheDocument();
});

it('opens the selected endpoint automation binding without mixing app identities', async () => {
  list.data = [
    {
      id: 'e1',
      name: 'stripe-primary',
      provider: 'stripe',
      enabled: true,
      delivery_path: '/stripe',
    },
  ];
  renderInbound();
  await userEvent.click(screen.getByRole('button', { name: 'Manage stripe-primary' }));
  expect(screen.getByText('Automation binding for e1')).toBeInTheDocument();
});

it('reviews a changed delivery path and a normal endpoint deletion separately', async () => {
  list.data = [
    {
      id: 'e1',
      name: 'stripe-primary',
      provider: 'stripe',
      enabled: true,
      delivery_path: '/stripe',
    },
  ];
  renderInbound();
  await userEvent.click(screen.getByRole('button', { name: 'Manage stripe-primary' }));
  const path = screen.getByRole('textbox', { name: 'App delivery path' });
  await userEvent.clear(path);
  await userEvent.type(path, '/new');
  await userEvent.click(screen.getByRole('button', { name: 'Review path change' }));
  expect(setDeliveryPath).toHaveBeenCalledWith('app-a', 'e1', '/new');
  await userEvent.click(screen.getByRole('button', { name: 'Delete endpoint' }));
  expect(confirm).toHaveBeenCalledWith(
    expect.objectContaining({ description: expect.stringMatching(/accepted queued work/i) })
  );
  expect(remove).toHaveBeenCalledWith('app-a', 'e1');
  expect(create).not.toHaveBeenCalled();
});
