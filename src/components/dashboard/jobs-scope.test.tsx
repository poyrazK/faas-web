import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectScope } from '@/lib/project-scope';

const m = vi.hoisted(() => ({ scope: null as unknown as ProjectScope }));
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
const cron = (id: string, app_id: string, path: string) => ({
  id,
  app_id,
  schedule: '0 * * * *',
  path,
  timezone: 'UTC',
  enabled: true,
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
    data: [cron('c1', 'a1', '/gateway-tick'), cron('c2', 'a2', '/etl-tick')],
    isPending: false,
    error: null,
    refetch: vi.fn(),
  }),
  useCreateCron: () => ({ mutateAsync: vi.fn(), isPending: false }),
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

const { ScheduledRequestsBody } = await import('./jobs-scheduled');
const { TriggersBody } = await import('./jobs-triggers');

const project = (slugs: string[] | null, settled = true): ProjectScope => ({
  project: 'acme-shop',
  label: 'acme-shop',
  appSlugs: slugs ? new Set(slugs) : null,
  settled,
  choices: [],
});
const noProject: ProjectScope = {
  project: null,
  label: '',
  appSlugs: null,
  settled: true,
  choices: [],
};
const Scheduled = () => <ScheduledRequestsBody search={{}} onSelection={vi.fn()} />;
const Triggers = () => <TriggersBody search={{}} onSelection={vi.fn()} />;

describe('Scheduled requests inside a project', () => {
  it('lists only the project’s schedules, and a new one can target only its apps', async () => {
    m.scope = project(['api-gateway']);
    render(<Scheduled />);
    expect(screen.getByText('/gateway-tick')).toBeInTheDocument();
    expect(screen.queryByText('/etl-tick')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'New scheduled request' }));
    const dialog = within(screen.getByRole('dialog', { name: 'New scheduled request' }));
    const targets = dialog.getAllByRole('option').map((option) => option.textContent);
    expect(targets).toContain('api-gateway');
    expect(targets).not.toContain('nightly-etl');
  });

  it('names the project when it has no schedules', () => {
    m.scope = project(['image-resize']);
    render(<Scheduled />);
    expect(screen.getByText('No scheduled requests in acme-shop yet.')).toBeInTheDocument();
  });

  it('shows the loading state, not every schedule, while membership loads', () => {
    m.scope = project(null, false);
    render(<Scheduled />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(screen.queryByText('/etl-tick')).toBeNull();
    expect(screen.queryByText(/No scheduled requests/)).toBeNull();
  });

  it('lists every schedule with no project chosen', () => {
    m.scope = noProject;
    render(<Scheduled />);
    expect(screen.getByText('/gateway-tick')).toBeInTheDocument();
    expect(screen.getByText('/etl-tick')).toBeInTheDocument();
  });
});

describe('Triggers inside a project', () => {
  it('lists only triggers that fire the project’s apps', () => {
    m.scope = project(['api-gateway']);
    render(<Triggers />);
    expect(screen.getByText('gateway-events')).toBeInTheDocument();
    expect(screen.queryByText('etl-events')).toBeNull();
  });

  it('names the project when it has no triggers', () => {
    m.scope = project(['image-resize']);
    render(<Triggers />);
    expect(screen.getByText('No triggers in acme-shop yet.')).toBeInTheDocument();
  });

  it('shows the loading state, not every trigger, while membership loads', () => {
    m.scope = project(null, false);
    render(<Triggers />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(screen.queryByText('etl-events')).toBeNull();
  });

  it('lists every trigger with no project chosen', () => {
    m.scope = noProject;
    render(<Triggers />);
    expect(screen.getByText('gateway-events')).toBeInTheDocument();
    expect(screen.getByText('etl-events')).toBeInTheDocument();
  });
});
