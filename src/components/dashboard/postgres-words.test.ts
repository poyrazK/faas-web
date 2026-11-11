import { describe, expect, it } from 'vitest';
import type { PostgresDatabase } from '@/lib/api/queries';
import {
  describeDatabase,
  regionName,
  spelledAgo,
  timeLeft,
  type DescribeContext,
} from './postgres-words';

const NOW = Date.parse('2026-11-09T12:00:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const database = (over: Partial<PostgresDatabase> = {}): PostgresDatabase => ({
  id: 'db1',
  name: 'orders',
  region: 'fra',
  postgres_major: 17,
  service_class: 'production',
  availability: 'single_zone',
  scale_to_zero: true,
  storage_limit_bytes: 5 * 1024 ** 3,
  restore_window_seconds: 7 * 24 * 3600,
  state: 'ready',
  last_error_code: null,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  ...over,
});
const ctx = (over: Partial<DescribeContext> = {}): DescribeContext => ({
  capSuspended: false,
  whose: 'your',
  canResize: true,
  now: NOW,
  ...over,
});
const iso = (ms: number) => new Date(ms).toISOString();

describe('describeDatabase', () => {
  it('calls a ready database Ready, with nothing to fix', () => {
    const words = describeDatabase(database(), ctx());
    expect(words).toMatchObject({ word: 'Ready', tone: 'good', fixes: [], gone: false });
    expect(words.sentence).toBe('It’s ready. Apps bound to it can connect.');
  });

  describe('a suspended database reads as Paused, never Ready', () => {
    it('when its size is not in the plan: upgrade, or resize where resize exists', () => {
      const words = describeDatabase(database({ plan_excess: 'service_class' }), ctx());
      expect(words).toMatchObject({ word: 'Paused', tone: 'critical' });
      expect(words.sentence).toBe(
        'It’s paused because its size isn’t included in your plan. Your data is safe; apps can’t connect until you fix this.'
      );
      expect(words.fixes).toEqual(['upgrade', 'resize']);
      expect(words.term).toContain('service_class');
      expect(
        describeDatabase(database({ plan_excess: 'service_class' }), ctx({ canResize: false }))
          .fixes
      ).toEqual(['upgrade']);
    });

    it('when the plan allows fewer databases', () => {
      const words = describeDatabase(database({ plan_excess: 'database_limit' }), ctx());
      expect(words.word).toBe('Paused');
      expect(words.sentence).toMatch(/plan allows fewer databases than you have/);
      expect(words.fixes).toEqual(['upgrade']);
    });

    it('when the compute cap holds the workspace', () => {
      const words = describeDatabase(database(), ctx({ capSuspended: true }));
      expect(words.word).toBe('Paused');
      expect(words.sentence).toMatch(/compute allowance is used up/);
      expect(words.term).toBe('suspended · compute cap');
      expect(words.fixes).toEqual(['upgrade']);
    });

    it('names a company’s plan as the company’s', () => {
      const words = describeDatabase(
        database({ plan_excess: 'service_class' }),
        ctx({ whose: 'Acme’s' })
      );
      expect(words.sentence).toContain('included in Acme’s plan');
    });

    it('only while ready: a failed database stays Failed under the cap', () => {
      expect(
        describeDatabase(database({ state: 'failed' }), ctx({ capSuspended: true })).word
      ).toBe('Failed');
    });
  });

  describe('being deleted', () => {
    it('says how long it can come back, and offers the restore', () => {
      const words = describeDatabase(
        database({ state: 'deleting', restorable_until: iso(NOW + 3 * DAY + HOUR) }),
        ctx()
      );
      expect(words).toMatchObject({
        word: 'Being deleted',
        ring: true,
        gone: true,
        emphasis: '3 more days',
        fixes: ['restore'],
      });
      expect(words.sentence).toBe(
        'You can still get it back for 3 more days. After that it’s gone for good.'
      );
    });

    it('ignores apid’s own pending-hold marker', () => {
      const words = describeDatabase(
        database({
          state: 'deleting',
          last_error_code: 'deletion_hold_pending',
          restorable_until: iso(NOW + 2 * DAY),
        }),
        ctx()
      );
      expect(words.fixes).toEqual(['restore']);
    });

    it('offers nothing once the window has passed', () => {
      const words = describeDatabase(
        database({ state: 'deleting', restorable_until: iso(NOW - HOUR) }),
        ctx()
      );
      expect(words.fixes).toEqual([]);
      expect(words.sentence).toMatch(/time to get it back has ended/);
    });

    it('says an immediate delete cannot be undone', () => {
      const words = describeDatabase(database({ state: 'deleting' }), ctx());
      expect(words.sentence).toBe('It’s being deleted. This can’t be undone.');
      expect(words.fixes).toEqual([]);
    });

    it('explains a source kept for its restored copies', () => {
      const words = describeDatabase(
        database({ state: 'deleting', last_error_code: 'restore_copies_remain' }),
        ctx()
      );
      expect(words.sentence).toMatch(/kept while databases restored from it still exist/);
    });

    it('says a stuck delete is retried', () => {
      const words = describeDatabase(
        database({ state: 'deleting', last_error_code: 'deletion_hold_failed' }),
        ctx()
      );
      expect(words.sentence).toMatch(/taking longer.*retried automatically/);
    });
  });

  describe('failed', () => {
    it.each([
      ['provider_failed', /provider reported a failure/],
      ['spec_mismatch', /built it differently/],
      ['unsupported', /doesn’t support/],
      ['backend_unavailable', /database service was unavailable/],
      ['quota_exceeded', /limit was reached/],
      ['restore_lineage_mismatch', /didn’t match/],
    ])('names %s in words and points to the detail', (code, sentence) => {
      const words = describeDatabase(database({ state: 'failed', last_error_code: code }), ctx());
      expect(words).toMatchObject({ word: 'Failed', tone: 'critical', fixes: ['open'] });
      expect(words.sentence).toMatch(sentence);
      expect(words.sentence).toMatch(/Delete it and create it again\.$/);
      expect(words.term).toBe(`failed · ${code}`);
    });

    it('falls back to a neutral sentence for an unknown code, keeping the code in the term', () => {
      const words = describeDatabase(
        database({ state: 'failed', last_error_code: 'brand_new_code' }),
        ctx()
      );
      expect(words.sentence).toMatch(/^Something went wrong setting it up\./);
      expect(words.sentence).not.toContain('brand_new_code');
      expect(words.term).toBe('failed · brand_new_code');
    });
  });

  it('says a database being set up is Starting, and why it is slow when apid retries', () => {
    expect(describeDatabase(database({ state: 'provisioning' }), ctx())).toMatchObject({
      word: 'Starting',
      sentence: 'It’s being set up. Apps can connect once it’s ready.',
    });
    expect(
      describeDatabase(
        database({ state: 'provisioning', last_error_code: 'backend_unavailable' }),
        ctx()
      ).sentence
    ).toBe(
      'Setting it up is taking longer because the database service is unavailable. It’s retried automatically.'
    );
    expect(
      describeDatabase(database({ state: 'provisioning', last_error_code: 'mystery' }), ctx())
        .sentence
    ).toMatch(/because of a problem/);
  });

  it('says a database mid-change is Changing', () => {
    const words = describeDatabase(database({ state: 'updating' }), ctx());
    expect(words.word).toBe('Changing');
    expect(words.sentence).toMatch(/disconnected briefly/);
  });

  it('warns about a restored copy past the database limit, with the time left', () => {
    const words = describeDatabase(database({ restore_slot_until: iso(NOW + 5 * DAY) }), ctx());
    expect(words).toMatchObject({ word: 'Ready', tone: 'warning', emphasis: '5 more days' });
    expect(words.fixes).toEqual(['upgrade']);
  });

  describe('fresh health', () => {
    const health = (over: Partial<NonNullable<PostgresDatabase['health']>>) => ({
      enabled: true,
      status: 'healthy' as const,
      fresh: true,
      provider_status: 'ready' as const,
      compute_state: 'active' as const,
      stale_after_seconds: 300,
      ...over,
    });

    it('says a scaled-to-zero database is asleep, still Ready', () => {
      const words = describeDatabase(
        database({ health: health({ compute_state: 'suspended' }) }),
        ctx()
      );
      expect(words.word).toBe('Ready');
      expect(words.sentence).toBe('It’s asleep while idle and wakes when an app connects.');
    });

    it('says a degraded database is having trouble, in the check’s words', () => {
      const words = describeDatabase(
        database({ health: health({ status: 'degraded', last_error_code: 'resource_missing' }) }),
        ctx()
      );
      expect(words).toMatchObject({ word: 'Having trouble', tone: 'warning', fixes: ['open'] });
      expect(words.sentence).toBe('The database provider can’t find it.');
    });

    it('reads nothing into a stale observation', () => {
      const words = describeDatabase(
        database({ health: health({ status: 'degraded', fresh: false }) }),
        ctx()
      );
      expect(words.word).toBe('Ready');
    });
  });
});

