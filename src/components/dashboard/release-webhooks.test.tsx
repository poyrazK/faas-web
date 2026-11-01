import type { ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '@/components/ui/confirm';
import { ToastProvider } from '@/components/ui/toast';
import { spyApi } from '@/test/api';

const state = vi.hoisted(() => ({
  maturity: 'beta' as string,
  workspace: { org: null as string | null, label: 'Personal', ready: true },
  setActiveOrg: vi.fn(),
}));
vi.mock('@/lib/api/capabilities', () => ({
  useCapability: () => ({
    accountId: 'acct',
    state: 'available',
    capability: {
      key: 'account-release-webhooks',
      maturity: state.maturity,
      docs_url: '/docs/event-driven',
    },
    refresh: vi.fn(),
  }),
}));
vi.mock('@/lib/api/workspace-apps', () => ({ useWorkspaceTarget: () => state.workspace }));
vi.mock('@/lib/workspace', () => ({ setActiveOrg: state.setActiveOrg }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { id: 'acct-1' } }) }));
vi.mock('./webhook-deliveries', () => ({
  WebhookDeliveries: ({
    source,
    appName,
  }: {
    source: { id: string; accountId?: string };
    appName?: (id: string) => string | undefined;
  }) => (
    <p>
      Deliveries of {source.id} for {source.accountId} from {appName?.('f'.repeat(32))}
    </p>
  ),
}));

const { ReleaseWebhooks } = await import('./release-webhooks');

const HOOK = 'a'.repeat(32);
const TARGET = 'https://platform.example.com/releases';
const ROOT = '/v1/account/release-webhooks';
const ok = (data: unknown) => Promise.resolve({ data, response: new Response() });
const problem = (status: number, code: string, detail: string) =>
  Promise.resolve({
    error: { type: 'about:blank', title: code, status, code, detail },
    response: new Response(null, { status }),
  });

const receiver = {
  id: HOOK,
  scope: 'account',
  account_id: '00000000-0000-4000-8000-000000000000',
  target_url: TARGET,
  webhook_secret_sealed_masked: '***',
  event_filter: ['deployment.live', 'deployment.failed'],
  retry_policy: 'default',
  delivery_format: 'json',
  enabled: true,
  created_at: '2026-10-20T09:00:00Z',
  updated_at: '2026-10-20T09:00:00Z',
};

let client: QueryClient;
function mount(children: ReactNode = <ReleaseWebhooks />) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ConfirmProvider>{children}</ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

let get: ReturnType<typeof spyApi>;
beforeEach(() => {
  state.maturity = 'beta';
  state.workspace = { org: null, label: 'Personal', ready: true };
  state.setActiveOrg.mockReset();
  get = spyApi('GET').mockImplementation((path: string) => {
    if (path === ROOT) return ok([receiver]);
    if (path === '/v1/apps') return ok([{ id: 'f'.repeat(32), slug: 'billing', name: 'billing' }]);
    return ok(undefined);
  });
});
afterEach(() => vi.restoreAllMocks());

async function row() {
  return screen.findByRole('listitem', { name: TARGET });
}

