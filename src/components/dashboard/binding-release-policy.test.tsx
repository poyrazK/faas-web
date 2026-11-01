import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { problem, renderWithProviders, routeApi, type Answer } from '@/test/monetization';

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { id: 'acct-1', plan: 'pro' } }) }));
const capabilityStates: Record<string, string> = {};
vi.mock('@/lib/api/capabilities', () => ({
  useCapability: (key: string) => ({
    accountId: 'acct-1',
    state: capabilityStates[key] ?? 'available',
    capability: undefined,
    refresh: vi.fn(),
  }),
}));

const { BindingReleasePolicy } = await import('./binding-release-policy');

const BASE = '/v1/apps/{slug}/bindings/release-policy';
const QUEUES = '/v1/apps/{slug}/bindings/release-policy-with-queues';
const STORAGE = '/v1/apps/{slug}/bindings/release-policy-with-object-storage';

type Policy = Record<string, unknown>;
let policies: Record<string, Policy>;
let putAnswer: (() => Answer) | undefined;
let spies: ReturnType<typeof routeApi>;

const policy = (over: Policy = {}): Policy => ({
  app_id: '00000000-0000-4000-8000-000000000001',
  scope: 'default',
  mode: 'off',
  revision: 0,
  max_verification_age: '10m0s',
  require_application_ack: false,
  ...over,
});

function save(scope: string, body: Policy): Answer {
  if (putAnswer) return putAnswer();
  const prev = policies[scope] ?? policy({ scope });
  const next: Policy = {
    ...prev,
    ...body,
    revision: (prev.revision as number) + 1,
    updated_at: '2026-10-31T10:00:00Z',
  };
  delete next.expected_revision;
  policies[scope] = next;
  return next;
}

beforeEach(() => {
  for (const key of Object.keys(capabilityStates)) delete capabilityStates[key];
  policies = { default: policy() };
  putAnswer = undefined;
  const scopeOf = (init: { params?: { query?: Record<string, unknown> } }) =>
    String(init.params?.query?.scope ?? 'default');
  spies = routeApi({
    [`GET ${BASE}`]: (init) => policies[scopeOf(init)] ?? policy({ scope: scopeOf(init) }),
    [`PUT ${BASE}`]: (init) => save(scopeOf(init), init.body as Policy),
    [`PUT ${QUEUES}`]: (init) => save(scopeOf(init), init.body as Policy),
    [`PUT ${STORAGE}`]: (init) => save(scopeOf(init), init.body as Policy),
  });
});

afterEach(() => vi.restoreAllMocks());

const putCall = (method: 'PUT' = 'PUT') => {
  const calls = spies[method].mock.calls;
  return calls[calls.length - 1] as [string, { body: Policy; params: unknown }];
};

it('reads the default scope and says what enforcement does to promotion', async () => {
  policies.default = policy({
    mode: 'enforce',
    revision: 4,
    queue_requirements: { orders: 'handler_completion' },
    object_storage_requirements: { MEDIA: 'read' },
    reason: 'Ship safely',
    updated_at: '2026-10-30T09:00:00Z',
  });
  renderWithProviders(<BindingReleasePolicy slug="api" />);
  expect(await screen.findByText(/^enforced$/i)).toBeInTheDocument();
  expect(screen.getByText(/revision 4/i)).toBeInTheDocument();
  expect(screen.getByText('10m0s')).toBeInTheDocument();
  expect(screen.getByText(/orders/)).toBeInTheDocument();
  expect(screen.getByText(/handler completion/i)).toBeInTheDocument();
  expect(screen.getByText(/MEDIA/)).toBeInTheDocument();
  // The fence it puts on traffic (binding_release_traffic.go:20).
  expect(screen.getAllByText(/promot/i).length).toBeGreaterThan(0);
  expect(screen.getByText(/does not change serving traffic/i)).toBeInTheDocument();
});

it('reads another deployment scope on request', async () => {
  policies.production = policy({ scope: 'production', mode: 'enforce', revision: 2 });
  const user = userEvent.setup();
  renderWithProviders(<BindingReleasePolicy slug="api" />);
  await screen.findByText(/^off$/i);
  const scope = screen.getByRole('textbox', { name: /deployment scope/i });
  await user.clear(scope);
  await user.type(scope, 'production{Enter}');
  expect(await screen.findByText(/revision 2/i)).toBeInTheDocument();
  expect(spies.GET).toHaveBeenCalledWith(
    BASE,
    expect.objectContaining({ params: { path: { slug: 'api' }, query: { scope: 'production' } } })
  );
});

