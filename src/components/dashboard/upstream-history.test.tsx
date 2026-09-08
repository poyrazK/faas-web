import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useUpstreamHistory = vi.fn();
vi.mock('@/lib/api/queries', () => ({
  useUpstreamHistory: (slug: string, bucket: string) => useUpstreamHistory(slug, bucket) as unknown,
}));
vi.mock('@/components/dither-kit', () => ({
  Sparkline: () => <div data-testid="sparkline" />,
}));

const { UpstreamHistoryPanel } = await import('./upstream-history');

const row = (over: Record<string, unknown> = {}) => ({
  host_redacted_hash: 'abcdef0123456789',
  kind: 'postgres',
  port: 5432,
  region: 'fra',
  buckets: [
    { sampled_at: '2026-09-08T08:00:00Z', p50_ms: 4, p95_ms: 11, sample_count: 12 },
    { sampled_at: '2026-09-08T09:00:00Z', p50_ms: 6, p95_ms: 18, sample_count: 12 },
  ],
  ...over,
});

beforeEach(() => {
  useUpstreamHistory.mockReset().mockReturnValue({ data: [row()], isPending: false, error: null });
});

describe('UpstreamHistoryPanel', () => {
  it('states the last measured pair in words, not only as a line', () => {
    render(<UpstreamHistoryPanel slug="api" />);
    expect(screen.getByText(/p50 6 ms · p95 18 ms/)).toBeInTheDocument();
    expect(screen.getByText('24 samples')).toBeInTheDocument();
    expect(screen.getByTestId('sparkline')).toBeInTheDocument();
  });

  it('says when an upstream was never reached instead of drawing zero', () => {
    useUpstreamHistory.mockReturnValue({
      data: [
        row({
          buckets: [
            { sampled_at: '2026-09-08T08:00:00Z', p50_ms: null, p95_ms: null, sample_count: 0 },
          ],
        }),
      ],
      isPending: false,
      error: null,
    });
    render(<UpstreamHistoryPanel slug="api" />);
    expect(screen.getByText('no successful probe')).toBeInTheDocument();
    expect(screen.queryByTestId('sparkline')).not.toBeInTheDocument();
  });

  it('explains an empty result rather than showing a blank panel', () => {
    useUpstreamHistory.mockReturnValue({ data: [], isPending: false, error: null });
    render(<UpstreamHistoryPanel slug="api" />);
    expect(screen.getByText(/no probe samples in this window/i)).toBeInTheDocument();
  });
});
