import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spyApi } from '@/test/api';

const toast = vi.fn();
const capability = vi.fn();
const confirm = vi.fn();
const navigate = vi.fn();
const workspace = vi.hoisted(() => ({
  org: null as string | null,
  label: 'Personal',
  ready: true,
}));

vi.mock('@/lib/api/workspace-apps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/workspace-apps')>()),
  useWorkspaceTarget: () => workspace,
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/lib/api/capabilities', () => ({ useCapability: () => capability() }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    account: { id: 'acct', plan: 'pro', limits: { plan: 'pro', preview_apps: 5 } },
  }),
}));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  Link: ({
    children,
    to,
    params,
    search: _search,
    ...rest
  }: {
    children: ReactNode;
    to: string;
    params?: { appSlug?: string };
    search?: unknown;
  }) => (
    <a href={to.replace('$appSlug', params?.appSlug ?? '')} {...rest}>
      {children}
    </a>
  ),
}));

const { ReleasePreviews } = await import('./release-previews');

const DAY = 86_400_000;
const checkout = { id: 'a1', slug: 'checkout', url: 'https://checkout.gregale.dev' };
const billing = { id: 'a2', slug: 'billing', url: 'https://billing.gregale.dev' };
const pr42 = {
  id: 'a3',
  slug: 'pr-42-checkout',
  url: 'https://pr-42-checkout.gregale.dev',
  preview_of_slug: 'checkout',
  preview_pr_number: 42,
  preview_pr_state: 'open',
  preview_expires_at: new Date(Date.now() + 6 * DAY).toISOString(),
  status: 'active',
};
const resource = (app: Record<string, unknown>, latest?: Record<string, unknown>) => ({
  app,
  parent: checkout,
  latest_deployment: latest,
  changes_from_production: {
    artifact_changed: Boolean(latest),
    preview_artifact: {},
    production_artifact: {},
    configuration_changed_groups: latest ? ['routing'] : [],
  },
  links: {
    url: app.url,
    logs: `/v1/apps/${String(app.slug)}/logs`,
    metrics: `/v1/apps/${String(app.slug)}/metrics`,
    configuration: `/v1/apps/${String(app.slug)}`,
  },
});
const reply = (data: unknown, status = 200) =>
  ({ data, response: new Response(null, { status }) }) as never;
const problem = (status: number, code: string, detail: string) =>
  ({
    error: { status, code, title: code, detail },
    response: new Response(null, { status }),
  }) as never;

let previews: Record<string, unknown>;
function stubGets() {
  return spyApi('GET').mockImplementation(async (path, init) => {
    if (path === '/v1/apps') return reply([checkout, billing, pr42]);
    if (path === '/v1/preview/{slug}') {
      const slug = (init as { params: { path: { slug: string } } }).params.path.slug;
      return previews[slug] ?? problem(404, 'preview_not_found', 'not a preview');
    }
    throw new Error(`unexpected GET ${path}`);
  });
}
function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ReleasePreviews />
    </QueryClientProvider>
  );
}
async function openForm() {
  await userEvent.click(await screen.findByRole('button', { name: 'New preview' }));
  return screen.getByRole('form', { name: 'New preview' });
}

beforeEach(() => {
  Object.assign(workspace, { org: null, label: 'Personal', ready: true });
  toast.mockReset();
  confirm.mockReset().mockResolvedValue(true);
  navigate.mockReset();
  capability.mockReset().mockReturnValue({
    accountId: 'acct',
    state: 'available',
    capability: { key: 'pr-previews', maturity: 'beta', docs_url: '/docs/preview-environments' },
    refresh: vi.fn(),
  });
  previews = { 'pr-42-checkout': reply(resource(pr42, { id: 'd1', status: 'live' })) };
});
afterEach(() => vi.restoreAllMocks());

