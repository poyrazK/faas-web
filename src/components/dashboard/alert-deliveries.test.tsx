import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useAlertDeliveries = vi.fn();
vi.mock('@/lib/api/queries', () => ({
  useAlertDeliveries: (slug: string, id: string, includeTest: boolean) =>
    useAlertDeliveries(slug, id, includeTest) as unknown,
}));

const { AlertDeliveries } = await import('./alert-deliveries');

function delivery(over: Record<string, unknown> = {}) {
  return {
    id: 'd1',
    rule_id: 'r1',
    account_id: 'a1',
    idempotency_key: 'r1:1',
    status: 'delivered',
    attempt_count: 1,
    observed_value: 12.5,
    fired_at: '2026-09-06T10:00:00Z',
    delivered_at: '2026-09-06T10:00:02Z',
    is_test: false,
    ...over,
  };
}

function result(items: unknown[]) {
  return { data: items, isPending: false, error: null, refetch: vi.fn() };
}

beforeEach(() => {
  useAlertDeliveries.mockReset();
  useAlertDeliveries.mockReturnValue(result([delivery()]));
});

describe('AlertDeliveries', () => {
  it('lists a delivery with its status and observed value', () => {
    render(<AlertDeliveries slug="api" ruleId="r1" />);
    expect(screen.getByText('delivered')).toBeInTheDocument();
    expect(screen.getByText(/12.5/)).toBeInTheDocument();
  });

  it('shows the observed value, baseline, and comparison recorded for a fire', () => {
    useAlertDeliveries.mockReturnValue(
      result([
        delivery({
          observed_value: 4.2,
          anomaly: {
            metric: 'error_rate_pct',
            comparison: 'above_baseline',
            threshold: 3,
            window: '15m',
            baseline: 1.1,
            baseline_days: 6,
            ratio: 3.818182,
          },
        }),
      ])
    );
    render(<AlertDeliveries slug="api" ruleId="r1" />);
    const evidence = screen.getByText(/error rate 4\.2% vs\. 1\.1% usual over 15 minutes/i);
    expect(evidence).toHaveTextContent('3.818× usual, with a trigger at 3× or higher');
    expect(evidence).toHaveTextContent('6 historical windows qualified');
  });

  it('shows a confirmed drop to zero and the lower bound comparison', () => {
    useAlertDeliveries.mockReturnValue(
      result([
        delivery({
          observed_value: 0,
          anomaly: {
            metric: 'request_count',
            comparison: 'below_baseline',
            threshold: 0.3,
            window: '5m',
            baseline: 200,
            baseline_days: 7,
            ratio: 0,
          },
        }),
      ])
    );
    render(<AlertDeliveries slug="api" ruleId="r1" />);
    const evidence = screen.getByText(/requests 0 vs\. 200 usual over 5 minutes/i);
    expect(evidence).toHaveTextContent('0× usual, with a trigger at 0.3× or lower');
  });

  it('shows why a delivery failed', () => {
    useAlertDeliveries.mockReturnValue(
      result([
        delivery({
          status: 'failed',
          attempt_count: 3,
          last_status_code: 502,
          last_error: 'upstream refused the connection',
          delivered_at: undefined,
        }),
      ])
    );
    render(<AlertDeliveries slug="api" ruleId="r1" />);
    expect(screen.getByText(/upstream refused the connection/)).toBeInTheDocument();
    expect(screen.getByText(/502/)).toBeInTheDocument();
  });

  it('hides test deliveries until asked, then requests them', async () => {
    render(<AlertDeliveries slug="api" ruleId="r1" />);
    expect(useAlertDeliveries).toHaveBeenLastCalledWith('api', 'r1', false);
    await userEvent.click(screen.getByLabelText(/include test/i));
    expect(useAlertDeliveries).toHaveBeenLastCalledWith('api', 'r1', true);
  });

  it('says so when the rule has never fired', () => {
    useAlertDeliveries.mockReturnValue(result([]));
    render(<AlertDeliveries slug="api" ruleId="r1" />);
    expect(screen.getByText(/never fired/i)).toBeInTheDocument();
  });
});
