import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import type {
  ProfileCapture,
  ProfileCaptureDiff,
  ProfileCaptureView,
} from '@/lib/api/profile-captures';
import type { ProfileCaptureSearch } from './profile-captures-search';

const access = vi.hoisted(() => ({ value: 'on' as string }));
const list = vi.fn();
const one = vi.fn();
const view = vi.fn();
const diff = vi.fn();
const create = vi.fn();
const remove = vi.fn();
const automatic = vi.fn();
const download = vi.fn();
const app = vi.fn();
const confirm = vi.fn();
const toast = vi.fn();

vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: () => ({ access: access.value, refresh: vi.fn() }),
}));
vi.mock('@/lib/api/profile-captures', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/profile-captures')>()),
  useProfileCaptures: (slug: string) => list(slug) as unknown,
  useProfileCapture: (slug: string, id: string) => one(slug, id) as unknown,
  useProfileCaptureView: (...args: unknown[]) => view(...args) as unknown,
  useProfileCaptureDiff: (...args: unknown[]) => diff(...args) as unknown,
  useCreateProfileCapture: () => ({ mutateAsync: create, isPending: false }),
  useDeleteProfileCapture: () => ({ mutateAsync: remove, isPending: false }),
  useSaveCaptureSettings: () => ({ mutateAsync: automatic, isPending: false }),
  downloadProfileCapture: (...args: unknown[]) => download(...args) as unknown,
}));
vi.mock('@/lib/api/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/queries')>()),
  useApp: (slug: string) => app(slug) as unknown,
  useAppInstances: () => ({
    data: [
      { id: 'a'.repeat(32), state: 'running', resident: true },
      { id: 'b'.repeat(32), state: 'parked', resident: false },
    ],
    isPending: false,
    error: null,
  }),
}));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));

const { ProfileCapturesBody } = await import('./profile-captures');

const HOUR = 3_600_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const capture = (over: Partial<ProfileCapture>): ProfileCapture => ({
  id: '11111111-1111-4111-8111-111111111111',
  app_id: 'a',
  status: 'ready',
  kinds: ['cpu', 'heap'],
  duration_seconds: 10,
  trigger: 'manual',
  processes: 1,
  profiles: [
    { kind: 'cpu', process_id: '7', bytes: 2048 },
    { kind: 'heap', process_id: '7', bytes: 4096 },
  ],
  created_at: ago(HOUR),
  completed_at: ago(HOUR - 11_000),
  expires_at: new Date(Date.now() + 6 * 24 * HOUR).toISOString(),
  deployment_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  ...over,
});
const manual = capture({});
const oom = capture({
  id: '22222222-2222-4222-8222-222222222222',
  trigger: 'memory_pressure',
  trigger_detail: 'guest memory available fell to 31 MiB of 246 MiB',
  kinds: ['heap'],
  partial: true,
  oom_killed_at: ago(2 * HOUR),
  oom_peak_mb: 263,
  oom_plan_mb: 256,
  created_at: ago(2 * HOUR),
});
const slow = capture({
  id: '33333333-3333-4333-8333-333333333333',
  trigger: 'slow_request',
  kinds: ['stacks', 'cpu'],
  request_id: 'req-slow-1',
  created_at: ago(3 * HOUR),
});
const bare = capture({
  id: '44444444-4444-4444-8444-444444444444',
  processes: 0,
  profiles: [],
  reason: 'nothing answered on pprof_port 6060',
  created_at: ago(4 * HOUR),
});

const cpuView: ProfileCaptureView = {
  capture: manual,
  kind: 'cpu',
  unit: 'nanoseconds',
  total: 2_000_000_000,
  empty: false,
  functions: [
    {
      name: 'main.hash',
      file: 'hash.go',
      line: 12,
      self: 1_500_000_000,
      total: 1_600_000_000,
      source: {
        url: 'https://github.com/acme/api/blob/abc/hash.go#L12',
        path: 'hash.go',
        line: 12,
      },
    },
  ],
  flamegraph: {
    name: 'root',
    value: 2_000_000_000,
    children: [
      {
        name: 'main.handler',
        value: 1_800_000_000,
        children: [{ name: 'main.hash', value: 1_600_000_000 }],
      },
      { name: 'runtime.gc', value: 200_000_000 },
    ],
  },
  source: { available: true, repository: 'acme/api', commit_sha: 'abc' },
};

let selected: ProfileCaptureSearch = {};
const onSelect = vi.fn((patch: ProfileCaptureSearch) => {
  selected = { ...selected, ...patch };
});
const renderBody = () =>
  render(<ProfileCapturesBody slug="api" search={selected} onSelect={onSelect} />);

