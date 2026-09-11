import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '@/components/ui/confirm';
import { DashboardSecondaryNavigation } from '@/components/dashboard/secondary-navigation';
import { Route as Settings } from './dashboard.settings';
import { Route as Team } from './dashboard.team';
import { Route as Keys } from './dashboard.keys';
import { Route as Account } from './dashboard.account';
import { Route as Security } from './dashboard.security';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/client', async (original) => ({ ...(await original<object>()), api }));
vi.mock('@/lib/auth', async (original) => ({
  ...(await original<object>()),
  useAuth: () => ({
    account: {
      id: 'me',
      email: 'owner@example.com',
      plan: 'pro',
      app_count: 2,
      status: 'active',
      github_install_id: 12,
    },
    user: { email: 'owner@example.com' },
    apiReachable: true,
    refreshAccount: vi.fn(),
    signOut: vi.fn(),
  }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/auth/mfa-provider', () => ({ useMfa: () => ({ openMfa: vi.fn() }) }));

const org = (slug: string, personal = false) => ({
  id: slug,
  slug,
  name: `${slug} studio`,
  personal,
  plan: 'pro',
  status: 'active',
  created_at: '2026-09-11T00:00:00Z',
  updated_at: '2026-09-11T00:00:00Z',
});
let orgs: ReturnType<typeof org>[];
let role: string;
const members = () => [
  { account_id: 'me', email: 'owner@example.com', role, joined_at: '2026-09-11T00:00:00Z' },
  {
    account_id: 'next',
    email: 'next@example.com',
    role: 'developer',
    joined_at: '2026-09-11T00:00:00Z',
  },
];
const key = (scope: string) => ({
  id: scope,
  label: `${scope} CI`,
  prefix: `${scope}_prefix`,
  scopes: ['apps:read'],
  status: 'active',
  created_at: '2026-09-11T00:00:00Z',
  last_used_at: null,
});
const ok = (data: unknown) =>
  Promise.resolve({ data, response: new Response(null, { status: 200 }) });

beforeEach(() => {
  orgs = [org('acme'), org('bravo')];
  role = 'owner';
  toast.mockReset();
  api.GET.mockReset().mockImplementation((path, options) => {
    const slug = options?.params?.path?.slug;
    if (path === '/v1/orgs') return ok({ orgs: [...orgs] });
    if (path === '/v1/orgs/{slug}') return ok(orgs.find((o) => o.slug === slug));
    if (path.endsWith('/members')) return ok({ members: members() });
    if (path.endsWith('/invitations')) return ok({ invitations: [] });
    if (path.endsWith('/seat_usage')) return ok({ used: 2, limit: 5, plan: 'pro' });
    if (path === '/v1/keys') return ok([key('personal')]);
    if (path.endsWith('/keys')) return ok({ keys: [key(slug)] });
    if (path.endsWith('/grace_window_days')) return ok({ days: 3, plan_default: 7 });
    if (path.endsWith('/egress_allowlist_extra'))
      return ok({ extra: 0, plan_cap: 8, max_extra: 32 });
    if (path.endsWith('/sessions')) return ok({ sessions: [] });
    if (path === '/v1/audit-events') return ok({ events: [] });
    if (path === '/v1/secrets') return ok({ secrets: [] });
    throw new Error(`Unexpected read ${path}`);
  });
  api.POST.mockReset().mockImplementation((path, options) => {
    if (path === '/v1/orgs') {
      const created = { ...org(options.body.slug), name: options.body.name };
      orgs.push(created);
      return ok(created);
    }
    if (path.endsWith('/transfer_ownership')) {
      role = 'admin';
      return ok(orgs[0]);
    }
    if (path.endsWith('/keys'))
      return ok({ ...key('created'), plaintext: 'one-time-private-value' });
    return ok({});
  });
  api.DELETE.mockReset().mockImplementation((path, options) => {
    if (path === '/v1/orgs/{slug}') orgs = orgs.filter((o) => o.slug !== options.params.path.slug);
    return ok(undefined);
  });
  api.PATCH.mockReset().mockImplementation((_path, options) => {
    orgs = orgs.map((o) => (o.slug === options.params.path.slug ? { ...o, ...options.body } : o));
    return ok(orgs.find((o) => o.slug === options.params.path.slug));
  });
});

async function mount(entry = '/dashboard/settings') {
  const root = createRootRoute({ component: Outlet });
  const dashboard = createRoute({
    getParentRoute: () => root,
    path: 'dashboard',
    component: () => (
      <>
        <DashboardSecondaryNavigation />
        <Outlet />
      </>
    ),
  });
  const routes = [Settings, Team, Keys, Account, Security].map((route, index) =>
    createRoute({
      getParentRoute: () => dashboard,
      path: ['settings', 'team', 'keys', 'account', 'security'][index],
      component: route.options.component,
      validateSearch: route.options.validateSearch,
      beforeLoad: (context) => route.options.beforeLoad?.(context as never),
    })
  );
  const router = createRouter({
    routeTree: root.addChildren([dashboard.addChildren(routes)]),
    history: createMemoryHistory({ initialEntries: [entry] }),
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  await router.load();
  await act(async () => {
    render(
      <QueryClientProvider client={client}>
        <ConfirmProvider>
          <RouterProvider router={router} />
        </ConfirmProvider>
      </QueryClientProvider>
    );
  });
  return { router, client };
}

async function section(name: string) {
  await userEvent.click(
    within(screen.getByRole('navigation', { name: 'Settings sections' })).getByRole('link', {
      name,
    })
  );
}

describe('canonical Settings', () => {
  it.each(['personal', 'organization'])(
    'opens creation from the empty %s key list',
    async (scope) => {
      const get = api.GET.getMockImplementation()!;
      api.GET.mockImplementation((path, options) =>
        path === '/v1/keys'
          ? ok([])
          : path === '/v1/orgs/{slug}/keys'
            ? ok({ keys: [] })
            : get(path, options)
      );
      await mount(`/dashboard/settings?section=api-keys&scope=${scope}`);
      await userEvent.click(await screen.findByRole('button', { name: 'Create your first key' }));
      expect(screen.getByRole('textbox', { name: 'Label' })).toHaveFocus();
    }
  );

  it.each([
    ['personal', 'Rotate personal CI'],
    ['organization', 'Revoke key acme CI'],
  ])('makes %s key actions discoverable by pointer', async (scope, label) => {
    await mount(`/dashboard/settings?section=api-keys&scope=${scope}`);
    await userEvent.hover(await screen.findByRole('button', { name: label }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(label);
  });

  it('defaults invalid sections to General with only browser-local labeling and read-only account details', async () => {
    await mount('/dashboard/settings?section=garbage&scope=bad');
    expect(screen.getByRole('textbox', { name: 'Console label' })).toBeInTheDocument();
    expect(screen.getByText(/stored in this browser/i)).toBeInTheDocument();
    expect(screen.getByText('owner@example.com')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Email' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Schedule account deletion' })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('navigation', { name: 'Settings sections' })).getAllByRole('link')
    ).toHaveLength(8);
  });

  it('restores sections, organization and key scopes through history and copied URLs', async () => {
    const { router } = await mount('/dashboard/settings?campaign=handoff#details');
    await section('API keys');
    expect(await screen.findByText('personal_prefix…')).toBeInTheDocument();
    await userEvent.click(
      within(screen.getByRole('navigation', { name: 'API key scopes' })).getByRole('link', {
        name: 'Organization',
      })
    );
    expect(await screen.findByText('acme_prefix…')).toBeInTheDocument();
    const saved = router.state.location.href;
    expect(router.state.location.search).toMatchObject({
      section: 'api-keys',
      scope: 'organization',
      campaign: 'handoff',
    });
    expect(router.state.location.hash).toBe('details');
    await section('Members');
    expect(await screen.findByText('next@example.com')).toBeInTheDocument();
    await act(async () => router.history.back());
    await waitFor(() => expect(screen.getByText('acme_prefix…')).toBeInTheDocument());
    await act(async () => router.history.forward());
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Members' })).toBeInTheDocument()
    );
    cleanup();
    await mount(saved);
    expect(await screen.findByText('acme_prefix…')).toBeInTheDocument();
  });

  it.each([
    ['/dashboard/team?org=bravo&campaign=old#members', 'members'],
    ['/dashboard/keys?scope=organization&org=bravo&campaign=old#keys', 'api-keys'],
    [
      '/dashboard/account?github=connected&default_branch=develop&campaign=old#github',
      'integrations',
    ],
    ['/dashboard/security?campaign=old#sessions', 'security'],
  ])('redirects %s with applicable search and hash preserved', async (entry, destination) => {
    const { router } = await mount(entry);
    expect(router.state.location.pathname).toBe('/dashboard/settings');
    expect(router.state.location.search).toMatchObject({ section: destination, campaign: 'old' });
    expect(router.state.location.hash).toBe(entry.split('#')[1]);
    if (destination === 'integrations') expect(screen.getByText('develop')).toBeInTheDocument();
    if (destination === 'api-keys')
      expect(await screen.findByText('bravo_prefix…')).toBeInTheDocument();
  });

  it('keeps Members focused and moves identity, seats, transfer and keys to their own sections', async () => {
    await mount('/dashboard/settings?section=members&org=acme');
    expect(await screen.findByText('next@example.com')).toBeInTheDocument();
    expect(screen.getByText('owner')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Transfer' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create key' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rename' })).not.toBeInTheDocument();
    await section('Organization');
    expect(await screen.findByText('2 of 5 seats used on the pro plan.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Transfer' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Invitations' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create key' })).not.toBeInTheDocument();
  });

  it('explains the Free plan zero seat cap as personal organizations only', async () => {
    orgs = [{ ...org('bravo'), plan: 'free' }];
    const get = api.GET.getMockImplementation()!;
    api.GET.mockImplementation((path, options) =>
      path.endsWith('/seat_usage') ? ok({ used: 1, limit: 0, plan: 'free' }) : get(path, options)
    );
    await mount('/dashboard/settings?section=organization&org=bravo');
    expect(
      await screen.findByText(
        'Personal organizations only on the free plan. Shared member seats are not included.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/1 of 0 seats used/)).not.toBeInTheDocument();
  });

  it('distributes GitHub, password/MFA/security inventory, platform limits and privacy without duplication', async () => {
    await mount('/dashboard/settings?section=integrations');
    expect(screen.getByRole('link', { name: /Manage on GitHub/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Email sign-in' })).not.toBeInTheDocument();
    await section('Security');
    for (const name of [
      'Email sign-in',
      'Multi-factor authentication',
      'Active sessions',
      'Sealed secrets',
      'Auth events',
    ])
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Manage on GitHub/ })).not.toBeInTheDocument();
    await section('Platform limits');
    expect(await screen.findByRole('spinbutton', { name: 'Extra entries' })).toBeInTheDocument();
    expect(screen.getByText('Scale to zero')).toBeInTheDocument();
    await section('Data and privacy');
    for (const name of [
      'Download export',
      'Clear browser data and sign out',
      'Schedule account deletion',
    ])
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });

  it('discards a revealed secret and draft when the key scope changes', async () => {
    const { client } = await mount('/dashboard/settings?section=api-keys');
    await userEvent.click(screen.getByRole('button', { name: 'Create key' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Label' }), 'deploy{Enter}');
    await userEvent.click(await screen.findByRole('button', { name: 'Reveal' }));
    expect(screen.getByText('one-time-private-value')).toBeInTheDocument();
    await userEvent.click(
      within(screen.getByRole('navigation', { name: 'API key scopes' })).getByRole('link', {
        name: 'Organization',
      })
    );
    expect(await screen.findByText('acme_prefix…')).toBeInTheDocument();
    expect(screen.queryByText('one-time-private-value')).not.toBeInTheDocument();
    await userEvent.click(
      within(screen.getByRole('navigation', { name: 'API key scopes' })).getByRole('link', {
        name: 'Personal',
      })
    );
    expect(screen.queryByRole('textbox', { name: 'Label' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reveal' })).not.toBeInTheDocument();
    expect(
      JSON.stringify(
        client
          .getMutationCache()
          .getAll()
          .map((m) => m.state.data)
      )
    ).not.toContain('one-time-private-value');
  });

  it('validates organization creation, retains input on API failure and selects the created organization', async () => {
    const { router } = await mount('/dashboard/settings?section=organization');
    await userEvent.click(screen.getByRole('button', { name: 'Create organization' }));
    const slug = screen.getByRole('textbox', { name: 'Slug' });
    await userEvent.type(slug, 'UPPER{Enter}');
    expect(slug).toHaveAttribute('aria-invalid', 'true');
    expect(api.POST).not.toHaveBeenCalled();
    await userEvent.clear(slug);
    await userEvent.type(slug, 'new-studio');
    const name = screen.getByRole('textbox', { name: 'Organization name' });
    await userEvent.type(name, 'New studio');
    api.POST.mockRejectedValueOnce(new Error('temporary offline'));
    await userEvent.type(name, '{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('temporary offline');
    expect(name).toHaveValue('New studio');
    await userEvent.type(name, '{Enter}');
    await waitFor(() => expect(router.state.location.search.org).toBe('new-studio'));
    expect(await screen.findByRole('combobox', { name: 'Active organization' })).toHaveValue(
      'new-studio'
    );
    expect(api.POST).toHaveBeenLastCalledWith('/v1/orgs', {
      body: { slug: 'new-studio', name: 'New studio' },
    });
  });

  it('confirms soft deletion truthfully, retries errors and falls back to the remaining organization', async () => {
    const { router } = await mount('/dashboard/settings?section=organization&org=acme');
    await userEvent.click(await screen.findByRole('button', { name: 'Delete organization' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(/pending deletion/i);
    expect(dialog).not.toHaveTextContent(/30 days|permanently removed immediately/i);
    const typed = within(dialog).getByRole('textbox');
    await userEvent.type(typed, 'wrong{Enter}');
    expect(api.DELETE).not.toHaveBeenCalled();
    await userEvent.clear(typed);
    api.DELETE.mockRejectedValueOnce(new Error('cannot delete while offline'));
    await userEvent.type(typed, 'acme{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('cannot delete while offline');
    expect(typed).toHaveValue('acme');
    await userEvent.type(typed, '{Enter}');
    await waitFor(() => expect(router.state.location.search.org).toBe('bravo'));
    expect(screen.getByRole('combobox', { name: 'Active organization' })).toHaveValue('bravo');
    expect(screen.queryByRole('option', { name: 'acme' })).not.toBeInTheDocument();
  });

  it('shows a deterministic empty state after deleting the last organization', async () => {
    orgs = [org('acme')];
    await mount('/dashboard/settings?section=organization&org=acme');
    await userEvent.click(await screen.findByRole('button', { name: 'Delete organization' }));
    await userEvent.type(within(screen.getByRole('dialog')).getByRole('textbox'), 'acme{Enter}');
    expect(await screen.findByText('No organizations on this account.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create organization' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Delete organization' })).not.toBeInTheDocument();
  });

  it('transfers only to another member and explains the old owner becomes admin', async () => {
    await mount('/dashboard/settings?section=organization&org=acme');
    const target = await screen.findByRole('combobox', { name: 'Transfer ownership to' });
    await waitFor(() =>
      expect(within(target).getByRole('option', { name: 'next@example.com' })).toBeInTheDocument()
    );
    expect(
      within(target).queryByRole('option', { name: 'owner@example.com' })
    ).not.toBeInTheDocument();
    await userEvent.selectOptions(target, 'next');
    await userEvent.click(screen.getByRole('button', { name: 'Transfer' }));
    expect(screen.getByRole('dialog')).toHaveTextContent(/you become an admin/i);
    await userEvent.type(within(screen.getByRole('dialog')).getByRole('textbox'), 'acme{Enter}');
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith('/v1/orgs/{slug}/transfer_ownership', {
        params: { path: { slug: 'acme' } },
        body: { new_owner_account_id: 'next' },
      })
    );
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Transfer' })).not.toBeInTheDocument()
    );
    expect(screen.queryByRole('button', { name: 'Delete organization' })).not.toBeInTheDocument();
  });

  it.each(['viewer', 'developer', 'admin', 'billing'])(
    'gates owner-only operations for %s without hiding membership',
    async (memberRole) => {
      role = memberRole;
      await mount('/dashboard/settings?section=organization&org=acme');
      expect(await screen.findByText('acme studio')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Transfer' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Delete organization' })).not.toBeInTheDocument();
      expect(Boolean(screen.queryByRole('button', { name: 'Rename' }))).toBe(
        memberRole === 'billing'
      );
      await section('Members');
      expect(await screen.findByText('next@example.com')).toBeInTheDocument();
      expect(
        screen.queryByRole('combobox', { name: 'Role for next@example.com' })
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Remove next@example.com' })
      ).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Invite member' })).toHaveProperty(
        'disabled',
        memberRole !== 'admin'
      );
      if (memberRole !== 'admin')
        expect(
          screen.getByText('Only organization owners and admins can invite members.')
        ).toBeInTheDocument();
    }
  );

  it('explains personal organization immutability', async () => {
    orgs = [org('personal', true)];
    await mount('/dashboard/settings?section=organization');
    expect(
      await screen.findByText(/personal organizations cannot be renamed or deleted/i)
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete organization' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rename' })).not.toBeInTheDocument();
  });

  it('rejects an overlong organization rename and retains the name for API retry', async () => {
    await mount('/dashboard/settings?section=organization');
    const name = await screen.findByRole('textbox', { name: 'Display name' });
    // Paste bypasses per-keystroke latency and exercises application validation.
    fireEvent.change(name, { target: { value: 'x'.repeat(257) } });
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    expect(name).toHaveAccessibleDescription('Enter a name of 1–256 characters.');
    expect(api.PATCH).not.toHaveBeenCalled();
    await userEvent.clear(name);
    await userEvent.type(name, 'Updated studio');
    api.PATCH.mockRejectedValueOnce(new Error('rename offline'));
    await userEvent.type(name, '{Enter}');
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }))
    );
    expect(name).toHaveValue('Updated studio');
    await userEvent.type(name, '{Enter}');
    expect(await screen.findByText('Updated studio')).toBeInTheDocument();
  });

  it('keeps organization keys readable for viewers and offers retry when the key list fails', async () => {
    role = 'viewer';
    const get = api.GET.getMockImplementation()!;
    let failing = true;
    api.GET.mockImplementation((path, options) =>
      path === '/v1/orgs/{slug}/keys' && failing
        ? Promise.reject(new Error('keys offline'))
        : get(path, options)
    );
    await mount('/dashboard/settings?section=api-keys&scope=organization');
    expect(await screen.findByText('keys offline')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create key' })).toBeDisabled();
    expect(screen.getByText(/only organization owners and admins/i)).toBeInTheDocument();
    failing = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry keys' }));
    expect(await screen.findByText('acme_prefix…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Rotate key|Revoke key/ })).not.toBeInTheDocument();
  });

  it('recovers from an organization list error without showing an empty-account state', async () => {
    const get = api.GET.getMockImplementation()!;
    api.GET.mockRejectedValueOnce(new Error('organization list offline'));
    await mount('/dashboard/settings?section=organization');
    expect(await screen.findByRole('alert')).toHaveTextContent('organization list offline');
    expect(screen.queryByText('No organizations on this account.')).not.toBeInTheDocument();
    api.GET.mockImplementation(get);
    await userEvent.click(screen.getByRole('button', { name: 'Retry organizations' }));
    expect(await screen.findByText('acme studio')).toBeInTheDocument();
  });

  it('withholds destructive controls when refreshed membership permissions cannot be verified', async () => {
    const { client } = await mount('/dashboard/settings?section=organization&org=acme');
    expect(await screen.findByRole('button', { name: 'Delete organization' })).toBeInTheDocument();
    const get = api.GET.getMockImplementation()!;
    api.GET.mockImplementation((path, options) =>
      path.endsWith('/members')
        ? Promise.reject(new Error('permissions offline'))
        : get(path, options)
    );
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['orgs', 'acme', 'members'] });
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('permissions offline');
    expect(screen.queryByRole('button', { name: 'Delete organization' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Transfer' })).not.toBeInTheDocument();
    await section('Members');
    expect(screen.getByRole('button', { name: 'Invite member' })).toBeDisabled();
  });
});
