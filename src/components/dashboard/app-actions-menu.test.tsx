import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workflow } from '@/lib/mock-data';
import { AppActionsMenu } from './app-actions-menu';

const mocks = vi.hoisted(() => ({
  redeploy: vi.fn(),
  confirm: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => mocks.confirm }));
vi.mock('@/lib/store', () => ({ useData: () => ({ redeploy: mocks.redeploy }) }));
vi.mock('@/lib/api/queries', () => ({
  useParkApp: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useWakeApp: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('./app-lifecycle', () => ({ useRestartAction: () => ({ run: vi.fn(), pending: false }) }));
vi.mock('./preview-actions', () => ({ useTearDownPreview: () => ({ available: false }) }));

const app = { id: 'alpha', name: 'alpha', state: 'running' } as Workflow;

beforeEach(() => {
  mocks.redeploy.mockReset().mockResolvedValue({ id: '0123456789abcdef0123456789abcdef' });
  mocks.confirm.mockReset().mockResolvedValue(true);
  mocks.toast.mockReset();
});

describe('App actions: roll back', () => {
  it('reports a queued rollback, not a finished one', async () => {
    const user = userEvent.setup();
    render(<AppActionsMenu app={app} canRollback isDeploying={false} />);
    await user.click(screen.getByRole('button', { name: 'More app actions' }));
    await user.click(
      within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Roll back' })
    );
    await waitFor(() => expect(mocks.redeploy).toHaveBeenCalledWith('alpha'));
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith({
        kind: 'success',
        title: 'Rollback queued',
        description: 'New deployment 0123456789ab is being prepared.',
      })
    );
    expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Rolled back' }));
  });
});
