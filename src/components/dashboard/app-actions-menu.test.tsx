import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workflow } from '@/lib/mock-data';
import { AppActionsMenu, RollbackButton } from './app-actions-menu';

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

describe('Roll back, beside Deploy', () => {
  it('names where it goes, confirms, and reports a queued rollback, not a finished one', async () => {
    const user = userEvent.setup();
    render(
      <RollbackButton
        app={app}
        target={{ version: 'v42', createdAt: Date.now() - 2 * 3_600_000 }}
        isDeploying={false}
      />
    );
    const button = screen.getByRole('button', { name: 'Roll back' });
    expect(button).toHaveAttribute('title', 'Go back to v42, deployed 2h ago');
    await user.click(button);
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Roll back alpha?',
        description: expect.stringMatching(/^alpha goes back to v42, deployed 2h ago\./),
      })
    );
    await waitFor(() => expect(mocks.redeploy).toHaveBeenCalledWith('alpha'));
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith({
        kind: 'success',
        title: 'Rollback queued',
        // apid re-activates the earlier deployment row; it writes no new one.
        description:
          'Returning to deployment 0123456789ab. It serves once its readiness check passes.',
      })
    );
    expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Rolled back' }));
  });

  it('does nothing when the confirmation is cancelled', async () => {
    mocks.confirm.mockResolvedValue(false);
    render(<RollbackButton app={app} target={null} isDeploying={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Roll back' }));
    expect(mocks.redeploy).not.toHaveBeenCalled();
  });

  it('waits while a deploy is running', () => {
    render(<RollbackButton app={app} target={null} isDeploying />);
    expect(screen.getByRole('button', { name: 'Roll back' })).toBeDisabled();
  });

  it('is no longer hidden in the actions menu', async () => {
    render(<AppActionsMenu app={app} />);
    await userEvent.click(screen.getByRole('button', { name: 'More app actions' }));
    expect(
      within(await screen.findByRole('menu')).queryByRole('menuitem', { name: /Roll back/ })
    ).not.toBeInTheDocument();
  });
});
