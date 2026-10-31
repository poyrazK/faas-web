import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { capability, problem, renderWithProviders, routeApi } from '@/test/monetization';

vi.mock('@/lib/api/capabilities', async () => {
  const { capability } = await import('@/test/monetization');
  return { useCapability: () => capability, useCapabilityAccess: () => capability };
});

const { ApiConsumerPlans } = await import('./api-consumer-plans');

const starter = {
  id: 'plan-starter',
  app_id: 'app-1',
  name: 'starter',
  max_requests_per_minute: 60,
  max_units_per_month: 20000,
  alert_thresholds_percent: [80, 100],
  created_at: '2026-04-01T00:00:00Z',
  updated_at: '2026-04-01T00:00:00Z',
};
const pro = {
  ...starter,
  id: 'plan-pro',
  name: 'pro',
  max_units_per_month: 0,
  alert_thresholds_percent: [],
};

beforeEach(() => {
  capability.state = 'available';
});
afterEach(() => vi.restoreAllMocks());

it('lists plan limits, showing zero as unlimited', async () => {
  routeApi({ 'GET /v1/apps/{slug}/consumer-plans': () => ({ plans: [starter, pro] }) });
  renderWithProviders(<ApiConsumerPlans slug="api" />);
  const proRow = (await screen.findByText('pro')).closest('tr')!;
  expect(within(proRow).getByText('Unlimited')).toBeInTheDocument();
  const starterRow = screen.getByText('starter').closest('tr')!;
  expect(within(starterRow).getByText('80%, 100%')).toBeInTheDocument();
});

it('shows the capability notice when monetization is unavailable', () => {
  capability.state = 'runtime-unavailable';
  const spies = routeApi({});
  renderWithProviders(<ApiConsumerPlans slug="api" />);
  expect(screen.getByText('Unavailable on this installation')).toBeInTheDocument();
  expect(spies.GET).not.toHaveBeenCalled();
});

it('creates a plan, refusing alerts without a monthly limit and reporting a name conflict', async () => {
  let attempts = 0;
  const spies = routeApi({
    'GET /v1/apps/{slug}/consumer-plans': () => ({ plans: [starter] }),
    'POST /v1/apps/{slug}/consumer-plans': (init) =>
      attempts++ === 0 ? problem(409, 'conflict') : { ...pro, ...(init.body as object) },
  });
  renderWithProviders(<ApiConsumerPlans slug="api" />);
  await userEvent.click(await screen.findByRole('button', { name: 'New plan' }));
  const dialog = await screen.findByRole('dialog');
  await userEvent.type(within(dialog).getByLabelText('Name'), 'team');
  await userEvent.type(within(dialog).getByLabelText('Usage alert thresholds (%)'), '50');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Create plan' }));
  expect(within(dialog).getByText(/set one first/)).toBeInTheDocument();
  expect(spies.POST).not.toHaveBeenCalled();

  const units = within(dialog).getByLabelText('Units per month');
  await userEvent.clear(units);
  await userEvent.type(units, '1000');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Create plan' }));
  expect(
    await within(dialog).findByText('A plan with this name already exists')
  ).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Create plan' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  const [, init] = spies.POST.mock.calls[1] as [string, { body: unknown }];
  expect(init.body).toEqual({
    name: 'team',
    max_requests_per_minute: 0,
    max_units_per_month: 1000,
    alert_thresholds_percent: [50],
  });
});

it('replaces a plan’s limits in place from a row click', async () => {
  const spies = routeApi({
    'GET /v1/apps/{slug}/consumer-plans': () => ({ plans: [starter] }),
    'PUT /v1/apps/{slug}/consumer-plans/{plan_id}': (init) => ({
      ...starter,
      ...(init.body as object),
    }),
  });
  renderWithProviders(<ApiConsumerPlans slug="api" />);
  await userEvent.click(await screen.findByText('starter'));
  const dialog = await screen.findByRole('dialog', { name: 'Edit starter' });
  const rpm = within(dialog).getByLabelText('Requests per minute');
  await userEvent.clear(rpm);
  await userEvent.type(rpm, '120');
  await userEvent.clear(within(dialog).getByLabelText('Usage alert thresholds (%)'));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save limits' }));
  await waitFor(() =>
    expect(spies.PUT).toHaveBeenCalledWith('/v1/apps/{slug}/consumer-plans/{plan_id}', {
      params: { path: { slug: 'api', plan_id: 'plan-starter' } },
      body: {
        max_requests_per_minute: 120,
        max_units_per_month: 20000,
        alert_thresholds_percent: [],
      },
    })
  );
});
