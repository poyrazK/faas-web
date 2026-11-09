import { describe, expect, it } from 'vitest';
import type { ApprovalPolicy, ApprovalStatus } from '@/lib/api/release-approvals';
import type { ReleaseFreeze, ReleaseFreezeStatus } from '@/lib/api/release-freezes';
import type { ScheduledRelease } from '@/lib/api/scheduled-releases';
import {
  approvalCardWords,
  approvalPolicyDetails,
  approvalPolicySentence,
  approversPhrase,
  describeReleaseSafety,
  freezeCardWords,
  gateCardWords,
  scheduleCardWords,
  scheduleOutcome,
  sourceOf,
  spokenTime,
  uncheckedPhrase,
  type SafetyInput,
  type Source,
} from './release-safety-words';

const NOW = new Date(2026, 10, 10, 12, 0).getTime(); // Tuesday Nov 10, 12:00 local
const local = (day: number, h: number, min = 0) => new Date(2026, 10, day, h, min).toISOString();
const when = (iso: string) => `<${iso}>`;
const ready = <T>(data: T): Source<T> => ({ state: 'ready', data });

const freeze = (over: Partial<ReleaseFreeze> = {}): ReleaseFreeze => ({
  id: 'f1',
  app: 'shop',
  kind: 'window',
  reason: 'incident 4711',
  source: 'manual',
  created_by: 'ops@acme.dev',
  created_at: '',
  active: true,
  ...over,
});
const status = (over: Partial<ReleaseFreezeStatus> = {}): ReleaseFreezeStatus => ({
  app: 'shop',
  frozen: false,
  active: [],
  ...over,
});
const policy = (over: Partial<ApprovalPolicy> = {}): ApprovalPolicy => ({
  app: 'shop',
  required_approvals: 1,
  after_stage: 2,
  timeout_minutes: 90,
  approvers: 'admin',
  allow_self_approval: false,
  notify_channels: ['ops-slack'],
  updated_by: 'me',
  created_at: '',
  updated_at: '',
  ...over,
});
const waiting = (over: Partial<ApprovalStatus> = {}): ApprovalStatus => ({
  deployment_id: 'dep44',
  app: 'shop',
  state: 'waiting',
  required_approvals: 1,
  approvals: 0,
  decisions: [],
  ...over,
});
const schedule = (over: Partial<ScheduledRelease> = {}): ScheduledRelease => ({
  id: 's1',
  app: 'shop',
  deployment_id: 'dep45',
  revision: 45,
  release_at: local(13, 18),
  state: 'scheduled',
  notify_channels: [],
  scheduled_by: 'me',
  created_at: '',
  updated_at: '',
  ...over,
});

const input = (over: Partial<SafetyInput> = {}): SafetyInput => ({
  freezes: ready(status()),
  policy: ready(null),
  waiting: ready([]),
  schedules: ready([]),
  version: (id, revision) => (revision ? `v${revision}` : id === 'dep44' ? 'v44' : id),
  when,
  now: NOW,
  ...over,
});

describe('spokenTime', () => {
  it('says the day as people do, in the viewer’s zone', () => {
    expect(spokenTime(local(10, 18), NOW)).toBe('today at 18:00');
    expect(spokenTime(local(11, 9, 30), NOW)).toBe('tomorrow at 09:30');
    expect(spokenTime(local(9, 23, 5), NOW)).toBe('yesterday at 23:05');
    expect(spokenTime(local(13, 16), NOW)).toBe('Friday at 16:00');
    expect(spokenTime(local(20, 16), NOW)).toBe('Nov 20 at 16:00');
    expect(spokenTime(new Date(2027, 0, 4, 8).toISOString(), NOW)).toBe('Jan 4, 2027 at 08:00');
  });

  it('keeps an unparseable time unknown', () => {
    expect(spokenTime('soon', NOW)).toBe('at an unknown time');
  });
});

describe('sourceOf', () => {
  const q = { data: 1, error: null, isPending: false };
  it('maps capability access and the read to what the answer may say', () => {
    expect(sourceOf('on', q)).toEqual({ state: 'ready', data: 1 });
    expect(sourceOf('off', q)).toEqual({ state: 'off' });
    expect(sourceOf('plan-not-entitled', q)).toEqual({ state: 'off' });
    expect(sourceOf('loading', q)).toEqual({ state: 'loading' });
    expect(sourceOf('registry-error', q)).toEqual({ state: 'failed' });
    expect(sourceOf('on', { ...q, error: new Error('x') })).toEqual({ state: 'failed' });
    expect(sourceOf('on', { data: undefined, error: null, isPending: true })).toEqual({
      state: 'loading',
    });
  });

  it('reads a policy that is not set (null) as ready, not loading', () => {
    expect(sourceOf('on', { data: null, error: null, isPending: false })).toEqual({
      state: 'ready',
      data: null,
    });
  });
});

