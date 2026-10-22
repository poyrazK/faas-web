import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '@/components/ui/confirm';
import { ApiError } from '@/lib/api/errors';
import { spyApi } from '@/test/api';

const toast = vi.fn();
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { id: 'acct-1', plan: 'pro' } }) }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

const { AppOutboundBindings } = await import('./app-outbound-bindings');

const POLICY = { rate_per_second: 10, burst: 20, max_in_flight: 10, request_timeout_ms: 30000 };
const integration = (over: { id: string; name: string } & Record<string, unknown>) => ({
  origin: 'https://api.example.com',
  allowed_methods: ['GET'],
  allowed_path_prefixes: ['/'],
  enabled: true,
  runs_enabled: false,
  credential_source: 'customer_sealed',
  credential_configured: true,
  owner_kind: 'customer',
  daily_request_limit: null,
  request_policy: POLICY,
  ...over,
});
const STRIPE = integration({
  id: '00000000-0000-4000-8000-000000000011',
  name: 'stripe',
  origin: 'https://api.stripe.com',
  allowed_methods: ['GET', 'POST'],
  allowed_path_prefixes: ['/v1/'],
  credential_source: 'operator_env',
  owner_kind: 'operator',
});
const GEOCODER = integration({
  id: '00000000-0000-4000-8000-000000000013',
  name: 'geocoder',
  origin: 'https://geo.example-maps.com',
  credential_configured: false,
});
const OPENAI = integration({
  id: '00000000-0000-4000-8000-000000000012',
  name: 'openai',
  origin: 'https://api.openai.com',
  ai_provider: 'openai',
});
const binding = (offer: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
  integration: offer,
  app_id: '00000000-0000-4000-8000-0000000000a1',
  allowed_methods: offer.allowed_methods,
  allowed_path_prefixes: offer.allowed_path_prefixes,
  daily_request_limit: null,
  created_at: '2026-10-19T10:00:00Z',
  ...over,
});

const ok = (data: unknown) => ({ data, response: new Response() });
const noContent = () => ({ data: undefined, response: new Response(null, { status: 204 }) });

type Init = { params?: { path?: Record<string, string> } };
let integrations: Record<string, unknown>[];
let bindings: Record<string, unknown>[];
let get: ReturnType<typeof spyApi>;
let put: ReturnType<typeof spyApi>;
let del: ReturnType<typeof spyApi>;

beforeEach(() => {
  toast.mockReset();
  integrations = [STRIPE, GEOCODER, OPENAI];
  bindings = [binding(STRIPE, { daily_request_limit: 5000 })];
  get = spyApi('GET').mockImplementation(async (path) => {
    if (path === '/v1/outbound/integrations') return ok({ items: integrations });
    if (path === '/v1/apps/{slug}/outbound-bindings') return ok({ items: bindings });
    throw new Error(`unexpected GET ${path}`);
  });
  put = spyApi('PUT').mockImplementation(async (path, init) => {
    if (path !== '/v1/apps/{slug}/outbound-bindings/{integration}')
      throw new Error(`unexpected PUT ${path}`);
    const id = (init as Init).params!.path!.integration;
    const offer = integrations.find((i) => i.id === id)!;
    const created = binding(offer);
    bindings = [...bindings.filter((b) => (b.integration as { id: string }).id !== id), created];
    return ok(created);
  });
  del = spyApi('DELETE').mockImplementation(async (path, init) => {
    if (path !== '/v1/apps/{slug}/outbound-bindings/{integration}')
      throw new Error(`unexpected DELETE ${path}`);
    const id = (init as Init).params!.path!.integration;
    bindings = bindings.filter((b) => (b.integration as { id: string }).id !== id);
    return noContent();
  });
});

afterEach(() => {
  for (const spy of [get, put, del]) spy.mockRestore();
});

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ConfirmProvider>
        <AppOutboundBindings slug="app-a" />
      </ConfirmProvider>
    </QueryClientProvider>
  );
}

