import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  capability,
  problem,
  renderWithProviders,
  routeApi,
  type Handlers,
} from '@/test/monetization';

vi.mock('@/lib/api/capabilities', async () => {
  const { capability } = await import('@/test/monetization');
  return { useCapability: () => capability, useCapabilityAccess: () => capability };
});

const { Customers } = await import('./customers');

const acme = {
  id: 't-acme',
  external_ref: 'crm-1001',
  name: 'Acme Corporation',
  status: 'active',
  created_at: '2026-05-01T00:00:00Z',
  updated_at: '2026-05-01T00:00:00Z',
};
const initrode = {
  ...acme,
  id: 't-ini',
  external_ref: 'crm-1004',
  name: 'Initrode',
  status: 'suspended',
};
const detail = {
  ...acme,
  consumers: [
    {
      id: 'c-acme',
      app_id: 'app-1',
      external_ref: 'crm-1001',
      name: 'Acme',
      status: 'active',
      created_at: '2026-05-01T00:00:00Z',
      updated_at: '2026-05-01T00:00:00Z',
    },
  ],
  surfaces: [{ id: 's-1', app_id: 'app-1', name: 'customer-domains', status: 'active' }],
};
const draft = {
  id: 'ts-1',
  tenant_id: 't-acme',
  period_start: '2026-09-01T00:00:00Z',
  period_end: '2026-10-01T00:00:00Z',
  revision: 1,
  status: 'draft',
  currency: 'EUR',
  billable_units: 1000,
  unpriced_units: 0,
  amount_millicents: 900_000,
  lines: [],
  as_of: '2026-10-01T00:05:00Z',
  created_at: '2026-10-02T00:00:00Z',
};

function handlers(extra: Handlers = {}): Handlers {
  return {
    'GET /v1/account/platform-tenants': () => ({ tenants: [acme, initrode] }),
    'GET /v1/account/platform-tenants/{id}': () => detail,
    'GET /v1/apps': () => [{ id: 'app-1', slug: 'api-gateway' }],
    ...extra,
  };
}

beforeEach(() => {
  capability.state = 'available';
});
afterEach(() => vi.restoreAllMocks());

async function openAcme() {
  await userEvent.click(await screen.findByText('Acme Corporation'));
  return screen.findByRole('heading', { name: 'Acme Corporation' });
}
const section = (name: string) =>
  userEvent.click(
    within(screen.getByRole('group', { name: 'Customer sections' })).getByRole('button', { name })
  );

describe('Customers', () => {
  it('lists customers with their status', async () => {
    routeApi(handlers());
    renderWithProviders(<Customers />);
    const row = (await screen.findByText('Initrode')).closest('tr')!;
    expect(within(row).getByText('suspended')).toBeInTheDocument();
    expect(within(row).getByText('crm-1004')).toBeInTheDocument();
  });

  it('shows the capability notice and reads nothing when monetization is unavailable', () => {
    capability.state = 'registry-error';
    const spies = routeApi(handlers());
    renderWithProviders(<Customers />);
    expect(screen.getByText('Availability could not be checked')).toBeInTheDocument();
    expect(spies.GET).not.toHaveBeenCalled();
  });

  it('says when registration found an existing customer, and explains a reference clash', async () => {
    let attempt = 0;
    routeApi(
      handlers({
        'POST /v1/account/platform-tenants': () =>
          attempt++ === 0 ? problem(409, 'conflict') : acme,
      }),
      { 'POST /v1/account/platform-tenants': 200 }
    );
    renderWithProviders(<Customers />);
    await userEvent.click(screen.getByRole('button', { name: 'Register customer' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('External reference'), 'crm-1001');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Acme Corporation');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Register customer' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/another name/);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Register customer' }));
    expect(await screen.findByText('Acme Corporation was already registered')).toBeInTheDocument();
  });

  it('shows linked consumers and surfaces by app', async () => {
    routeApi(handlers());
    renderWithProviders(<Customers />);
    await openAcme();
    expect(await screen.findByText('customer-domains')).toBeInTheDocument();
    expect(screen.getByText('Acme')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText('app api-gateway')).toHaveLength(2));
  });

  it('suspends only after a confirmation naming credentials and hostnames', async () => {
    const spies = routeApi(
      handlers({
        'PATCH /v1/account/platform-tenants/{id}': () => ({ ...acme, status: 'suspended' }),
      })
    );
    renderWithProviders(<Customers />);
    await openAcme();
    await userEvent.click(screen.getByRole('button', { name: 'Suspend customer' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/credentials of every linked consumer/);
    expect(dialog).toHaveTextContent(/hostnames of every linked tenant surface/);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Suspend customer' }));
    await waitFor(() =>
      expect(spies.PATCH).toHaveBeenCalledWith('/v1/account/platform-tenants/{id}', {
        params: { path: { id: 't-acme' } },
        body: { status: 'suspended' },
      })
    );
  });

  it('publishes a tenant price in millicents after confirming it is immutable', async () => {
    const spies = routeApi(
      handlers({
        'GET /v1/account/platform-tenants/{id}/rate-cards': () => ({ rate_cards: [] }),
        'POST /v1/account/platform-tenants/{id}/rate-cards': () => ({
          id: 'rc-1',
          tenant_id: 't-acme',
          currency: 'EUR',
          unit: 'request',
          price_millicents_per_unit: 1200,
          included_units_per_month: 0,
          effective_from: '2026-10-16T12:01:00Z',
          created_at: '2026-10-16T12:00:00Z',
        }),
      })
    );
    renderWithProviders(<Customers />);
    await openAcme();
    await section('Rate cards');
    expect(await screen.findByText(/each app’s own rate cards apply/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Price per request (EUR)'), '0.012');
    await userEvent.click(screen.getByRole('button', { name: 'Publish rate card' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/immutable/);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Publish rate card' }));
    await waitFor(() => expect(spies.POST).toHaveBeenCalled());
    const [, init] = spies.POST.mock.calls[0] as [string, { body: unknown }];
    expect(init.body).toEqual({
      currency: 'EUR',
      price_millicents_per_unit: 1200,
      included_units_per_month: 0,
    });
  });

  it('finalizes a cross-app statement only after confirmation', async () => {
    const spies = routeApi(
      handlers({
        'GET /v1/account/platform-tenants/{id}/usage-statements': () => ({ statements: [draft] }),
        'POST /v1/account/platform-tenants/{id}/usage-statements/{statement_id}/finalize': () => ({
          ...draft,
          status: 'finalized',
        }),
      })
    );
    renderWithProviders(<Customers />);
    await openAcme();
    await section('Statements');
    await userEvent.click(await screen.findByRole('button', { name: 'Finalize revision 1' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/immutable/);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Finalize statement' }));
    await waitFor(() =>
      expect(spies.POST).toHaveBeenCalledWith(
        '/v1/account/platform-tenants/{id}/usage-statements/{statement_id}/finalize',
        expect.objectContaining({
          params: expect.objectContaining({ path: { id: 't-acme', statement_id: 'ts-1' } }),
        })
      )
    );
  });
});
