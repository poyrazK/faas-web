import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route as Releases } from './dashboard.deployments';
import { Route as Builds } from './dashboard.builds';
import { Route as App } from './dashboard.workflows.$workflowId';

const fixtures = vi.hoisted(() => ({
  omitBuildFromHistory: false,
  deploymentRead: 'ready',
  rowCount: 1,
  appMissing: false,
  deployment: {
    id: 'dep-1',
    app_id: 'app-1',
    image_digest: 'sha256:aaaa',
    kind: 'github',
    status: 'failed',
    build_id: 'build-1',
    created_at: '2026-09-11T00:00:00Z',
    rollback_on_5xx: false,
    first_5xx_count: 0,
    min_instances: 0,
    traffic_percent: 0,
  },
  build: {
    id: 'build-1',
    deployment_id: 'dep-1',
    kind: 'github',
    source_bytes: 2048,
    status: 'failed',
    failure_class: 'oom',
    duration_seconds: 42,
    enqueued_at: '2026-09-11T00:00:00Z',
  },
  orphan: {
    id: 'build-only',
    deployment_id: '',
    kind: 'tarball',
    source_bytes: 4096,
    status: 'succeeded',
    duration_seconds: 0,
    enqueued_at: '2026-09-11T01:00:00Z',
  },
  retry: vi.fn(),
  min: vi.fn(),
  traffic: vi.fn(),
  sbom: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: fixtures.toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { plan: 'pro' }, loading: false }) }));
