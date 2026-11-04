import { describe, expect, it } from 'vitest';
import { blankDraft, draftProblems, fromDraft, toDraft, deletesData } from './lifecycle-draft';

describe('lifecycle drafts', () => {
  it('round-trips every action apid stores', () => {
    const rules = [
      {
        id: 'expire-tmp',
        status: 'Enabled' as const,
        filter: { prefix: 'tmp/', tags: { stage: 'scratch' } },
        expiration: { days: 7 },
        noncurrent_version_expiration: { noncurrent_days: 30, newer_noncurrent_versions: 3 },
      },
      { id: 'abort', status: 'Disabled' as const, abort_incomplete_multipart_days: 2 },
      {
        id: 'year-end',
        status: 'Enabled' as const,
        expiration: { date: '2027-01-01T00:00:00Z' },
      },
      {
        id: 'markers',
        status: 'Enabled' as const,
        expiration: { expired_object_delete_marker: true },
      },
    ];
    expect(rules.map((r) => fromDraft(toDraft(r)))).toEqual(rules);
  });

  it('leaves the ID out when none is given, so apid generates one', () => {
    const draft = { ...blankDraft(), expire: 'days' as const, expireDays: '3' };
    expect(fromDraft(draft)).toEqual({ status: 'Enabled', expiration: { days: 3 } });
  });

  it('writes a chosen date as the UTC midnight apid requires', () => {
    const draft = { ...blankDraft(), expire: 'date' as const, expireDate: '2027-03-01' };
    expect(fromDraft(draft).expiration).toEqual({ date: '2027-03-01T00:00:00Z' });
  });

  it('asks for at least one action', () => {
    expect(draftProblems([blankDraft()])[0]).toContain(
      'Choose at least one thing for this rule to do.'
    );
  });

  it('refuses tag filters with multipart or delete-marker cleanup, as apid does', () => {
    const tagged = { ...blankDraft(), tags: 'team=web', abort: true, abortDays: '3' };
    expect(draftProblems([tagged])[0]).toContain(
      'A tag filter cannot be combined with aborting uploads or clearing delete markers.'
    );
    const markers = { ...blankDraft(), tags: 'team=web', expire: 'markers' as const };
    expect(draftProblems([markers])[0]).toContain(
      'A tag filter cannot be combined with aborting uploads or clearing delete markers.'
    );
  });

  it('checks day counts, tag syntax and duplicate IDs', () => {
    const bad = {
      ...blankDraft(),
      id: 'same',
      expire: 'days' as const,
      expireDays: '0',
      tags: 'oops',
      noncurrent: true,
      noncurrentDays: '5',
      keepNewer: '101',
    };
    const twin = { ...blankDraft(), id: 'same', abort: true, abortDays: '1' };
    const [first, second] = draftProblems([bad, twin]);
    expect(first).toEqual(
      expect.arrayContaining([
        'Days must be a whole number of at least 1.',
        'Write tags as key=value, separated by commas.',
        'Keep between 1 and 100 newer versions.',
        'Rule IDs must be unique.',
      ])
    );
    expect(second).toContain('Rule IDs must be unique.');
  });

  it('knows which rules delete data, so saving them asks first', () => {
    expect(deletesData([{ ...blankDraft(), abort: true, abortDays: '2' }])).toBe(false);
    expect(deletesData([{ ...blankDraft(), expire: 'days', expireDays: '2' }])).toBe(true);
    expect(deletesData([{ ...blankDraft(), noncurrent: true, noncurrentDays: '2' }])).toBe(true);
    expect(
      deletesData([{ ...blankDraft(), enabled: false, expire: 'days', expireDays: '2' }])
    ).toBe(false);
  });
});