beforeEach(() => {
  access.value = 'on';
  selected = {};
  for (const fn of [list, one, view, diff, create, remove, automatic, download, app, confirm])
    fn.mockReset();
  toast.mockReset();
  onSelect.mockClear();
  list.mockReturnValue({
    data: { captures: [manual, oom, slow, bare] },
    isPending: false,
    error: null,
    refetch: vi.fn(),
  });
  one.mockImplementation((_slug: string, id: string) => ({
    data: [manual, oom, slow, bare].find((c) => c.id === id),
    isPending: false,
    error: null,
  }));
  view.mockReturnValue({ data: cpuView, isPending: false, error: null, refetch: vi.fn() });
  diff.mockReturnValue({ data: undefined, isPending: false, error: null });
  app.mockReturnValue({ data: { manifest: { profiling: { enabled: false } } } });
  confirm.mockResolvedValue(true);
});
afterEach(() => vi.restoreAllMocks());

describe('ProfileCapturesBody', () => {
  it.each(['off', 'plan-not-entitled', 'runtime-unavailable'])(
    'reads nothing while profile-captures is %s',
    (state) => {
      access.value = state;
      renderBody();
      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(list).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: /capture profile/i })).not.toBeInTheDocument();
    }
  );

  it('sends a plan without captures to the plans page', () => {
    access.value = 'plan-not-entitled';
    renderBody();
    expect(screen.getByRole('link', { name: 'View plans' })).toHaveAttribute(
      'href',
      '/dashboard/plans'
    );
  });

  it('names who started each capture, marks an OOM kill, and counts what needs review', () => {
    renderBody();
    expect(screen.getAllByText('You started it')).toHaveLength(2);
    expect(screen.getByText('Memory pressure')).toBeInTheDocument();
    expect(screen.getByText('Slow request')).toBeInTheDocument();
    expect(screen.getAllByText('Ready').length).toBeGreaterThan(0);
    expect(screen.getByText(/OOM-killed after/)).toBeInTheDocument();
    expect(screen.getByRole('status', { name: /captures to review/i })).toHaveTextContent(
      /2 automatic captures in the last 7 days, 1 followed by an OOM kill/
    );
  });

  it('starts a capture with the kinds, window and instance chosen', async () => {
    create.mockResolvedValue(capture({ status: 'queued' }));
    renderBody();
    const form = screen.getByRole('form', { name: /capture a running instance/i });
    await userEvent.click(within(form).getByRole('checkbox', { name: 'CPU' }));
    await userEvent.click(within(form).getByRole('checkbox', { name: 'Heap' }));
    await userEvent.click(within(form).getByRole('checkbox', { name: /stacks/i }));
    await userEvent.clear(within(form).getByLabelText(/window/i));
    await userEvent.type(within(form).getByLabelText(/window/i), '30');
    // Only running instances are offered; a parked app is not woken.
    const instance = within(form).getByLabelText('Instance');
    expect(within(instance).getAllByRole('option')).toHaveLength(2);
    await userEvent.selectOptions(instance, 'a'.repeat(32));
    await userEvent.click(within(form).getByRole('button', { name: 'Capture profile' }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        kinds: ['heap', 'stacks'],
        duration_seconds: 30,
        instance_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      })
    );
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ capture: manual.id }));
  });

  it.each([
    [409, 'conflict', {}, /already running/i],
    [429, 'quota_exhausted', {}, /60 per hour/i],
    [429, 'quota_exhausted', { limit_bytes: 268435456, observed_bytes: 268000000 }, /storage/i],
    [402, 'plan_feature_gated', {}, /plan/i],
  ])('explains a refused capture (%s %s)', async (status, code, extra, title) => {
    create.mockRejectedValue(new ApiError({ status, code, title: code, ...extra }));
    renderBody();
    await userEvent.click(screen.getByRole('button', { name: 'Capture profile' }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'error', title: expect.stringMatching(title) })
      )
    );
  });

  it('shows the API’s functions and call paths and downloads the API’s own pprof file', async () => {
    selected = { capture: manual.id };
    const blob = new Blob(['pprof']);
    download.mockResolvedValue({ blob, filename: `profile-${manual.id}-cpu.pb.gz` });
    const url = vi.fn(() => 'blob:mock');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: url, revokeObjectURL: vi.fn() }));
    renderBody();
    const detail = screen.getByRole('region', { name: /capture 11111111/i });
    expect(view).toHaveBeenCalledWith('api', manual.id, 'cpu');
    expect(within(detail).getAllByText('main.hash').length).toBeGreaterThan(0);
    expect(within(detail).getByRole('link', { name: /hash\.go:12/ })).toHaveAttribute(
      'href',
      'https://github.com/acme/api/blob/abc/hash.go#L12'
    );
    expect(within(detail).getByText('main.handler')).toBeInTheDocument();
    expect(within(detail).getByText(/go tool pprof/)).toBeInTheDocument();
    await userEvent.click(within(detail).getByRole('button', { name: /download cpu pprof/i }));
    await waitFor(() => expect(download).toHaveBeenCalledWith('api', manual.id, 'cpu'));
    expect(url).toHaveBeenCalledWith(blob);
    vi.unstubAllGlobals();
  });

  it('explains a capture with no collector instead of reading an empty view', () => {
    selected = { capture: bare.id };
    renderBody();
    const detail = screen.getByRole('region', { name: /capture 44444444/i });
    expect(detail).toHaveTextContent(/no collector/i);
    expect(detail).toHaveTextContent(/pprof_port 6060/);
    expect(view).not.toHaveBeenCalledWith('api', bare.id, expect.anything());
  });

  it('links a slow-request capture to the request it caught', () => {
    selected = { capture: slow.id };
    renderBody();
    const detail = screen.getByRole('region', { name: /capture 33333333/i });
    expect(within(detail).getByRole('link', { name: /request req-slow-1/i })).toHaveAttribute(
      'href',
      '/dashboard/apps/api?tab=Debugger&debugView=requests&request=req-slow-1'
    );
  });

  it('compares with an earlier capture and labels growth in words, not only colour', async () => {
    selected = { capture: manual.id, captureBase: oom.id };
    const result: ProfileCaptureDiff = {
      baseline: oom,
      candidate: manual,
      kind: 'heap',
      unit: 'bytes',
      baseline_total: 1_048_576,
      candidate_total: 3_145_728,
      delta: 2_097_152,
      warnings: ['captures come from different deployments'],
      functions: [
        { name: 'cache.put', baseline: 1_048_576, candidate: 3_145_728, delta: 2_097_152 },
      ],
      flamegraph: { name: 'root', baseline: 1_048_576, candidate: 3_145_728, delta: 2_097_152 },
    };
    diff.mockReturnValue({ data: result, isPending: false, error: null });
    renderBody();
    const compare = screen.getByRole('region', { name: /comparison/i });
    // The baseline has no CPU profile, so the API picks a kind both collected.
    expect(diff).toHaveBeenCalledWith('api', manual.id, oom.id, undefined);
    expect(compare).toHaveTextContent(/different deployments/);
    expect(within(compare).getAllByText(/grew 2 MiB/).length).toBeGreaterThan(0);
  });

  it('deletes a capture only after a destructive confirmation', async () => {
    selected = { capture: manual.id };
    remove.mockResolvedValue(undefined);
    renderBody();
    await userEvent.click(screen.getByRole('button', { name: /delete capture/i }));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ destructive: true }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(manual.id));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ capture: undefined }));
  });

  it('turns automatic captures off with the rest of the profiling settings, after saying it retires snapshots', async () => {
    app.mockReturnValue({
      data: { manifest: { profiling: { enabled: true, window_seconds: 10, pprof_port: 6060 } } },
    });
    renderBody();
    const toggle = screen.getByRole('switch', { name: /automatic captures/i });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(toggle);
    expect((confirm.mock.calls[0][0] as { description: string }).description).toMatch(/snapshots/i);
    await waitFor(() =>
      expect(automatic).toHaveBeenCalledWith({
        current: { enabled: true, window_seconds: 10, pprof_port: 6060 },
        patch: { automatic_captures: false },
      })
    );
  });

  it('saves a Go pprof port, refusing the platform’s own', async () => {
    renderBody();
    const port = screen.getByLabelText('Go pprof port');
    await userEvent.type(port, '9191');
    expect(screen.getByText(/9191 belongs to the platform/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save port' })).toBeDisabled();
    await userEvent.clear(port);
    await userEvent.type(port, '6060');
    await userEvent.click(screen.getByRole('button', { name: 'Save port' }));
    expect((confirm.mock.calls[0][0] as { description: string }).description).toMatch(
      /next deployment/i
    );
    await waitFor(() =>
      expect(automatic).toHaveBeenCalledWith({
        current: { enabled: false },
        patch: { pprof_port: 6060 },
      })
    );
  });
});
