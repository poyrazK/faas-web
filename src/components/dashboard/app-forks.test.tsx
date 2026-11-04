import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import type { AppFork, ForkExec } from '@/lib/api/forks';

const access = vi.hoisted(() => ({ value: {} as Record<string, string> }));
const forks = vi.fn();
const create = vi.fn();
const cancel = vi.fn();
const execs = vi.fn();
const run = vi.fn();
const confirm = vi.fn();
const toast = vi.fn();
const invalidate = vi.fn();

vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: (id: string) => ({ access: access.value[id] ?? 'on', refresh: vi.fn() }),
}));
vi.mock('@/lib/api/forks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/forks')>()),
  useAppForks: (slug: string) => forks(slug) as unknown,
  createAppFork: (...args: unknown[]) => create(...args) as unknown,
  useCancelAppFork: () => ({ mutate: cancel, isPending: false }),
  useForkExecs: (slug: string, id: string) => execs(slug, id) as unknown,
  useRunForkExec: () => ({ mutateAsync: run, isPending: false }),
}));
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => ({ invalidateQueries: invalidate }),
}));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
// The crash snapshot panel has its own tests; here it only has to stay out of the way.
vi.mock('./crash-snapshots', () => ({ CrashSnapshotsPanel: () => null }));

const { ForksBody } = await import('./app-forks');

const fork = (over: Partial<AppFork>): AppFork => ({
  id: '11111111-1111-4111-8111-111111111111',
  app_id: 'a',
  deployment_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  status: 'running',
  ttl_seconds: 3600,
  expires_at: '2026-11-03T12:00:00Z',
  created_at: '2026-11-03T11:00:00Z',
  updated_at: '2026-11-03T11:00:05Z',
  started_at: '2026-11-03T11:00:04Z',
  ...over,
});
const running = fork({});
const failed = fork({
  id: '22222222-2222-4222-8222-222222222222',
  status: 'failed',
  started_at: undefined,
  failure: { code: 'no_capture', message: 'the deployment has no snapshot yet' },
});
const fromCapture = fork({
  id: '33333333-3333-4333-8333-333333333333',
  status: 'expired',
  crash_capture_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  finished_at: '2026-11-03T10:00:00Z',
});

const list = (items: AppFork[], extra: Record<string, unknown> = {}) => ({
  data: { items },
  isPending: false,
  error: null,
  refetch: vi.fn(),
  ...extra,
});

beforeEach(() => {
  access.value = {};
  for (const fn of [forks, create, cancel, execs, run, confirm, toast, invalidate]) fn.mockReset();
  forks.mockReturnValue(list([running, failed, fromCapture]));
  execs.mockReturnValue({ data: { items: [] }, isPending: false, error: null, refetch: vi.fn() });
  confirm.mockResolvedValue(true);
});