describe('App outbound integrations', () => {
  it('lists what the app is bound to, with the binding’s own limits', async () => {
    renderSection();
    const row = (await screen.findByRole('heading', { name: 'stripe' })).closest('li')!;
    expect(row).toHaveTextContent('https://api.stripe.com');
    expect(row).toHaveTextContent('GET, POST');
    expect(row).toHaveTextContent('/v1/');
    expect(row).toHaveTextContent('5,000 requests per day');
    expect(get).toHaveBeenCalledWith(
      '/v1/apps/{slug}/outbound-bindings',
      expect.objectContaining({ params: { path: { slug: 'app-a' } } })
    );
  });

  it('marks an operator-owned integration as Operator-managed, once, in the bound list and the select', async () => {
    const SENDGRID = integration({
      id: '00000000-0000-4000-8000-000000000014',
      name: 'sendgrid',
      owner_kind: 'operator',
      credential_source: 'operator_env',
    });
    integrations = [STRIPE, GEOCODER, SENDGRID];
    bindings = [binding(STRIPE), binding(GEOCODER)];
    renderSection();
    const stripe = (await screen.findByRole('heading', { name: 'stripe' })).closest('li')!;
    expect(within(stripe).getAllByText('Operator-managed')).toHaveLength(1);
    const geocoder = screen.getByRole('heading', { name: 'geocoder' }).closest('li')!;
    expect(within(geocoder).queryByText('Operator-managed')).toBeNull();
    const select = screen.getByRole('combobox', { name: 'Integration' });
    await waitFor(() =>
      expect(
        within(select)
          .getAllByRole('option')
          .map((o) => o.textContent)
      ).toEqual(['Choose an integration', 'sendgrid (Operator-managed)'])
    );
  });

  it('keeps the credential state visible on an operator-owned integration with a sealed credential', async () => {
    integrations = [integration({ ...STRIPE, credential_source: 'customer_sealed' })];
    bindings = [binding(integrations[0]!)];
    renderSection();
    const row = (await screen.findByRole('heading', { name: 'stripe' })).closest('li')!;
    expect(within(row).getAllByText('Operator-managed')).toHaveLength(1);
    expect(within(row).getByText('Credential set')).toBeInTheDocument();
  });

  it('offers only integrations the app is not already bound to', async () => {
    renderSection();
    const select = await screen.findByRole('combobox', { name: 'Integration' });
    await waitFor(() =>
      expect(
        within(select)
          .getAllByRole('option')
          .map((o) => o.textContent)
      ).toEqual(['Choose an integration', 'geocoder', 'openai'])
    );
  });

  it('does not offer a disabled integration, which the backend refuses to bind', async () => {
    integrations = [
      STRIPE,
      GEOCODER,
      integration({ id: OPENAI.id, name: 'openai', enabled: false }),
    ];
    renderSection();
    const select = await screen.findByRole('combobox', { name: 'Integration' });
    await waitFor(() =>
      expect(
        within(select)
          .getAllByRole('option')
          .map((o) => o.textContent)
      ).toEqual(['Choose an integration', 'geocoder'])
    );
  });

  it('describes binding as available to the account, not owned by it', async () => {
    renderSection();
    expect(
      await screen.findByText(/an integration available to your account/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/account owns/i)).toBeNull();
  });

  it('binds the chosen integration and shows it once the list reloads', async () => {
    const user = userEvent.setup();
    renderSection();
    const select = await screen.findByRole('combobox', { name: 'Integration' });
    await waitFor(() =>
      expect(within(select).getByRole('option', { name: 'openai' })).toBeTruthy()
    );
    await user.selectOptions(select, 'openai');
    await user.click(screen.getByRole('button', { name: 'Bind' }));

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put).toHaveBeenCalledWith(
      '/v1/apps/{slug}/outbound-bindings/{integration}',
      expect.objectContaining({
        params: { path: { slug: 'app-a', integration: OPENAI.id } },
      })
    );
    expect(await screen.findByRole('heading', { name: 'openai' })).toBeInTheDocument();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }));
    // Bound integrations leave the select.
    expect(within(select).queryByRole('option', { name: 'openai' })).toBeNull();
  });

  it('says a customer-sealed integration without a credential will not serve traffic yet', async () => {
    const user = userEvent.setup();
    renderSection();
    const select = await screen.findByRole('combobox', { name: 'Integration' });
    await waitFor(() =>
      expect(within(select).getByRole('option', { name: 'geocoder' })).toBeTruthy()
    );
    await user.selectOptions(select, 'geocoder');
    await user.click(screen.getByRole('button', { name: 'Bind' }));

    const row = (await screen.findByRole('heading', { name: 'geocoder' })).closest('li')!;
    expect(within(row).getByText('No credential')).toBeInTheDocument();
    expect(row).toHaveTextContent(/will not serve traffic until a credential is set/i);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'success',
        description: expect.stringMatching(/credential/i),
      })
    );
  });

  it('keeps the form and reports the reason when the API refuses the bind', async () => {
    put.mockRejectedValue(
      new ApiError({
        status: 404,
        code: 'not_found',
        title: 'Not found',
        detail: 'integration not found',
      })
    );
    const user = userEvent.setup();
    renderSection();
    const select = await screen.findByRole('combobox', { name: 'Integration' });
    await waitFor(() =>
      expect(within(select).getByRole('option', { name: 'openai' })).toBeTruthy()
    );
    await user.selectOptions(select, 'openai');
    await user.click(screen.getByRole('button', { name: 'Bind' }));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'error', description: 'integration not found' })
      )
    );
    expect(select).toHaveValue(OPENAI.id);
    expect(screen.queryByRole('heading', { name: 'openai' })).toBeNull();
  });

  it('asks before unbinding, and leaves the binding alone when declined', async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole('button', { name: 'Unbind stripe' }));
    const dialog = within(await screen.findByRole('dialog', { name: /Unbind stripe/ }));
    expect(dialog.getByText(/integration itself.*stay/i)).toBeInTheDocument();
    // The binding row holds this app's own limits; unbinding discards them.
    expect(dialog.getByText(/limits on the binding.*discarded/i)).toBeInTheDocument();
    expect(
      dialog.getByText(/binding it again starts from the integration's defaults/i)
    ).toBeInTheDocument();
    expect(dialog.queryByText(/at any time/i)).toBeNull();
    await user.click(dialog.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(del).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'stripe' })).toBeInTheDocument();
  });

  it('unbinds once confirmed and returns the integration to the select', async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole('button', { name: 'Unbind stripe' }));
    const dialog = within(await screen.findByRole('dialog', { name: /Unbind stripe/ }));
    // Typing the name is required: the button stays disabled until it matches.
    expect(dialog.getByRole('button', { name: 'Unbind' })).toBeDisabled();
    await user.type(dialog.getByRole('textbox'), 'stripe');
    await user.click(dialog.getByRole('button', { name: 'Unbind' }));

    await waitFor(() => expect(del).toHaveBeenCalledTimes(1));
    expect(del).toHaveBeenCalledWith(
      '/v1/apps/{slug}/outbound-bindings/{integration}',
      expect.objectContaining({
        params: { path: { slug: 'app-a', integration: STRIPE.id } },
      })
    );
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'stripe' })).toBeNull());
    const select = screen.getByRole('combobox', { name: 'Integration' });
    expect(
      within(select).getByRole('option', { name: 'stripe (Operator-managed)' })
    ).toBeInTheDocument();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }));
  });

  it('points to the Integrations page when the account has none to bind', async () => {
    integrations = [];
    bindings = [];
    renderSection();
    expect(await screen.findByText(/no integrations in this account yet/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create an integration' })).toHaveAttribute(
      'href',
      '/dashboard/integrations'
    );
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('shows an unbound app as empty while still offering the integrations to bind', async () => {
    bindings = [];
    renderSection();
    expect(await screen.findByText(/not bound to any outbound integration/i)).toBeInTheDocument();
    const select = screen.getByRole('combobox', { name: 'Integration' });
    await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(4));
  });

  it('reports a failed read with a retry instead of an empty list', async () => {
    get.mockImplementation(async (path) => {
      if (path === '/v1/outbound/integrations') return ok({ items: integrations });
      throw new ApiError({ status: 403, code: 'forbidden', title: 'Forbidden' });
    });
    const user = userEvent.setup();
    renderSection();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText(/not bound to any outbound integration/i)).toBeNull();
    get.mockImplementation(async (path) => {
      if (path === '/v1/outbound/integrations') return ok({ items: integrations });
      return ok({ items: bindings });
    });
    await user.click(screen.getByRole('button', { name: /try again|retry/i }));
    expect(await screen.findByRole('heading', { name: 'stripe' })).toBeInTheDocument();
  });
});
