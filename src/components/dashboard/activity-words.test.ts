import { describe, expect, it } from 'vitest';
import type { ResourceActivity } from '@/lib/api/resource-activity';
import {
  activityHeadline,
  activitySentence,
  actorWords,
  dayLabel,
  groupByDay,
  namesActor,
  outcomeMark,
} from './activity-words';

const UTC = { timeZone: 'UTC' };
const NOW = Date.parse('2026-11-10T15:00:00Z');

function row(id: string, occurred_at: string, over: Partial<ResourceActivity> = {}) {
  return {
    id,
    occurred_at,
    kind: 'app.deployed',
    summary: 'Dev deployed api',
    actor: { type: 'user', label: 'Dev' },
    resource: { type: 'app', label: 'api' },
    data: {},
    ...over,
  } as ResourceActivity;
}

describe('dayLabel', () => {
  it('names today, yesterday, then the date', () => {
    expect(dayLabel(Date.parse('2026-11-10T01:00:00Z'), { now: NOW, ...UTC })).toBe('Today');
    expect(dayLabel(Date.parse('2026-11-09T23:59:00Z'), { now: NOW, ...UTC })).toBe('Yesterday');
    expect(dayLabel(Date.parse('2026-11-03T12:00:00Z'), { now: NOW, ...UTC })).toBe('Tue, Nov 3');
    expect(dayLabel(Date.parse('2025-11-03T12:00:00Z'), { now: NOW, ...UTC })).toBe(
      'Mon, Nov 3, 2025'
    );
  });
});

describe('groupByDay', () => {
  it('keeps newest-first order and puts an undated event where it falls', () => {
    const groups = groupByDay(
      [
        row('5', '2026-11-10T14:00:00Z'),
        row('4', '2026-11-10T02:00:00Z'),
        row('3', 'not a time'),
        row('2', '2026-11-09T20:00:00Z'),
        row('1', '2026-11-03T20:00:00Z'),
      ],
      { now: NOW, ...UTC }
    );
    expect(groups.map((group) => [group.label, group.rows.map((r) => r.id)])).toEqual([
      ['Today', ['5', '4']],
      ['Date unknown', ['3']],
      ['Yesterday', ['2']],
      ['Tue, Nov 3', ['1']],
    ]);
    expect(new Set(groups.map((group) => group.key)).size).toBe(groups.length);
  });
});

describe('activitySentence and actors', () => {
  it('uses the API sentence, and the kind only when there is none', () => {
    expect(activitySentence(row('1', '', { summary: 'Dev deployed api' }))).toBe(
      'Dev deployed api'
    );
    expect(activitySentence(row('1', '', { summary: ' ', kind: 'future.kind' }))).toBe(
      'Dev: future.kind'
    );
  });

  it('adds the kind of actor only when the name does not say it', () => {
    expect(actorWords({ type: 'user', label: 'Dev' })).toBe('Dev');
    expect(actorWords({ type: 'github', label: 'GitHub Actions' })).toBe('GitHub Actions');
    expect(actorWords({ type: 'api_key', label: 'ci-bot' })).toBe('ci-bot (API key)');
    expect(actorWords({ type: 'system', label: '' })).toBe('Unknown actor (system)');
  });

  it('knows when the sentence already names the actor', () => {
    expect(namesActor(row('1', ''))).toBe(true);
    expect(namesActor(row('1', '', { summary: 'api.example.com added' }))).toBe(false);
  });
});

describe('outcomeMark', () => {
  it('marks failures, cancels and unknown kinds; success and requests stay quiet', () => {
    expect(outcomeMark('deploy.failed')).toEqual({ word: 'Failed', tone: 'critical' });
    expect(outcomeMark('deploy.rollback_failed')?.word).toBe('Failed');
    expect(outcomeMark('deploy.cancelled')).toEqual({ word: 'Cancelled', tone: 'muted' });
    expect(outcomeMark('future.kind')?.word).toBe('Outcome unknown');
    expect(outcomeMark('app.deployed')).toBeUndefined();
    expect(outcomeMark('deploy.requested')).toBeUndefined();
  });
});

describe('activityHeadline', () => {
  const today = [
    row('3', '2026-11-10T14:00:00Z', { kind: 'deploy.failed' }),
    row('2', '2026-11-10T10:00:00Z'),
  ];
  const older = row('1', '2026-11-09T10:00:00Z');

  it('counts today exactly once the loaded history reaches past midnight', () => {
    expect(
      activityHeadline([...today, older], { now: NOW, hasOlder: true, filtered: false, ...UTC })
    ).toBe('2 events today, 1 failed.');
    expect(
      activityHeadline([today[1]], { now: NOW, hasOlder: false, filtered: false, ...UTC })
    ).toBe('1 event today, none failed.');
  });

  it('says "at least" while older pages could still hold today’s events', () => {
    expect(activityHeadline(today, { now: NOW, hasOlder: true, filtered: false, ...UTC })).toBe(
      'At least 2 events today, 1 of them failed so far.'
    );
  });

  it('says when nothing happened today and how long ago the last event was', () => {
    expect(activityHeadline([older], { now: NOW, hasOlder: false, filtered: true, ...UTC })).toBe(
      'No matching activity today. The last was 1d ago.'
    );
  });

  it('has nothing to say without a dated event', () => {
    expect(
      activityHeadline([row('1', 'bad')], { now: NOW, hasOlder: false, filtered: false })
    ).toBeUndefined();
  });
});