describe('describeReleaseSafety', () => {
  it('says nothing is blocking, and that versions go live after their checks', () => {
    const a = describeReleaseSafety(input());
    expect(a).toMatchObject({ phase: 'clear', word: 'Clear', tone: 'good' });
    expect(a.sentence).toBe('Nothing is blocking releases.');
    expect(a.detail).toEqual(['New versions go live as soon as they pass their checks.']);
  });

  it('says what an approval policy makes new versions do, and the next freeze', () => {
    const a = describeReleaseSafety(
      input({
        policy: ready(policy({ required_approvals: 2 })),
        freezes: ready(
          status({ next: freeze({ active: false, reason: 'weekend', next_starts_at: 'N' }) })
        ),
      })
    );
    expect(a.detail).toEqual([
      'New versions pause partway through their rollout until 2 owners or admins approve them.',
      'The next freeze, “weekend”, starts <N>.',
    ]);
  });

  it('leads with a freeze until its end, who set it and why, and Lift', () => {
    const f = freeze({ ends_at: 'E' });
    const a = describeReleaseSafety(
      input({ freezes: ready(status({ frozen: true, active: [f] })) })
    );
    expect(a).toMatchObject({ phase: 'held', word: 'Frozen', tone: 'critical' });
    expect(a.sentence).toBe('Releases are frozen until <E>.');
    expect(a.detail).toEqual(['“incident 4711”, set by ops@acme.dev.']);
    expect(a.holds[0].action).toEqual({ kind: 'lift', freeze: f });
  });

  it('says a window without an end lasts until lifted, and names a freeze on every app', () => {
    const a = describeReleaseSafety(
      input({ freezes: ready(status({ frozen: true, active: [freeze({ app: undefined })] })) })
    );
    expect(a.sentence).toBe('Releases are frozen until someone lifts the freeze.');
    expect(a.detail[0]).toMatch(/It covers every personal app of your account\.$/);
  });

  it('never invents the end of a weekly freeze; it gives the schedule instead', () => {
    const weekly = freeze({
      kind: 'weekly',
      weekly: { days: ['fri'], start: '16:00', duration_minutes: 3840, time_zone: 'UTC' },
    });
    const a = describeReleaseSafety(
      input({ freezes: ready(status({ frozen: true, active: [weekly] })) })
    );
    expect(a.sentence).toBe('Releases are frozen by a weekly freeze.');
    expect(a.detail[0]).toContain('Every Fri at 16:00 for 2 d 16 h, UTC time.');
  });

  it('says Gregale froze it after an automatic rollback', () => {
    const a = describeReleaseSafety(
      input({
        freezes: ready(
          status({
            frozen: true,
            active: [freeze({ source: 'automatic_rollback', reason: 'settle', ends_at: 'E' })],
          })
        ),
      })
    );
    expect(a.detail[0]).toBe(
      'Gregale froze it after rolling a version back on its own (“settle”).'
    );
  });

  it('gives several freezes’ shared end only when every one has an end', () => {
    const both = [freeze({ ends_at: local(11, 9) }), freeze({ id: 'f2', ends_at: local(12, 9) })];
    const a = describeReleaseSafety(
      input({ freezes: ready(status({ frozen: true, active: both })) })
    );
    expect(a.sentence).toBe(`Releases are frozen until <${local(12, 9)}> by 2 freezes.`);
    expect(a.holds[0].action).toEqual({ kind: 'freezes' });
    const open = [freeze({ ends_at: 'E' }), freeze({ id: 'f2', reason: 'b' })];
    expect(
      describeReleaseSafety(input({ freezes: ready(status({ frozen: true, active: open })) }))
        .sentence
    ).toBe('Releases are frozen by 2 freezes.');
  });

  it('names the version waiting, how many approvals it still needs and from whom', () => {
    const one = describeReleaseSafety(
      input({ policy: ready(policy()), waiting: ready([waiting({ expires_at: 'X' })]) })
    );
    expect(one).toMatchObject({ phase: 'held', word: 'Waiting for approval', tone: 'warning' });
    expect(one.sentence).toBe('v44 is waiting for an approval from an owner or admin.');
    expect(one.detail).toEqual([
      'It’s paused partway through its rollout. If no one approves it by <X>, it’s rolled back.',
    ]);
    expect(one.holds[0].action).toEqual({ kind: 'review', deploymentId: 'dep44' });

    const more = describeReleaseSafety(
      input({
        policy: ready(policy({ approvers: 'developer', required_approvals: 3 })),
        waiting: ready([waiting({ required_approvals: 3, approvals: 1 })]),
      })
    );
    expect(more.sentence).toBe('v44 needs 2 more approvals from owners, admins or developers.');

    const unknownPolicy = describeReleaseSafety(
      input({ policy: { state: 'failed' }, waiting: ready([waiting()]) })
    );
    expect(unknownPolicy.sentence).toBe('v44 is waiting for approval.');
    expect(unknownPolicy.unchecked).toEqual(['approvals']);
  });

  it('says a version that timed out is being rolled back, and opens it', () => {
    const a = describeReleaseSafety(input({ waiting: ready([waiting({ state: 'expired' })]) }));
    expect(a.sentence).toBe('v44 ran out of time waiting for approval and is being rolled back.');
    expect(a.holds[0].action).toEqual({ kind: 'open', deploymentId: 'dep44', version: 'v44' });
  });

  it('names a scheduled release and when it goes live, soonest first, ignoring ended ones', () => {
    const a = describeReleaseSafety(
      input({
        schedules: ready([
          schedule({ id: 'later', revision: 46, release_at: local(14, 9) }),
          schedule(),
          schedule({ id: 'done', state: 'started', revision: 40 }),
        ]),
      })
    );
    expect(a).toMatchObject({ phase: 'held', word: 'Scheduled', tone: 'active' });
    expect(a.holds.map((h) => h.sentence)).toEqual([
      `v45 is scheduled to go live <${local(13, 18)}>.`,
      `v46 is scheduled to go live <${local(14, 9)}>.`,
    ]);
    expect(a.holds[0].action).toEqual({ kind: 'open', deploymentId: 'dep45', version: 'v45' });
  });

  it('says a schedule past its time is due, not that it goes live in the past', () => {
    const a = describeReleaseSafety(
      input({ schedules: ready([schedule({ release_at: local(10, 11) })]) })
    );
    expect(a.sentence).toBe('v45 is due to start its scheduled rollout.');
  });

  it('orders a freeze before approvals before schedules', () => {
    const a = describeReleaseSafety(
      input({
        freezes: ready(status({ frozen: true, active: [freeze()] })),
        waiting: ready([waiting()]),
        schedules: ready([schedule()]),
      })
    );
    expect(a.holds.map((h) => h.key)).toEqual(['frozen', 'approval-dep44', 'schedule-s1']);
  });

  it('never says nothing is blocking when a read failed', () => {
    const a = describeReleaseSafety(
      input({ freezes: { state: 'failed' }, schedules: { state: 'failed' } })
    );
    expect(a).toMatchObject({ phase: 'partial', tone: 'idle' });
    expect(a.sentence).toBe('Nothing we could check is blocking releases.');
    expect(a.detail[0]).toBe('Couldn’t check freezes and scheduled releases.');
  });

  it('waits for its reads, unless something already holds a release', () => {
    expect(describeReleaseSafety(input({ waiting: { state: 'loading' } })).phase).toBe('loading');
    expect(
      describeReleaseSafety(
        input({
          waiting: { state: 'loading' },
          freezes: ready(status({ frozen: true, active: [freeze()] })),
        })
      ).phase
    ).toBe('held');
  });

  it('treats a mechanism the account does not have as unable to hold a release', () => {
    const a = describeReleaseSafety(
      input({
        freezes: { state: 'off' },
        policy: { state: 'off' },
        waiting: { state: 'off' },
        schedules: { state: 'off' },
      })
    );
    expect(a.phase).toBe('clear');
  });
});