describe('timeLeft', () => {
  it('rounds down, so it never promises more time than there is', () => {
    expect(timeLeft(NOW + 2 * DAY + 23 * HOUR, NOW)).toBe('2 more days');
    expect(timeLeft(NOW + DAY, NOW)).toBe('1 more day');
    expect(timeLeft(NOW + 5 * HOUR + 59 * 60_000, NOW)).toBe('5 more hours');
    expect(timeLeft(NOW + HOUR, NOW)).toBe('1 more hour');
    expect(timeLeft(NOW + 59 * 60_000, NOW)).toBe('less than an hour');
  });
});

describe('spelledAgo', () => {
  it('spells the unit out', () => {
    expect(spelledAgo(NOW - 35 * DAY, NOW)).toBe('35 days ago');
    expect(spelledAgo(NOW - DAY, NOW)).toBe('1 day ago');
    expect(spelledAgo(NOW - 3 * HOUR, NOW)).toBe('3 hours ago');
    expect(spelledAgo(NOW - 5 * 60_000, NOW)).toBe('5 minutes ago');
    expect(spelledAgo(NOW - 10_000, NOW)).toBe('just now');
  });
});

describe('regionName', () => {
  it('spells out a known region and passes an unknown one through', () => {
    expect(regionName('fra')).toBe('Frankfurt');
    expect(regionName('ams')).toBe('Amsterdam');
    expect(regionName('xyz')).toBe('xyz');
  });
});
