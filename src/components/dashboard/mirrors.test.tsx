import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MirrorForm } from './mirrors';

/** Source and mirror must differ; the button stays off until they do. */
describe('MirrorForm', () => {
  it('refuses the same deployment on both sides and submits explicit defaults', () => {
    const onSubmit = vi.fn();
    render(
      <MirrorForm
        deployments={[
          { id: 'd1', label: 'd1 · running' },
          { id: 'd2', label: 'd2 · ready' },
        ]}
        busy={false}
        onSubmit={onSubmit}
      />
    );
    fireEvent.change(screen.getByLabelText('Source deployment'), { target: { value: 'd1' } });
    fireEvent.change(screen.getByLabelText('Mirror deployment'), { target: { value: 'd1' } });
    expect(screen.getByRole('button', { name: 'Create mirror' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Mirror deployment'), { target: { value: 'd2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create mirror' }));
    expect(onSubmit).toHaveBeenCalledWith({
      source_deployment_id: 'd1',
      mirror_deployment_id: 'd2',
      percent: 100,
      include_body: false,
      redact_headers: ['authorization', 'cookie'],
    });
  });
});