describe('ReleasePreviews', () => {
  it('lists existing previews and keeps the action off when the capability is off', async () => {
    stubGets();
    capability.mockReturnValue({
      accountId: 'acct',
      state: 'runtime-unavailable',
      capability: { key: 'pr-previews', maturity: 'beta', docs_url: '/docs/preview-environments' },
      refresh: vi.fn(),
    });
    renderPanel();
    expect(await screen.findByText('pr-42-checkout')).toBeInTheDocument();
    expect(screen.getByText(/Unavailable on this installation/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New preview' })).not.toBeInTheDocument();
  });

  it('states the slug, the lease and the plan limit before creating', async () => {
    stubGets();
    renderPanel();
    const form = await openForm();
    const parent = within(form).getByLabelText('Production app');
    expect(
      within(parent)
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual(['checkout', 'billing']);
    await userEvent.type(within(form).getByLabelText('Pull request number'), '7');
    expect(within(form).getByText('pr-7-checkout')).toBeInTheDocument();
    expect(form).toHaveTextContent('expires 7 days after you create it');
    expect(form).toHaveTextContent('Your Pro plan allows 5 open PR preview environments');
    expect(form).toHaveTextContent(
      "Values and secrets in checkout's pr-preview scope are applied to it"
    );
  });

  it('refuses a lease outside 1–720 hours and a slug over 63 characters', async () => {
    stubGets();
    renderPanel();
    const form = await openForm();
    await userEvent.type(within(form).getByLabelText('Pull request number'), '7');
    const ttl = within(form).getByLabelText('Expires after (hours)');
    await userEvent.clear(ttl);
    await userEvent.type(ttl, '721');
    expect(within(form).getByText('Enter whole hours from 1 to 720.')).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Create preview' })).toBeDisabled();
    await userEvent.clear(ttl);
    await userEvent.type(ttl, '24');
    expect(within(form).getByRole('button', { name: 'Create preview' })).toBeEnabled();
    await userEvent.clear(within(form).getByLabelText('Pull request number'));
    await userEvent.type(within(form).getByLabelText('Pull request number'), '1'.repeat(60));
    expect(within(form).getByText(/at most 63 characters/)).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Create preview' })).toBeDisabled();
  });

  it('creates a preview, then shows its status, URL, expiry and page', async () => {
    stubGets();
    const created = {
      ...pr42,
      id: 'a9',
      slug: 'pr-7-checkout',
      url: 'https://pr-7-checkout.gregale.dev',
      preview_pr_number: 7,
      preview_expires_at: new Date(Date.now() + DAY).toISOString(),
      status: 'undeployed',
    };
    previews['pr-7-checkout'] = reply(resource(created));
    const post = spyApi('POST').mockResolvedValue(reply(created, 201));
    renderPanel();
    const form = await openForm();
    await userEvent.type(within(form).getByLabelText('Pull request number'), '7');
    const ttl = within(form).getByLabelText('Expires after (hours)');
    await userEvent.clear(ttl);
    await userEvent.type(ttl, '24');
    await userEvent.click(within(form).getByRole('button', { name: 'Create preview' }));
    expect(post).toHaveBeenCalledWith('/v1/apps/{slug}/previews', {
      params: { path: { slug: 'checkout' } },
      body: { pr_number: 7, ttl_hours: 24 },
    });
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'success', title: 'Preview pr-7-checkout created' })
      )
    );
    const detail = await screen.findByRole('region', { name: 'Preview pr-7-checkout' });
    expect(await within(detail).findByText('Not deployed yet')).toBeInTheDocument();
    expect(
      within(detail).getByRole('link', { name: /pr-7-checkout\.gregale\.dev/ })
    ).toHaveAttribute('href', 'https://pr-7-checkout.gregale.dev/');
    expect(within(detail).getByText(/in 1 day/)).toBeInTheDocument();
    expect(within(detail).getByRole('link', { name: 'Open pr-7-checkout' })).toHaveAttribute(
      'href',
      '/dashboard/apps/pr-7-checkout'
    );
  });

  it('says a repeat renewed the existing preview', async () => {
    stubGets();
    spyApi('POST').mockResolvedValue(reply(pr42, 200));
    renderPanel();
    const form = await openForm();
    await userEvent.type(within(form).getByLabelText('Pull request number'), '42');
    await userEvent.click(within(form).getByRole('button', { name: 'Create preview' }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'info',
          title: 'Preview pr-42-checkout already existed',
        })
      )
    );
  });

  it('explains the plan limit with a way out', async () => {
    stubGets();
    spyApi('POST').mockResolvedValue(
      problem(
        403,
        'plan_limit_apps',
        'pro plan allows 5 open PR preview environment(s); you have 5.'
      )
    );
    renderPanel();
    const form = await openForm();
    await userEvent.type(within(form).getByLabelText('Pull request number'), '7');
    await userEvent.click(within(form).getByRole('button', { name: 'Create preview' }));
    const alert = await within(form).findByRole('alert');
    expect(alert).toHaveTextContent('pro plan allows 5 open PR preview environment(s)');
    expect(alert).toHaveTextContent('Open a preview below and tear it down');
    expect(within(alert).getByRole('link', { name: 'View plans' })).toHaveAttribute(
      'href',
      '/dashboard/plans'
    );
  });

  it('asks for a verified email when the API does', async () => {
    stubGets();
    spyApi('POST').mockResolvedValue(
      problem(
        403,
        'email_verification_required',
        'verify your email address before deploying apps.'
      )
    );
    renderPanel();
    const form = await openForm();
    await userEvent.type(within(form).getByLabelText('Pull request number'), '7');
    await userEvent.click(within(form).getByRole('button', { name: 'Create preview' }));
    const alert = await within(form).findByRole('alert');
    expect(within(alert).getByRole('link', { name: 'Verify your email' })).toHaveAttribute(
      'href',
      '/dashboard/account'
    );
  });

  it('opens a listed preview by slug', async () => {
    const get = stubGets();
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: /pr-42-checkout/ }));
    const detail = await screen.findByRole('region', { name: 'Preview pr-42-checkout' });
    expect(get).toHaveBeenCalledWith('/v1/preview/{slug}', expect.anything());
    expect(await within(detail).findByText('live')).toBeInTheDocument();
    expect(within(detail).getByRole('link', { name: 'checkout' })).toHaveAttribute(
      'href',
      '/dashboard/apps/checkout'
    );
    expect(detail).toHaveTextContent('PR #42 · open');
    expect(detail).toHaveTextContent('routing');
  });

  it('tears a preview down from its detail, with the typed confirm, and stays on Releases', async () => {
    stubGets();
    const post = spyApi('POST').mockResolvedValue({
      data: undefined,
      response: new Response(null, { status: 204 }),
    } as never);
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: /pr-42-checkout/ }));
    const detail = await screen.findByRole('region', { name: 'Preview pr-42-checkout' });
    await userEvent.click(await within(detail).findByRole('button', { name: 'Tear down preview' }));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ destructive: true, typeToConfirm: 'pr-42-checkout' })
    );
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/v1/preview/{slug}/destroy', {
        params: { path: { slug: 'pr-42-checkout' } },
      })
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('region', { name: 'Preview pr-42-checkout' })
      ).not.toBeInTheDocument()
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it('says so when the slug is not a preview', async () => {
    stubGets();
    previews = {};
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: /pr-42-checkout/ }));
    expect(await screen.findByText(/is not a preview app/)).toBeInTheDocument();
  });
});