describe('mechanism sentences', () => {
  it('words approvers and the policy', () => {
    expect(approversPhrase('admin', 1)).toBe('an owner or admin');
    expect(approversPhrase('developer', 2)).toBe('owners, admins or developers');
    expect(approvalPolicySentence(null)).toBe('New versions don’t wait for anyone’s approval.');
    expect(approvalPolicySentence(policy())).toBe(
      'New versions pause partway through their rollout until an owner or admin approves them.'
    );
    expect(approvalPolicyDetails(policy())).toEqual([
      {
        label: 'Whose approval counts',
        value: 'Anyone eligible except the person who deployed',
      },
      { label: 'Where it pauses', value: 'Canary stage 2' },
      { label: 'Gives up after', value: '1 h 30 min, then the version is rolled back' },
      { label: 'Tells', value: 'ops-slack' },
    ]);
  });

  it('marks approvals waiting, on or off', () => {
    expect(approvalCardWords(null, [])).toMatchObject({ word: 'Off', tone: 'idle' });
    expect(approvalCardWords(policy(), [])).toMatchObject({ word: 'On', tone: 'active' });
    expect(approvalCardWords(policy(), [waiting()])).toMatchObject({
      word: 'Waiting',
      tone: 'warning',
    });
  });

  it('says whether freezes pause releases now, next, or not at all', () => {
    const app = { kind: 'app', slug: 'shop' } as const;
    expect(freezeCardWords({ owner: app, freezes: [], status: status(), when })).toMatchObject({
      word: 'Off',
      sentence: 'No freeze is set. Add one to pause releases over a weekend or during an incident.',
    });
    expect(
      freezeCardWords({
        owner: app,
        freezes: [freeze({ app: undefined })],
        status: status({ frozen: true, active: [freeze()] }),
        when,
      })
    ).toMatchObject({
      word: 'Frozen now',
      tone: 'critical',
      sentence: 'Releases are paused by “incident 4711”.',
    });
    const upcoming = freeze({ active: false, next_starts_at: 'N' });
    expect(
      freezeCardWords({
        owner: app,
        freezes: [upcoming, freeze({ id: 'r', kind: 'after_rollback', active: false })],
        status: status({ next: upcoming }),
        when,
      }).sentence
    ).toBe('2 freezes can pause releases; the next starts <N>.');
    expect(
      freezeCardWords({
        owner: { kind: 'org', org: 'acme' },
        freezes: [freeze({ app: undefined, org: 'acme' })],
        when,
      }).sentence
    ).toBe('Releases of acme’s apps are paused by “incident 4711”.');
    // A freeze on one app pauses only that app, not the whole account.
    expect(
      freezeCardWords({ owner: { kind: 'account' }, freezes: [freeze()], when }).sentence
    ).toBe('Releases of shop are paused by “incident 4711”.');
    expect(
      freezeCardWords({
        owner: { kind: 'account' },
        freezes: [freeze(), freeze({ id: 'f2', app: undefined })],
        when,
      }).sentence
    ).toBe('2 freezes are pausing releases now.');
    expect(
      freezeCardWords({
        owner: { kind: 'account' },
        freezes: [freeze({ active: false })],
        when,
      }).sentence
    ).toBe('One freeze can pause releases; none is active now.');
  });

  it('says rollouts stop on built-in signals, and on the app’s own checks', () => {
    expect(gateCardWords([])).toMatchObject({ word: 'Built-in only', tone: 'idle' });
    expect(gateCardWords([{} as never]).sentence).toBe(
      'Rollouts also stop when your own check fails.'
    );
    expect(gateCardWords([{} as never, {} as never]).sentence).toBe(
      'Rollouts also stop when any of your 2 checks fails.'
    );
  });

  it('says what goes live next, naming the app on the account-wide list', () => {
    const version = (s: ScheduledRelease) => `v${s.revision}`;
    expect(scheduleCardWords({ schedules: [], app: 'shop', version, when }).word).toBe('None');
    expect(
      scheduleCardWords({ schedules: [schedule()], app: 'shop', version, when }).sentence
    ).toBe(`v45 goes live <${local(13, 18)}>.`);
    expect(
      scheduleCardWords({
        schedules: [schedule(), schedule({ id: 's2', revision: 46, release_at: local(12, 9) })],
        version,
        when,
      })
    ).toMatchObject({
      word: '2 scheduled',
      sentence: `2 releases are scheduled; the first, shop v46, goes live <${local(12, 9)}>.`,
    });
  });

  it('says why a schedule ended without starting, preferring the API’s own words', () => {
    expect(scheduleOutcome(schedule())).toBeUndefined();
    expect(scheduleOutcome(schedule({ outcome_code: 'release_frozen' }))).toBe(
      'Releases were frozen at that time.'
    );
    expect(scheduleOutcome(schedule({ outcome_code: 'x', outcome_detail: 'Because.' }))).toBe(
      'Because.'
    );
    expect(scheduleOutcome(schedule({ outcome_code: 'mystery' }))).toBeUndefined();
  });

  it('joins what could not be checked', () => {
    expect(uncheckedPhrase(['freezes'])).toBe('freezes');
    expect(uncheckedPhrase(['freezes', 'approvals', 'schedules'])).toBe(
      'freezes, approvals and scheduled releases'
    );
  });
});
