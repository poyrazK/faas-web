import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '@/components/ui/confirm';
import { spyApi } from '@/test/api';

const toast = vi.fn();
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { id: 'acct-1', plan: 'pro' } }) }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));

const { IntegrationsBody } = await import('./integrations-body');
type View = 'integrations' | 'ai';

const SECRET = 'Bearer sk-live-do-not-echo-0123456789';
const POLICY = { rate_per_second: 10, burst: 20, max_in_flight: 10, request_timeout_ms: 30000 };
const integration = (over: { id: string; name: string } & Record<string, unknown>) => ({
  origin: 'https://api.example.com',
  allowed_methods: ['GET'],
  allowed_path_prefixes: ['/'],
  enabled: true,
  runs_enabled: false,
  credential_source: 'customer_sealed',
  credential_configured: false,
  owner_kind: 'customer',
  daily_request_limit: null,
  request_policy: POLICY,
  ...over,
});
const OPENAI = integration({
  id: '00000000-0000-4000-8000-000000000012',
  name: 'openai',
  origin: 'https://api.openai.com',
  credential_configured: true,
  daily_request_limit: 10000,
  ai_provider: 'openai',
  ai_daily_token_limit: 2000000,
});
const GEOCODER = integration({ id: '00000000-0000-4000-8000-000000000013', name: 'geocoder' });

const ok = (data: unknown) => ({ data, response: new Response() });
const noContent = () => ({ data: undefined, response: new Response(null, { status: 204 }) });
const capabilities = (enabled: boolean) => ({
  registry_version: 1,
  plan: 'pro',
  capabilities: [
    {
      key: 'ai-gateway',
      name: 'AI gateway',
      category: 'data',
      description: 'LLM calls through managed integrations.',
      maturity: 'preview',
      plans: enabled ? ['hobby', 'pro', 'scale'] : ['scale'],
      docs_url: '/docs/ai-gateway',
      acceptance: 'test',
      enabled,
      ...(enabled ? {} : { unavailable_reason: 'plan_not_entitled' }),
    },
  ],
});

type Init = { params?: { path?: Record<string, string> }; body?: Record<string, unknown> };
let items: Record<string, unknown>[];
let aiEnabled: boolean;
let get: ReturnType<typeof spyApi>;
let post: ReturnType<typeof spyApi>;
let put: ReturnType<typeof spyApi>;
let del: ReturnType<typeof spyApi>;

beforeEach(() => {
  toast.mockReset();
  items = [OPENAI, GEOCODER];
  aiEnabled = true;
  get = spyApi('GET').mockImplementation(async (path, init) => {
    const id = (init as Init | undefined)?.params?.path?.integration;
    switch (path) {
      case '/v1/capabilities':
        return ok(capabilities(aiEnabled));
      case '/v1/outbound/integrations':
        return ok({ items });
      case '/v1/outbound/integrations/{integration}/usage':
        return ok({
          daily_request_count: id === OPENAI.id ? 8731 : 0,
          daily_request_limit: id === OPENAI.id ? 10000 : null,
          usage_date: '2026-10-16',
          resets_at: '2026-10-17T00:00:00Z',
        });
      case '/v1/outbound/integrations/{integration}/ai-usage':
        return ok({
          usage_date: '2026-10-16',
          ai_provider: 'openai',
          daily_token_count: 1500,
          daily_token_limit: 2000000,
          resets_at: '2026-10-17T00:00:00Z',
          daily_cost_millicents: 250000,
          daily_cost_limit_millicents: null,
          items: ['app-a', 'app-b'].map((caller) => ({
            caller,
            model: 'gpt-4o-mini',
            requests: 10,
            error_requests: 1,
            usage_unknown_requests: 0,
            input_tokens: 500,
            cached_input_tokens: 0,
            cache_write_tokens: 0,
            output_tokens: 250,
            cost_millicents: 125000,
            images: 0,
            audio_seconds: 0,
            characters: 0,
          })),
        });
      case '/v1/outbound/integrations/{integration}/ai-alerts':
        return ok({ items: [] });
      case '/v1/outbound/ai-routes':
        return ok({ items: [] });
      default:
        throw new Error(`unexpected GET ${path}`);
    }
  });
  post = spyApi('POST').mockImplementation(async (path, init) => {
    if (path !== '/v1/outbound/integrations') throw new Error(`unexpected POST ${path}`);
    const body = (init as Init).body!;
    const created = integration({
      id: '00000000-0000-4000-8000-0000000000c1',
      name: String(body.name),
      ...body,
    });
    items = [...items, created];
    return { data: created, response: new Response(null, { status: 201 }) };
  });
  put = spyApi('PUT').mockImplementation(async (path, init) => {
    if (path === '/v1/outbound/integrations/{integration}/credential') {
      const id = (init as Init).params!.path!.integration;
      items = items.map((i) => (i.id === id ? { ...i, credential_configured: true } : i));
      return noContent();
    }
    throw new Error(`unexpected PUT ${path}`);
  });
  del = spyApi('DELETE').mockImplementation(async (path, init) => {
    if (path !== '/v1/outbound/integrations/{integration}') throw new Error(`unexpected DELETE`);
    const id = (init as Init).params!.path!.integration;
    items = items.filter((i) => i.id !== id);
    return noContent();
  });
});

afterEach(() => {
  for (const spy of [get, post, put, del]) spy.mockRestore();
});

function Harness({ initial }: { initial: View }) {
  const [view, setView] = useState<View>(initial);
  return <IntegrationsBody view={view} onView={setView} />;
}

