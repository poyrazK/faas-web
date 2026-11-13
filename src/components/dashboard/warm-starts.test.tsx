import type { ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from '@/lib/api/queries';
import type { Plan } from '@/lib/auth';
import { spyApi } from '@/test/api';
import { WarmStarts } from './warm-starts';

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  refresh: vi.fn(),
  access: 'on' as string,
  maturity: 'beta' as string | undefined,
  workspace: { org: null as string | null, label: 'Personal', ready: true },
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: (id: string) => ({
    access: mocks.access,
    capability: mocks.maturity ? { key: id, maturity: mocks.maturity } : undefined,
    refresh: mocks.refresh,
  }),
}));
vi.mock('@/lib/api/workspace-apps', () => ({ useWorkspaceTarget: () => mocks.workspace }));

const web = {
  id: 'app-1',
  slug: 'api-gateway',
  type: 'app',
  max_concurrency: 4,
  warm_pool_size: 0,
  warm_snapshot_enabled: true,
  warm_snapshot_min_ms: 2000,
  warm_snapshot_min_requests: 5,
  manifest: { entrypoint: ['node', 'server.js'], port: 8080 },
} as unknown as App;

const accepted = (body: unknown) => ({ data: body, response: new Response() }) as never;
const refused = (status: number, code: string, detail: string) =>
  ({
    error: { status, code, title: 'Refused', detail },
    response: new Response(null, { status }),
  }) as never;

function renderWith(app: App, plan: Plan | undefined = 'pro') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <WarmStarts app={app} plan={plan} />
    </QueryClientProvider>
  );
}

const pool = () => screen.getByRole('group', { name: 'Warm pool' });
const snapshots = () => screen.getByRole('group', { name: 'Warm snapshots' });
const body = (patch: ReturnType<typeof spyApi>, call = 0) =>
  (patch.mock.calls[call][1] as { body: object }).body;

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.toast.mockReset();
  mocks.refresh.mockReset();
  mocks.access = 'on';
  mocks.maturity = 'beta';
  mocks.workspace = { org: null, label: 'Personal', ready: true };
  spyApi('GET').mockResolvedValue(accepted([]));
});

