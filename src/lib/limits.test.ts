import { describe, expect, it } from 'vitest';
import { billStatus, capSentence, egressSentence, meterTone, type BillFacts } from './limits';

const GiB = 2 ** 30;
const ready = <T extends object>(t: T) => ({ state: 'ready' as const, ...t });
const base: BillFacts = {
  workspace: 'personal',
  plan: 'pro',
  cap: ready({ capCents: 5000, overageCents: 1240 }),
  egress: ready({ enabled: false, electable: true, usedGb: 205, includedGb: 500 }),
  storage: ready({ usedBytes: 19 * GiB, ceilingBytes: 250 * GiB }),
};

describe('meterTone', () => {
  it('turns amber from 80% and red at the limit', () => {
    expect(meterTone(79, 100)).toBe('good');
    expect(meterTone(80, 100)).toBe('warning');
    expect(meterTone(100, 100)).toBe('critical');
  });
});

describe('billStatus', () => {
  it('fine: names the cap use and the closest other limit', () => {
    expect(billStatus(base)).toEqual({
      tone: 'good',
      headline: 'Nothing on your bill is stopped',
      detail: '$12.40 of your $50.00 overage cap used. Egress is at 41% of 500 GiB.',
    });
  });

  it('treats a $0 cap as a pause switch', () => {
    expect(billStatus({ ...base, cap: ready({ capCents: 0, overageCents: 0 }) })).toMatchObject({
      tone: 'critical',
      headline: 'Your apps are stopped',
      detail: 'Your spend cap is $0, which pauses every workload.',
      action: 'cap',
    });
  });

  it('stops at a reached cap', () => {
    expect(
      billStatus({ ...base, cap: ready({ capCents: 5000, overageCents: 5000 }) })
    ).toMatchObject({
      tone: 'critical',
      headline: 'Your apps are stopped',
      detail: 'Overage reached your $50.00 cap.',
      action: 'cap',
    });
  });

  it('stops apps at the egress allowance with overage off; Free gets plans', () => {
    const full = ready({ enabled: false, electable: true, usedGb: 500, includedGb: 500 });
    expect(billStatus({ ...base, egress: full })).toMatchObject({
      tone: 'critical',
      detail: 'Egress reached 500 GiB.',
      action: 'egress',
    });
    expect(
      billStatus({
        ...base,
        plan: 'free',
        cap: ready({ capCents: null }),
        egress: { ...full, electable: false },
      }).action
    ).toBe('plans');
  });

  it('never stops at the egress allowance while paying beyond it', () => {
    expect(
      billStatus({
        ...base,
        egress: ready({ enabled: true, electable: true, usedGb: 600, includedGb: 500 }),
      }).tone
    ).toBe('good');
  });

  it('leads with data loss, even over a reached cap', () => {
    const status = billStatus({
      ...base,
      cap: ready({ capCents: 5000, overageCents: 6000 }),
      storage: ready({
        usedBytes: 262 * GiB,
        ceilingBytes: 250 * GiB,
        overCeiling: { excessBytes: 12 * GiB, deletionAt: '2026-12-02T00:00:00Z' },
      }),
    });
    expect(status).toEqual({
      tone: 'critical',
      headline: 'Files will be deleted on Dec 2',
      detail:
        'Storage is 12 GiB over its 250 GiB ceiling. Delete files to get back under it, or ask support to raise the ceiling.',
      action: 'storage',
    });
  });

  it('names the limit that is close', () => {
    expect(
      billStatus({
        ...base,
        egress: ready({ enabled: false, electable: true, usedGb: 410, includedGb: 500 }),
      })
    ).toMatchObject({
      tone: 'warning',
      headline: 'Close to a limit',
      detail: 'Egress is at 82% of 500 GiB.',
    });
  });

  it('warns when a paid account has no cap', () => {
    expect(billStatus({ ...base, cap: ready({ capCents: null, overageCents: 0 }) })).toMatchObject({
      tone: 'warning',
      headline: 'Close to a limit',
      detail: 'No cap is set, so nothing stops overage.',
    });
  });

  it('never gives an organization a cap verdict', () => {
    expect(
      billStatus({
        ...base,
        workspace: 'org',
        cap: ready({ capCents: 5000 }),
        egress: ready({ enabled: false, electable: true }),
      })
    ).toEqual({
      tone: 'neutral',
      headline: 'Nothing reported stopped',
      detail:
        'Gregale doesn’t report this organization’s overage or egress use here, so only storage was checked.',
    });
  });

  it('never says "Nothing is stopped" when a read failed', () => {
    const status = billStatus({ ...base, egress: { state: 'unknown' } });
    // Not mint: a read that failed is never shown as fine.
    expect(status).toMatchObject({ tone: 'neutral', headline: 'Nothing reported stopped' });
    expect(status.detail).toMatch(/Egress couldn’t be read\.$/);
  });

  it('has no overage to cap on Free', () => {
    const free = { ...base, plan: 'free' as const, cap: ready({ capCents: null }) };
    expect(capSentence(free)).toBe('Free stops at its allowance, so there’s no overage to cap.');
    expect(billStatus(free).tone).toBe('good');
  });
});