it('confirms before enforcing, then writes the base route with the read revision', async () => {
  const user = userEvent.setup();
  renderWithProviders(<BindingReleasePolicy slug="api" />);
  await user.click(await screen.findByRole('button', { name: /edit policy/i }));
  await user.click(screen.getByRole('radio', { name: /enforce/i }));
  await user.click(screen.getByRole('button', { name: /save policy/i }));

  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(/refused until/i)).toBeInTheDocument();
  expect(spies.PUT).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole('button', { name: /enforce/i }));

  await waitFor(() => expect(spies.PUT).toHaveBeenCalled());
  const [path, init] = putCall();
  expect(path).toBe(BASE);
  expect(init.body).toEqual({
    mode: 'enforce',
    expected_revision: 0,
    max_verification_age: '10m0s',
    require_application_ack: false,
  });
  expect(await screen.findByText(/^revision 1$/i)).toBeInTheDocument();
});

it('needs a reason to turn enforcement off, and says traffic loses its fence', async () => {
  policies.default = policy({ mode: 'enforce', revision: 1 });
  const user = userEvent.setup();
  renderWithProviders(<BindingReleasePolicy slug="api" />);
  await user.click(await screen.findByRole('button', { name: /edit policy/i }));
  await user.click(screen.getByRole('radio', { name: /off/i }));
  await user.click(screen.getByRole('button', { name: /save policy/i }));
  expect(await screen.findByText(/reason is required/i)).toBeInTheDocument();
  const reason = screen.getByRole('textbox', { name: /reason/i });
  expect(reason).toHaveAttribute('aria-invalid', 'true');
  expect(reason).toHaveAccessibleDescription(/reason is required/i);
  expect(screen.getByRole('textbox', { name: /maximum evidence age/i })).not.toHaveAttribute(
    'aria-invalid'
  );
  expect(spies.PUT).not.toHaveBeenCalled();

  await user.type(screen.getByRole('textbox', { name: /reason/i }), 'Incident recovery');
  await user.click(screen.getByRole('button', { name: /save policy/i }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(/without binding evidence/i)).toBeInTheDocument();
  await user.click(within(dialog).getByRole('button', { name: /turn off/i }));
  await waitFor(() => expect(spies.PUT).toHaveBeenCalled());
  expect(putCall()[1].body).toMatchObject({ mode: 'off', reason: 'Incident recovery' });
});

it('rejects an evidence age outside 1s–24h before writing', async () => {
  const user = userEvent.setup();
  renderWithProviders(<BindingReleasePolicy slug="api" />);
  await user.click(await screen.findByRole('button', { name: /edit policy/i }));
  const age = screen.getByRole('textbox', { name: /maximum evidence age/i });
  await user.clear(age);
  await user.type(age, '25h');
  await user.click(screen.getByRole('button', { name: /save policy/i }));
  expect(await screen.findByText(/whole seconds from 1s to 24h/i)).toBeInTheDocument();
  expect(age).toHaveAttribute('aria-invalid', 'true');
  expect(age).toHaveAccessibleDescription(/whole seconds from 1s to 24h/i);
  expect(spies.PUT).not.toHaveBeenCalled();
});

it('adds a queue requirement through the queues route', async () => {
  policies.default = policy({ mode: 'enforce', revision: 1 });
  const user = userEvent.setup();
  renderWithProviders(<BindingReleasePolicy slug="api" />);
  await user.click(await screen.findByRole('button', { name: /edit policy/i }));
  await user.click(screen.getByRole('button', { name: /add queue requirement/i }));
  await user.type(screen.getByRole('textbox', { name: /queue binding 1/i }), 'orders');
  await user.selectOptions(screen.getByRole('combobox', { name: /queue evidence 1/i }), [
    'handler_completion',
  ]);
  await user.click(screen.getByRole('button', { name: /save policy/i }));
  await waitFor(() => expect(spies.PUT).toHaveBeenCalled());
  const [path, init] = putCall();
  expect(path).toBe(QUEUES);
  expect(init.body.queue_requirements).toEqual({ orders: 'handler_completion' });
});

it('rejects an invalid queue binding name', async () => {
  policies.default = policy({ mode: 'enforce', revision: 1 });
  const user = userEvent.setup();
  renderWithProviders(<BindingReleasePolicy slug="api" />);
  await user.click(await screen.findByRole('button', { name: /edit policy/i }));
  await user.click(screen.getByRole('button', { name: /add queue requirement/i }));
  await user.type(screen.getByRole('textbox', { name: /queue binding 1/i }), 'Orders!');
  await user.click(screen.getByRole('button', { name: /save policy/i }));
  expect(await screen.findByText(/lowercase letters/i)).toBeInTheDocument();
  const name = screen.getByRole('textbox', { name: /queue binding 1/i });
  expect(name).toHaveAttribute('aria-invalid', 'true');
  expect(name).toHaveAccessibleDescription(/lowercase letters/i);
  expect(spies.PUT).not.toHaveBeenCalled();
});

it('retains stored queue requirements it cannot edit when queue bindings are off', async () => {
  capabilityStates['queue-bindings'] = 'plan-not-entitled';
  policies.default = policy({
    mode: 'enforce',
    revision: 2,
    queue_requirements: { orders: 'consumer_readiness' },
  });
  const user = userEvent.setup();
  renderWithProviders(<BindingReleasePolicy slug="api" />);
  await user.click(await screen.findByRole('button', { name: /edit policy/i }));
  expect(screen.queryByRole('button', { name: /add queue requirement/i })).not.toBeInTheDocument();
  expect(screen.getByText(/kept as they are/i)).toBeInTheDocument();
  await user.click(screen.getByRole('checkbox', { name: /application acknowledgements/i }));
  await user.click(screen.getByRole('button', { name: /save policy/i }));
  await waitFor(() => expect(spies.PUT).toHaveBeenCalled());
  const [path, init] = putCall();
  expect(path).toBe(QUEUES);
  expect(init.body.queue_requirements).toEqual({ orders: 'consumer_readiness' });
  expect(init.body.require_application_ack).toBe(true);
});

it('clears a storage requirement explicitly on the storage route', async () => {
  policies.default = policy({
    mode: 'enforce',
    revision: 2,
    object_storage_requirements: { MEDIA: 'read' },
  });
  const user = userEvent.setup();
  renderWithProviders(<BindingReleasePolicy slug="api" />);
  await user.click(await screen.findByRole('button', { name: /edit policy/i }));
  await user.click(screen.getByRole('button', { name: /remove storage requirement 1/i }));
  await user.click(screen.getByRole('button', { name: /save policy/i }));
  await waitFor(() => expect(spies.PUT).toHaveBeenCalled());
  const [path, init] = putCall();
  expect(path).toBe(STORAGE);
  expect(init.body.object_storage_requirements).toEqual({});
});

it('explains a revision conflict by its code and rereads the policy', async () => {
  policies.default = policy({ mode: 'enforce', revision: 1 });
  putAnswer = () => {
    policies.default = policy({ mode: 'enforce', revision: 5 });
    return problem(409, 'bindings_release_policy_changed', 'Read the current policy revision.');
  };
  const user = userEvent.setup();
  renderWithProviders(<BindingReleasePolicy slug="api" />);
  await user.click(await screen.findByRole('button', { name: /edit policy/i }));
  await user.click(screen.getByRole('checkbox', { name: /application acknowledgements/i }));
  await user.click(screen.getByRole('button', { name: /save policy/i }));
  expect(await screen.findByText(/changed since you opened it/i)).toBeInTheDocument();
  expect(await screen.findByText(/revision 5/i)).toBeInTheDocument();
});

it('shows a failed read with a retry, not an off policy', async () => {
  spies.GET.mockImplementation(async () => ({
    // 403 rather than a retryable 503, so retryPolicy settles at once.
    error: { status: 403, code: 'insufficient_scope', title: 'x', detail: 'Policy read denied' },
    response: new Response(null, { status: 403 }),
  }));
  renderWithProviders(<BindingReleasePolicy slug="api" />);
  expect(await screen.findByText(/policy read denied/i)).toBeInTheDocument();
  expect(screen.queryByText(/^off$/i)).not.toBeInTheDocument();
});