function renderPage(initial: View = 'integrations') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ConfirmProvider>
        <Harness initial={initial} />
      </ConfirmProvider>
    </QueryClientProvider>
  );
  return client;
}

async function openRow(name: string) {
  const user = userEvent.setup();
  await user.click(await screen.findByText(name));
  return { user, dialog: within(await screen.findByRole('dialog', { name })) };
}

describe('Integrations page', () => {
  it('lists integrations with credential state and today’s usage against the budget', async () => {
    renderPage();
    const openai = (await screen.findByText('openai')).closest('tr')!;
    expect(within(openai).getByText('Credential set')).toBeInTheDocument();
    await waitFor(() => expect(openai).toHaveTextContent('8,731 / 10,000'));
    const geocoder = screen.getByText('geocoder').closest('tr')!;
    expect(within(geocoder).getByText('No credential')).toBeInTheDocument();
    await waitFor(() => expect(geocoder).toHaveTextContent('0 / no limit'));
  });

  it('shows when the daily budget resets as a time, with the exact time on hover', async () => {
    renderPage();
    const { dialog } = await openRow('openai');
    const resets = await waitFor(() => dialog.getByRole('time'));
    expect(resets).toHaveAttribute('dateTime', '2026-10-17T00:00:00.000Z');
    expect(resets).toHaveAttribute('title', expect.stringContaining('2026'));
    expect(resets.textContent).not.toBe('2026-10-17T00:00:00Z');
  });

  it('creates an integration and goes straight to its credential', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /New integration/ }));
    const dialog = within(await screen.findByRole('dialog', { name: 'New integration' }));
    await user.type(dialog.getByRole('textbox', { name: 'Name' }), 'payments-api');
    const origin = dialog.getByRole('textbox', { name: 'Origin' });
    await user.clear(origin);
    await user.type(origin, 'https://api.payments.example');
    await user.click(dialog.getByRole('checkbox', { name: 'POST' }));
    await user.click(dialog.getByRole('button', { name: 'Create integration' }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][0]).toBe('/v1/outbound/integrations');
    expect((post.mock.calls[0][1] as Init).body).toEqual({
      name: 'payments-api',
      origin: 'https://api.payments.example',
      allowed_methods: ['GET', 'POST'],
      allowed_path_prefixes: ['/'],
    });
    const detail = within(await screen.findByRole('dialog', { name: 'payments-api' }));
    expect(detail.getByText(/No credential is set/)).toBeInTheDocument();
  });

  it('sends a credential once and never renders or caches it', async () => {
    const client = renderPage();
    const { user, dialog } = await openRow('geocoder');
    await user.click(dialog.getByRole('button', { name: 'Credential' }));
    const input = dialog.getByLabelText('Authorization value');
    expect(input).toHaveAttribute('type', 'password');
    await user.type(input, SECRET);
    await user.click(dialog.getByRole('button', { name: 'Save credential' }));

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0]).toBe('/v1/outbound/integrations/{integration}/credential');
    expect((put.mock.calls[0][1] as Init).body).toEqual({ authorization: SECRET });
    expect(await dialog.findByText(/A credential is set/)).toBeInTheDocument();
    expect(dialog.getByLabelText('New Authorization value')).toHaveValue('');
    expect(document.body.innerHTML).not.toContain(SECRET);
    expect(JSON.stringify(toast.mock.calls)).not.toContain(SECRET);
    const cached = [
      ...client
        .getQueryCache()
        .getAll()
        .map((q) => q.state),
      ...client
        .getMutationCache()
        .getAll()
        .map((m) => m.state),
    ];
    expect(JSON.stringify(cached)).not.toContain(SECRET);
  });

  it('deletes only after typing the name to confirm', async () => {
    renderPage();
    const { user, dialog } = await openRow('openai');
    await user.click(dialog.getByRole('button', { name: 'Delete integration…' }));
    let confirm = within(await screen.findByRole('dialog', { name: 'Delete openai?' }));
    expect(confirm.getByRole('button', { name: 'Delete integration' })).toBeDisabled();
    await user.click(confirm.getByRole('button', { name: 'Cancel' }));
    expect(del).not.toHaveBeenCalled();

    await user.click(dialog.getByRole('button', { name: 'Delete integration…' }));
    confirm = within(await screen.findByRole('dialog', { name: 'Delete openai?' }));
    await user.type(confirm.getByRole('textbox'), 'openai');
    await user.click(confirm.getByRole('button', { name: 'Delete integration' }));
    await waitFor(() => expect(del).toHaveBeenCalledTimes(1));
    expect((del.mock.calls[0][1] as Init).params?.path).toEqual({ integration: OPENAI.id });
    await waitFor(() => expect(screen.queryByText('openai')).not.toBeInTheDocument());
  });

  it('shows AI usage by model when the ai-gateway capability is available', async () => {
    renderPage('ai');
    const table = (await screen.findByText('gpt-4o-mini')).closest('tr')!;
    // Two callers of one model roll up into one row.
    expect(table).toHaveTextContent('20');
    expect(table).toHaveTextContent('€2.50');
    expect(screen.getByText('No budget threshold has been crossed.')).toBeInTheDocument();
  });

  it('explains the capability instead of calling AI endpoints when it is not available', async () => {
    aiEnabled = false;
    renderPage('ai');
    expect(await screen.findByText(/Not included in your plan/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View plans' })).toBeInTheDocument();
    const paths = get.mock.calls.map(([path]) => path);
    expect(paths.filter((p) => /ai-|ai_/.test(p))).toEqual([]);
  });
});
