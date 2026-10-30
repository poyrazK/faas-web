import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route as NewAppRoute } from './dashboard.apps.new';
import { Route as TemplatesRoute } from './dashboard.templates';
import { Route as ImportRoute } from './dashboard.import';
import type { ProjectPlan } from '@/lib/api/queries';

const mocks = vi.hoisted(() => ({
  workspace: { org: null as string | null, label: 'Personal' },
  create: vi.fn(),
  bind: vi.fn(),
  deploy: vi.fn(),
  scan: vi.fn(),
  apply: vi.fn(),
  toast: vi.fn(),
  templateRead: 'ready',
  templateRetry: vi.fn(),
  sourceScan: { plan: undefined, error: null, scanning: false } as {
    plan?: ProjectPlan;
    error: unknown;
    scanning: boolean;
  },
}));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    loading: false,
    account: {
      plan: 'hobby',
      app_count: 0,
      github_install_id: '42',
      limits: { ram_mb: 512, deployed_apps: 10 },
    },
  }),
}));
vi.mock('@/lib/api/workspace-apps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/workspace-apps')>()),
  useWorkspaceTarget: () => mocks.workspace,
}));
vi.mock('@/lib/store', () => ({ useData: () => ({ addWorkflow: mocks.create }) }));
vi.mock('@/lib/api/capabilities', () => ({
  useCapability: () => ({ accountId: '', state: 'unavailable' }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/components/dashboard/repo-picker', () => ({
  // The real picker forwards id/name/form/ARIA to its control; so does this,
  // so label association is asserted through the wizard's own <label>.
  RepoPicker: ({
    onChange,
    className: _className,
    ...control
  }: {
    value: string;
    onChange: (value: string) => void;
    className?: string;
  }) => <input {...control} onChange={(event) => onChange(event.target.value)} />,
}));
vi.mock('@/lib/api/queries', () => ({
  useBindRepoFor: () => ({ mutateAsync: mocks.bind }),
  useDeployFromRefFor: () => ({ mutateAsync: mocks.deploy }),
  useUpdateAppFor: () => ({ mutateAsync: vi.fn() }),
  useSourceRefScan: () => mocks.sourceScan,
  useApps: () => ({ data: [] }),
  useTemplates: () => ({
    data:
      mocks.templateRead === 'ready'
        ? [{ name: 'hello-python', category: 'hello', description: 'A minimal Python server.' }]
        : [],
    isPending: false,
    error: mocks.templateRead === 'error' ? new Error('Template catalog offline') : null,
    refetch: mocks.templateRetry,
  }),
  useProjectScan: () => ({ mutateAsync: mocks.scan, isPending: false }),
  useProjectApply: () => ({ mutateAsync: mocks.apply, isPending: false }),
}));

const plan: ProjectPlan = {
  project_slug: 'sample',
  scan_source: 'compose',
  tier: 'hobby',
  workloads: [{ name: 'api', class: 'http', root_dir: '.', command: [], ports: [8080] }],
  managed: [],
  crons: [],
  observed_apps: 1,
  observed_crons: 0,
  limit_apps: 10,
  limit_crons: 10,
  can_apply: true,
  plan_token: 'scanned-plan-token',
};

async function mount(entry = '/dashboard/apps/new') {
  const root = createRootRoute({ component: Outlet });
  const dashboard = createRoute({
    getParentRoute: () => root,
    path: '/dashboard',
    component: Outlet,
  });
  const newApp = createRoute({
    getParentRoute: () => dashboard,
    path: 'apps/new',
    validateSearch: NewAppRoute.options.validateSearch,
    component: NewAppRoute.options.component,
  });
  const templates = createRoute({
    getParentRoute: () => dashboard,
    path: 'templates',
    validateSearch: TemplatesRoute.options.validateSearch,
    beforeLoad: (context) =>
      TemplatesRoute.options.beforeLoad?.(
        context as unknown as Parameters<NonNullable<typeof TemplatesRoute.options.beforeLoad>>[0]
      ),
  });
  const importer = createRoute({
    getParentRoute: () => dashboard,
    path: 'import',
    validateSearch: ImportRoute.options.validateSearch,
    beforeLoad: (context) =>
      ImportRoute.options.beforeLoad?.(
        context as unknown as Parameters<NonNullable<typeof ImportRoute.options.beforeLoad>>[0]
      ),
  });
  const router = createRouter({
    routeTree: root.addChildren([dashboard.addChildren([newApp, templates, importer])]),
    history: createMemoryHistory({ initialEntries: [entry] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  mocks.workspace = { org: null, label: 'Personal' };
  vi.clearAllMocks();
  mocks.templateRead = 'ready';
  mocks.sourceScan = { plan: undefined, error: null, scanning: false };
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  mocks.create.mockResolvedValue({ id: 'sample', url: 'https://sample.example' });
  mocks.scan.mockResolvedValue(plan);
  mocks.apply.mockResolvedValue({ apps: [{ slug: 'sample-api', id: 'app-id' }] });
});

describe('New App source flow', () => {
  it('continues to an empty app when the template catalog has no starters', async () => {
    mocks.templateRead = 'empty';
    const router = await mount('/dashboard/apps/new?source=template');
    await userEvent.click(screen.getByRole('button', { name: 'Continue with an empty app' }));
    expect(router.state.location.search.source).toBe('empty');
    expect(mocks.create).not.toHaveBeenCalled();
    // Empty needs no setup: choosing it lands on Configure directly.
    expect(await screen.findByRole('textbox', { name: /App name/ })).toBeInTheDocument();
  });
  it('preserves the template read failure and provides retry', async () => {
    mocks.templateRead = 'error';
    await mount('/dashboard/apps/new?source=template');
    expect(screen.getByRole('alert')).toHaveTextContent('Template catalog offline');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(mocks.templateRetry).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole('button', { name: 'Continue with an empty app' })
    ).not.toBeInTheDocument();
  });
  it('starts on Git when GitHub is connected and lets another source take over', async () => {
    const user = userEvent.setup();
    const router = await mount();
    expect(screen.getByRole('heading', { name: 'New app' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Git repository' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    for (const name of ['Empty app', 'Template', 'Import']) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false');
    }
    // Git's fields are on its own station: choosing its card goes there.
    await user.click(screen.getByRole('button', { name: 'Git repository' }));
    expect(await screen.findByLabelText('Repository')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByLabelText('Repository')).toHaveFocus();
    expect(screen.getByLabelText('Repository')).toHaveAccessibleDescription(
      'Choose a repository to deploy.'
    );
    expect(router.state.location.search.step).toBe('setup');
    await user.click(screen.getByRole('button', { name: 'Back to Sources' }));
    await user.click(await screen.findByRole('button', { name: /^Empty app/ }));
    expect(router.state.location.search).toMatchObject({ source: 'empty' });
    await user.type(await screen.findByLabelText('App name'), 'empty-demo');
    await user.click(screen.getByRole('button', { name: 'Review' }));
    await user.click(await screen.findByRole('button', { name: 'Create app' }));
    expect(await screen.findByText('App ready')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'https://sample.example' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open app' })).not.toBeInTheDocument();
    expect(mocks.create).toHaveBeenCalledWith({
      name: 'empty-demo',
      runtime: 'node22',
      memoryMb: 128,
      type: 'function',
      visibility: 'public',
      org: null,
    });
    expect(mocks.bind).not.toHaveBeenCalled();
    expect(mocks.deploy).not.toHaveBeenCalled();
  });

  it('names the shared workspace in review and creates the app in it', async () => {
    mocks.workspace = { org: 'acme-corp', label: 'Acme Corp' };
    const user = userEvent.setup();
    await mount('/dashboard/apps/new?source=empty');
    await user.click(screen.getByRole('button', { name: 'Empty app' }));
    await user.type(await screen.findByLabelText('App name'), 'team-api');
    await user.click(screen.getByRole('button', { name: 'Review' }));
    const workspace = (await screen.findByText('Workspace')).parentElement!;
    expect(workspace).toHaveTextContent('Acme Corp');
    expect(
      screen.getByText(/Created in Acme Corp, so it is listed in that workspace/)
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create app' }));
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'team-api', org: 'acme-corp' })
      )
    );
  });

  it('explains a workspace role that cannot create apps', async () => {
    mocks.workspace = { org: 'acme-corp', label: 'Acme Corp' };
    const { ApiError } = await import('@/lib/api/errors');
    mocks.create.mockRejectedValueOnce(
      new ApiError({ status: 403, code: 'org_role_forbidden', title: 'Forbidden' })
    );
    const user = userEvent.setup();
    await mount('/dashboard/apps/new?source=empty');
    await user.click(screen.getByRole('button', { name: 'Empty app' }));
    await user.type(await screen.findByLabelText('App name'), 'team-api');
    await user.click(screen.getByRole('button', { name: 'Review' }));
    await user.click(await screen.findByRole('button', { name: 'Create app' }));
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith({
        kind: 'error',
        title: 'Could not create the app',
        description: expect.stringMatching(/^Your role in Acme Corp cannot create apps/),
      })
    );
  });

  it('restores the selected source from a bookmark and browser Back/Forward without losing configuration', async () => {
    const user = userEvent.setup();
    const router = await mount('/dashboard/apps/new?source=empty');
    expect(screen.getByRole('button', { name: /^Empty app/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await user.click(screen.getByRole('button', { name: /^Empty app/ }));
    await user.type(await screen.findByLabelText('App name'), 'saved-draft');
    await act(async () => router.history.back());
    expect(await screen.findByRole('button', { name: /^Empty app/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await act(async () => router.history.forward());
    expect(await screen.findByLabelText('App name')).toHaveValue('saved-draft');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(await screen.findByRole('button', { name: /^Git repository/ }));
    expect(await screen.findByLabelText('Repository')).toBeInTheDocument();
    await act(async () => router.history.back());
    expect(await screen.findByRole('button', { name: /^Empty app/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it.each([
    ['hello-python', 'python313'],
    ['node-api', 'node24'],
  ])(
    'preserves direct template launches for %s through configuration, review and scaffold completion',
    async (slug, runtime) => {
      const user = userEvent.setup();
      await mount(`/dashboard/apps/new?template=${slug}`);
      // A template link lands on Template's own station.
      expect(screen.getByRole('region', { name: 'Template' })).toBeInTheDocument();
      await user.click(await screen.findByRole('button', { name: 'Continue' }));
      expect(await screen.findByLabelText('App name')).toHaveValue(slug);
      expect(screen.getByLabelText('Runtime')).toHaveValue(runtime);
      await user.click(screen.getByRole('button', { name: 'Review' }));
      expect(await screen.findByText(slug)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Create app' }));
      expect(await screen.findByText(/scaffold$/)).toBeInTheDocument();
      expect(mocks.deploy).not.toHaveBeenCalled();
    }
  );

  it('normalizes an incomplete restored review URL and waits for explicit Review after editing or browser Back', async () => {
    const user = userEvent.setup();
    const router = await mount('/dashboard/apps/new?source=empty&step=review');
    await user.type(await screen.findByLabelText('App name'), 'restored-app');
    expect(screen.getByLabelText('App name')).toHaveValue('restored-app');
    expect(router.state.location.search).toMatchObject({ source: 'empty', step: 'configure' });
    expect(screen.queryByRole('button', { name: 'Create app' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Review' }));
    expect(await screen.findByRole('button', { name: 'Create app' })).toBeInTheDocument();
    await act(async () => router.history.back());
    await user.type(await screen.findByLabelText('App name'), '-edited');
    expect(screen.getByLabelText('App name')).toHaveValue('restored-app-edited');
    expect(router.state.location.search.step).toBe('configure');
    expect(screen.queryByRole('button', { name: 'Create app' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Review' }));
    expect(await screen.findByRole('button', { name: 'Create app' })).toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('selects a catalog template in place and allows returning to choose another source', async () => {
    const user = userEvent.setup();
    const router = await mount();
    await user.click(screen.getByRole('button', { name: /^Template/ }));
    // Template's own station: the catalog is the way on, so no Continue yet.
    expect(router.state.location.search.step).toBe('setup');
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'hello-python' }));
    expect(router.state.location.pathname).toBe('/dashboard/apps/new');
    expect(router.state.location.search).toMatchObject({
      source: 'template',
      template: 'hello-python',
    });
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByLabelText('App name')).toHaveValue('hello-python');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(await screen.findByRole('button', { name: 'Back to Sources' }));
    await user.click(await screen.findByRole('button', { name: /^Empty app/ }));
    expect(router.state.location.search.template).toBeUndefined();
    // Empty needs no setup: choosing it lands on Configure directly.
    expect(await screen.findByLabelText('App name')).toHaveValue('');
  });

  it('keeps the created app scaffold tied to its submitted template after browser Back', async () => {
    const user = userEvent.setup();
    const router = await mount('/dashboard/apps/new?source=template');
    await user.click(screen.getByRole('button', { name: 'hello-python' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(await screen.findByRole('button', { name: 'Review' }));
    await user.click(await screen.findByRole('button', { name: 'Create app' }));
    expect(await screen.findByText('hello-python scaffold')).toBeInTheDocument();
    await act(async () => router.history.go(-3));
    expect(screen.getByText('hello-python scaffold')).toBeInTheDocument();
    expect(
      screen.getByText(/gregale init --template hello-python && gregale deploy --app hello-python/)
    ).toBeInTheDocument();
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it('hands a multi-service repository to Import with its project slug and branch', async () => {
    const user = userEvent.setup();
    const router = await mount();
    mocks.sourceScan = {
      plan: { ...plan, workloads: [...plan.workloads, { ...plan.workloads[0], name: 'worker' }] },
      error: null,
      scanning: false,
    };
    // Git's fields are on its own station: choosing its card goes there.
    await user.click(screen.getByRole('button', { name: 'Git repository' }));
    await user.type(await screen.findByLabelText('Repository'), 'acme/Checkout_Service');
    await user.clear(screen.getByLabelText('Ref'));
    await user.type(screen.getByLabelText('Ref'), 'develop');
    await user.click(screen.getByRole('button', { name: 'Import as a project' }));
    expect(router.state.location.search).toMatchObject({
      source: 'import',
      slug: 'checkout-service',
      branch: 'develop',
    });
    expect(screen.getByLabelText('Project slug')).toHaveValue('checkout-service');
    expect(screen.getByLabelText('Branch')).toHaveValue('develop');
  });

  it('scans, reviews and applies an import within New App using the existing project endpoint contract', async () => {
    const user = userEvent.setup();
    const router = await mount('/dashboard/apps/new?source=import&slug=sample&branch=develop');
    // Import's own station.
    expect(screen.getByRole('region', { name: 'Import' })).toBeInTheDocument();
    expect(screen.getByLabelText('Project slug')).toHaveValue('sample');
    expect(screen.getByLabelText('Branch')).toHaveValue('develop');
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
    const file = new File(['tarball'], 'repo.tar.gz', { type: 'application/gzip' });
    await user.upload(screen.getByLabelText('Choose a .tar.gz'), file);
    await user.click(screen.getByRole('button', { name: 'Scan' }));
    expect(await screen.findByText('Plan — sample')).toBeInTheDocument();
    expect(mocks.apply).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Apply plan' }));
    expect(await screen.findByRole('link', { name: 'sample-api' })).toHaveAttribute(
      'href',
      '/dashboard/apps/sample-api'
    );
    expect(mocks.scan).toHaveBeenCalledWith({ file, slug: 'sample', branch: 'develop' });
    expect(mocks.apply).toHaveBeenCalledWith({
      file,
      slug: 'sample',
      branch: 'develop',
      planToken: 'scanned-plan-token',
    });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.deploy).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe('/dashboard/apps/new');
  });

  it.each(['Project slug', 'Branch'])(
    'requires a fresh import scan after changing %s',
    async (field) => {
      const user = userEvent.setup();
      await mount('/dashboard/apps/new?source=import');
      await user.upload(
        screen.getByLabelText('Choose a .tar.gz'),
        new File(['tarball'], 'repo.tar.gz', { type: 'application/gzip' })
      );
      await user.click(screen.getByRole('button', { name: 'Scan' }));
      expect(await screen.findByRole('button', { name: 'Apply plan' })).toBeEnabled();
      await user.type(screen.getByLabelText(field), 'different');
      expect(screen.queryByRole('button', { name: 'Apply plan' })).not.toBeInTheDocument();
      expect(mocks.apply).not.toHaveBeenCalled();
    }
  );

  it('retains an import draft when switching sources and returning with browser Back', async () => {
    const user = userEvent.setup();
    const router = await mount('/dashboard/apps/new?source=import');
    await user.upload(
      screen.getByLabelText('Choose a .tar.gz'),
      new File(['tarball'], 'repo.tar.gz', { type: 'application/gzip' })
    );
    await user.type(screen.getByLabelText('Project slug'), 'draft');
    await user.click(screen.getByRole('button', { name: 'Back to Sources' }));
    await user.click(await screen.findByRole('button', { name: /^Empty app/ }));
    // Back over "Empty app" and "back to Sources" returns to Import's station.
    await act(async () => router.history.go(-2));
    expect(await screen.findByText('repo.tar.gz')).toBeVisible();
    expect(screen.getByLabelText('Project slug')).toHaveValue('draft');
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it('guards an uploaded import draft when leaving New App', async () => {
    const user = userEvent.setup();
    const router = await mount('/dashboard/apps/new?source=import');
    await user.upload(
      screen.getByLabelText('Choose a .tar.gz'),
      new File(['tarball'], 'repo.tar.gz', { type: 'application/gzip' })
    );
    await user.click(screen.getByRole('link', { name: 'All apps' }));
    expect(window.confirm).toHaveBeenCalledWith('Discard unsaved changes?');
    expect(router.state.location.pathname).toBe('/dashboard/apps/new');
  });

  it('retains the uploaded import and scanned plan through a failed submission from another source', async () => {
    const user = userEvent.setup();
    let rejectCreate!: (error: Error) => void;
    mocks.create.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectCreate = reject;
      })
    );
    await mount('/dashboard/apps/new?source=import');
    const file = new File(['tarball'], 'repo.tar.gz', { type: 'application/gzip' });
    await user.upload(screen.getByLabelText('Choose a .tar.gz'), file);
    await user.type(screen.getByLabelText('Project slug'), 'sample');
    await user.clear(screen.getByLabelText('Branch'));
    await user.type(screen.getByLabelText('Branch'), 'feature/import');
    await user.click(screen.getByRole('button', { name: 'Scan' }));
    expect(await screen.findByRole('button', { name: 'Apply plan' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Back to Sources' }));
    // Empty needs no setup: choosing it lands on Configure directly.
    await user.click(await screen.findByRole('button', { name: /^Empty app/ }));
    await user.type(await screen.findByLabelText('App name'), 'empty-attempt');
    await user.click(screen.getByRole('button', { name: 'Review' }));
    await user.click(await screen.findByRole('button', { name: 'Create app' }));
    expect(
      await screen.findByText('Track the app and its first deployment from the platform state.')
    ).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Creating app' })).toBeVisible();
    expect(screen.queryByText('App ready')).not.toBeInTheDocument();
    await act(async () => rejectCreate(new Error('Creation unavailable')));
    expect(await screen.findByRole('button', { name: 'Create app' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByLabelText('App name');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(await screen.findByRole('button', { name: /^Import/ }));
    expect(await screen.findByText('repo.tar.gz')).toBeVisible();
    expect(screen.getByLabelText('Project slug')).toHaveValue('sample');
    expect(screen.getByLabelText('Branch')).toHaveValue('feature/import');
    expect(screen.getByRole('button', { name: 'Apply plan' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Apply plan' }));
    expect(await screen.findByRole('link', { name: 'sample-api' })).toBeInTheDocument();
    expect(mocks.scan).toHaveBeenCalledTimes(1);
    expect(mocks.apply).toHaveBeenCalledWith({
      file,
      slug: 'sample',
      branch: 'feature/import',
      planToken: 'scanned-plan-token',
    });
  });

  it.each([
    [
      '/dashboard/templates?template=hello-python#catalog',
      'template',
      { template: 'hello-python' },
      '#catalog',
    ],
    [
      '/dashboard/import?slug=sample&branch=develop',
      'import',
      { slug: 'sample', branch: 'develop' },
      '',
    ],
  ])(
    'redirects legacy bookmark %s into the selected source while preserving applicable state',
    async (entry, source, search, hash) => {
      const router = await mount(entry);
      await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard/apps/new'));
      expect(router.state.location.search).toMatchObject({ source, ...search });
      expect(router.state.location.hash).toBe(hash.replace(/^#/, ''));
      expect(screen.getByRole('heading', { name: 'New app' })).toBeInTheDocument();
    }
  );
});
