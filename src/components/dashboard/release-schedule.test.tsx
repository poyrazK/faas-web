import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import type { Deployment } from '@/lib/api/queries';
import type { ScheduledRelease } from '@/lib/api/scheduled-releases';
import type { ScopeGate } from './scope-gate';

const m = vi.hoisted(() => ({
  save: vi.fn(),
  cancel: vi.fn(),
  toast: vi.fn(),
  confirm: vi.fn(),
  schedule: null as ScheduledRelease | null,
  list: [] as ScheduledRelease[],
}));

vi.mock('@/lib/api/scheduled-releases', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/scheduled-releases')>()),
  useDeploymentSchedule: () => ({
    data: m.schedule,
    error: null,
    isPending: false,
    refetch: vi.fn(),
  }),
  useScheduledReleases: () => ({ data: m.list, error: null, isPending: false, refetch: vi.fn() }),
  useScheduleRelease: () => ({ mutateAsync: m.save, isPending: false }),
  useCancelSchedule: () => ({ mutateAsync: m.cancel, isPending: false }),
}));
vi.mock('@/lib/api/notification-channels', () => ({
  useNotificationChannels: () => ({
    data: [
      { id: 'c1', name: 'releases', kind: 'slack', target: 'T1', created_at: '' },
      { id: 'c2', name: 'pager', kind: 'pagerduty', target: '…1234', created_at: '' },
    ],
    error: null,
    isPending: false,
    refetch: vi.fn(),
  }),
}));
vi.mock('@/lib/api/capabilities', () => ({ useCapabilityStage: () => 'Preview' }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: m.toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => m.confirm }));

const { ReleaseSchedule, ScheduledReleases } = await import('./release-schedule');

