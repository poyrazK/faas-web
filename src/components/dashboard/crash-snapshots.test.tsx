import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import type { CrashCapture } from '@/lib/api/forks';

const access = vi.hoisted(() => ({ value: {} as Record<string, string> }));
const snapshots = vi.fn();
const settings = vi.fn();
const setSettings = vi.fn();
const capture = vi.fn();
const fork = vi.fn();
const confirm = vi.fn();
const toast = vi.fn();
const invalidate = vi.fn();

vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: (id: string) => ({ access: access.value[id] ?? 'on', refresh: vi.fn() }),
}));
vi.mock('@/lib/api/forks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/forks')>()),
  useAppForks: () => ({ data: { items: [] }, isPending: false, error: null }),
  useCrashSnapshots: (slug: string) => snapshots(slug) as unknown,
  useCrashSnapshotSettings: (slug: string) => settings(slug) as unknown,
  useSetCrashSnapshots: () => ({ mutateAsync: setSettings, isPending: false }),
  useCaptureCrashSnapshot: () => ({ mutateAsync: capture, isPending: false }),
  forkCrashSnapshot: (...args: unknown[]) => fork(...args) as unknown,
}));
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => ({ invalidateQueries: invalidate }),
}));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));

const { ForksBody } = await import('./app-forks');

const snap = (over: Partial<CrashCapture>): CrashCapture => ({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  app_id: 'a',
  deployment_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  trigger: 'http_5xx',
  status_code: 502,
  route: '/orders/42',
  status: 'ready',
  mem_bytes: 268435456,
  requested_at: '2026-11-03T10:00:00Z',
  captured_at: '2026-11-03T10:00:01Z',
  expires_at: '2026-11-10T10:00:01Z',
  ...over,
});
const ready = snap({});
const fromCode = snap({
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  trigger: 'sdk',
  status_code: undefined,
  reason: 'checkout failed',
  route: '/checkout',
  status: 'capturing',
});
const expired = snap({
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  trigger: 'manual',
  status: 'expired',
});

beforeEach(() => {
  access.value = {};
  for (const fn of [snapshots, settings, setSettings, capture, fork, confirm, toast, invalidate])
    fn.mockReset();
  snapshots.mockReturnValue({
    data: { items: [ready, fromCode, expired] },
    isPending: false,
    error: null,
    refetch: vi.fn(),
  });
  settings.mockReturnValue({ data: { enabled: false }, isPending: false, error: null });
  confirm.mockResolvedValue(true);
});

const panel = () => screen.getByRole('region', { name: 'Crash snapshots' });

describe('Crash snapshots', () => {
  it.each(['off', 'plan-not-entitled', 'runtime-unavailable'])(
    'reads nothing while crash-snapshots is %s',
    (state) => {
      access.value = { 'crash-snapshots': state };
      render(<ForksBody slug="api" />);
      expect(snapshots).not.toHaveBeenCalled();
      expect(settings).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: /capture now/i })).not.toBeInTheDocument();
    }
  );

  it('marks the list as sensitive memory', () => {
    render(<ForksBody slug="api" />);
    const note = within(panel()).getByRole('note');
    expect(note).toHaveTextContent(/sensitive/i);
    expect(note).toHaveTextContent(/your users' data/i);
    expect(note).toHaveTextContent(/encrypted/i);
    expect(note).toHaveTextContent(/7 days/i);
  });

  it('says what triggered each capture and opens only a ready one as a fork', () => {
    render(<ForksBody slug="api" />);
    const list = within(panel());
    expect(list.getByText(/502 on \/orders\/42/)).toBeInTheDocument();
    expect(list.getByText(/checkout failed/)).toBeInTheDocument();
    expect(list.getByText('Ready')).toBeInTheDocument();
    expect(list.getByText('Capturing')).toBeInTheDocument();
    expect(list.getByText('Expired')).toBeInTheDocument();
    expect(list.getAllByRole('button', { name: /^open .* as a fork/i })).toHaveLength(1);
  });

  it('confirms the copy before opening a snapshot as a fork, then shows the token once', async () => {
    fork.mockResolvedValue({
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      access_token: 'gfk_snapshot',
    });
    render(<ForksBody slug="api" />);
    await userEvent.click(within(panel()).getByRole('button', { name: /^open .* as a fork/i }));
    const asked = confirm.mock.calls[0][0] as { description: string };
    expect(asked.description).toMatch(/memory/i);
    expect(asked.description).toMatch(/access token/i);
    await waitFor(() => expect(fork).toHaveBeenCalledWith('api', ready.id, { ttl_seconds: 3600 }));
    expect(await within(panel()).findByRole('region', { name: /access token/i })).toBeVisible();
  });

  it('explains a snapshot that cannot be opened', async () => {
    fork.mockRejectedValue(
      new ApiError({ status: 409, code: 'crash_capture_not_ready', title: 'Capture not ready' })
    );
    render(<ForksBody slug="api" />);
    await userEvent.click(within(panel()).getByRole('button', { name: /^open .* as a fork/i }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'error', title: 'Snapshot not ready' })
      )
    );
  });

  it('confirms turning 5xx captures on, but not off', async () => {
    render(<ForksBody slug="api" />);
    await userEvent.click(within(panel()).getByRole('switch', { name: /capture after a 5xx/i }));
    expect((confirm.mock.calls[0][0] as { description: string }).description).toMatch(
      /your users' data/i
    );
    await waitFor(() => expect(setSettings).toHaveBeenCalledWith(true));

    confirm.mockClear();
    settings.mockReturnValue({ data: { enabled: true }, isPending: false, error: null });
    setSettings.mockClear();
    render(<ForksBody slug="other" />);
    const switches = screen.getAllByRole('switch', { name: /capture after a 5xx/i });
    await userEvent.click(switches[switches.length - 1]);
    expect(confirm).not.toHaveBeenCalled();
    await waitFor(() => expect(setSettings).toHaveBeenCalledWith(false));
  });

  it('captures now after a confirmation, and explains the cooldown refusal', async () => {
    capture.mockRejectedValue(
      new ApiError({ status: 409, code: 'crash_capture_refused', title: 'Capture not started' })
    );
    render(<ForksBody slug="api" />);
    await userEvent.click(within(panel()).getByRole('button', { name: /capture now/i }));
    expect((confirm.mock.calls[0][0] as { description: string }).description).toMatch(
      /pauses it briefly/i
    );
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Capture not started',
          description: expect.stringMatching(/10 minutes/),
        })
      )
    );
  });
});
