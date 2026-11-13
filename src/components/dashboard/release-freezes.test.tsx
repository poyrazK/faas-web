import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import type { ReleaseFreeze } from '@/lib/api/release-freezes';
import type { ScopeGate } from './scope-gate';

const m = vi.hoisted(() => ({
  create: vi.fn(),
  lift: vi.fn(),
  toast: vi.fn(),
  confirm: vi.fn(),
  freezes: [] as ReleaseFreeze[],
  status: { app: 'shop', frozen: false, active: [] as ReleaseFreeze[] } as Record<string, unknown>,
}));

vi.mock('@/lib/api/release-freezes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/release-freezes')>()),
  useReleaseFreezes: () => ({ data: m.freezes, error: null, isPending: false, refetch: vi.fn() }),
  useFreezeStatus: () => ({ data: m.status, error: null, isPending: false, refetch: vi.fn() }),
  useCreateReleaseFreeze: () => ({ mutateAsync: m.create, isPending: false }),
  useLiftReleaseFreeze: () => ({ mutateAsync: m.lift, isPending: false }),
}));
vi.mock('@/lib/api/capabilities', () => ({ useCapabilityStage: () => 'Preview' }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: m.toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => m.confirm }));

const { FrozenRefusal, ReleaseFreezes } = await import('./release-freezes');

const freeze = (over: Partial<ReleaseFreeze> = {}): ReleaseFreeze => ({
  id: 'f1',
  app: 'shop',
  kind: 'window',
  starts_at: '2026-11-03T10:00:00Z',
  ends_at: '2026-11-03T14:00:00Z',
  reason: 'incident 4711',
  source: 'manual',
  created_by: 'ops@acme.dev',
  created_at: '2026-11-03T10:00:00Z',
  active: true,
  ...over,
});
const problem = (status: number, code: string, extra: Record<string, unknown> = {}) =>
  new ApiError({ status, code, title: code, ...extra });

beforeEach(() => {
  m.create.mockReset().mockResolvedValue(freeze());
  m.lift.mockReset().mockResolvedValue(freeze({ active: false }));
  m.toast.mockReset();
  m.confirm.mockReset().mockResolvedValue(true);
  m.freezes = [];
  m.status = { app: 'shop', frozen: false, active: [] };
});

