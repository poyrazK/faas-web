import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectScope } from '@/lib/project-scope';

const m = vi.hoisted(() => ({
  scope: null as unknown as ProjectScope,
  env: {
    applies: true,
    environment: 'production',
    name: 'Production',
    protected: false,
    listLoaded: true,
  },
  create: vi.fn(),
}));
vi.mock('@/lib/environment-scope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/environment-scope')>()),
  useEnvironmentScope: () => ({
    applies: m.env.applies,
    environment: m.env.environment,
    name: m.env.name,
    kind: m.env.environment === 'production' ? 'production' : 'stage',
    available: true,
    choices: m.env.listLoaded
      ? [
          { id: 'p', slug: 'production', protected: true },
          { id: 's', slug: m.env.environment, protected: m.env.protected },
        ]
      : null,
    list: { isPending: false, isError: false, refetch: vi.fn() },
  }),
}));
vi.mock('@/lib/project-scope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/project-scope')>()),
  useProjectScope: () => m.scope,
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));

const apps = [
  { id: 'a1', slug: 'api-gateway' },
  { id: 'a2', slug: 'nightly-etl' },
];
const cron = (id: string, app_id: string, path: string, environment?: string) => ({
  id,
  app_id,
  schedule: '0 * * * *',
  path,
  timezone: 'UTC',
  enabled: true,
  ...(environment ? { environment } : {}),
});
const trigger = (id: string, app_id: string, slug: string) => ({
  id,
  app_id,
  slug,
  kind: 'queue',
  enabled: true,
  batch_size_max: 10,
  batch_window_ms: 100,
  max_attempts: 3,
});
vi.mock('@/lib/api/queries', () => ({
  useApps: () => ({ data: apps, isPending: false, error: null, refetch: vi.fn() }),
  useCrons: () => ({
    data: [
      cron('c1', 'a1', '/prod-tick'),
      cron('c2', 'a1', '/explicit-prod-tick', 'production'),
      cron('c3', 'a1', '/staging-tick', 'staging'),
    ],
    isPending: false,
    error: null,
    refetch: vi.fn(),
  }),
  useCreateCron: () => ({ mutateAsync: m.create, isPending: false }),
  useRunCron: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteCron: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateCron: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCronRuns: () => ({ data: { runs: [] }, isPending: false, error: null }),
  useFireNowRequest: () => ({ data: undefined }),
  useTriggers: () => ({
    data: [trigger('t1', 'a1', 'gateway-events'), trigger('t2', 'a2', 'etl-events')],
    isPending: false,
    error: null,
    refetch: vi.fn(),
  }),
  useSetTriggerEnabled: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useTriggerMetrics: () => ({ data: undefined, isPending: true, error: null }),
}));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ account: { id: 'acct', limits: { triggers_allowed: true } } }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/components/dashboard/trigger-records', () => ({ TriggerRecords: () => null }));
vi.mock('@/components/dashboard/trigger-dlq', () => ({ TriggerDeadLetter: () => null }));
vi.mock('@/components/dashboard/trigger-detail', () => ({ TriggerConfiguration: () => null }));

const { ScheduledRequestsBody, cronInEnvironment } = await import('./jobs-scheduled');

const inProject: ProjectScope = {
  project: 'acme-shop',
  label: 'acme-shop',
  appSlugs: new Set(['api-gateway', 'nightly-etl']),
  settled: true,
  choices: [],
};
const Scheduled = () => <ScheduledRequestsBody search={{}} onSelection={vi.fn()} />;
const inStaging = (protectedStage = false, listLoaded = true) => {
  m.env = {
    applies: true,
    environment: 'staging',
    name: 'Staging',
    protected: protectedStage,
    listLoaded,
  };
};
/** Every write control the page draws for a cron row or in its header. */
const writeControls = () => [
  ...screen.queryAllByRole('button', { name: 'New scheduled request' }),
  ...screen.queryAllByRole('button', { name: /^Edit scheduled request / }),
  ...screen.queryAllByRole('button', { name: /^Run .* now$/ }),
  ...screen.queryAllByRole('button', { name: /^Delete cron / }),
  ...screen.queryAllByRole('switch'),
];
beforeEach(() => {
  m.scope = inProject;
  m.env = {
    applies: true,
    environment: 'production',
    name: 'Production',
    protected: false,
    listLoaded: true,
  };
  m.create.mockReset().mockResolvedValue({ schedule: '0 3 * * *', path: '/' });
});

