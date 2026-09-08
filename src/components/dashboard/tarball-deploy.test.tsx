import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

const deploy = vi.fn();
const toast = vi.fn();

vi.mock('@/lib/api/queries', () => ({
  useDeployTarball: () => ({ mutateAsync: deploy, isPending: false }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));

const { TarballDeploy } = await import('./tarball-deploy');

const archive = () => new File(['source'], 'app.tar.gz', { type: 'application/gzip' });

beforeEach(() => {
  deploy.mockReset().mockResolvedValue({ id: 'dep12345678' });
  toast.mockReset();
});

describe('TarballDeploy', () => {
  it('will not submit without an archive', () => {
    render(<TarballDeploy slug="api" />);
    expect(screen.getByRole('button', { name: /deploy archive/i })).toBeDisabled();
  });

  it('sends the archive with the annotations that make it auditable', async () => {
    const onDeployed = vi.fn();
    render(<TarballDeploy slug="api" onDeployed={onDeployed} />);
    await userEvent.upload(screen.getByLabelText('Source tarball'), archive());
    await userEvent.type(screen.getByLabelText('Deploy reason'), 'restoring the pre-outage build');
    await userEvent.selectOptions(screen.getByLabelText('Deploy tag'), 'incident_recovery');
    await userEvent.click(screen.getByRole('button', { name: /deploy archive/i }));
    await waitFor(() =>
      expect(deploy).toHaveBeenCalledWith(
        expect.objectContaining({
          sidecar: { reason: 'restoring the pre-outage build', tag: 'incident_recovery' },
        })
      )
    );
    expect(onDeployed).toHaveBeenCalledWith('dep12345678');
  });

  it('explains a 413 as the archive being too large', async () => {
    deploy.mockRejectedValue(
      new ApiError({ status: 413, code: 'source_too_large', title: 'Too large' })
    );
    render(<TarballDeploy slug="api" />);
    await userEvent.upload(screen.getByLabelText('Source tarball'), archive());
    await userEvent.click(screen.getByRole('button', { name: /deploy archive/i }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Archive too large' }));
  });
});
