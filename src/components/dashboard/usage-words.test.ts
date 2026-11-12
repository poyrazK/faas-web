import { describe, expect, it } from 'vitest';
import {
  canUpgrade,
  computeForecastMillicents,
  projectUsage,
  usageAnswer,
  type UsageAnswerInput,
} from './usage-words';

// Nov 12, 2026, midday UTC: day 12 of a 30-day month.
const NOW = Date.UTC(2026, 10, 12, 12);

const base: UsageAnswerInput = {
  month: '2026-11',
  used: 1432.5,
  included: 2000,
  overageGbHours: 0,
  overageCents: 0,
  capCents: 2000,
  forecastMillicents: 1_480_000,
  plan: 'pro',
  now: NOW,
};

describe('projectUsage', () => {
  it('draws a straight line to the last day of the current month', () => {
    const p = projectUsage(1200, '2026-11', NOW);
    expect(p.projecting).toBe(true);
    expect(p.projected).toBe(3000);
    expect(p.monthEnd).toBe('Nov 30');
  });

  it('does not project another month, day one, or nothing used', () => {
    expect(projectUsage(10, '2026-10', NOW).projecting).toBe(false);
    expect(projectUsage(10, '2026-11', Date.UTC(2026, 10, 1, 20)).projecting).toBe(false);
    expect(projectUsage(0, '2026-11', NOW).projecting).toBe(false);
    expect(projectUsage(10, undefined, NOW)).toEqual({ projecting: false, projected: 10 });
  });
});

describe('computeForecastMillicents', () => {
  const meter = (name: string, available: boolean, projected?: number) => ({
    meter: name,
    forecast: { available, projected_net_millicents: projected },
  });

  it('reads the compute meter only when apid says it is available', () => {
    expect(computeForecastMillicents([meter('compute', true, 500)])).toBe(500);
    expect(computeForecastMillicents([meter('gb_hours', true, 700)])).toBe(700);
    expect(computeForecastMillicents([meter('compute', false)])).toBeUndefined();
    expect(computeForecastMillicents([meter('egress', true, 900)])).toBeUndefined();
    expect(computeForecastMillicents(undefined)).toBeUndefined();
  });
});

describe('canUpgrade', () => {
  it('offers a higher plan below Scale, and nothing for an unknown plan', () => {
    expect(canUpgrade('free')).toBe(true);
    expect(canUpgrade('pro')).toBe(true);
    expect(canUpgrade('scale')).toBe(false);
    expect(canUpgrade(undefined)).toBe(false);
  });
});

describe('usageAnswer', () => {
  it('says how much is used, where the pace ends and what it costs, and offers an upgrade', () => {
    const answer = usageAnswer(base);
    expect(answer.sentence).toBe(
      "You've used 72% of this month's included compute. At this pace you'll be about 1,581 GB-hours over by Nov 30, around $14.80."
    );
    expect(answer.tone).toBe('warning');
    expect(answer.action).toBe('upgrade');
  });

  it('leaves the money out when the forecast is unavailable, never inventing a price', () => {
    const answer = usageAnswer({ ...base, forecastMillicents: undefined });
    expect(answer.sentence).toMatch(/over by Nov 30\.$/);
    expect(answer.sentence).not.toMatch(/\$/);
  });

  it('says nothing needs attention when the pace stays within the allowance', () => {
    const answer = usageAnswer({ ...base, used: 400 });
    expect(answer.sentence).toBe(
      "You've used 20% of this month's included compute. At this pace you'll stay within it. Nothing needs your attention."
    );
    expect(answer.tone).toBe('good');
    expect(answer.action).toBeNull();
  });

  it('does not project a past month', () => {
    const answer = usageAnswer({ ...base, month: '2026-10', used: 10 });
    expect(answer.sentence).toBe(
      "You've used less than 1% of this month's included compute. Nothing needs your attention."
    );
  });

  it('names the overage once the allowance is passed', () => {
    const answer = usageAnswer({
      ...base,
      used: 2100,
      overageGbHours: 100,
      overageCents: 100,
      capCents: null,
    });
    expect(answer.sentence).toMatch(
      /^You're 100 GB-hours past this month's included compute, \$1\.00 of overage so far\. At this pace you'll be about 3,250 GB-hours over by Nov 30, around \$14\.80\.$/
    );
    expect(answer.action).toBe('upgrade');
  });

  it('offers no upgrade from the top plan', () => {
    expect(usageAnswer({ ...base, plan: 'scale' }).action).toBeNull();
  });

  it('puts a reached cap first and asks to raise it', () => {
    const answer = usageAnswer({ ...base, used: 2500, overageCents: 2000, capCents: 2000 });
    expect(answer.tone).toBe('critical');
    expect(answer.sentence).toMatch(/^You've reached your \$20\.00 spend cap\./);
    expect(answer.action).toBe('raise_cap');
  });

  it('reads a $0 cap as a pause, even inside the allowance', () => {
    const answer = usageAnswer({ ...base, used: 10, capCents: 0 });
    expect(answer.tone).toBe('critical');
    expect(answer.sentence).toMatch(/^Your apps are paused\./);
    expect(answer.action).toBe('raise_cap');
  });

  it('warns from 80% of the cap', () => {
    const answer = usageAnswer({ ...base, used: 2300, overageCents: 1700, capCents: 2000 });
    expect(answer.sentence).toMatch(/^You've used \$17\.00 of your \$20\.00 spend cap\./);
    expect(answer.action).toBe('raise_cap');
  });

  it('never treats an unread cap as no cap or as zero', () => {
    const answer = usageAnswer({ ...base, used: 10, capCents: undefined });
    expect(answer.tone).toBe('good');
    expect(answer.sentence).not.toMatch(/cap/);
  });

  it('states the figure plainly for a plan with no included allowance', () => {
    expect(usageAnswer({ ...base, included: 0, used: 12 }).sentence).toBe(
      "You've used 12 GB-hours of compute this month."
    );
  });
});