describe('ForksBody', () => {
  it.each(['off', 'plan-not-entitled', 'runtime-unavailable'])(
    'reads nothing while production-forks is %s',
    (state) => {
      access.value = { 'production-forks': state };
      render(<ForksBody slug="api" />);
      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(forks).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: /create fork/i })).not.toBeInTheDocument();
    }
  );

  it('sends a plan without forks to the plans page', () => {
    access.value = { 'production-forks': 'plan-not-entitled' };
    render(<ForksBody slug="api" />);
    expect(screen.getByText('Not included in your plan')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View plans' })).toHaveAttribute(
      'href',
      '/dashboard/plans'
    );
  });

  it('says what a fork copies, who can reach it and how long it lives', () => {
    render(<ForksBody slug="api" />);
    const note = screen.getByRole('note');
    expect(note).toHaveTextContent(/copies production data/i);
    expect(note).toHaveTextContent(/secrets already in memory/i);
    expect(note).toHaveTextContent(/no network/i);
    expect(note).toHaveTextContent(/access token/i);
    expect(note).toHaveTextContent(/deploy:write and secrets:read/i);
    expect(note).toHaveTextContent(/1 hour by default, at most 4/i);
  });

  it('labels each fork with its state and explains a failure by its code', () => {
    render(<ForksBody slug="api" />);
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(
      screen.getByText(/has no snapshot yet\. Send it some traffic first/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/crash snapshot/i)).toBeInTheDocument();
    // Only an active fork can be cancelled.
    expect(screen.getAllByRole('button', { name: /^cancel fork/i })).toHaveLength(1);
  });

  it('confirms before copying production, then shows the access token once', async () => {
    confirm.mockResolvedValueOnce(false);
    create.mockResolvedValue({ ...running, access_token: 'gfk_secret-token' });
    render(<ForksBody slug="api" />);
    await userEvent.click(screen.getByRole('button', { name: 'Create fork' }));
    const asked = confirm.mock.calls[0][0] as { description: string };
    expect(asked.description).toMatch(/memory and disk/i);
    expect(asked.description).toMatch(/access token/i);
    expect(asked.description).toMatch(/1 hour/i);
    expect(create).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Create fork' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith('api', { ttl_seconds: 3600 }));
    const secret = await screen.findByRole('region', { name: /access token/i });
    expect(secret).not.toHaveTextContent('gfk_secret-token');
    await userEvent.click(within(secret).getByRole('button', { name: 'Reveal' }));
    expect(secret).toHaveTextContent('gfk_secret-token');
    expect(secret).toHaveTextContent(/X-Gregale-Fork-Token/);
    expect(invalidate).toHaveBeenCalled();
  });

  it('asks for a live capture and a chosen lifetime', async () => {
    create.mockResolvedValue({ ...running, access_token: 'gfk_t' });
    render(<ForksBody slug="api" />);
    await userEvent.selectOptions(screen.getByLabelText('Lifetime'), '14400');
    await userEvent.click(screen.getByRole('radio', { name: /live capture now/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Create fork' }));
    expect((confirm.mock.calls[0][0] as { description: string }).description).toMatch(
      /pauses the newest running instance/i
    );
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith('api', { ttl_seconds: 14400, live: true })
    );
  });

  it.each([
    ['app_fork_limit', 409, /active fork limit/i],
    ['app_fork_unavailable', 409, /nothing to fork/i],
    ['live_fork_refused', 409, /live capture not started/i],
    ['live_forks_not_enabled', 501, /live forks are off/i],
    ['plan_app_forks_not_allowed', 402, /plan/i],
  ])('explains a refused create (%s)', async (code, status, title) => {
    create.mockRejectedValue(new ApiError({ status, code, title: code, detail: 'apid says' }));
    render(<ForksBody slug="api" />);
    await userEvent.click(screen.getByRole('button', { name: 'Create fork' }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'error', title: expect.stringMatching(title) })
      )
    );
    expect(screen.queryByRole('region', { name: /access token/i })).not.toBeInTheDocument();
  });

  it('cancels an active fork only after a destructive confirmation', async () => {
    render(<ForksBody slug="api" />);
    await userEvent.click(screen.getByRole('button', { name: /^cancel fork/i }));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ destructive: true }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith(running.id));
  });

  it('runs a command through the shell and shows its output tail', async () => {
    const done: ForkExec = {
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      fork_id: running.id,
      command: ['ls -la /tmp'],
      shell: true,
      timeout_seconds: 60,
      max_output_bytes: 65536,
      status: 'succeeded',
      exit_code: 0,
      output_truncated: true,
      stdout: 'total 0',
      stderr: '',
      requested_by: 'account:me',
      created_at: '2026-11-03T11:05:00Z',
    };
    execs.mockReturnValue({ data: { items: [done] }, isPending: false, error: null });
    run.mockResolvedValue(done);
    render(<ForksBody slug="api" />);
    await userEvent.click(screen.getByRole('button', { name: /commands for fork 1111/i }));
    const panel = screen.getByRole('region', { name: /commands in fork/i });
    expect(panel).toHaveTextContent(/no secrets/i);
    expect(within(panel).getByText('total 0')).toBeInTheDocument();
    expect(within(panel).getByText('Succeeded')).toBeInTheDocument();
    expect(within(panel).getByText(/older output was dropped/i)).toBeInTheDocument();
    await userEvent.type(within(panel).getByLabelText('Command'), 'ls -la /tmp');
    await userEvent.click(within(panel).getByRole('button', { name: 'Run command' }));
    await waitFor(() =>
      expect(run).toHaveBeenCalledWith({
        command: ['ls -la /tmp'],
        shell: true,
        timeout_seconds: 60,
      })
    );
  });

  it('splits an argv without the shell, and explains a refused command', async () => {
    run.mockRejectedValue(
      new ApiError({ status: 409, code: 'app_fork_exec_refused', title: 'Command not accepted' })
    );
    render(<ForksBody slug="api" />);
    await userEvent.click(screen.getByRole('button', { name: /commands for fork 1111/i }));
    const panel = screen.getByRole('region', { name: /commands in fork/i });
    await userEvent.click(within(panel).getByRole('checkbox', { name: /app's shell/i }));
    await userEvent.type(within(panel).getByLabelText('Command'), 'cat  /etc/hostname');
    await userEvent.click(within(panel).getByRole('button', { name: 'Run command' }));
    await waitFor(() =>
      expect(run).toHaveBeenCalledWith({
        command: ['cat', '/etc/hostname'],
        shell: false,
        timeout_seconds: 60,
      })
    );
    expect(await within(panel).findByRole('alert')).toHaveTextContent(/4 commands waiting/i);
  });

  it('keeps the four read states apart', () => {
    forks.mockReturnValue(list([], { data: undefined, isPending: true }));
    const { unmount } = render(<ForksBody slug="api" />);
    expect(screen.getByText(/loading forks/i)).toBeInTheDocument();
    unmount();
    forks.mockReturnValue(list([]));
    render(<ForksBody slug="api" />);
    expect(screen.getByText(/no forks yet/i)).toBeInTheDocument();
  });
});