describe('row sentences', () => {
  it('says what happens at each limit', () => {
    expect(capSentence(base)).toBe('Apps, jobs and databases stop at $50.00 of overage.');
    expect(capSentence({ ...base, cap: ready({ capCents: null, overageCents: 0 }) })).toBe(
      'No cap is set, so nothing stops overage.'
    );
    expect(egressSentence({ enabled: false, includedGb: 500 })).toBe(
      'Apps stop at 500 GiB. Or pay for egress beyond it.'
    );
    expect(egressSentence({ enabled: true, includedGb: 500, priceMillicentsPerGib: 3000 })).toBe(
      'Pays $0.03 per GiB beyond 500 GiB, counted toward your spend cap.'
    );
  });
});

describe('review fixes', () => {
  it('never calls the bill fine while the usage summary could not be read', () => {
    const status = billStatus({ ...base, usageUnknown: true });
    expect(status).toMatchObject({ tone: 'neutral', headline: 'Nothing reported stopped' });
    expect(status.detail).toMatch(/Your usage couldn’t be read\.$/);
  });

  it('still stops at the egress allowance while egress billing is off', () => {
    const saved = ready({
      enabled: true,
      billingOff: true,
      electable: true,
      usedGb: 500,
      includedGb: 500,
    });
    expect(billStatus({ ...base, egress: saved })).toMatchObject({
      tone: 'critical',
      detail: 'Egress reached 500 GiB.',
    });
    expect(egressSentence({ enabled: true, billingOff: true, includedGb: 500 })).toBe(
      'Saved. Until egress billing starts, apps still stop at 500 GiB.'
    );
  });

  it('stops a company with a $0 cap, without its overage', () => {
    expect(
      billStatus({
        ...base,
        workspace: 'org',
        cap: ready({ capCents: 0 }),
        egress: ready({ enabled: false, electable: true }),
      })
    ).toMatchObject({
      tone: 'critical',
      headline: 'Your apps are stopped',
      detail: 'This organization’s spend cap is $0, which pauses every workload.',
      action: 'cap',
    });
  });

  it('stops Free at its included compute, and warns from 80%', () => {
    const free = { ...base, plan: 'free' as const, cap: ready({ capCents: null }) };
    expect(
      billStatus({ ...free, compute: { usedGbHours: 100, includedGbHours: 100 } })
    ).toMatchObject({
      tone: 'critical',
      headline: 'Your apps are stopped',
      detail: 'Free’s included compute is used up for this month.',
      action: 'plans',
    });
    expect(
      billStatus({ ...free, compute: { usedGbHours: 85, includedGbHours: 100 } })
    ).toMatchObject({
      tone: 'warning',
      detail: 'Compute is at 85% of Free’s 100 GB-hours.',
    });
  });
});
