import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

const useAuditEvent = vi.fn();
vi.mock('@/lib/api/queries', () => ({
  useAuditEvent: (id: string) => useAuditEvent(id) as unknown,
}));

const { AuthEventDetail } = await import('./auth-event-detail');

beforeEach(() => {
  useAuditEvent.mockReset().mockReturnValue({
    data: {
      id: '1042',
      at: '2026-09-08T09:00:00Z',
      actor: 'demo@acme.example',
      kind: 'session.signed_in',
      subject: 'google-oauth',
      severity: 'info',
      data: { method: 'google', ip: '203.0.113.9' },
    },
    isPending: false,
    error: null,
  });
});

describe('AuthEventDetail', () => {
  it('shows every field the API returned, payload included', () => {
    render(<AuthEventDetail id="1042" onClose={vi.fn()} />);
    expect(screen.getByText('session.signed_in')).toBeInTheDocument();
    expect(screen.getByText('google-oauth')).toBeInTheDocument();
    expect(screen.getByText(/"ip": "203\.0\.113\.9"/)).toBeInTheDocument();
  });

  it('reads not_found as no such event, not as a permissions problem', () => {
    useAuditEvent.mockReturnValue({
      data: undefined,
      isPending: false,
      error: new ApiError({ status: 404, code: 'not_found', title: 'Not found' }),
    });
    render(<AuthEventDetail id="9" onClose={vi.fn()} />);
    expect(screen.getByText(/no such event on this account/i)).toBeInTheDocument();
  });

  it('stays closed without an id', () => {
    useAuditEvent.mockReturnValue({ data: undefined, isPending: false, error: null });
    render(<AuthEventDetail id={null} onClose={vi.fn()} />);
    expect(screen.queryByText(/auth event/i)).not.toBeInTheDocument();
  });
});
