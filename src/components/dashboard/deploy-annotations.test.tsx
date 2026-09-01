import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_ANNOTATIONS } from '@/lib/deploy-annotations';
import { DeployAnnotations } from './deploy-annotations';

/** Four controlled fields; every edit reports the whole draft back. */
describe('DeployAnnotations', () => {
  it('reports a new draft when the reason changes and counts characters', () => {
    const onChange = vi.fn();
    render(<DeployAnnotations value={EMPTY_ANNOTATIONS} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'rotate keys' } });
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_ANNOTATIONS, reason: 'rotate keys' });
    expect(screen.getByText('0 / 280')).toBeInTheDocument();
  });

  it('offers the five tags plus none', () => {
    render(<DeployAnnotations value={EMPTY_ANNOTATIONS} onChange={() => {}} />);
    expect(screen.getByLabelText('Tag').querySelectorAll('option')).toHaveLength(6);
  });

  it('keeps the pull request field numeric', () => {
    const onChange = vi.fn();
    render(<DeployAnnotations value={EMPTY_ANNOTATIONS} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Pull request'), { target: { value: '12a' } });
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_ANNOTATIONS, pr_number: '12' });
  });
});
