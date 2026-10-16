import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spyApi } from '@/test/api';
import { FocusExport, previousMonth } from './focus-export';

afterEach(() => vi.restoreAllMocks());

describe('previousMonth', () => {
  it('is the last closed UTC month, across a year boundary', () => {
    expect(previousMonth(new Date('2026-10-16T00:00:00Z'))).toBe('2026-09');
    expect(previousMonth(new Date('2026-01-03T00:00:00Z'))).toBe('2025-12');
  });
});

describe('FocusExport', () => {
  it('downloads the chosen month and format as a file', async () => {
    const get = spyApi('GET').mockResolvedValue({
      data: new Blob(['a,b']),
      response: new Response(),
    } as never);
    URL.createObjectURL = vi.fn().mockReturnValue('blob:focus');
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<FocusExport />);
    await userEvent.selectOptions(screen.getByLabelText('Format'), 'csv');
    await userEvent.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(get).toHaveBeenCalledWith(
      '/v1/billing/focus',
      expect.objectContaining({
        params: { query: { month: previousMonth(), format: 'csv' } },
        parseAs: 'blob',
      })
    );
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:focus');
  });

  it('shows the API refusal instead of downloading', async () => {
    spyApi('GET').mockResolvedValue({
      error: { status: 403, code: 'mfa_required', title: 'Verify with MFA to read billing.' },
      response: new Response(null, { status: 403 }),
    } as never);
    render(<FocusExport />);
    await userEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Verify with MFA');
  });
});
