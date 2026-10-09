import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/dither-kit', () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="chart">{children}</div>
  ),
  Line: ({ dataKey, strokeVariant }: { dataKey: string; strokeVariant?: string }) => (
    <span data-testid={`series-${dataKey}`} data-stroke={strokeVariant ?? 'solid'} />
  ),
  Grid: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

const { UsageTrendPanel } = await import('./usage-trend');

const NOW = Date.parse('2026-10-09T15:00:00Z');
const daily = [
  { date: '2026-09-30', gb_hours: 40 },
  { date: '2026-10-01', gb_hours: 2, top_app_slug: 'web', top_app_gb_hours: 1 },
  { date: '2026-10-02', gb_hours: 9, top_app_slug: 'api', top_app_gb_hours: 7.5 },
  { date: '2026-10-03', gb_hours: 3 },
];

describe('UsageTrendPanel', () => {
  it('draws the running total against a dashed allowance', () => {
    render(
      <UsageTrendPanel
        daily={daily}
        month="2026-10"
        usedGbHours={15}
        includedGbHours={50}
        now={NOW}
      />
    );

    expect(screen.getByTestId('series-used')).toHaveAttribute('data-stroke', 'solid');
    expect(screen.getByTestId('series-included')).toHaveAttribute('data-stroke', 'dashed');
  });

  it('states how far the daily rollups trail the live total', () => {
    render(
      <UsageTrendPanel
        daily={daily}
        month="2026-10"
        usedGbHours={15}
        includedGbHours={50}
        now={NOW}
      />
    );

    expect(screen.getByText(/Daily rollups: 14 GB-h · live total: 15 GB-h/)).toBeInTheDocument();
  });

  it('names the biggest day and the app behind it', () => {
    render(
      <UsageTrendPanel
        daily={daily}
        month="2026-10"
        usedGbHours={15}
        includedGbHours={50}
        now={NOW}
      />
    );

    expect(
      screen.getByText(/Biggest day: Oct 2 — 9 GB-h, mostly api \(7\.5 GB-h\)/)
    ).toBeInTheDocument();
  });

  it('leaves out the allowance line when the plan includes none', () => {
    render(
      <UsageTrendPanel
        daily={daily}
        month="2026-10"
        usedGbHours={15}
        includedGbHours={0}
        now={NOW}
      />
    );

    expect(screen.getByTestId('series-used')).toBeInTheDocument();
    expect(screen.queryByTestId('series-included')).not.toBeInTheDocument();
  });

  it('says so instead of drawing when there are no rollups for the month', () => {
    render(
      <UsageTrendPanel daily={[]} month="2026-10" usedGbHours={0} includedGbHours={50} now={NOW} />
    );

    expect(screen.queryByTestId('chart')).not.toBeInTheDocument();
    expect(screen.getByText(/No daily usage recorded for this month yet/)).toBeInTheDocument();
  });

  it('waits for a second day before drawing a trend', () => {
    render(
      <UsageTrendPanel
        daily={[{ date: '2026-10-01', gb_hours: 2 }]}
        month="2026-10"
        usedGbHours={2}
        includedGbHours={50}
        now={NOW}
      />
    );

    expect(screen.queryByTestId('chart')).not.toBeInTheDocument();
    expect(screen.getByText(/once the month has two days of usage/)).toBeInTheDocument();
  });

  it('refuses to start the total mid-month when the window misses the 1st', () => {
    render(
      <UsageTrendPanel
        daily={[
          { date: '2026-10-02', gb_hours: 1 },
          { date: '2026-10-31', gb_hours: 2 },
        ]}
        month="2026-10"
        usedGbHours={5}
        includedGbHours={50}
        now={Date.parse('2026-10-31T08:00:00Z')}
      />
    );

    expect(screen.queryByTestId('chart')).not.toBeInTheDocument();
    expect(screen.getByText(/only reach back 30 days/)).toBeInTheDocument();
  });
});
