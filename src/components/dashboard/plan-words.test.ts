import { describe, expect, it } from 'vitest';
import { planAnswer } from './plan-words';

describe('planAnswer', () => {
  it('names the plan and what it includes, with no price', () => {
    expect(
      planAnswer({
        plan: 'pro',
        status: 'active',
        limits: { deployed_apps: 25, ram_mb: 4096, included_gb_hours: 2000 },
      })
    ).toEqual({
      tone: 'good',
      sentence:
        "You're on the Pro plan: up to 25 apps with 4,096 MB of memory each, and 2,000 GB-hours of compute included every month.",
    });
  });

  it('puts a failed payment first and points at the retry', () => {
    expect(planAnswer({ plan: 'hobby', status: 'past_due' }).sentence).toBe(
      "You're on the Hobby plan, and the last payment didn't go through. Retry it under Subscription below."
    );
    expect(planAnswer({ plan: 'free', status: 'suspended' }).tone).toBe('critical');
  });

  it('says less when the limits are partial', () => {
    expect(planAnswer({ plan: 'free', limits: {} }).sentence).toBe("You're on the Free plan.");
  });
});
