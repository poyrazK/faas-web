import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import type { Deployment } from '@/lib/api/queries';

const reorder = vi.fn();
const cancel = vi.fn();
const toast = vi.fn();
const confirm = vi.fn();
const useDeployQueue = vi.fn();
let access = 'on';

vi.mock('@/lib/api/queries', () => ({
  useApps: () => ({ data: [{ id: 'app-a', slug: 'alpha' }] }),
  useReorderDeployment: () => ({ mutateAsync: reorder, isPending: false }),
  useCancelDeployment: () => ({ mutateAsync: cancel, isPending: false }),
}));
vi.mock('@/lib/api/deploy-queue', () => ({
  QUEUE_WINDOW: 200,
  useDeployQueue: () => useDeployQueue() as unknown,
}));
vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: () => ({ access, refresh: vi.fn() }),
  useCapabilityStage: () => 'Beta',
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));

const { DeployQueue } = await import('./deploy-queue');

const dep = (over: Partial<Deployment> = {}): Deployment => ({
  id: 'd'.repeat(32),
  app_id: 'app-a',
  image_digest: '',
  kind: 'github',
  status: 'pending',
  created_at: '2026-11-03T10:00:00Z',
  revision: 7,
  ...over,
});
const ready = (data: Deployment[]) => ({
  data,
  error: null,
  isPending: false,
  refetch: vi.fn(),
});
const problem = (status: number, code: string) =>
  new ApiError({ type: 'about:blank', status, code, title: code });

beforeEach(() => {
  access = 'on';
  reorder.mockReset().mockResolvedValue({ id: 'd'.repeat(32), priority: 0 });
  cancel.mockReset().mockResolvedValue({ id: 'd'.repeat(32), status: 'cancelled' });
  toast.mockReset();
  confirm.mockReset().mockResolvedValue(true);
  useDeployQueue.mockReturnValue(ready([dep()]));
});

describe('DeployQueue', () => {
  it('lists each queued deployment with its app, status and controls, labelled beta', () => {
    useDeployQueue.mockReturnValue(
      ready([dep(), dep({ id: 'e'.repeat(32), status: 'building', revision: 8 })])
    );
    render(<DeployQueue onOpen={vi.fn()} />);
    const panel = screen.getByRole('region', { name: 'Deploy queue' });
    expect(panel).toHaveTextContent('Beta');
    const [waiting, building] = within(panel).getAllByRole('listitem');
    expect(waiting).toHaveTextContent('alpha');
    expect(waiting).toHaveTextContent('v7');
    expect(within(waiting).getByRole('button', { name: 'Deploy now' })).toBeEnabled();
    expect(within(waiting).getByRole('button', { name: 'Background' })).toBeEnabled();
    expect(within(waiting).getByRole('button', { name: 'Cancel' })).toBeEnabled();
    // The builder has claimed it: only cancel is left.
    expect(within(building).queryByRole('button', { name: 'Deploy now' })).toBeNull();
    expect(within(building).getByRole('button', { name: 'Cancel' })).toBeEnabled();
  });

  it('deploys a waiting release next with priority 0, then offers to put it back in turn', async () => {
    render(<DeployQueue onOpen={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Deploy now' }));
    expect(reorder).toHaveBeenCalledWith({ id: 'd'.repeat(32), priority: 0 });
    expect(await screen.findByText('Deploys next')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'In turn' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deploy now' })).toBeNull();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }));
  });

  it('moves a waiting release to the background with priority 1000', async () => {
    reorder.mockResolvedValue({ id: 'd'.repeat(32), priority: 1000 });
    render(<DeployQueue onOpen={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Background' }));
    expect(reorder).toHaveBeenCalledWith({ id: 'd'.repeat(32), priority: 1000 });
    expect(await screen.findByText('Waits for everything else')).toBeInTheDocument();
  });

  it('cancels only after a destructive confirmation, through the app-scoped route', async () => {
    confirm.mockResolvedValueOnce(false);
    render(<DeployQueue onOpen={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ destructive: true }));
    expect(cancel).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith({ slug: 'alpha', id: 'd'.repeat(32) }));
  });

  it('reads a reorder that lost the race as timing, not as an error', async () => {
    reorder.mockRejectedValue(problem(409, 'deployment_reorder_not_pending'));
    render(<DeployQueue onOpen={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Deploy now' }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'info', title: 'Already left the queue' })
      )
    );
  });

  it('reads a cancel of a release that went live as timing and points at rollback', async () => {
    cancel.mockRejectedValue(problem(409, 'deployment_cancel_live_forbidden'));
    render(<DeployQueue onOpen={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'info', title: 'Already live' })
      )
    );
  });

  it.each([
    ['plan-not-entitled', /needs the hobby plan/i],
    ['off', /not enabled for this account/i],
    ['runtime-unavailable', /unavailable on this installation/i],
  ])('keeps cancel but not reorder when queue controls are %s', (state, note) => {
    access = state;
    render(<DeployQueue onOpen={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Deploy now' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Background' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    expect(screen.getByRole('region', { name: 'Deploy queue' })).toHaveTextContent(note);
  });

  it('opens the release so the rest of its controls are one click away', async () => {
    const onOpen = vi.fn();
    render(<DeployQueue onOpen={onOpen} />);
    await userEvent.click(screen.getByRole('button', { name: /open release v7/i }));
    expect(onOpen).toHaveBeenCalledWith('d'.repeat(32));
  });

  it('says when nothing is queued, and shows a read failure as an error', () => {
    useDeployQueue.mockReturnValue(ready([]));
    const { unmount } = render(<DeployQueue onOpen={vi.fn()} />);
    expect(screen.getByRole('region', { name: 'Deploy queue' })).toHaveTextContent(
      /nothing is waiting to deploy/i
    );
    unmount();
    useDeployQueue.mockReturnValue({
      data: undefined,
      error: problem(500, 'internal'),
      isPending: false,
      refetch: vi.fn(),
    });
    render(<DeployQueue onOpen={vi.fn()} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
