import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { RegressionTriage } from './debug-triage';

const hooks = vi.hoisted(() => ({
  review: vi.fn(),
  mutateAsync: vi.fn(),
  refetch: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('@/lib/api/debug', () => ({
  useDebugRegressionReview: hooks.review,
  useDebugRegressionAction: () => ({ mutateAsync: hooks.mutateAsync, isPending: false }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: hooks.toast }) }));

const record = {
  app_id: 'app-1',
  deployment_id: 'dep-1',
  route: '/orders/{id}',
  version: 'v-1',
  state: 'active',
  first_detected_at: '2026-11-03T10:00:00Z',
  last_detected_at: '2026-11-03T11:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  hooks.review.mockReturnValue({
    data: record,
    isPending: false,
    error: null,
    refetch: hooks.refetch,
  });
  hooks.mutateAsync.mockResolvedValue({});
});

const mount = () =>
  render(<RegressionTriage slug="api" deploymentId="dep-1" route="/orders/{id}" />);

describe('RegressionTriage', () => {
  it('reads the exact observation and offers the actions its state allows', () => {
    mount();
    expect(hooks.review).toHaveBeenCalledWith('api', 'dep-1', '/orders/{id}');
    expect(screen.getByText('Open')).toBeInTheDocument();
    for (const name of ['Acknowledge', 'Dismiss', 'Resolve'])
      expect(screen.getByRole('button', { name })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Reopen' })).not.toBeInTheDocument();
  });

  it('sends a checked action naming the version it was decided against, with the reason', async () => {
    mount();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Known slow query' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));
    });
    expect(hooks.mutateAsync).toHaveBeenCalledWith({
      deployment_id: 'dep-1',
      route: '/orders/{id}',
      action: 'acknowledge',
      expected_app_id: 'app-1',
      expected_version: 'v-1',
      reason: 'Known slow query',
    });
    expect(hooks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'success', title: 'Regression acknowledged' })
    );
  });

  it('dismisses until an absolute time within apid’s 30-day cap', async () => {
    mount();
    fireEvent.change(screen.getByLabelText('Reason'), {
      target: { value: 'Expected during migration' },
    });
    fireEvent.change(screen.getByLabelText('Dismiss for'), { target: { value: '30d' } });
    const before = Date.now();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    });
    const body = hooks.mutateAsync.mock.calls[0][0];
    expect(body.action).toBe('dismiss');
    const until = Date.parse(body.dismissed_until);
    expect(until).toBeGreaterThan(before + 29 * 24 * 3600_000);
    expect(until).toBeLessThan(before + 30 * 24 * 3600_000);
  });

  it('re-reads instead of retrying when the observation changed underneath', async () => {
    hooks.mutateAsync.mockRejectedValue(
      new ApiError({ status: 409, code: 'regression_changed', title: 'Regression changed' })
    );
    mount();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Fixed in #42' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    });
    expect(hooks.mutateAsync).toHaveBeenCalledTimes(1);
    expect(hooks.refetch).toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/changed after you opened it/);
    expect(hooks.toast).not.toHaveBeenCalled();
  });

  it('offers reopen from an acknowledged regression', () => {
    hooks.review.mockReturnValue({
      data: { ...record, state: 'acknowledged', acknowledged_at: '2026-11-03T11:30:00Z' },
      isPending: false,
      error: null,
      refetch: hooks.refetch,
    });
    mount();
    expect(screen.getByText('Acknowledged')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Acknowledge' })).not.toBeInTheDocument();
  });
});