vi.mock('@/lib/store', () => ({
  useData: () => ({
    getWorkflow: () =>
      fixtures.appMissing
        ? undefined
        : {
            id: 'alpha',
            name: 'alpha',
            runtime: 'node',
            memoryMb: 256,
            state: 'running',
          },
    redeploy: vi.fn(),
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));
vi.mock('@/components/dashboard/tarball-deploy', () => ({ TarballDeploy: () => null }));
vi.mock('@/lib/api/queries', async (original) => {
  const actual = await original<object>();
  const ok = (data: unknown) => ({ data, isPending: false, error: null, refetch: vi.fn() });
  const mutation = (mutateAsync = vi.fn()) => ({ mutateAsync, isPending: false });
  const pages = (items: unknown[]) => ({
    ...ok({ pages: [{ items }] }),
    hasNextPage: false,
    fetchNextPage: vi.fn(),
    isFetchingNextPage: false,
  });
  return {
    ...actual,
    useApps: () => ok([{ id: 'app-1', slug: 'alpha' }]),
    useApp: () => ok({ id: 'app-1', slug: 'alpha' }),
    useInfiniteDeployments: () =>
      pages(
        Array.from({ length: fixtures.rowCount }, (_, i) => ({
          ...fixtures.deployment,
          id: i === 0 ? fixtures.deployment.id : `dep-${i + 1}`,
        }))
      ),
    useAppDeployments: () => pages([fixtures.deployment]),
    useBuilds: () => ok({ items: [fixtures.build, fixtures.orphan] }),
    useInfiniteBuilds: () =>
      pages(fixtures.omitBuildFromHistory ? [fixtures.orphan] : [fixtures.build, fixtures.orphan]),
    useBuildRecords: () => [ok(fixtures.build)],
    useBuild: (id: string) =>
      ok(id === 'build-only' ? fixtures.orphan : id ? fixtures.build : undefined),
    useDeployment: (id: string) =>
      fixtures.deploymentRead === 'ready'
        ? ok(id ? fixtures.deployment : undefined)
        : {
            ...ok(undefined),
            isPending: fixtures.deploymentRead === 'pending',
            error: fixtures.deploymentRead === 'error' ? new Error('Deployment read failed') : null,
          },
    useBuildProvenance: () => ok({ commit_sha: 'abcdef0123456789', buildkit_version: 'v0.20' }),
    useDeploymentScan: () =>
      ok({
        status: 'complete',
        vulnerabilities: [
          {
            id: 'CVE-2026-1234',
            severity: 'HIGH',
            package: 'openssl',
            version: '1',
            fixed_in: '2',
          },
        ],
      }),
    useDeploymentSecretScan: () =>
      ok({
        status: 'complete_with_redactions',
        findings: [
          { severity: 'high', provider: 'test', file: '/app/config', line: 4, key: 'redacted' },
        ],
      }),
    useDeploymentStages: () =>
      ok({
        history: [
          { name: 'image_build', status: 'failed', duration_ms: 42000, reason: 'memory limit' },
        ],
      }),
    useDeploymentAudit: () =>
      ok({
        items: [
          { kind: 'deploy.created', actor: 'operator@example.test', at: '2026-09-11T00:00:00Z' },
        ],
        limit: 50,
      }),
    useDeploymentPreviewUrl: () => ok({ url: '' }),
    useDeploymentSummary: () =>
      ok({ deployment: fixtures.deployment, previous: null, changes: [] }),
    useAppMetrics: () => ok(undefined),
    useCompareDeployments: () => ({ ...mutation(), reset: vi.fn() }),
    useDebugRequestEvidence: () => ({ ...ok(undefined), isPending: true }),
    useRetryDeployment: () => mutation(fixtures.retry),
    useUpdateDeploymentMinInstances: () => mutation(fixtures.min),
    useUpdateDeploymentTraffic: () => mutation(fixtures.traffic),
    useFetchBuildSbom: () => mutation(fixtures.sbom),
  };
});

class Stream {
  static instances: Stream[] = [];
  listeners = new Map<string, (event: MessageEvent) => void>();
  close = vi.fn();
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    Stream.instances.push(this);
  }
  addEventListener(name: string, handler: (event: MessageEvent) => void) {
    this.listeners.set(name, handler);
  }
  emit(name: string, data: string) {
    this.listeners.get(name)?.(new MessageEvent(name, { data }));
  }
}

async function mount(entry = '/dashboard/deployments') {
  const root = createRootRoute({ component: Outlet });
  const dashboard = createRoute({
    getParentRoute: () => root,
    path: 'dashboard',
    component: Outlet,
  });
  const routes = [Releases, Builds, App].map((route, i) =>
    createRoute({
      getParentRoute: () => dashboard,
      path: ['deployments', 'builds', 'workflows/$workflowId'][i],
      component: route.options.component,
      validateSearch: route.options.validateSearch,
      beforeLoad: (context) => route.options.beforeLoad?.(context as never),
    })
  );
  const router = createRouter({
    routeTree: root.addChildren([dashboard.addChildren(routes)]),
    history: createMemoryHistory({ initialEntries: [entry] }),
  });
  await router.load();
  await act(async () => {
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RouterProvider router={router} />
      </QueryClientProvider>
    );
  });
  return router;
}

beforeEach(() => {
  fixtures.omitBuildFromHistory = false;
  fixtures.deploymentRead = 'ready';
  fixtures.rowCount = 1;
  fixtures.appMissing = false;
  fixtures.orphan.deployment_id = '';
  fixtures.build.status = 'failed';
  fixtures.deployment.id = 'dep-1';
  fixtures.deployment.image_digest = 'sha256:aaaa';
  Stream.instances = [];
  vi.stubGlobal('EventSource', Stream);
  fixtures.retry.mockReset().mockResolvedValue({ id: 'retry-1' });
  fixtures.min.mockReset().mockResolvedValue({});
  fixtures.traffic.mockReset().mockResolvedValue({});
  fixtures.sbom.mockReset().mockResolvedValue({ bomFormat: 'CycloneDX' });
});

afterEach(() => vi.restoreAllMocks());

describe('Releases hub', () => {
  it('shortens list identifiers but keeps full IDs and digests searchable and readable in detail', async () => {
    fixtures.deployment.id = '0123456789abcdef0123456789abcdef';
    fixtures.deployment.image_digest = `sha256:${'a'.repeat(64)}`;
    const router = await mount(`/dashboard/deployments?q=${fixtures.deployment.image_digest}`);
    const row = screen.getByRole('button', { name: /01234567…cdef/ });
    expect(row).not.toHaveTextContent(fixtures.deployment.image_digest);
    expect(within(row).getByTitle(fixtures.deployment.id)).toBeInTheDocument();
    await userEvent.clear(screen.getByRole('searchbox'));
    await userEvent.type(screen.getByRole('searchbox'), fixtures.deployment.id);
    await userEvent.click(screen.getByRole('button', { name: /01234567…cdef/ }));
    expect(router.state.location.search).toMatchObject({ deployment: fixtures.deployment.id });
    const details = await screen.findByRole('region', { name: 'Release details' });
    expect(
      within(details).getByText(fixtures.deployment.id, { selector: 'dd' })
    ).toBeInTheDocument();
    expect(
      within(details).getByText(fixtures.deployment.image_digest, { selector: 'dd' })
    ).not.toHaveClass('truncate');
  });

  it('offers actual status values and preserves unrelated URL state when filtering', async () => {
    const router = await mount('/dashboard/deployments?campaign=handoff#details');
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Status filter' }),
      'failed'
    );
    expect(router.state.location.search).toMatchObject({ status: 'failed', campaign: 'handoff' });
    expect(router.state.location.hash).toBe('details');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status filter' }), '');
    expect(router.state.location.search.status).toBeUndefined();
    expect(screen.getByRole('button', { name: /dep-1\b/ })).toBeInTheDocument();
  });

  it('names the active Builds view when filters match nothing', async () => {
    const router = await mount(
      '/dashboard/deployments?view=builds&status=missing&campaign=handoff#builds'
    );
    expect(screen.getByText('No builds match these filters.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(router.state.location.search).toMatchObject({ view: 'builds', campaign: 'handoff' });
    expect(router.state.location.search.status).toBeUndefined();
    expect(router.state.location.hash).toBe('builds');
  });
  it('uses App terminology when a selected app no longer exists', async () => {
    fixtures.appMissing = true;
    await mount('/dashboard/workflows/missing');
    expect(screen.getByRole('heading', { name: 'App not found' })).toBeInTheDocument();
    expect(screen.getByText('This app does not exist or has been deleted.')).toBeInTheDocument();
    expect(document.title).toContain('App not found');
  });
  it('offers choosing an app when there are no releases', async () => {
    fixtures.rowCount = 0;
    await mount();
    expect(screen.getByText('No releases yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Choose an app to deploy' })).toHaveAttribute(
      'href',
      '/dashboard/workflows'
    );
  });

  it('keeps deployment status and identity primary while preserving compact build facts', async () => {
    await mount();
    expect(screen.getAllByRole('columnheader')).toHaveLength(5);
    expect(screen.getByRole('table')).toHaveClass('table-fixed');
    expect(screen.getByRole('columnheader', { name: 'Build / source' })).toHaveClass(
      'hidden',
      'md:table-cell'
    );
    expect(screen.getByRole('columnheader', { name: 'Deployment state' })).not.toHaveClass(
      'hidden'
    );
  });

  it.each(['error', 'pending'])(
    'keeps selected build evidence and SBOM available while its deployment read is %s',
    async (state) => {
      fixtures.deploymentRead = state;
      fixtures.orphan.deployment_id = 'dep-1';
      const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      URL.createObjectURL = vi.fn().mockReturnValue('blob:sbom');
      URL.revokeObjectURL = vi.fn();
      await mount('/dashboard/deployments?view=builds&build=build-only');
      expect(await screen.findByText('Failure class')).toBeInTheDocument();
      expect(screen.getByText('4.0 KB', { selector: 'dd' })).toBeInTheDocument();
      expect(screen.queryByText(/No deployment is attached/)).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Runtime controls' }));
      expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
      if (state === 'error')
        expect(await screen.findByText('Deployment read failed')).toBeInTheDocument();
      else expect(await screen.findByText('Loading deployment…')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Provenance / SBOM' }));
      expect(await screen.findByText('v0.20')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Download SBOM' }));
      expect(fixtures.sbom).toHaveBeenCalledWith('build-only');
      expect(download).toHaveBeenCalled();
    }
  );

  it.each([
    ['/dashboard/deployments', 'pointer', 'release'],
    ['/dashboard/deployments?view=builds', 'keyboard', 'build'],
    ['/dashboard/workflows/alpha?tab=Deployments', 'keyboard', 'app release'],
  ])(
    'reveals and focuses %s detail for %s selection and restores focus on close/Back',
    async (entry, input, kind) => {
      fixtures.rowCount = 50;
      const reveal = vi.spyOn(Element.prototype, 'scrollIntoView');
      const router = await mount(entry);
      const row =
        kind === 'build'
          ? screen.getByRole('button', { name: /build-only/ })
          : kind === 'app release'
            ? screen.getByRole('button', { name: /image aaaa/ })
            : screen.getByRole('button', { name: /dep-1\b/ });
      const select = async () => {
        if (input === 'pointer') await userEvent.click(row);
        else {
          row.focus();
          await userEvent.keyboard('{Enter}');
        }
      };
      await select();
      const detail = await screen.findByRole('region', {
        name: kind === 'build' ? 'Build details' : 'Release details',
      });
      expect(detail).toHaveFocus();
      expect(reveal.mock.contexts).toContain(detail);
      await userEvent.click(within(detail).getByRole('button', { name: 'Close' }));
      await waitFor(() => expect(row).toHaveFocus());
      await select();
      await act(async () => router.history.back());
      await waitFor(() => expect(row).toHaveFocus());
      expect(screen.queryByRole('region', { name: /details/ })).not.toBeInTheDocument();
      await act(async () => router.history.forward());
      expect(await screen.findByRole('region', { name: /details/ })).toHaveFocus();
    }
  );

  it.each([
    ['failed', 'var(--status-critical)'],
    ['running', 'var(--status-warning)'],
    ['succeeded', 'var(--status-good)'],
  ])('distinguishes %s build status in the list and shared detail', async (status, color) => {
    fixtures.build.status = status;
    await mount('/dashboard/deployments');
    const row = screen.getByRole('button', { name: /dep-1\b/ });
    expect(within(row).getAllByText(status).at(-1)?.parentElement).toHaveStyle({ color });
    await userEvent.click(row);
    const details = await screen.findByRole('region', { name: 'Release details' });
    expect(within(details).getAllByText(status).at(-1)?.parentElement).toHaveStyle({ color });
    expect(within(details).getAllByText('failed')[0].parentElement).toHaveStyle({
      color: 'var(--status-critical)',
    });
  });
  it('resolves joined build evidence even when its record is outside the loaded build page', async () => {
    fixtures.omitBuildFromHistory = true;
    await mount();
    const row = screen.getByRole('button', { name: /dep-1\b/ });
    expect(row).toHaveTextContent('oom');
    expect(row).toHaveTextContent('42s');
    expect(within(row).getAllByText('failed')).toHaveLength(2);
  });
  it('joins deployment rows to their build status, duration, failure and source', async () => {
    await mount();
    expect(screen.getByRole('heading', { name: 'Releases' })).toBeInTheDocument();
    const row = screen.getByRole('button', { name: /dep-1\b/ });
    expect(row).toHaveTextContent('oom');
    expect(row).toHaveTextContent('42s');
    expect(row).toHaveTextContent('github');
    expect(within(row).getAllByText('failed')).toHaveLength(2);
  });

  it('keeps unattached builds discoverable with source size and zero duration', async () => {
    await mount();
    await userEvent.click(screen.getByRole('link', { name: 'Builds' }));
    const row = screen.getByRole('button', { name: /build-only/ });
    expect(row).toHaveTextContent('4.0 KB');
    expect(row).toHaveTextContent('0s');
    await userEvent.click(row);
    expect(await screen.findByRole('heading', { name: 'Build details' })).toBeInTheDocument();
    expect(screen.getByText(/No deployment is attached/)).toBeInTheDocument();
    expect(Stream.instances).toHaveLength(0);
  });

  it('redirects old Builds bookmarks with selected build, filters, other search and hash', async () => {
    const router = await mount(
      '/dashboard/builds?build=build-only&q=tarball&status=succeeded&campaign=handoff#output'
    );
    expect(router.state.location.pathname).toBe('/dashboard/deployments');
    expect(router.state.location.search).toMatchObject({
      view: 'builds',
      build: 'build-only',
      q: 'tarball',
      status: 'succeeded',
      campaign: 'handoff',
    });
    expect(router.state.location.hash).toBe('output');
    expect(await screen.findByRole('heading', { name: 'Build details' })).toBeInTheDocument();
  });

  it('restores selected detail and section after Back, Forward and a copied URL', async () => {
    const router = await mount('/dashboard/deployments?campaign=handoff#details');
    await userEvent.click(screen.getByRole('button', { name: /dep-1\b/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Security scans' }));
    expect(await screen.findByText('CVE-2026-1234')).toBeInTheDocument();
    expect(router.state.location.search).toMatchObject({
      deployment: 'dep-1',
      releaseSection: 'scans',
      campaign: 'handoff',
    });
    expect(router.state.location.hash).toBe('details');
    const copied = router.state.location.href;
    await act(async () => router.history.back());
    await waitFor(() => expect(screen.queryByText('CVE-2026-1234')).not.toBeInTheDocument());
    await act(async () => router.history.forward());
    expect(await screen.findByText('CVE-2026-1234')).toBeInTheDocument();
    cleanup();
    await mount(copied);
    expect(await screen.findByText('CVE-2026-1234')).toBeInTheDocument();
  });

  it.each([
    '/dashboard/deployments?deployment=dep-1',
    '/dashboard/workflows/alpha?tab=Deployments&deployment=dep-1',
  ])('uses shared release evidence and operational actions at %s', async (entry) => {
    const router = await mount(entry);
    expect(await screen.findByRole('heading', { name: 'Release details' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Build output' }));
    const stream = Stream.instances.at(-1)!;
    expect(stream.url).toContain('/v1/deployments/dep-1/logs');
    act(() => stream.emit('log', 'compiler output'));
    expect(await screen.findByText('compiler output')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Provenance / SBOM' }));
    expect(await screen.findByText('v0.20')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Security scans' }));
    expect(await screen.findByText('CVE-2026-1234')).toBeInTheDocument();
    expect(screen.getByText('/app/config:4')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Lifecycle' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Resume from' }), {
      target: { value: 'image_build' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Retry deployment' }));
    expect(fixtures.retry).toHaveBeenCalledWith({ id: 'dep-1', from_stage: 'image_build' });
    await userEvent.click(screen.getByRole('button', { name: 'Runtime controls' }));
    fireEvent.change(screen.getByRole('spinbutton', { name: /Minimum instances/ }), {
      target: { value: '2' },
    });
    await userEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]);
    expect(fixtures.min).toHaveBeenCalledWith({ id: 'dep-1', min_instances: 2 });
    fireEvent.change(screen.getByRole('spinbutton', { name: /Traffic weight/ }), {
      target: { value: '25' },
    });
    await userEvent.click(screen.getAllByRole('button', { name: 'Save' })[1]);
    expect(fixtures.traffic).toHaveBeenCalledWith({ id: 'dep-1', traffic_percent: 25 });
    await userEvent.click(screen.getByRole('button', { name: 'Audit context' }));
    expect(await screen.findByText('Audit timeline')).toBeInTheDocument();
    expect(screen.getByText('operator@example.test')).toBeInTheDocument();
    expect(router.state.location.search).toMatchObject({
      deployment: 'dep-1',
      releaseSection: 'audit',
    });
    if (entry.includes('workflows')) expect(router.state.location.search.tab).toBe('Deployments');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(stream.close).toHaveBeenCalled();
  });

  it('downloads SBOM for a successful build without requiring a deployment', async () => {
    vi.stubGlobal(
      'URL',
      Object.assign(URL, {
        createObjectURL: vi.fn().mockReturnValue('blob:sbom'),
        revokeObjectURL: vi.fn(),
      })
    );
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await mount('/dashboard/deployments?view=builds&build=build-only&releaseSection=provenance');
    await userEvent.click(await screen.findByRole('button', { name: 'Download SBOM' }));
    expect(fixtures.sbom).toHaveBeenCalledWith('build-only');
    expect(click).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:sbom');
    click.mockRestore();
  });

  it('normalizes invalid owned state without discarding valid selection or foreign search', async () => {
    const router = await mount(
      '/dashboard/deployments?deployment=dep-1&view=wrong&releaseSection=wrong&campaign=handoff'
    );
    expect(await screen.findByRole('heading', { name: 'Release details' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Overview' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(router.state.location.search).toMatchObject({
      deployment: 'dep-1',
      campaign: 'handoff',
    });
    expect(router.state.location.search.view).not.toBe('wrong');
    expect(router.state.location.search.releaseSection).not.toBe('wrong');
  });

  it('normalizes a deployment-only section on an unattached build while retaining its selection', async () => {
    const router = await mount(
      '/dashboard/deployments?view=builds&build=build-only&releaseSection=scans&campaign=handoff'
    );
    expect(await screen.findByText(/No deployment is attached/)).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.search.releaseSection).toBe('overview'));
    expect(router.state.location.search).toMatchObject({
      build: 'build-only',
      campaign: 'handoff',
    });
  });

  it('restores app release sections and selection through Back, Forward and refresh', async () => {
    const router = await mount('/dashboard/workflows/alpha?tab=Deployments#release');
    await userEvent.click(screen.getByRole('button', { name: /image aaaa/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Security scans' }));
    const copied = router.state.location.href;
    await act(async () => router.history.back());
    await waitFor(() => expect(screen.queryByText('CVE-2026-1234')).not.toBeInTheDocument());
    await act(async () => router.history.back());
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Release details' })).not.toBeInTheDocument()
    );
    await act(async () => router.history.forward());
    expect(await screen.findByRole('heading', { name: 'Release details' })).toBeInTheDocument();
    cleanup();
    await mount(copied);
    expect(await screen.findByText('CVE-2026-1234')).toBeInTheDocument();
    expect(copied).toContain('#release');
  });

  it('preserves Debugger investigation and unrelated state when selecting and closing app releases', async () => {
    const router = await mount(
      '/dashboard/workflows/alpha?tab=Deployments&debugView=compare&debugFilter=failed&debugWindow=6h&request=request-7&debugRoute=%2Fcheckout&campaign=handoff#evidence'
    );
    const investigation = {
      debugView: 'compare',
      debugFilter: 'failed',
      debugWindow: '6h',
      request: 'request-7',
      debugRoute: '/checkout',
      campaign: 'handoff',
    };
    await userEvent.click(screen.getByRole('button', { name: /image aaaa/ }));
    expect(router.state.location.search).toMatchObject({ ...investigation, deployment: 'dep-1' });
    await userEvent.click(await screen.findByRole('button', { name: 'Security scans' }));
    await userEvent.click(
      within(screen.getByRole('region', { name: 'Release details' })).getByRole('button', {
        name: 'Close',
      })
    );
    expect(router.state.location.search).toMatchObject(investigation);
    expect(router.state.location.search.deployment).toBeUndefined();
    expect(router.state.location.search.releaseSection).toBeUndefined();
    await userEvent.click(screen.getByRole('tab', { name: 'Debugger' }));
    expect(await screen.findByRole('dialog', { name: 'Request evidence' })).toBeInTheDocument();
    expect(router.state.location.search).toMatchObject(investigation);
    await act(async () => router.history.back());
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Deployments' })).toHaveAttribute(
        'aria-selected',
        'true'
      )
    );
    await act(async () => router.history.back());
    expect(await screen.findByText('CVE-2026-1234')).toBeInTheDocument();
    expect(router.state.location.search).toMatchObject({
      ...investigation,
      deployment: 'dep-1',
      releaseSection: 'scans',
    });
    expect(router.state.location.hash).toBe('evidence');
    const copied = router.state.location.href;
    cleanup();
    const restored = await mount(copied);
    expect(restored.state.location.search).toMatchObject(investigation);
    expect(await screen.findByText('CVE-2026-1234')).toBeInTheDocument();
  });

  it('clears an invalid app release section without losing the existing app tab and deployment', async () => {
    const router = await mount(
      '/dashboard/workflows/alpha?tab=Deployments&deployment=dep-1&releaseSection=wrong'
    );
    expect(await screen.findByRole('button', { name: 'Overview' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(router.state.location.search.releaseSection).toBeUndefined();
    expect(router.state.location.search).toMatchObject({ tab: 'Deployments', deployment: 'dep-1' });
  });
});
