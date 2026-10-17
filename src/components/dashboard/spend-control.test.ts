import { describe, expect, it } from 'vitest';
import { capStanding, describeCapEvent } from './spend-control';

describe('capStanding', () => {
  it('says plainly when nothing limits overage', () => {
    const standing = capStanding(1234, null);
    expect(standing.label).toBe('No cap');
    expect(standing.pct).toBeNull();
  });

  it('treats a €0 cap as overage not allowed', () => {
    expect(capStanding(0, 0).label).toBe('Overage not allowed');
    expect(capStanding(0, 0).pct).toBe(0);
    expect(capStanding(50, 0).pct).toBe(100);
  });

  it('warns from 80% and reports the cap reached at 100%', () => {
    expect(capStanding(1000, 2000).label).toBe('Within the cap');
    expect(capStanding(1600, 2000).label).toBe('Close to the cap');
    expect(capStanding(2000, 2000).label).toBe('Cap reached');
    expect(capStanding(9000, 2000).pct).toBe(100);
  });
});

describe('describeCapEvent', () => {
  it('reads apid cap changes, including "null" for no cap', () => {
    expect(
      describeCapEvent({
        id: 1,
        at: '',
        kind: 'overage.cap_changed',
        data: { old_cents: 'null', new_cents: 2000 },
      })
    ).toMatch(/^Cap changed from no cap to .*20/);
  });

  it('reads a cap-reached notice and names unknown kinds as they are', () => {
    expect(
      describeCapEvent({
        id: 2,
        at: '',
        kind: 'overage.cap_reached',
        data: { current_overage_cents: 2100, cap_cents: 2000 },
      })
    ).toMatch(/^Cap reached: .*21.* of .*20/);
    expect(describeCapEvent({ id: 3, at: '', kind: 'overage.new_thing' })).toBe(
      'overage.new_thing'
    );
  });
});
