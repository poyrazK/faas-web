import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CreateOrgDialog } from './org-dialogs';

describe('CreateOrgDialog', () => {
  it('fills the slug from the name and submits both', () => {
    const onCreate = vi.fn();
    render(<CreateOrgDialog open onClose={() => {}} onCreate={onCreate} busy={false} />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Acme Robotics' } });
    expect(screen.getByLabelText('Slug')).toHaveValue('acme-robotics');
    fireEvent.click(screen.getByRole('button', { name: 'Create organisation' }));
    expect(onCreate).toHaveBeenCalledWith({ slug: 'acme-robotics', name: 'Acme Robotics' });
  });

  it('stops following the name once the slug is edited by hand', () => {
    render(<CreateOrgDialog open onClose={() => {}} onCreate={() => {}} busy={false} />);
    fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'custom' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Acme' } });
    expect(screen.getByLabelText('Slug')).toHaveValue('custom');
  });
});
