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
  return { useCapability: () => capability };
});

const { ApiConsumers } = await import('./api-consumers');

const acme = {
  id: 'c-acme',
  app_id: 'app-1',
  external_ref: 'crm-1001',
  name: 'Acme',
  status: 'active',
  created_at: '2026-05-01T10:00:00Z',
  updated_at: '2026-05-01T10:00:00Z',
  revoked_at: null,
};
const initech = {
  ...acme,
  id: 'c-initech',
  external_ref: 'crm-1003',
  name: 'Initech',
  status: 'revoked',
  revoked_at: '2026-09-01T10:00:00Z',
};
const pro = {
  id: 'plan-pro',
  app_id: 'app-1',
  name: 'pro',
  max_requests_per_minute: 600,
  max_units_per_month: 0,
  alert_thresholds_percent: [],
  created_at: '2026-04-01T00:00:00Z',
  updated_at: '2026-04-01T00:00:00Z',
};
const primary = {
  id: 'k-1',
  consumer_id: 'c-acme',
  name: 'primary',
  prefix: 'gcs_ab12',
  scopes: ['read'],
  created_at: '2026-05-01T10:00:00Z',
  expires_at: null,
  last_used_at: null,
  revoked_at: null,
};
const PLAINTEXT = 'gcs_ab12_plaintext_shown_once';

function handlers(extra: Handlers = {}): Handlers {
  return {
    'GET /v1/apps/{slug}/consumers': () => ({ consumers: [acme, initech] }),
    'GET /v1/apps/{slug}/consumer-plans': () => ({ plans: [pro] }),
    'GET /v1/apps/{slug}/consumers/{consumer_id}/plan-assignments': (init) => ({
      assignments:
        init.params?.path?.consumer_id === 'c-acme'
          ? [
              {
                id: 'a-1',
                consumer_id: 'c-acme',
                plan_id: 'plan-pro',
                effective_from: '2026-06-01T00:00:00Z',
                created_at: '2026-05-30T00:00:00Z',
              },
            ]
          : [],
    }),
    'GET /v1/apps/{slug}/consumers/{consumer_id}/keys': () => ({ keys: [primary] }),
    ...extra,
  };
}

beforeEach(() => {
  capability.state = 'available';
});
afterEach(() => vi.restoreAllMocks());

async function openAcme() {
  await userEvent.click(await screen.findByText('Acme'));
  return screen.findByRole('heading', { name: 'Acme' });
}

describe('ApiConsumers', () => {
  it('lists consumers with the plan each is on', async () => {
    routeApi(handlers());
    renderWithProviders(<ApiConsumers slug="api" />);
    const acmeRow = (await screen.findByText('Acme')).closest('tr')!;
    await waitFor(() => expect(within(acmeRow).getByText('pro')).toBeInTheDocument());
    const initechRow = screen.getByText('Initech').closest('tr')!;
    await waitFor(() => expect(within(initechRow).getByText('Default')).toBeInTheDocument());
    expect(within(initechRow).getByText('revoked')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Register consumer' })).toBeInTheDocument();
  });

  it('shows the capability notice and reads nothing when monetization is unavailable', async () => {
    capability.state = 'plan-not-entitled';
    const spies = routeApi(handlers());
    renderWithProviders(<ApiConsumers slug="api" />);
    expect(screen.getByText('Not included in your plan')).toBeInTheDocument();
    expect(spies.GET).not.toHaveBeenCalled();
  });

  it('registers a consumer and reports a duplicate reference as a conflict', async () => {
    let attempts = 0;
    const spies = routeApi(
      handlers({
        'POST /v1/apps/{slug}/consumers': (init) =>
          attempts++ === 0
            ? problem(409, 'conflict', 'external_ref taken')
            : { ...acme, id: 'c-new', ...(init.body as object) },
      })
    );
    renderWithProviders(<ApiConsumers slug="api" />);
    await userEvent.click(screen.getByRole('button', { name: 'Register consumer' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('External reference'), 'crm-2000');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Hooli');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Register consumer' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/already exists/);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Register consumer' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(spies.POST).toHaveBeenLastCalledWith('/v1/apps/{slug}/consumers', {
      params: { path: { slug: 'api' } },
      body: { external_ref: 'crm-2000', name: 'Hooli' },
    });
  });

  it('shows an issued key once and keeps the plaintext out of the query cache', async () => {
    routeApi(
      handlers({
        'POST /v1/apps/{slug}/consumers/{consumer_id}/keys': () => ({
          ...primary,
          id: 'k-2',
          name: 'ci',
          key: PLAINTEXT,
        }),
      })
    );
    const { client } = renderWithProviders(<ApiConsumers slug="api" />);
    await openAcme();
    await userEvent.click(await screen.findByRole('button', { name: 'Issue key' }));
    await userEvent.type(screen.getByLabelText('Key name'), 'ci');
    await userEvent.click(screen.getByRole('button', { name: 'Issue key' }));
    const secret = await screen.findByRole('region', { name: 'New key for Acme' });
    expect(within(secret).queryByText(PLAINTEXT)).not.toBeInTheDocument();
    await userEvent.click(within(secret).getByRole('button', { name: 'Reveal' }));
    expect(within(secret).getByText(PLAINTEXT)).toBeInTheDocument();
    expect(
      JSON.stringify(
        client
          .getQueryCache()
          .getAll()
          .map((q) => q.state.data)
      )
    ).not.toContain(PLAINTEXT);
    await userEvent.click(within(secret).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(PLAINTEXT)).not.toBeInTheDocument();
  });

  it('revokes a key only after confirmation', async () => {
    const spies = routeApi(
      handlers({
        'DELETE /v1/apps/{slug}/consumers/{consumer_id}/keys/{key_id}': () => ({
          ...primary,
          revoked_at: '2026-10-16T00:00:00Z',
        }),
      })
    );
    renderWithProviders(<ApiConsumers slug="api" />);
    await openAcme();
    await userEvent.click(await screen.findByRole('button', { name: 'Revoke key primary' }));
    let dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/cannot be restored/);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(spies.DELETE).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Revoke key primary' }));
    dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Revoke key' }));
    await waitFor(() =>
      expect(spies.DELETE).toHaveBeenCalledWith(
        '/v1/apps/{slug}/consumers/{consumer_id}/keys/{key_id}',
        { params: { path: { slug: 'api', consumer_id: 'c-acme', key_id: 'k-1' } } }
      )
    );
  });

  it('moves a consumer to a plan from the next minute by omitting effective_from', async () => {
    const spies = routeApi(
      handlers({
        'POST /v1/apps/{slug}/consumers/{consumer_id}/plan-assignments': () => ({
          id: 'a-2',
          consumer_id: 'c-acme',
          effective_from: '2026-10-16T12:01:00Z',
          created_at: '2026-10-16T12:00:00Z',
        }),
      })
    );
    renderWithProviders(<ApiConsumers slug="api" />);
    await openAcme();
    const sections = screen.getByRole('group', { name: 'Consumer sections' });
    await userEvent.click(within(sections).getByRole('button', { name: 'Plan' }));
    expect(await screen.findByText(/since 2026-06-01 00:00 UTC/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Move plan' }));
    await waitFor(() => expect(spies.POST).toHaveBeenCalled());
    const [, init] = spies.POST.mock.calls[0] as [string, { body: unknown }];
    expect(init.body).toEqual({});
  });
});
