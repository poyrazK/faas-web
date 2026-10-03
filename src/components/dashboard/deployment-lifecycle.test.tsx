import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import type { ReactNode } from 'react';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    search,
    children,
  }: {
    to: string;
    search: Record<string, string>;
    children: ReactNode;
  }) => <a href={`${to}?${new URLSearchParams(search)}`}>{children}</a>,
}));

const cancel = vi.fn();
const retry = vi.fn();
const toast = vi.fn();
const confirm = vi.fn();

vi.mock('@/lib/api/queries', () => ({
  useCancelDeployment: () => ({ mutateAsync: cancel, isPending: false }),
  useRetryDeployment: () => ({ mutateAsync: retry, isPending: false }),
  useApps: () => ({ data: [{ id: 'app1', slug: 'api' }] }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));

const { DeploymentLifecycle } = await import('./deployment-lifecycle');

function deployment(status: string) {
  return { id: 'd'.repeat(32), app_id: 'app1', status } as never;
}

beforeEach(() => {
  cancel.mockReset();
  retry.mockReset();
  toast.mockReset();
  confirm.mockReset().mockResolvedValue(true);
});

describe('DeploymentLifecycle', () => {
  it('confirms an immutable full retry and links to the new record', async () => {
    retry.mockResolvedValue({ id: 'new-deployment' });
    render(<DeploymentLifecycle deployment={deployment('failed')} />);
    await userEvent.click(screen.getByRole('button', { name: 'Retry deployment' }));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Retry this failed deployment?',
        description: expect.stringContaining('recorded source/image and release inputs'),
      })
    );
    expect(retry).toHaveBeenCalledWith({ id: 'd'.repeat(32), from_stage: 'source_download' });
    expect(await screen.findByRole('link', { name: 'View new deployment' })).toHaveAttribute(
      'href',
      '/dashboard/deployments?deployment=new-deployment&releaseSection=overview'
    );
    expect(screen.getByRole('status')).toHaveTextContent('failed record is unchanged');
    expect(screen.getByRole('button', { name: 'Retry deployment' })).toBeDisabled();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it.each(['cancel', 'retry'] as const)(
    'declining %s confirmation sends no mutation',
    async (action) => {
      confirm.mockResolvedValue(false);
      render(
        <DeploymentLifecycle deployment={deployment(action === 'cancel' ? 'building' : 'failed')} />
      );
      await userEvent.click(
        screen.getByRole('button', {
          name: action === 'cancel' ? 'Cancel deployment' : 'Retry deployment',
        })
      );
      expect(confirm).toHaveBeenCalledOnce();
      expect(cancel).not.toHaveBeenCalled();
      expect(retry).not.toHaveBeenCalled();
    }
  );

  it.each(['cancel', 'retry'] as const)(
    'locks %s before the confirmation promise resolves',
    async (action) => {
      let answer!: (value: boolean) => void;
      confirm.mockReturnValue(
        new Promise<boolean>((resolve) => {
          answer = resolve;
        })
      );
      const mutation = action === 'cancel' ? cancel : retry;
      mutation.mockReturnValue(new Promise(() => {}));
      render(
        <DeploymentLifecycle deployment={deployment(action === 'cancel' ? 'building' : 'failed')} />
      );
      await userEvent.dblClick(
        screen.getByRole('button', {
          name: action === 'cancel' ? 'Cancel deployment' : 'Retry deployment',
        })
      );
      expect(confirm).toHaveBeenCalledOnce();
      expect(mutation).not.toHaveBeenCalled();
      answer(true);
      await waitFor(() => expect(mutation).toHaveBeenCalledOnce());
    }
  );

  it.each(['live', 'superseded', 'cancelled', 'future-state'])(
    'explains unavailable recovery for %s',
    (status) => {
      render(<DeploymentLifecycle deployment={deployment(status)} />);
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      expect(screen.getByText(/unavailable|already cancelled/i)).toBeInTheDocument();
    }
  );

  it('cancels against the app slug after confirmation', async () => {
    cancel.mockResolvedValue({});
    render(<DeploymentLifecycle deployment={deployment('building')} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel deployment' }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith({ slug: 'api', id: 'd'.repeat(32) }));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Deployment cancelled' }));
  });

  it.each(['cancel', 'retry'] as const)(
    'does not submit %s after the deployment changes state in an open dialog',
    async (action) => {
      let answer!: (value: boolean) => void;
      confirm.mockReturnValue(
        new Promise<boolean>((resolve) => {
          answer = resolve;
        })
      );
      const view = render(
        <DeploymentLifecycle deployment={deployment(action === 'cancel' ? 'building' : 'failed')} />
      );
      await userEvent.click(
        screen.getByRole('button', {
          name: action === 'cancel' ? 'Cancel deployment' : 'Retry deployment',
        })
      );
      view.rerender(<DeploymentLifecycle deployment={deployment('live')} />);
      answer(true);
      expect(await screen.findByRole('alert')).toHaveTextContent('state changed');
      expect(cancel).not.toHaveBeenCalled();
      expect(retry).not.toHaveBeenCalled();
    }
  );

  it('does not retry an old selection after the dialog owner unmounts', async () => {
    let answer!: (value: boolean) => void;
    confirm.mockReturnValue(
      new Promise<boolean>((resolve) => {
        answer = resolve;
      })
    );
    const view = render(<DeploymentLifecycle deployment={deployment('failed')} />);
    await userEvent.click(screen.getByRole('button', { name: 'Retry deployment' }));
    view.unmount();
    answer(true);
    await Promise.resolve();
    expect(retry).not.toHaveBeenCalled();
  });

  it.each(['cancel', 'retry'] as const)('keeps %s permission errors inline', async (action) => {
    (action === 'cancel' ? cancel : retry).mockRejectedValue(
      new ApiError({ status: 403, code: 'forbidden', title: 'Deploy permission required' })
    );
    render(
      <DeploymentLifecycle deployment={deployment(action === 'cancel' ? 'building' : 'failed')} />
    );
    await userEvent.click(
      screen.getByRole('button', {
        name: action === 'cancel' ? 'Cancel deployment' : 'Retry deployment',
      })
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('do not have permission');
    expect(screen.queryByRole('link', { name: 'View new deployment' })).not.toBeInTheDocument();
  });

  it.each(['cancel', 'retry'] as const)(
    'explains inaccessible %s targets without inventing a result',
    async (action) => {
      (action === 'cancel' ? cancel : retry).mockRejectedValue(
        new ApiError({ status: 404, code: 'not_found', title: 'Not found' })
      );
      render(
        <DeploymentLifecycle deployment={deployment(action === 'cancel' ? 'building' : 'failed')} />
      );
      await userEvent.click(
        screen.getByRole('button', {
          name: action === 'cancel' ? 'Cancel deployment' : 'Retry deployment',
        })
      );
      expect(await screen.findByRole('alert')).toHaveTextContent('unavailable to your account');
    }
  );

  it.each(['failed', 'cancelled', 'live'])(
    'explains a cancellation race with %s accurately',
    async (status) => {
      cancel.mockRejectedValue(
        new ApiError({ status: 409, code: 'conflict', title: `Deployment is ${status}` })
      );
      render(<DeploymentLifecycle deployment={deployment('building')} />);
      await userEvent.click(screen.getByRole('button', { name: 'Cancel deployment' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(`Deployment is ${status}`);
      expect(screen.getByRole('alert')).not.toHaveTextContent('already live');
    }
  );

  it.each([
    ['source_invalid', 'Original archive no longer available', 'original source is unavailable'],
    ['conflict', 'Deployment is no longer failed', 'current state'],
  ])('explains retry rejection %s', async (code, title, expected) => {
    retry.mockRejectedValue(new ApiError({ status: 409, code, title }));
    render(<DeploymentLifecycle deployment={deployment('failed')} />);
    await userEvent.click(screen.getByRole('button', { name: 'Retry deployment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(expected);
    expect(screen.getByRole('button', { name: 'Retry deployment' })).toBeEnabled();
  });

  it('prevents another retry after a dropped response until history is checked', async () => {
    retry.mockRejectedValue(new TypeError('Connection dropped'));
    render(<DeploymentLifecycle deployment={deployment('failed')} />);
    await userEvent.click(screen.getByRole('button', { name: 'Retry deployment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('outcome is unknown');
    expect(screen.getByRole('button', { name: 'Retry deployment' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Check deployment history' })).toHaveAttribute(
      'href',
      '/dashboard/deployments?'
    );
  });

  it.each([{}, { id: 'd'.repeat(32) }])(
    'handles an accepted retry without a valid new identity safely',
    async (result) => {
      retry.mockResolvedValue(result);
      render(<DeploymentLifecycle deployment={deployment('failed')} />);
      await userEvent.click(screen.getByRole('button', { name: 'Retry deployment' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'did not identify a new deployment'
      );
      expect(screen.getByRole('button', { name: 'Retry deployment' })).toBeDisabled();
      expect(screen.queryByRole('link', { name: 'View new deployment' })).not.toBeInTheDocument();
    }
  );
});
