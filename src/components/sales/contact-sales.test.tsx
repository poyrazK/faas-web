import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { withRouter } from '@/test/router';
import { ApiError } from '@/lib/api/errors';
import { ContactSales } from './contact-sales';

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), submit: vi.fn() }));
vi.mock('@/lib/api/sales-intake', () => ({
  prepareSalesInquiry: mocks.prepare,
  submitSalesInquiry: mocks.submit,
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.prepare.mockResolvedValue({
    challenge: 'opaque-token',
    ready_after_ms: 0,
    expires_in_seconds: 3600,
  });
  mocks.submit.mockResolvedValue({ accepted: true });
});
async function fill() {
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send request' })).toBeEnabled(), {
    timeout: 5000,
  });
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Maya Chen  ' } });
  fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'MAYA@EXAMPLE.COM' } });
  fireEvent.change(screen.getByLabelText('What are you building?'), {
    target: { value: 'A team API' },
  });
}
describe('contact sales', () => {
  it('submits a demo request with normalized optional code and shows confirmation', async () => {
    render(withRouter(<ContactSales />));
    await fill();
    fireEvent.change(screen.getByLabelText(/Salesperson code/), { target: { value: 'poju43' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await screen.findByText('Message received');
    expect(mocks.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Maya Chen',
        email: 'maya@example.com',
        intent: 'demo',
        salesperson_code: 'POJU43',
        challenge: 'opaque-token',
      })
    );
  });
  it('keeps the same token and message after an uncertain result, making retry idempotent', async () => {
    mocks.submit.mockRejectedValueOnce(new Error('network'));
    render(withRouter(<ContactSales />));
    await fill();
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await screen.findByRole('alert');
    expect(screen.getByLabelText('What are you building?')).toHaveValue('A team API');
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await screen.findByText('Message received');
    expect(mocks.submit.mock.calls[0][0].challenge).toBe(mocks.submit.mock.calls[1][0].challenge);
    expect(mocks.submit.mock.calls[1][0].salesperson_code).toBe('');
  });
  it('refreshes an expired challenge without erasing the form', async () => {
    mocks.submit.mockRejectedValueOnce(
      new ApiError({ status: 400, code: 'sales_challenge_invalid', title: 'Expired' })
    );
    mocks.prepare
      .mockResolvedValueOnce({ challenge: 'old', ready_after_ms: 0, expires_in_seconds: 3600 })
      .mockResolvedValueOnce({ challenge: 'fresh', ready_after_ms: 0, expires_in_seconds: 3600 });
    render(withRouter(<ContactSales />));
    await fill();
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await screen.findByText(/form check expired/i);
    await waitFor(() => expect(mocks.prepare).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send request' })).toBeEnabled());
    expect(screen.getByLabelText('Name')).toHaveValue('  Maya Chen  ');
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await screen.findByText('Message received');
    expect(mocks.submit.mock.calls[1][0].challenge).toBe('fresh');
  });
  it('enforces UTF-8 byte limits and offers recovery when the check is unreachable', async () => {
    mocks.prepare.mockRejectedValueOnce(new Error('offline'));
    render(withRouter(<ContactSales />));
    fireEvent.click(await screen.findByRole('button', { name: 'Retry form check' }));
    await fill();
    fireEvent.change(screen.getByLabelText('What are you building?'), {
      target: { value: '界'.repeat(501) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('1500 bytes');
    expect(mocks.submit).not.toHaveBeenCalled();
  });
});
