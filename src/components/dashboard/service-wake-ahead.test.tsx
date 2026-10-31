import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { problem, renderWithProviders, routeApi, type Answer } from '@/test/monetization';

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { id: 'acct-1', plan: 'pro' } }) }));

const { ServiceWakeAhead } = await import('./service-wake-ahead');

const PATH = '/v1/apps/{slug}/service-wake-ahead';
const LEARNED = {
  source: 'live',
  window: '24h',
  caller_wakes: 46,
  targets: [
    {
      app_id: '00000000-0000-4000-8000-000000000021',
      slug: 'auth',
      call_share: 0.82,
      cold_share: 0.64,
      qualifies: true,
      started: 31,
      used: 28,
      unused: 2,
      failed: 1,
    },
    {
      app_id: '00000000-0000-4000-8000-000000000022',
      slug: 'billing',
      call_share: 0.3,
      cold_share: 0.9,
      qualifies: false,
      started: 0,
      used: 0,
      unused: 0,
      failed: 0,
    },
  ],
};

let current: Record<string, unknown>;
let putAnswer: ((body: { enabled: boolean }) => Answer) | undefined;
let getAnswer: (() => Answer) | undefined;
let spies: ReturnType<typeof routeApi>;

beforeEach(() => {
  current = { slug: 'api', enabled: true, learned: LEARNED };
  putAnswer = undefined;
  getAnswer = undefined;
  spies = routeApi({
    [`GET ${PATH}`]: () => (getAnswer ? getAnswer() : current),
    [`PUT ${PATH}`]: (init) => {
      const body = init.body as { enabled: boolean };
      if (putAnswer) return putAnswer(body);
      // The PUT answer carries no learned block (handlers_service_wake_ahead.go).
      current = { ...current, enabled: body.enabled, updated_at: '2026-10-31T09:00:00Z' };
      return { slug: 'api', enabled: body.enabled, updated_at: '2026-10-31T09:00:00Z' };
    },
  });
});

afterEach(() => vi.restoreAllMocks());

const toggle = () => screen.findByRole('switch', { name: /wake services ahead/i });

it('says what wake-ahead does and what it costs in GB-hours', async () => {
  renderWithProviders(<ServiceWakeAhead slug="api" />);
  await toggle();
  expect(screen.getByText(/restores overlap/i)).toBeInTheDocument();
  expect(screen.getByText(/GB-hours/)).toBeInTheDocument();
});

it('shows a default-on app as on, and says it is the default', async () => {
  renderWithProviders(<ServiceWakeAhead slug="api" />);
  expect(await toggle()).toBeChecked();
  expect(screen.getByText(/default for a project service/i)).toBeInTheDocument();
});

it('shows a chosen setting as the customer’s choice, not the default', async () => {
  current = { slug: 'api', enabled: false, updated_at: '2026-10-30T12:00:00Z', learned: LEARNED };
  renderWithProviders(<ServiceWakeAhead slug="api" />);
  expect(await toggle()).not.toBeChecked();
  expect(screen.getByText(/turned off/i)).toBeInTheDocument();
  expect(screen.queryByText(/default/i)).not.toBeInTheDocument();
});

it('turns wake-ahead on with a PUT and keeps the measurements on screen', async () => {
  current = { slug: 'api', enabled: false, updated_at: '2026-10-30T12:00:00Z', learned: LEARNED };
  const user = userEvent.setup();
  renderWithProviders(<ServiceWakeAhead slug="api" />);
  await user.click(await toggle());

  await waitFor(() => expect(spies.PUT).toHaveBeenCalled());
  const [, init] = spies.PUT.mock.calls[0] as [string, Record<string, unknown>];
  expect(init).toMatchObject({ params: { path: { slug: 'api' } }, body: { enabled: true } });
  await waitFor(async () => expect(await toggle()).toBeChecked());
  expect(await screen.findByText(/within 30 seconds/i)).toBeInTheDocument();
  expect(screen.getByText('auth')).toBeInTheDocument();
});