describe('ReleasePreviews in a company workspace', () => {
  const PROJECT = '3f2b8c1e-6a4d-4e5f-9b7a-1c2d3e4f5a6b';
  const summary = (slug: string, status = 'active') => ({
    id: `id-${slug}`,
    slug,
    type: 'app',
    project_id: PROJECT,
    status,
    created_at: '2026-10-01T00:00:00Z',
  });
  const pr7 = {
    ...pr42,
    id: 'c2',
    slug: 'pr-7-search-indexer',
    url: 'https://pr-7-search-indexer.gregale.dev',
    preview_of_slug: 'search-indexer',
    preview_pr_number: 7,
  };
  let inventory: ReturnType<typeof summary>[];
  let appReads: Record<string, unknown>;
  function stubCompanyGets() {
    return spyApi('GET').mockImplementation(async (path, init) => {
      const slug = (init as { params?: { path?: { slug?: string } } })?.params?.path?.slug;
      if (path === '/v1/orgs/{slug}/apps') return reply({ apps: inventory });
      if (path === '/v1/preview/{slug}')
        return previews[slug!] ?? problem(404, 'preview_not_found', 'not a preview');
      if (path === '/v1/apps/{slug}') return appReads[slug!] ?? problem(404, 'not_found', 'gone');
      throw new Error(`unexpected GET ${path}`);
    });
  }
  beforeEach(() => {
    Object.assign(workspace, { org: 'acme-corp', label: 'Acme Corp', ready: true });
    inventory = [summary('search-indexer'), summary('pr-7-search-indexer', 'undeployed')];
    appReads = { 'pr-7-search-indexer': reply(pr7) };
    previews = { 'pr-7-search-indexer': reply(resource(pr7)) };
  });

  it("lists the company's previews and production apps from its inventory, not /v1/apps", async () => {
    const get = stubCompanyGets();
    renderPanel();
    expect(await screen.findByText('pr-7-search-indexer')).toBeInTheDocument();
    expect(screen.getByText(/PR #7 of search-indexer/)).toBeInTheDocument();
    expect(screen.queryByText('pr-42-checkout')).not.toBeInTheDocument();
    const form = await openForm();
    expect(
      within(within(form).getByLabelText('Production app'))
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual(['search-indexer']);
    // The personal plan's allowance is not the company's.
    expect(form).not.toHaveTextContent('Your Pro plan allows');
    expect(form).toHaveTextContent(
      'In Acme Corp, apid lets only the member who created an app create its previews'
    );
    expect(get).toHaveBeenCalledWith('/v1/orgs/{slug}/apps', expect.anything());
    expect(get).not.toHaveBeenCalledWith('/v1/apps', expect.anything());
  });

  it("creates a company app's preview and lists it from the refreshed inventory", async () => {
    const get = stubCompanyGets();
    const created = { ...pr7, slug: 'pr-8-search-indexer', preview_pr_number: 8 };
    previews['pr-8-search-indexer'] = reply(resource(created));
    const post = spyApi('POST').mockImplementation(async () => {
      inventory = [...inventory, summary('pr-8-search-indexer', 'undeployed')];
      return reply(created, 201);
    });
    renderPanel();
    const form = await openForm();
    await userEvent.type(within(form).getByLabelText('Pull request number'), '8');
    await userEvent.click(within(form).getByRole('button', { name: 'Create preview' }));
    expect(post).toHaveBeenCalledWith('/v1/apps/{slug}/previews', {
      params: { path: { slug: 'search-indexer' } },
      body: { pr_number: 8, ttl_hours: 168 },
    });
    expect(await screen.findByRole('button', { name: /pr-8-search-indexer/ })).toBeInTheDocument();
    expect(get.mock.calls.filter(([path]) => path === '/v1/orgs/{slug}/apps').length).toBe(2);
  });

  it('explains a role refusal by naming the organization', async () => {
    stubCompanyGets();
    spyApi('POST').mockResolvedValue(
      problem(
        403,
        'org_role_forbidden',
        'your role does not allow use an application endpoint without a reviewed organization permission on this organization.'
      )
    );
    renderPanel();
    const form = await openForm();
    await userEvent.type(within(form).getByLabelText('Pull request number'), '8');
    await userEvent.click(within(form).getByRole('button', { name: 'Create preview' }));
    const alert = await within(form).findByRole('alert');
    expect(alert).toHaveTextContent(
      'apid lets only the member who created search-indexer create its previews, while they are an owner or admin of Acme Corp'
    );
    expect(alert).toHaveTextContent('org_role_forbidden');
  });

  it('falls back to the app read when the preview read is refused, and offers no teardown', async () => {
    // GET /v1/preview/{slug} and its teardown are not reviewed organization
    // routes (faas appaccess/indirect.go:107-109, access.go:263-270);
    // GET /v1/apps/{slug} is (appaccess/routes.go:28).
    stubCompanyGets();
    previews['pr-7-search-indexer'] = problem(403, 'org_role_forbidden', 'role');
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: /pr-7-search-indexer/ }));
    const detail = await screen.findByRole('region', { name: 'Preview pr-7-search-indexer' });
    expect(await within(detail).findByText('PR #7 · open')).toBeInTheDocument();
    expect(within(detail).getByText(/in 6 days/)).toBeInTheDocument();
    expect(detail).toHaveTextContent(
      'Only the member who created search-indexer, while an owner or admin of Acme Corp, can see this preview’s latest deployment'
    );
    expect(within(detail).queryByRole('button', { name: 'Tear down preview' })).toBeNull();
    expect(within(detail).queryByRole('alert')).toBeNull();
  });
});
