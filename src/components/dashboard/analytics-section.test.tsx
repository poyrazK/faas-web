import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/**
 * The overview already carries a section headed "Analytics" — the account's
 * scalars for the last 24 hours. This one is the request series for a single
 * app, and it shipped briefly with the same heading, nested inside that
 * section, so the page showed two Analytics blocks one above the other.
 *
 * The name is the fix and the test is the guard: whatever this section is
 * called, it cannot be called what the block above it is called.
 */
vi.mock('@/lib/api/queries', () => ({
  useAppAnalyticsTimeseries: () => ({
    data: { points: [], since: '24h', window_clamped: false },
    isPending: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

const { AnalyticsSection } = await import('./analytics-section');

describe('AnalyticsSection', () => {
  it('does not take the heading the overview already uses', () => {
    render(<AnalyticsSection apps={[{ slug: 'api' }]} slug="api" onSelectApp={vi.fn()} />);
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading).toHaveTextContent('Request analytics');
    expect(heading).not.toHaveTextContent(/^Analytics$/);
  });

  it('names the app it is scoped to, since the figures are one app’s', () => {
    render(<AnalyticsSection apps={[{ slug: 'api' }]} slug="api" onSelectApp={vi.fn()} />);
    expect(screen.getByLabelText('Select an app')).toHaveTextContent('api');
  });
});