it('keeps the old value and explains a capacity failure by its code', async () => {
  current = { slug: 'api', enabled: false, updated_at: '2026-10-30T12:00:00Z', learned: LEARNED };
  putAnswer = () => problem(503, 'capacity_unavailable', 'service wake-ahead');
  const user = userEvent.setup();
  renderWithProviders(<ServiceWakeAhead slug="api" />);
  await user.click(await toggle());

  expect(await screen.findByText(/briefly unavailable/i)).toBeInTheDocument();
  expect(await toggle()).not.toBeChecked();
});

it('does not claim the app is gone when the route answers not_found', async () => {
  // The platform kill switch answers the same 404 not_found as a missing app
  // (faas httpkit.NoSuchRoute), so the copy must not pick one.
  current = { slug: 'api', enabled: false, updated_at: '2026-10-30T12:00:00Z', learned: LEARNED };
  putAnswer = () => problem(404, 'not_found', 'not found');
  const user = userEvent.setup();
  renderWithProviders(<ServiceWakeAhead slug="api" />);
  await user.click(await toggle());

  expect(await screen.findByText(/wake-ahead is not available for this app/i)).toBeInTheDocument();
  expect(screen.queryByText(/no longer exists/i)).not.toBeInTheDocument();
  expect(await toggle()).not.toBeChecked();
});

it('lists measured services with their shares and 24h outcomes', async () => {
  renderWithProviders(<ServiceWakeAhead slug="api" />);
  const list = await screen.findByRole('list', { name: /measured services/i });
  const [auth, billing] = within(list).getAllByRole('listitem');
  expect(within(auth).getByText('auth')).toBeInTheDocument();
  expect(within(auth).getByText(/qualifies/i)).toBeInTheDocument();
  expect(auth).toHaveTextContent(/82%/);
  expect(auth).toHaveTextContent(/64%/);
  expect(auth).toHaveTextContent(/31 woken ahead/);
  expect(auth).toHaveTextContent(/28 used/);
  expect(auth).toHaveTextContent(/2 unused/);
  expect(auth).toHaveTextContent(/1 failed/);
  expect(within(billing).getByText(/below threshold/i)).toBeInTheDocument();
  expect(screen.getByText(/46 cold wakes/)).toBeInTheDocument();
});

it('says depends_on stands in until 20 wakes have been measured', async () => {
  current = {
    slug: 'api',
    enabled: true,
    learned: { source: 'live', window: '24h', caller_wakes: 3, targets: [] },
  };
  renderWithProviders(<ServiceWakeAhead slug="api" />);
  expect(await screen.findByText(/no services measured yet/i)).toBeInTheDocument();
  expect(screen.getByText(/3 cold wakes/)).toBeInTheDocument();
  expect(screen.getByText(/depends_on/)).toBeInTheDocument();
});

it('says when gateway measurements cannot be read', async () => {
  current = {
    slug: 'api',
    enabled: false,
    learned: { source: 'unavailable', window: '24h', caller_wakes: 0, targets: [] },
  };
  renderWithProviders(<ServiceWakeAhead slug="api" />);
  expect(await screen.findByText(/measurements are unavailable/i)).toBeInTheDocument();
  expect(screen.queryByText(/no services measured yet/i)).not.toBeInTheDocument();
});

it('shows a failed read as an error, not as an off switch', async () => {
  getAnswer = () => problem(404, 'not_found', 'no such app');
  renderWithProviders(<ServiceWakeAhead slug="api" />);
  expect(await screen.findByRole('alert')).toHaveTextContent(/no such app/);
  expect(screen.queryByRole('switch')).not.toBeInTheDocument();
});

it('locks the switch on a PR preview, which never wakes services ahead', async () => {
  current = { slug: 'pr-42-api', enabled: false, learned: LEARNED };
  renderWithProviders(<ServiceWakeAhead slug="pr-42-api" previewOf="api" />);
  expect(await toggle()).toBeDisabled();
  expect(screen.getByText(/previews never wake services ahead/i)).toBeInTheDocument();
  // A preview neither learns nor wakes ahead, so measurements would mislead.
  expect(screen.queryByRole('list', { name: /measured services/i })).not.toBeInTheDocument();
  expect(spies.PUT).not.toHaveBeenCalled();
});
