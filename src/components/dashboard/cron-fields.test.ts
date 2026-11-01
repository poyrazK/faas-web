import { describe, expect, it } from 'vitest';
import { effectiveOverlap, overlapPolicy } from './cron-fields';

describe('effectiveOverlap', () => {
  it('lets schedule_policy win over skip_if_running', () => {
    expect(
      effectiveOverlap({
        skip_if_running: true,
        schedule_policy: { version: 1, overlap: 'allow', missed_runs: 'skip' },
      })
    ).toBe('allow');
    expect(
      effectiveOverlap({
        skip_if_running: false,
        schedule_policy: { version: 1, overlap: 'replace', missed_runs: 'skip' },
      })
    ).toBe('replace');
  });

  it('falls back to skip_if_running when there is no policy', () => {
    expect(effectiveOverlap({ skip_if_running: true })).toBe('skip');
    expect(effectiveOverlap({ skip_if_running: false })).toBe('allow');
  });
});

describe('overlapPolicy', () => {
  it('uses the backend defaults when the cron has no policy', () => {
    expect(overlapPolicy({}, 'skip')).toEqual({ version: 1, overlap: 'skip', missed_runs: 'skip' });
  });

  it('carries missed_runs and a non-zero start deadline, because PATCH replaces the object', () => {
    expect(
      overlapPolicy(
        {
          schedule_policy: {
            version: 1,
            overlap: 'allow',
            missed_runs: 'coalesce_latest',
            start_deadline_seconds: 60,
          },
        },
        'replace'
      )
    ).toEqual({
      version: 1,
      overlap: 'replace',
      missed_runs: 'coalesce_latest',
      start_deadline_seconds: 60,
    });
  });
});