const parked = (over: Partial<Deployment> = {}): Deployment => ({
  id: 'd'.repeat(32),
  app_id: 'app',
  image_digest: '',
  kind: 'github',
  status: 'live',
  created_at: '2026-11-03T10:00:00Z',
  traffic_percent: 0,
  revision: 44,
  ...over,
});
const pending = (over: Partial<ScheduledRelease> = {}): ScheduledRelease => ({
  id: 's1',
  app: 'shop',
  deployment_id: 'd'.repeat(32),
  revision: 44,
  release_at: new Date(Date.now() + 2 * 3_600_000).toISOString(),
  state: 'scheduled',
  canary: { preset: 'balanced' },
  notify_channels: ['releases'],
  scheduled_by: 'me@acme.dev',
  created_at: '2026-11-03T10:00:00Z',
  updated_at: '2026-11-03T10:00:00Z',
  ...over,
});
const localIn = (ms: number) => {
  const d = new Date(Date.now() + ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

beforeEach(() => {
  m.save.mockReset().mockResolvedValue(pending());
  m.cancel.mockReset().mockResolvedValue(pending({ state: 'cancelled' }));
  m.toast.mockReset();
  m.confirm.mockReset().mockResolvedValue(true);
  m.schedule = null;
  m.list = [];
});

describe('ReleaseSchedule', () => {
  it('schedules a parked release after confirming when production moves, in the viewer’s zone', async () => {
    render(<ReleaseSchedule slug="shop" deployment={parked()} />);
    const section = screen.getByRole('region', { name: 'Scheduled release' });
    expect(section).toHaveTextContent('Preview');
    await userEvent.click(screen.getByRole('button', { name: 'Schedule rollout' }));
    const when = localIn(2 * 3_600_000);
    await userEvent.type(screen.getByLabelText('Start the rollout'), when);
    await userEvent.selectOptions(screen.getByLabelText('Rollout'), 'slow');
    // PagerDuty is not a release channel.
    expect(screen.queryByText('pager')).toBeNull();
    await userEvent.click(screen.getByLabelText(/releases/));
    await userEvent.click(screen.getByRole('button', { name: 'Schedule' }));
    expect(m.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Schedule shop v44?',
        description: expect.stringMatching(/production moves off the release serving now/),
      })
    );
    await waitFor(() =>
      expect(m.save).toHaveBeenCalledWith({
        id: 'd'.repeat(32),
        body: {
          release_at: new Date(Date.parse(when)).toISOString(),
          canary: { preset: 'slow' },
          notify_channels: ['releases'],
        },
      })
    );
  });

  it('turns a freeze at that time into an audited override, confirmed again', async () => {
    m.save.mockRejectedValueOnce(
      new ApiError({
        status: 409,
        code: 'release_frozen',
        title: 'frozen',
        detail: 'At 2026-11-04T02:00:00Z: Production releases of shop are frozen.',
        freezes: [],
      })
    );
    render(<ReleaseSchedule slug="shop" deployment={parked()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Schedule rollout' }));
    await userEvent.type(screen.getByLabelText('Start the rollout'), localIn(3_600_000));
    await userEvent.click(screen.getByRole('button', { name: 'Schedule' }));
    const refusal = await screen.findByRole('alert', { name: 'Release frozen' });
    await userEvent.type(within(refusal).getByLabelText('Override reason'), 'launch');
    await userEvent.click(
      within(refusal).getByRole('button', { name: 'Schedule into the freeze' })
    );
    expect(m.confirm).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'Schedule shop v44 into the freeze?', destructive: true })
    );
    await waitFor(() =>
      expect(m.save).toHaveBeenLastCalledWith(
        expect.objectContaining({ body: expect.objectContaining({ override_freeze: 'launch' }) })
      )
    );
  });

  it('explains approval policies that need a canary', async () => {
    m.save.mockRejectedValueOnce(
      new ApiError({ status: 409, code: 'release_approval_canary_required', title: 'x' })
    );
    render(<ReleaseSchedule slug="shop" deployment={parked()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Schedule rollout' }));
    await userEvent.click(screen.getByLabelText('Now, on the next pass'));
    await userEvent.click(screen.getByRole('button', { name: 'Schedule' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/requires release approvals/);
  });

  it('moves or cancels a pending schedule; cancelling keeps the release without traffic', async () => {
    m.schedule = pending();
    render(<ReleaseSchedule slug="shop" deployment={parked()} />);
    expect(screen.getByText('Scheduled')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move' })).toBeInTheDocument();
    m.confirm.mockResolvedValueOnce(false);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel schedule' }));
    expect(m.cancel).not.toHaveBeenCalled();
    expect(m.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        destructive: true,
        description: expect.stringMatching(/stays live without traffic/),
      })
    );
    await userEvent.click(screen.getByRole('button', { name: 'Cancel schedule' }));
    await waitFor(() => expect(m.cancel).toHaveBeenCalledWith('d'.repeat(32)));
  });

  it('says why a serving release cannot be scheduled', () => {
    render(<ReleaseSchedule slug="shop" deployment={parked({ traffic_percent: 100 })} />);
    expect(screen.queryByRole('button', { name: 'Schedule rollout' })).toBeNull();
    expect(screen.getByText(/already takes 100% of traffic/)).toBeInTheDocument();
  });

  it('shows why a schedule ended without starting', () => {
    m.schedule = pending({
      state: 'blocked',
      outcome_code: 'release_frozen',
      outcome_detail: 'A deploy freeze was active.',
    });
    render(<ReleaseSchedule slug="shop" deployment={parked()} />);
    expect(screen.getByText('Could not start')).toBeInTheDocument();
    expect(screen.getByText('release_frozen')).toBeInTheDocument();
  });
});

describe('ScheduledReleases', () => {
  it('lists schedules with their state and opens the release', async () => {
    const onOpen = vi.fn();
    m.list = [
      pending(),
      pending({ id: 's2', state: 'expired', outcome_code: 'not_ready', revision: 43 }),
    ];
    render(<ScheduledReleases onOpen={onOpen} />);
    expect(screen.getByRole('region', { name: 'Scheduled releases' })).toHaveTextContent(
      /shop v44 goes live (today|tomorrow) at \d\d:\d\d\./
    );
    const [first, second] = screen.getAllByRole('listitem');
    expect(first).toHaveTextContent('shop');
    expect(second).toHaveTextContent('Expired');
    // The outcome in words, its code kept on hover.
    expect(within(second).getByTitle('not_ready')).toHaveTextContent(
      'The version wasn’t ready in time.'
    );
    expect(within(second).queryByRole('button', { name: /Cancel schedule/ })).toBeNull();
    await userEvent.click(within(first).getByRole('button', { name: /Cancel schedule/ }));
    expect(m.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Cancel shop v44’s schedule?', destructive: true })
    );
    await userEvent.click(within(first).getByRole('button', { name: 'Open release v44' }));
    expect(onOpen).toHaveBeenCalledWith('d'.repeat(32));
  });

  it('says so when an app has none', () => {
    render(<ScheduledReleases app="shop" />);
    expect(
      screen.getByText(
        'Nothing is scheduled, so new versions start their rollout as soon as they’re ready.'
      )
    ).toBeInTheDocument();
  });
});

describe('ScheduledReleases inside a project', () => {
  const gate = (appSlugs: string[] | null, settled = true): ScopeGate => ({
    scope: {
      project: 'acme-shop',
      label: 'acme-shop',
      appSlugs: appSlugs ? new Set(appSlugs) : null,
      settled,
      choices: [],
    },
    pending: appSlugs === null && !settled,
    error: undefined,
    retry: vi.fn(),
  });

  beforeEach(() => {
    m.list = [
      pending({ id: 's1', app: 'api-gateway', revision: 7 }),
      pending({ id: 's2', app: 'nightly-etl', revision: 9 }),
    ];
  });

  it('lists only the project’s schedules', () => {
    render(<ScheduledReleases scope={gate(['api-gateway'])} />);
    const list = screen.getByRole('list', { name: 'Scheduled releases' });
    expect(list).toHaveTextContent('api-gateway v7');
    expect(list).not.toHaveTextContent('nightly-etl');
  });

  it('names the project when nothing in it is scheduled', () => {
    render(<ScheduledReleases scope={gate(['image-resize'])} />);
    expect(screen.getByText(/Nothing in acme-shop is scheduled/)).toBeInTheDocument();
  });

  it('reads schedules, rather than listing every app’s, while membership loads', () => {
    render(<ScheduledReleases scope={gate(null, false)} />);
    expect(screen.getByText('Reading schedules…')).toBeInTheDocument();
    expect(screen.queryByText(/nightly-etl/)).toBeNull();
  });

  it('lists every schedule with no project chosen', () => {
    render(<ScheduledReleases />);
    expect(screen.getByRole('list', { name: 'Scheduled releases' })).toHaveTextContent(
      'nightly-etl v9'
    );
  });
});