describe('cronInEnvironment', () => {
  it('counts a cron with no environment, or production, as production', () => {
    expect(cronInEnvironment({}, 'production')).toBe(true);
    expect(cronInEnvironment({ environment: 'production' }, 'production')).toBe(true);
    expect(cronInEnvironment({ environment: 'staging' }, 'production')).toBe(false);
    expect(cronInEnvironment({ environment: 'staging' }, 'staging')).toBe(true);
    expect(cronInEnvironment({}, 'staging')).toBe(false);
  });
});

describe('Scheduled requests follow the environment', () => {
  it('production lists only production crons', () => {
    render(<Scheduled />);
    expect(screen.getByText('/prod-tick')).toBeInTheDocument();
    expect(screen.getByText('/explicit-prod-tick')).toBeInTheDocument();
    expect(screen.queryByText('/staging-tick')).toBeNull();
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('Staging lists only Staging’s crons and says so', () => {
    inStaging();
    render(<Scheduled />);
    expect(screen.getByText('/staging-tick')).toBeInTheDocument();
    expect(screen.queryByText('/prod-tick')).toBeNull();
    expect(screen.getByRole('note')).toHaveTextContent('Showing Staging’s scheduled requests.');
  });

  it('creating in Staging sends environment: staging', async () => {
    inStaging();
    render(<Scheduled />);
    await userEvent.click(screen.getAllByRole('button', { name: 'New scheduled request' })[0]);
    const dialog = within(screen.getByRole('dialog', { name: 'New scheduled request' }));
    await userEvent.type(dialog.getByRole('textbox', { name: 'Schedule' }), '0 3 * * *');
    await userEvent.click(dialog.getByRole('button', { name: 'Create scheduled request' }));
    await waitFor(() =>
      expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ environment: 'staging' }))
    );
  });

  it('production creates without an environment, as before', async () => {
    render(<Scheduled />);
    await userEvent.click(screen.getAllByRole('button', { name: 'New scheduled request' })[0]);
    const dialog = within(screen.getByRole('dialog', { name: 'New scheduled request' }));
    await userEvent.type(dialog.getByRole('textbox', { name: 'Schedule' }), '0 3 * * *');
    await userEvent.click(dialog.getByRole('button', { name: 'Create scheduled request' }));
    await waitFor(() => expect(m.create).toHaveBeenCalled());
    expect(m.create.mock.calls[0][0]).not.toHaveProperty('environment');
  });

  it('a protected stage shows crons without write controls', () => {
    inStaging(true);
    render(<Scheduled />);
    expect(screen.getByText('/staging-tick')).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(
      'Staging is protected: changes go through a promotion.'
    );
    expect(writeControls()).toEqual([]);
  });

  it('stays read-only until the environment list says Staging isn’t protected', () => {
    inStaging(false, false);
    render(<Scheduled />);
    expect(screen.getByText('/staging-tick')).toBeInTheDocument();
    expect(writeControls()).toEqual([]);
  });

  it('a Staging the list says is unprotected is editable', () => {
    inStaging();
    render(<Scheduled />);
    expect(screen.getAllByRole('button', { name: /^Run .* now$/ }).length).toBeGreaterThan(0);
  });
});

describe('an open dialog follows the lock and the environment', () => {
  it('closes the create dialog when the stage turns protected, and creates nothing', async () => {
    inStaging();
    const view = render(<Scheduled />);
    await userEvent.click(screen.getAllByRole('button', { name: 'New scheduled request' })[0]);
    expect(screen.getByRole('dialog', { name: 'New scheduled request' })).toBeInTheDocument();
    inStaging(true);
    view.rerender(<Scheduled />);
    expect(screen.queryByRole('dialog', { name: 'New scheduled request' })).toBeNull();
    expect(m.create).not.toHaveBeenCalled();
  });

  it('closes the create dialog when the top bar switches environment', async () => {
    inStaging();
    const view = render(<Scheduled />);
    await userEvent.click(screen.getAllByRole('button', { name: 'New scheduled request' })[0]);
    m.env = { applies: true, environment: 'qa', name: 'Qa', protected: false, listLoaded: true };
    view.rerender(<Scheduled />);
    expect(screen.queryByRole('dialog', { name: 'New scheduled request' })).toBeNull();
  });

  it('closes the edit dialog when the stage turns protected', async () => {
    inStaging();
    const view = render(<Scheduled />);
    await userEvent.click(screen.getByRole('button', { name: /^Edit scheduled request / }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    inStaging(true);
    view.rerender(<Scheduled />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
