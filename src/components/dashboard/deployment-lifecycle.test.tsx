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
  it('links to the returned deployment after retry, not the failed record', async () => {
    retry.mockResolvedValue({ id: 'new-deployment' });
    render(<DeploymentLifecycle deployment={deployment('failed')} />);
    await userEvent.click(screen.getByRole('button', { name: 'Retry deployment' }));
    expect(await screen.findByRole('link', { name: 'View new deployment' })).toHaveAttribute(
      'href',
      '/dashboard/deployments?deployment=new-deployment&releaseSection=overview'
    );
  });
  it('preserves retry stage and displays a rejected mutation inline', async () => {
    retry.mockRejectedValue(
      new ApiError({ status: 403, code: 'forbidden', title: 'Deploy permission required' })
    );
    render(<DeploymentLifecycle deployment={deployment('failed')} />);
    await userEvent.selectOptions(screen.getByLabelText(/resume from/i), 'image_build');
    await userEvent.click(screen.getByRole('button', { name: 'Retry deployment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Deploy permission required');
    expect(screen.getByLabelText(/resume from/i)).toHaveValue('image_build');
    expect(screen.queryByRole('link', { name: 'View new deployment' })).not.toBeInTheDocument();
  });
  it('does not submit twice while a retry is unresolved', async () => {
    retry.mockReturnValue(new Promise(() => {}));
    render(<DeploymentLifecycle deployment={deployment('failed')} />);
    await userEvent.dblClick(screen.getByRole('button', { name: 'Retry deployment' }));
    expect(retry).toHaveBeenCalledOnce();
  });
  it('offers cancel while a deployment is in flight', () => {
    render(<DeploymentLifecycle deployment={deployment('building')} />);
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^retry/i })).not.toBeInTheDocument();
  });

  it('offers retry once a deployment has failed', () => {
    render(<DeploymentLifecycle deployment={deployment('failed')} />);
    expect(screen.getByRole('button', { name: /^retry/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument();
  });

  it('offers neither once a deployment is live', () => {
    render(<DeploymentLifecycle deployment={deployment('live')} />);
    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^retry/i })).not.toBeInTheDocument();
  });

  it('cancels against the app slug, behind a confirm', async () => {
    cancel.mockResolvedValue({});
    render(<DeploymentLifecycle deployment={deployment('building')} />);
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith({ slug: 'api', id: 'd'.repeat(32) }));
    expect(confirm).toHaveBeenCalled();
  });

  it('explains a 409 as the deployment already being live', async () => {
    cancel.mockRejectedValue(
      new ApiError({ status: 409, code: 'conflict', title: 'Live deployment' })
    );
    render(<DeploymentLifecycle deployment={deployment('building')} />);
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringMatching(/already live/i) })
    );
  });

  it('retries from the chosen stage', async () => {
    retry.mockResolvedValue({});
    render(<DeploymentLifecycle deployment={deployment('failed')} />);
    await userEvent.selectOptions(screen.getByLabelText(/resume from/i), 'image_build');
    await userEvent.click(screen.getByRole('button', { name: /^retry/i }));
    await waitFor(() =>
      expect(retry).toHaveBeenCalledWith({ id: 'd'.repeat(32), from_stage: 'image_build' })
    );
  });
});