describe('ReleaseFreezes', () => {
  it('says in one sentence that the app is frozen now, labelled preview, with what a freeze blocks behind its tip', async () => {
    m.freezes = [freeze()];
    m.status = { app: 'shop', frozen: true, active: [freeze()] };
    render(<ReleaseFreezes owner={{ kind: 'app', slug: 'shop' }} />);
    const card = screen.getByRole('region', { name: 'Freezes' });
    expect(card).toHaveTextContent('Preview');
    expect(card).toHaveTextContent('Releases are paused by “incident 4711”.');
    expect(card).not.toHaveTextContent(/GitHub pushes/);
    await userEvent.click(screen.getByRole('button', { name: 'About freezes' }));
    expect(await screen.findByText(/GitHub pushes.*Rollbacks/s)).toBeInTheDocument();
    expect(within(screen.getByRole('list')).getByText('Frozen now')).toBeInTheDocument();
  });

  it('names when the next freeze starts, and offers one when there is none', () => {
    m.freezes = [freeze({ active: false, next_starts_at: '2026-11-06T13:00:00Z' })];
    m.status = { app: 'shop', frozen: false, active: [], next: m.freezes[0] };
    const { unmount } = render(<ReleaseFreezes owner={{ kind: 'app', slug: 'shop' }} />);
    expect(screen.getByRole('region', { name: 'Freezes' })).toHaveTextContent(
      /One freeze can pause releases; the next starts .+ at \d\d:\d\d\./
    );
    unmount();
    m.freezes = [];
    m.status = { app: 'shop', frozen: false, active: [] };
    render(<ReleaseFreezes owner={{ kind: 'app', slug: 'shop' }} />);
    expect(screen.getByText(/No freeze is set/)).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'New freeze' })).not.toBeInTheDocument();
  });

  it('describes weekly and after-rollback freezes with their zone and length', () => {
    m.freezes = [
      freeze({
        id: 'w',
        app: undefined,
        kind: 'weekly',
        starts_at: undefined,
        ends_at: undefined,
        weekly: {
          days: ['fri'],
          start: '16:00',
          duration_minutes: 3840,
          time_zone: 'Europe/Istanbul',
        },
        active: false,
        next_starts_at: '2026-11-06T13:00:00Z',
      }),
      freeze({ id: 'r', kind: 'after_rollback', after_rollback_minutes: 60, active: false }),
    ];
    render(<ReleaseFreezes owner={{ kind: 'account' }} />);
    expect(
      screen.getByText(/Every Fri at 16:00 for 2 d 16 h, Europe\/Istanbul time/)
    ).toBeInTheDocument();
    expect(screen.getByText(/Covers every personal app of your account/)).toBeInTheDocument();
    expect(screen.getByText(/for 1 h each time Gregale rolls it back/)).toBeInTheDocument();
    expect(screen.getByText('Standing policy')).toBeInTheDocument();
  });

  it('lifts only after a confirmation that says what goes through again', async () => {
    m.freezes = [freeze({ app: undefined, org: 'acme' })];
    render(<ReleaseFreezes owner={{ kind: 'org', org: 'acme' }} />);
    m.confirm.mockResolvedValueOnce(false);
    await userEvent.click(screen.getByRole('button', { name: /^Lift/ }));
    expect(m.lift).not.toHaveBeenCalled();
    expect(m.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Lift the freeze on every app of acme?',
        description: expect.stringMatching(/audit log/),
      })
    );
    await userEvent.click(screen.getByRole('button', { name: /^Lift/ }));
    await waitFor(() =>
      expect(m.lift).toHaveBeenCalledWith(expect.objectContaining({ id: 'f1', org: 'acme' }))
    );
  });

  it('reads a lift that lost the race as already lifted, and a member’s refusal by role', async () => {
    m.freezes = [freeze()];
    m.lift.mockRejectedValueOnce(problem(404, 'release_freeze_not_found'));
    render(<ReleaseFreezes owner={{ kind: 'app', slug: 'shop' }} />);
    await userEvent.click(screen.getByRole('button', { name: /^Lift/ }));
    await waitFor(() =>
      expect(m.toast).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'info', title: 'Already lifted' })
      )
    );
    m.lift.mockRejectedValueOnce(problem(403, 'org_role_forbidden'));
    await userEvent.click(screen.getByRole('button', { name: /^Lift/ }));
    await waitFor(() =>
      expect(m.toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Only an owner or admin can lift this freeze' })
      )
    );
  });

  it('freezes every app of an organization after a confirmation naming who it blocks', async () => {
    render(<ReleaseFreezes owner={{ kind: 'org', org: 'acme' }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add a freeze' }));
    expect(screen.getByRole('dialog', { name: 'Freeze every app of acme' })).toBeInTheDocument();
    const form = screen.getByRole('form', { name: 'New freeze' });
    await userEvent.type(within(form).getByLabelText('Reason'), 'holiday freeze');
    await userEvent.click(within(form).getByRole('button', { name: 'Freeze releases' }));
    expect(m.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Freeze every app of acme?',
        destructive: true,
        description: expect.stringMatching(
          /every app of the organization acme, whoever created it.*release_frozen.*Rollbacks/s
        ),
      })
    );
    await waitFor(() =>
      expect(m.create).toHaveBeenCalledWith({
        owner: { kind: 'org', org: 'acme' },
        body: { kind: 'window', reason: 'holiday freeze' },
      })
    );
  });

  it('sends a weekly window in its time zone, and explains a member’s role refusal', async () => {
    m.create.mockRejectedValueOnce(problem(403, 'org_role_forbidden'));
    render(<ReleaseFreezes owner={{ kind: 'org', org: 'acme' }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add a freeze' }));
    expect(screen.getByRole('dialog', { name: 'Freeze every app of acme' })).toBeInTheDocument();
    const form = screen.getByRole('form', { name: 'New freeze' });
    await userEvent.click(within(form).getByRole('button', { name: 'Weekly' }));
    await userEvent.clear(within(form).getByLabelText('Time zone'));
    await userEvent.type(within(form).getByLabelText('Time zone'), 'Europe/Istanbul');
    await userEvent.type(within(form).getByLabelText('Reason'), 'no weekend releases');
    await userEvent.click(within(form).getByRole('button', { name: 'Create policy' }));
    await waitFor(() =>
      expect(m.create).toHaveBeenCalledWith({
        owner: { kind: 'org', org: 'acme' },
        body: {
          kind: 'weekly',
          reason: 'no weekend releases',
          weekly: {
            days: ['fri'],
            start: '16:00',
            duration_minutes: 3840,
            time_zone: 'Europe/Istanbul',
          },
        },
      })
    );
    expect(await within(form).findByRole('alert')).toHaveTextContent(
      'Only owners and admins of acme create weekly and after-rollback freezes'
    );
  });

  it('refuses to send a freeze without a reason', async () => {
    render(<ReleaseFreezes owner={{ kind: 'app', slug: 'shop' }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add a freeze' }));
    await userEvent.click(screen.getByRole('button', { name: 'Freeze releases' }));
    expect(screen.getByText(/Give a reason/)).toBeInTheDocument();
    expect(m.confirm).not.toHaveBeenCalled();
  });
});

describe('FrozenRefusal', () => {
  it('lists the refusing freezes and hands back an override reason', async () => {
    const onOverride = vi.fn();
    render(
      <FrozenRefusal
        error={problem(409, 'release_frozen', {
          detail: 'Production releases of shop are frozen.',
          freezes: [freeze()],
        })}
        onOverride={onOverride}
      />
    );
    const alert = screen.getByRole('alert', { name: 'Release frozen' });
    expect(alert).toHaveTextContent('incident 4711');
    expect(within(alert).getByRole('button', { name: 'Release anyway' })).toBeDisabled();
    await userEvent.type(within(alert).getByLabelText('Override reason'), 'hotfix');
    await userEvent.click(within(alert).getByRole('button', { name: 'Release anyway' }));
    expect(onOverride).toHaveBeenCalledWith('hotfix');
  });
});

describe('ReleaseFreezes inside a project', () => {
  const gate = (appSlugs: string[] | null, settled = true): ScopeGate => ({
    scope: {
      project: 'acme-shop',
      label: 'acme-shop',
      appSlugs: appSlugs ? new Set(appSlugs) : null,
      settled,
      choices: [],
    },
    pending: appSlugs === null && !settled,
    error:
      appSlugs === null && settled
        ? new Error('Couldn’t read which apps are in acme-shop')
        : undefined,
    retry: vi.fn(),
  });

  beforeEach(() => {
    m.freezes = [
      freeze({ id: 'mine', app: 'api-gateway', reason: 'gateway incident' }),
      freeze({ id: 'other', app: 'nightly-etl', reason: 'etl migration' }),
      freeze({ id: 'all', app: undefined, reason: 'holiday freeze', active: false }),
    ];
  });

  it('keeps the project’s freezes and freezes on every app, and says the latter hold it too', () => {
    render(<ReleaseFreezes owner={{ kind: 'account' }} scope={gate(['api-gateway'])} />);
    const card = screen.getByRole('region', { name: 'Freezes' });
    expect(card).toHaveTextContent('gateway incident');
    expect(card).toHaveTextContent('holiday freeze');
    expect(card).toHaveTextContent('Covers every personal app of your account');
    expect(card).not.toHaveTextContent('etl migration');
    expect(card).toHaveTextContent(
      /they also hold the apps in acme-shop, and lifting one frees every app/
    );
  });

  it('reads freezes, rather than listing every app’s, while membership loads', () => {
    render(<ReleaseFreezes owner={{ kind: 'account' }} scope={gate(null, false)} />);
    const card = screen.getByRole('region', { name: 'Freezes' });
    expect(card).toHaveTextContent('Reading freezes…');
    expect(card).not.toHaveTextContent('etl migration');
    expect(card).not.toHaveTextContent('holiday freeze');
  });

  it('lists every freeze with no project chosen', () => {
    render(<ReleaseFreezes owner={{ kind: 'account' }} />);
    const card = screen.getByRole('region', { name: 'Freezes' });
    expect(card).toHaveTextContent('etl migration');
    expect(card).not.toHaveTextContent(/also hold/);
  });
});
