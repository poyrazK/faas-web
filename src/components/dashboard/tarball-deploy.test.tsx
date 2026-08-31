import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TarballDeployForm } from './tarball-deploy';

/** The button stays off until a .tar.gz is chosen; a .zip is refused inline. */
describe('TarballDeployForm', () => {
  it('rejects a non-tarball and enables on a tarball', () => {
    const onSubmit = vi.fn();
    render(<TarballDeployForm busy={false} onSubmit={onSubmit} />);
    const input = screen.getByLabelText('Archive');
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.zip')] } });
    expect(screen.getByText(/only \.tar\.gz/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deploy archive' })).toBeDisabled();
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.tar.gz')] } });
    expect(screen.getByRole('button', { name: 'Deploy archive' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Deploy archive' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.any(File), {});
  });

  it('passes the filled annotations through the sidecar', () => {
    const onSubmit = vi.fn();
    render(<TarballDeployForm busy={false} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('Archive'), {
      target: { files: [new File(['x'], 'a.tgz')] },
    });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'first deploy' } });
    fireEvent.click(screen.getByRole('button', { name: 'Deploy archive' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.any(File), { reason: 'first deploy' });
  });
});
