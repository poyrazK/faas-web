import { describe, expect, it } from 'vitest';
import type { Deployment } from './api/queries';
import {
  canRollBackTo,
  humanDuration,
  nowSubject,
  rolloutSentence,
  rolloutView,
  shortDigest,
  sourceLabel,
  versionStatus,
} from './deployment-history-view';

function dep(over: Partial<Deployment> = {}): Deployment {
  return {
    id: 'd1',
    app_id: 'a1',
    image_digest: 'sha256:f35835e0aa',
    kind: 'github',
    status: 'live',
    created_at: '2026-11-09T09:00:00Z',
    ...over,
  };
}

describe('humanDuration', () => {
  it('reads seconds, minutes and hours the way a person says them', () => {
    expect(humanDuration(38)).toBe('38 s');
    expect(humanDuration(0.2)).toBe('1 s');
    expect(humanDuration(247)).toBe('4 min');
    expect(humanDuration(3900)).toBe('1 h 5 min');
    expect(humanDuration(7200)).toBe('2 h');
  });

  it('says nothing when the build reported no duration', () => {
    expect(humanDuration(undefined)).toBeUndefined();
    expect(humanDuration(null)).toBeUndefined();
    expect(humanDuration(-1)).toBeUndefined();
  });
});

describe('shortDigest', () => {
  it('drops the algorithm and keeps seven characters', () => {
    expect(shortDigest('sha256:700ef9fabc')).toBe('700ef9f');
    expect(shortDigest('')).toBe('');
  });
});

describe('versionStatus', () => {
  it('maps the API status vocabulary to plain words', () => {
    expect(versionStatus(dep({ traffic_percent: 90 })).word).toBe('Current version (serving 90%)');
    expect(versionStatus(dep({ traffic_percent: undefined })).word).toBe('Current version');
    expect(versionStatus(dep({ status: 'superseded' })).word).toBe('Replaced');
    expect(versionStatus(dep({ status: 'failed' }))).toEqual({ word: 'Failed', tone: 'critical' });
    expect(versionStatus(dep({ status: 'crashed' })).word).toBe('Failed');
    expect(versionStatus(dep({ status: 'cancelled' })).word).toBe('Cancelled');
    expect(versionStatus(dep({ status: 'imaging' })).word).toBe('Building');
    expect(versionStatus(dep({ status: 'pending' })).word).toBe('Queued');
  });

  it('reads a live row by its rollout and traffic', () => {
    expect(versionStatus(dep({ rollout_state: 'rolling_out', traffic_percent: 10 })).word).toBe(
      'New version (getting 10%)'
    );
    expect(versionStatus(dep({ rollout_state: 'aborted', traffic_percent: 0 })).word).toBe(
      'Rolled back'
    );
    expect(versionStatus(dep({ traffic_percent: 0 })).word).toBe('Ready, no traffic');
    expect(versionStatus(dep({ scope: 'staging', traffic_percent: 100 })).word).toBe(
      'Live in staging (serving 100%)'
    );
  });

  it('shows a status it does not know as the API wrote it', () => {
    expect(versionStatus(dep({ status: 'teleporting' })).word).toBe('teleporting');
  });
});

describe('canRollBackTo', () => {
  it('offers only replaced versions, as the checked rollback accepts', () => {
    expect(canRollBackTo(dep({ status: 'superseded' }))).toBe(true);
    expect(canRollBackTo(dep({ status: 'live' }))).toBe(false);
    expect(canRollBackTo(dep({ status: 'failed' }))).toBe(false);
  });
});

describe('rolloutView', () => {
  it('labels the steps from the preset ladder when it agrees with the row', () => {
    const view = rolloutView(
      dep({
        canary_preset: 'balanced',
        canary_step: 1,
        canary_total_steps: 4,
        traffic_percent: 10,
        rollout_state: 'rolling_out',
      })
    );
    expect(view.steps).toEqual([
      { label: '1%', state: 'done' },
      { label: '10%', state: 'current' },
      { label: '50%', state: 'next' },
      { label: '100%', state: 'next' },
    ]);
    expect(view.nextPercent).toBe(50);
    expect(rolloutSentence(view)).toBe('A new version is getting 10% of traffic');
  });

  it('falls back to step numbers when the ladder does not match', () => {
    const view = rolloutView(
      dep({
        canary_preset: 'balanced',
        canary_step: 1,
        canary_total_steps: 3,
        traffic_percent: 10,
        rollout_state: 'rolling_out',
      })
    );
    expect(view.steps.map((s) => s.label)).toEqual(['Step 1', '10%', 'Step 3']);
    expect(view.nextPercent).toBeUndefined();
  });

  it('says less when the traffic share is unknown', () => {
    const view = rolloutView(dep({ rollout_state: 'rolling_out', traffic_percent: undefined }));
    expect(rolloutSentence(view)).toBe('A new version is rolling out');
    expect(rolloutSentence(rolloutView(dep({ rollout_state: 'pending' })))).toBe(
      'A new version is about to roll out'
    );
  });
});

describe('nowSubject', () => {
  it('leads with a rollout in flight and names the version it is replacing', () => {
    const canary = dep({ id: 'new', rollout_state: 'rolling_out', traffic_percent: 10 });
    const current = dep({ id: 'old', traffic_percent: 90 });
    expect(nowSubject([canary, current])).toEqual({
      kind: 'rollout',
      deployment: canary,
      predecessor: current,
    });
  });

  it('otherwise leads with the version serving the default environment', () => {
    const staging = dep({ id: 'stg', scope: 'staging', traffic_percent: 100 });
    const live = dep({ id: 'live', traffic_percent: 100 });
    const building = dep({ id: 'b', status: 'building' });
    expect(nowSubject([building, staging, live])).toEqual({
      kind: 'live',
      deployment: live,
      newer: building,
    });
  });

  it('falls back to the newest row when nothing is serving', () => {
    const failed = dep({ id: 'f', status: 'failed' });
    expect(nowSubject([failed])).toEqual({ kind: 'latest', deployment: failed });
    expect(nowSubject([])).toEqual({ kind: 'none' });
  });
});

describe('sourceLabel', () => {
  it('names where a version came from', () => {
    expect(sourceLabel(dep({ kind: 'github' }))).toBe('GitHub');
    expect(sourceLabel(dep({ kind: 'tarball' }))).toBe('an uploaded archive');
  });
});
