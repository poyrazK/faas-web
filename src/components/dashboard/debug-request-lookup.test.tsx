import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DebugRequestLookup } from './debug-request-lookup';

describe('DebugRequestLookup', () => {
  it('opens the evidence of the request ID a response carried, trimmed', async () => {
    const onOpen = vi.fn();
    render(<DebugRequestLookup onOpen={onOpen} />);
    const submit = screen.getByRole('button', { name: 'Open request details' });
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/x-faas-request-id/), '  0f9c2e7a51b84d6e  ');
    await userEvent.click(submit);
    expect(onOpen).toHaveBeenCalledWith('0f9c2e7a51b84d6e');
  });

  it('caps the ID at the 128 characters the API accepts', () => {
    render(<DebugRequestLookup onOpen={vi.fn()} />);
    expect(screen.getByLabelText(/x-faas-request-id/)).toHaveAttribute('maxLength', '128');
  });
});
