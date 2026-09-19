import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { SloPanel } from './app-core-panels';

const useAppSlo = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/queries', async (original) => ({
  ...(await original<object>()),
  useAppSlo,
}));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ account: { plan: 'hobby' }, loading: false }),
}));

const slo = {
  app_id: 'a',
  app_slug: 'alpha',
  window: '24h',
  source: 'prometheus',
  as_of: '2026-09-19T12:00:00Z',
  requests_total: 1234,
  error_rate_pct: 1.25,
  cold_boot_rate_pct: 2.75,
  request_duration: { p50_ms: 12, p95_ms: 53, p99_ms: 104 },
  throttled_total: 0,
  instance_hours: 2,
  gb_hours: 1,
};

beforeEach(() => useAppSlo.mockReset());

it.each([
  ['unavailable', 'Wake-queue telemetry unavailable.'],
  ['no_sample', 'No wake-queue samples in this window.'],
])('keeps other SLO metrics visible when wake-queue latency is %s', (status, message) => {
  useAppSlo.mockReturnValue({
    data: { ...slo, wake_queue_p95_ms: null, wake_queue_sample_status: status },
    isPending: false,
    error: null,
  });
  render(<SloPanel slug="alpha" />);
  expect(screen.getByText('—')).toBeInTheDocument();
  expect(screen.getByText(message)).toBeInTheDocument();
  expect(screen.getByText('53.0 ms')).toBeInTheDocument();
  expect(screen.getByText('1,234')).toBeInTheDocument();
  expect(screen.queryByText('0.0 ms')).not.toBeInTheDocument();
});

it.each([0, 12.34])('preserves measured wake-queue latency, including zero (%s)', (value) => {
  useAppSlo.mockReturnValue({
    data: { ...slo, wake_queue_p95_ms: value, wake_queue_sample_status: 'available' },
    isPending: false,
    error: null,
  });
  render(<SloPanel slug="alpha" />);
  expect(screen.getByText(value === 0 ? '0.0 ms' : '12.3 ms')).toBeInTheDocument();
  expect(screen.queryByText('—')).not.toBeInTheDocument();
});