describe('ReleaseWebhooks', () => {
  it('lists receivers with their events and takes the beta label from the catalog', async () => {
    mount();
    const item = await row();
    expect(item).toHaveTextContent('deployment.live');
    expect(item).toHaveTextContent('deployment.failed');
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it("caches receivers under the signed-in account's key, which sign-out clears", async () => {
    mount();
    await row();
    const cache = client.getQueryCache();
    expect(cache.findAll({ queryKey: ['account', 'acct-1', 'release-webhooks'] })).toHaveLength(1);
    expect(cache.findAll({ queryKey: ['release-webhooks'] })).toHaveLength(0);
  });

  it('drops the label once the capability graduates', async () => {
    state.maturity = 'ga';
    mount();
    await row();
    expect(screen.queryByText('Beta')).toBeNull();
  });

  it('explains release webhooks in a company workspace without reading the personal account', async () => {
    state.workspace = { org: 'acme', label: 'Acme Inc', ready: true };
    mount();
    expect(await screen.findByText(/belong to your personal account/i)).toHaveTextContent(
      'Acme Inc'
    );
    expect(get).not.toHaveBeenCalledWith(ROOT, expect.anything());
    await userEvent.click(
      screen.getByRole('button', { name: 'Switch to your personal workspace' })
    );
    expect(state.setActiveOrg).toHaveBeenCalledWith(null);
  });

  it('creates a receiver with a generated secret shown once, hidden until revealed', async () => {
    const post = spyApi('POST').mockImplementation(() => ok({ ...receiver, id: 'b'.repeat(32) }));
    mount();
    await row();
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Target URL' }),
      'https://new.example.com/h'
    );
    await userEvent.click(screen.getByRole('button', { name: 'rollout.aborted' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add receiver' }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const [path, init] = post.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(path).toBe(ROOT);
    expect(init.body).toMatchObject({
      target_url: 'https://new.example.com/h',
      event_filter: ['rollout.aborted'],
      retry_policy: 'default',
      delivery_format: 'json',
      enabled: false,
    });
    const secret = init.body.webhook_secret as string;
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const reveal = await screen.findByRole('region', { name: /signing secret/i });
    expect(reveal).not.toHaveTextContent(secret);
    await userEvent.click(within(reveal).getByRole('button', { name: 'Reveal' }));
    expect(reveal).toHaveTextContent(secret);
    expect(reveal).toHaveTextContent(/X-Faas-Webhook-Signature/);
    expect(reveal).toHaveTextContent(/paused/i);
  });

  it('starts a receiver paused by default, and live when asked', async () => {
    const post = spyApi('POST').mockImplementation(() => ok(receiver));
    mount();
    await row();
    const paused = screen.getByRole('checkbox', { name: /start paused/i });
    expect(paused).toBeChecked();
    expect(screen.getByText(/events while it is paused are not delivered/i)).toBeInTheDocument();
    await userEvent.click(paused);
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Target URL' }),
      'https://live.example.com'
    );
    await userEvent.click(screen.getByRole('button', { name: 'deployment.live' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add receiver' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        ROOT,
        expect.objectContaining({ body: expect.objectContaining({ enabled: true }) })
      )
    );
  });

  it('counts a pasted secret in UTF-8 bytes, as apid does', async () => {
    const post = spyApi('POST');
    mount();
    await row();
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Target URL' }),
      'https://b.example.com'
    );
    await userEvent.click(screen.getByRole('button', { name: 'deployment.live' }));
    // 100 characters, 300 bytes: over apid's 256-byte cap.
    await userEvent.type(screen.getByLabelText('Your own secret (optional)'), '€'.repeat(100));
    await userEvent.click(screen.getByRole('button', { name: 'Add receiver' }));
    expect(await screen.findByText(/at most 256 bytes/i)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('uses a pasted secret as is and does not show it back', async () => {
    const post = spyApi('POST').mockImplementation(() => ok(receiver));
    mount();
    await row();
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Target URL' }),
      'https://own.example.com'
    );
    await userEvent.click(screen.getByRole('button', { name: 'deployment.live' }));
    const own = screen.getByLabelText('Your own secret (optional)');
    expect(own).toHaveAttribute('type', 'password');
    await userEvent.type(own, 'from-the-vault');
    await userEvent.click(screen.getByRole('button', { name: 'Add receiver' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        ROOT,
        expect.objectContaining({
          body: expect.objectContaining({ webhook_secret: 'from-the-vault' }),
        })
      )
    );
    expect(screen.queryByRole('region', { name: /signing secret/i })).toBeNull();
  });

  it('asks for at least one event before sending', async () => {
    const post = spyApi('POST');
    mount();
    await row();
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Target URL' }),
      'https://x.example.com'
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add receiver' }));
    expect(await screen.findByText('Choose at least one event.')).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('says the webhook limit is shared with app webhooks on plan_webhook_quota', async () => {
    spyApi('POST').mockImplementation(() =>
      problem(403, 'plan_webhook_quota', 'pro plan caps webhooks at 30 for this account')
    );
    mount();
    await row();
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Target URL' }),
      'https://q.example.com'
    );
    await userEvent.click(screen.getByRole('button', { name: 'deployment.live' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add receiver' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/shared with app webhooks/i);
    expect(within(alert).getByRole('link', { name: 'View plans' })).toHaveAttribute(
      'href',
      '/dashboard/plans'
    );
  });

  it('deletes a receiver only after a destructive confirmation', async () => {
    const del = spyApi('DELETE').mockImplementation(() => ok(undefined));
    mount();
    const item = await row();
    await userEvent.click(within(item).getByRole('button', { name: `Delete receiver ${TARGET}` }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/delivery history/i);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete receiver' }));
    await waitFor(() =>
      expect(del).toHaveBeenCalledWith(`${ROOT}/{id}`, { params: { path: { id: HOOK } } })
    );
  });

  it('rotates the secret after saying the old one stops verifying', async () => {
    const post = spyApi('POST').mockImplementation(() =>
      ok({ rotated_at: '2026-11-01T00:00:00Z', webhook_secret_sealed_masked: '***' })
    );
    mount();
    const item = await row();
    await userEvent.click(
      within(item).getByRole('button', { name: `Rotate secret for ${TARGET}` })
    );
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/old secret stop verifying/i);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rotate secret' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        `${ROOT}/{id}/rotate-secret`,
        expect.objectContaining({
          params: { path: { id: HOOK } },
          body: { webhook_secret: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) },
        })
      )
    );
  });

  it('pauses a receiver', async () => {
    const patch = spyApi('PATCH').mockImplementation(() => ok({ ...receiver, enabled: false }));
    mount();
    const item = await row();
    await userEvent.click(within(item).getByRole('switch', { name: `Pause receiver ${TARGET}` }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith(`${ROOT}/{id}`, {
        params: { path: { id: HOOK } },
        body: { enabled: false },
      })
    );
  });

  it('edits only what changed', async () => {
    const patch = spyApi('PATCH').mockImplementation(() => ok(receiver));
    mount();
    const item = await row();
    await userEvent.click(within(item).getByRole('button', { name: `Edit receiver ${TARGET}` }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('textbox', { name: 'Target URL' })).toHaveValue(TARGET);
    expect(within(dialog).getByRole('button', { name: 'deployment.live' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(within(dialog).queryByLabelText('Your own secret (optional)')).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'rollout.aborted' }));
    await userEvent.selectOptions(within(dialog).getByLabelText('Format'), 'cloudevents');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith(`${ROOT}/{id}`, {
        params: { path: { id: HOOK } },
        body: {
          event_filter: ['deployment.live', 'deployment.failed', 'rollout.aborted'],
          delivery_format: 'cloudevents',
        },
      })
    );
  });

  it('keeps an event the form does not offer, such as agent_run.finished, when editing', async () => {
    get.mockImplementation((path: string) =>
      path === ROOT
        ? ok([{ ...receiver, event_filter: ['deployment.live', 'agent_run.finished'] }])
        : ok([])
    );
    const patch = spyApi('PATCH').mockImplementation(() => ok(receiver));
    mount();
    const item = await row();
    await userEvent.click(within(item).getByRole('button', { name: `Edit receiver ${TARGET}` }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'agent_run.finished' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'rollout.aborted' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith(`${ROOT}/{id}`, {
        params: { path: { id: HOOK } },
        body: { event_filter: ['deployment.live', 'rollout.aborted', 'agent_run.finished'] },
      })
    );
  });

  it('opens deliveries with the source app named', async () => {
    mount();
    const item = await row();
    await userEvent.click(within(item).getByRole('button', { name: `Deliveries for ${TARGET}` }));
    expect(
      await screen.findByText(`Deliveries of ${HOOK} for acct-1 from billing`)
    ).toBeInTheDocument();
  });
});
