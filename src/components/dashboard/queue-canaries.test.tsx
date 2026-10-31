import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { problem, renderWithProviders, routeApi, type Answer } from '@/test/monetization';

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { id: 'acct-1', plan: 'pro' } }) }));
let capabilityState = 'available';
vi.mock('@/lib/api/capabilities', () => ({
  useCapability: () => ({
    accountId: 'acct-1',
    state: capabilityState,
    capability: undefined,
    refresh: vi.fn(),
  }),
}));

const { QueueCanaries } = await import('./queue-canaries');

const INVENTORY = '/v1/apps/{slug}/bindings';
const CREATE = '/v1/apps/{slug}/bindings/queue-canaries';
const CANARY = '/v1/apps/{slug}/bindings/queue-canaries/{canary}';
const DEP = '22222222-2222-4222-8222-222222222222';
const OLD = '66666666-6666-4666-8666-666666666666';
const NEW = '77777777-7777-4777-8777-777777777777';

type Item = Record<string, unknown>;
let items: Item[];
let canaries: Record<string, Item>;
let createAnswer: (() => Answer) | undefined;
let spies: ReturnType<typeof routeApi>;

const queueItem = (over: Item = {}): Item => ({
  type: 'queue',
  name: 'orders',
  binding: 'orders',
  scope: 'default',
  access: 'push',
  state: 'enabled',
  runtime_status: 'healthy',
  verification_status: 'unknown',
  queue_canary_supported: true,
  ...over,
});

beforeEach(() => {
  capabilityState = 'available';
  createAnswer = undefined;
  canaries = {
    [OLD]: {
      id: OLD,
      binding: 'orders',
      deployment_id: DEP,
      scope: 'default',
      status: 'succeeded',
      published_at: '2026-10-31T08:00:00Z',
      expires_at: '2026-10-31T08:10:00Z',
      delivered_at: '2026-10-31T08:00:02Z',
      completed_at: '2026-10-31T08:00:03Z',
    },
  };
  items = [
    queueItem({ queue_canary: canaries[OLD] }),
    queueItem({
      name: 'emails',
      binding: 'emails',
      access: 'pull',
      queue_canary_supported: false,
      queue_canary_reason: 'queue_handler_unsupported',
    }),
  ];
  spies = routeApi(
    {
      [`GET ${INVENTORY}`]: () => ({
        app: 'api',
        generated_at: '2026-10-31T09:00:00Z',
        complete: true,
        verification_deployment_id: DEP,
        verification_scope: 'default',
        bindings: items,
      }),
      [`POST ${CREATE}`]: (init) => {
        if (createAnswer) return createAnswer();
        const body = init.body as Item;
        canaries[NEW] = {
          id: NEW,
          binding: body.binding,
          deployment_id: body.deployment_id,
          scope: 'default',
          status: 'published',
          published_at: '2026-10-31T09:01:00Z',
          expires_at: '2026-10-31T09:11:00Z',
        };
        return canaries[NEW];
      },
      [`GET ${CANARY}`]: (init) => canaries[String(init.params?.path?.canary)],
      [`DELETE ${CANARY}`]: (init) => {
        const id = String(init.params?.path?.canary);
        canaries[id] = { ...canaries[id], status: 'cancelled', reason: 'cancelled' };
        return canaries[id];
      },
    },
    { [`POST ${CREATE}`]: 201 }
  );
});

afterEach(() => vi.restoreAllMocks());

const row = async (name: string) =>
  within(await screen.findByRole('list', { name: /queue bindings/i }))
    .getAllByRole('listitem')
    .find((item) => within(item).queryByText(name)) as HTMLElement;

it('says queue canaries are unavailable and offers nothing when the capability is off', async () => {
  capabilityState = 'plan-not-entitled';
  renderWithProviders(<QueueCanaries slug="api" />);
  expect(await screen.findByText(/not included in your plan/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /publish/i })).not.toBeInTheDocument();
  expect(spies.GET).not.toHaveBeenCalled();
});

it('lists push queue bindings with their latest canary and why one cannot publish', async () => {
  renderWithProviders(<QueueCanaries slug="api" />);
  const orders = await row('orders');
  expect(within(orders).getByText('Succeeded')).toBeInTheDocument();
  expect(within(orders).getByText(/handler completed/i)).toBeInTheDocument();
  const emails = await row('emails');
  expect(within(emails).getByText(/queue_handler_unsupported/)).toBeInTheDocument();
  expect(within(emails).queryByRole('button', { name: /publish/i })).not.toBeInTheDocument();
});

it('publishes only after a confirmation naming the binding, with consent', async () => {
  const user = userEvent.setup();
  renderWithProviders(<QueueCanaries slug="api" />);
  await user.click(within(await row('orders')).getByRole('button', { name: /publish canary/i }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(/one canary message to orders/i)).toBeInTheDocument();
  expect(spies.POST).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole('button', { name: /publish/i }));

  await waitFor(() => expect(spies.POST).toHaveBeenCalled());
  const [path, init] = spies.POST.mock.calls[0] as [string, { body: Item }];
  expect(path).toBe(CREATE);
  expect(init.body).toEqual({
    deployment_id: DEP,
    binding: 'orders',
    ttl_seconds: 600,
    publish_consent: true,
  });
  expect(await within(await row('orders')).findByText('Published')).toBeInTheDocument();
  expect(screen.getByText(/not a pass/i)).toBeInTheDocument();
});

it('explains a refused publication by its code', async () => {
  createAnswer = () => problem(400, 'validation_failed', 'Supply an exact deployment.');
  const user = userEvent.setup();
  renderWithProviders(<QueueCanaries slug="api" />);
  await user.click(within(await row('orders')).getByRole('button', { name: /publish canary/i }));
  await user.click(
    within(await screen.findByRole('dialog')).getByRole('button', { name: /publish/i })
  );
  expect(await screen.findByText(/GREGALE_QUEUE_CANARY_BINDINGS/)).toBeInTheDocument();
});

it('explains a conflicting canary by its code', async () => {
  createAnswer = () => problem(409, 'queue_canary_changed', 'Another canary is active.');
  const user = userEvent.setup();
  renderWithProviders(<QueueCanaries slug="api" />);
  await user.click(within(await row('orders')).getByRole('button', { name: /publish canary/i }));
  await user.click(
    within(await screen.findByRole('dialog')).getByRole('button', { name: /publish/i })
  );
  expect(await screen.findByText(/another canary is still active/i)).toBeInTheDocument();
});

it('cancels an in-flight canary after a destructive confirmation', async () => {
  canaries[OLD] = { ...canaries[OLD], status: 'dispatching' };
  items[0] = queueItem({ queue_canary: canaries[OLD] });
  const user = userEvent.setup();
  renderWithProviders(<QueueCanaries slug="api" />);
  const orders = await row('orders');
  expect(within(orders).queryByRole('button', { name: /publish canary/i })).not.toBeInTheDocument();
  await user.click(within(orders).getByRole('button', { name: /cancel canary/i }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(/revokes its evidence/i)).toBeInTheDocument();
  expect(spies.DELETE).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole('button', { name: /cancel canary/i }));
  await waitFor(() => expect(spies.DELETE).toHaveBeenCalledWith(CANARY, expect.anything()));
  expect(await within(await row('orders')).findByText('Cancelled')).toBeInTheDocument();
});

it('says so when the deployment has no queue bindings', async () => {
  items = [];
  renderWithProviders(<QueueCanaries slug="api" />);
  expect(await screen.findByText(/no queue bindings/i)).toBeInTheDocument();
});