describe('WarmStarts', () => {
  it('is labelled beta, opens with what is set, and shows the pool and warm snapshots on Pro', async () => {
    const user = userEvent.setup();
    renderWith({ ...web, warm_pool_size: 1 } as App, 'pro');
    expect(screen.getByRole('heading', { name: 'Warm starts' })).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(
      screen.getByText('1 copy is kept paused, ready to wake. Warm snapshots are on.')
    ).toBeInTheDocument();
    const size = within(pool()).getByLabelText('Ready-to-wake copies');
    expect(size).toHaveValue(1);
    expect(size).toHaveAttribute('max', '4');
    expect(size).toHaveAttribute('title', 'warm_pool_size');
    expect(pool()).toHaveTextContent(/billed while paused/i);
    expect(pool()).toHaveTextContent(/up to 4, this app.s most copies at once/i);
    expect(within(snapshots()).getByRole('switch', { name: 'Warm snapshots' })).toBeChecked();
    // The capture thresholds sit behind Advanced.
    expect(within(snapshots()).queryByLabelText('Capture after (ms)')).not.toBeInTheDocument();
    await user.click(
      within(snapshots()).getByRole('button', { name: 'Advanced snapshot settings' })
    );
    expect(within(snapshots()).getByLabelText('Capture after (ms)')).toHaveValue(2000);
    expect(within(snapshots()).getByLabelText('Capture after (requests)')).toHaveValue(5);
  });

  it('offers Discard only once something changed, and puts the draft back', async () => {
    const user = userEvent.setup();
    renderWith(web, 'pro');
    expect(screen.queryByRole('button', { name: 'Discard changes' })).not.toBeInTheDocument();
    const size = within(pool()).getByLabelText('Ready-to-wake copies');
    await user.clear(size);
    await user.type(size, '3');
    expect(screen.getByRole('button', { name: 'Save warm settings' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(size).toHaveValue(0);
    expect(screen.getByRole('button', { name: 'Save warm settings' })).toBeDisabled();
  });

  it('saves only what changed, and says when it applies', async () => {
    const patch = spyApi('PATCH').mockResolvedValue(accepted({ ...web, warm_pool_size: 2 }));
    const user = userEvent.setup();
    renderWith(web, 'pro');
    expect(screen.getByRole('button', { name: 'Save warm settings' })).toBeDisabled();
    const size = within(pool()).getByLabelText('Ready-to-wake copies');
    await user.clear(size);
    await user.type(size, '2');
    await user.click(screen.getByRole('button', { name: 'Save warm settings' }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0][1]).toMatchObject({ params: { path: { slug: 'api-gateway' } } });
    expect(body(patch)).toEqual({ warm_pool_size: 2 });
    await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
    expect(mocks.toast.mock.calls[0][0]).toMatchObject({ kind: 'success' });
    expect(mocks.toast.mock.calls[0][0].description).toMatch(/scheduler/i);
  });

  it('turns warm snapshots off without sending the thresholds', async () => {
    const patch = spyApi('PATCH').mockResolvedValue(
      accepted({ ...web, warm_snapshot_enabled: false })
    );
    const user = userEvent.setup();
    renderWith(web, 'scale');
    await user.click(within(snapshots()).getByRole('switch', { name: 'Warm snapshots' }));
    expect(within(snapshots()).queryByLabelText('Capture after (ms)')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save warm settings' }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(body(patch)).toEqual({ warm_snapshot_enabled: false });
  });

  it('refuses a pool larger than max concurrency before it leaves the browser', async () => {
    const patch = spyApi('PATCH');
    const user = userEvent.setup();
    renderWith(web, 'pro');
    const size = within(pool()).getByLabelText('Ready-to-wake copies');
    await user.clear(size);
    await user.type(size, '9');
    expect(size).toHaveAttribute('aria-invalid', 'true');
    expect(within(pool()).getByText(/at most 4, the app.s max concurrency/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save warm settings' })).toBeDisabled();
    expect(patch).not.toHaveBeenCalled();
  });

  it('explains both plan gates by plan name on Free, with a Compare plans link', () => {
    renderWith({ ...web, warm_snapshot_enabled: false } as App, 'free');
    expect(pool()).toHaveTextContent('Warm pools are available on Hobby, Pro and Scale');
    expect(pool()).toHaveTextContent('This account is on Free');
    expect(within(pool()).getByRole('link', { name: 'Compare plans' })).toHaveAttribute(
      'href',
      '/dashboard/plans'
    );
    expect(within(pool()).queryByLabelText('Ready-to-wake copies')).not.toBeInTheDocument();
    expect(snapshots()).toHaveTextContent('Warm snapshots are available on Pro and Scale');
    expect(within(snapshots()).queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save warm settings' })).not.toBeInTheDocument();
  });

  it('offers the pool on Hobby but explains that warm snapshots need Pro', () => {
    renderWith({ ...web, warm_snapshot_enabled: false } as App, 'hobby');
    expect(within(pool()).getByLabelText('Ready-to-wake copies')).toBeInTheDocument();
    expect(snapshots()).toHaveTextContent('Warm snapshots are available on Pro and Scale');
    expect(snapshots()).toHaveTextContent('This account is on Hobby');
    expect(within(snapshots()).getByRole('link', { name: 'Compare plans' })).toBeInTheDocument();
    expect(within(snapshots()).queryByRole('switch')).not.toBeInTheDocument();
  });

  it('reads the registry’s plan refusal as the plan gate', () => {
    mocks.access = 'plan-not-entitled';
    renderWith(web, 'free');
    expect(pool()).toHaveTextContent('Warm pools are available on Hobby, Pro and Scale');
    expect(within(pool()).getByRole('link', { name: 'Compare plans' })).toBeInTheDocument();
  });

  it('shows the off state, read-only, when the capability is not enabled for the account', () => {
    mocks.access = 'off';
    renderWith({ ...web, warm_pool_size: 2 } as App, 'pro');
    expect(screen.getByRole('status')).toHaveTextContent('Not enabled for this account');
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(
      screen.getByText(/saved settings still apply: 2 copies are kept paused/i)
    ).toBeInTheDocument();
  });

  it('waits for the registry before offering anything to edit', () => {
    mocks.access = 'loading';
    mocks.maturity = undefined;
    renderWith(web, 'pro');
    expect(screen.getByText('Checking availability…')).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });

  it('names the plan gate and links plans when apid refuses on plan', async () => {
    spyApi('PATCH').mockResolvedValue(
      refused(
        403,
        'plan_warm_pool_not_allowed',
        'Free tier does not support per-app warm pools; upgrade to Hobby or higher.'
      )
    );
    const user = userEvent.setup();
    renderWith(web, 'hobby');
    const size = within(pool()).getByLabelText('Ready-to-wake copies');
    await user.clear(size);
    await user.type(size, '1');
    await user.click(screen.getByRole('button', { name: 'Save warm settings' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/upgrade to Hobby or higher/);
    expect(screen.getByText('plan_warm_pool_not_allowed')).toBeInTheDocument();
    expect(
      within(alert.parentElement as HTMLElement).getByRole('link', { name: 'Compare plans' })
    ).toBeInTheDocument();
  });

  it('rereads availability when apid says the capability is not released', async () => {
    spyApi('PATCH').mockResolvedValue(
      refused(
        403,
        'capability_not_released',
        'app.warm_pool_size needs the Warm pool capability, which is not available to this account; remove it or contact support for access.'
      )
    );
    const user = userEvent.setup();
    renderWith(web, 'pro');
    await user.type(within(pool()).getByLabelText('Ready-to-wake copies'), '1');
    await user.click(screen.getByRole('button', { name: 'Save warm settings' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/not available to this account/);
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('reports how many paused instances are ready against the size asked for', async () => {
    spyApi('GET').mockResolvedValue(
      accepted([
        { id: 'i1', state: 'warm', resident: true },
        { id: 'i2', state: 'running', resident: true },
      ])
    );
    renderWith({ ...web, warm_pool_size: 2 } as App, 'pro');
    expect(await within(pool()).findByText('1 of 2 paused now')).toBeInTheDocument();
  });

  it('says why a pool can be empty, naming the organization’s spend cap in a company workspace', async () => {
    mocks.workspace = { org: 'acme', label: 'Acme Inc', ready: true };
    const user = userEvent.setup();
    renderWith({ ...web, warm_pool_size: 2 } as App, 'pro');
    expect(await within(pool()).findByText('0 of 2 paused now')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'About Ready-to-wake copies' }));
    expect(await screen.findByText(/Acme Inc reaches its/)).toHaveTextContent(
      /capped by its organization/
    );
  });

  it('names the account’s own spend cap in the personal workspace, behind the tip', async () => {
    const user = userEvent.setup();
    renderWith(web, 'pro');
    expect(pool()).not.toHaveTextContent(/spend cap/i);
    await user.click(screen.getByRole('button', { name: 'About Ready-to-wake copies' }));
    expect(await screen.findByText(/your account reaches its/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'spend cap' })).toHaveAttribute(
      'href',
      '/dashboard/usage'
    );
  });

  it('says a before_checkpoint hook keeps warm snapshots from being captured', () => {
    renderWith(
      {
        ...web,
        manifest: { ...web.manifest, before_checkpoint: { path: '/flush' } },
      } as unknown as App,
      'pro'
    );
    expect(within(snapshots()).getByRole('note')).toHaveTextContent(
      /none is taken while the app has a before-snapshot hook \(before_checkpoint\)/i
    );
    expect(
      screen.getByText(/none are taken while a before-snapshot hook is set/i)
    ).toBeInTheDocument();
  });

  it('explains that workers and jobs keep no pool and take no warm snapshots', () => {
    renderWith(
      {
        ...web,
        manifest: { entrypoint: ['node', 'worker.js'], execution_mode: 'worker' },
      } as unknown as App,
      'pro'
    );
    expect(screen.getByText(/this app runs in worker mode/i)).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });
});
