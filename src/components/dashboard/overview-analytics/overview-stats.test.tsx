import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { withRouter } from '@/test/router';
import { OverviewStats, type OverviewStatsProps } from './overview-stats';

const props = (over: Partial<OverviewStatsProps> = {}): OverviewStatsProps => ({
  paid: true,
  showPlanGate: false,
  appCount: 3,
  rangeDescription: 'last 24 hours',
  metrics: {
    unavailable: false,
    degraded: false,
    figures: { requests: 15_200, errorPct: 0.57, errored: 87, wakeP95Ms: 218 },
  },
  resident: { known: true, partial: false, mb: 6912, count: 12 },
  usage: {
    phase: 'ready',
    usedGbHours: 1432.5,
    includedGbHours: 2000,
    overGbHours: 0,
    cpuHours: 318.2,
  },
  ...over,
});

const card = (name: string) => screen.getByRole('region', { name });

async function show(over: Partial<OverviewStatsProps> = {}) {
  render(withRouter(<OverviewStats {...props(over)} />));
  await screen.findByRole('region', { name: 'Memory now' });
}

describe('OverviewStats', () => {
  it('shows the six figures with their context lines', async () => {
    await show();
    expect(card('Total requests')).toHaveTextContent('15k');
    expect(card('Error rate')).toHaveTextContent('0.57%');
    expect(card('Error rate')).toHaveTextContent('87 errored, weighted by traffic');
    expect(card('Wake p95')).toHaveTextContent('218ms');
    expect(card('Memory now')).toHaveTextContent('6,912MB');
    expect(card('GB-h left')).toHaveTextContent('567.5');
    expect(card('CPU')).toHaveTextContent('318.2h');
    expect(screen.getByRole('link', { name: 'Usage' })).toHaveAttribute('href', '/dashboard/usage');
  });

  it('reads degraded metrics as unknown, never zero', async () => {
    await show({
      metrics: { unavailable: true, degraded: true, figures: props().metrics.figures },
    });
    expect(card('Total requests')).toHaveTextContent('—');
    expect(card('Total requests')).toHaveTextContent('metrics degraded');
    expect(card('Wake p95')).toHaveTextContent('—');
  });

  it('shows the overage, and the hours used when there is no allowance', async () => {
    await show({
      usage: { ...props().usage, overGbHours: 12.4, overageCents: 186 },
    });
    expect(card('GB-h over')).toHaveTextContent('12.4');
    expect(card('GB-h over')).toHaveTextContent('$1.86 overage this period');
  });

  it('falls back to hours used when the plan carries no allowance', async () => {
    await show({ usage: { ...props().usage, includedGbHours: null } });
    expect(card('GB-h used')).toHaveTextContent('1,432.5');
  });

  it('says why a memory figure is missing', async () => {
    await show({ resident: { known: false, partial: true, mb: 0, count: 0 } });
    expect(card('Memory now')).toHaveTextContent('more instances than one page');
  });
});
