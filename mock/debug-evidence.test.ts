import { describe, expect, it } from 'vitest';
import { apps, mirrorRules } from './data';
import { evidenceDeployment, evidenceExtras, replayTarget, timeSpans } from './debug-evidence';

const span = (span_id: string, name: string, ms: number) => ({
  trace_id: 't',
  span_id,
  name,
  kind: 'client',
  duration_nanos: ms * 1_000_000,
});
const [first, second] = apps;

describe('debug evidence mocks', () => {
  it('times spans inside the request, children after the server span starts', () => {
    const timed = timeSpans(
      [span('a', 'GET /orders/{id}', 2400), span('b', 'postgres.query', 2180)],
      '2026-11-03T10:00:00.000Z'
    );
    expect(timed[0].start_time).toBe('2026-11-03T10:00:00.000Z');
    expect(Date.parse(timed[1].start_time!)).toBeGreaterThan(Date.parse(timed[0].start_time!));
    expect(Date.parse(timed[1].end_time!) - Date.parse(timed[1].start_time!)).toBe(2180);
    expect(timed[1].parent_span_id).toBe('a');
  });

  it('marks unmeasured stages missing rather than zero, and keeps the shape apid returns', () => {
    const timed = timeSpans(
      [span('a', 'GET /x', 100), span('b', 'postgres.query', 80)],
      '2026-11-03T10:00:00Z'
    );
    const extras = evidenceExtras(first, 'abcdef0123456789', timed, '2026-11-03T10:00:00Z', true);
    expect(extras.correlation.stages).toHaveLength(6);
    const billing = extras.correlation.stages.find((s) => s.phase === 'billing')!;
    expect(billing).toMatchObject({ status: 'missing' });
    expect(billing.duration_ms).toBeUndefined();
    expect(extras.timeline.some((e) => e.phase === 'wake')).toBe(true);
    expect(extras.critical_path?.slowest_span_id).toBe('b');
    expect(extras.logs.length).toBeLessThanOrEqual(20);
  });

  it('replays only through an enabled rule of the serving deployment', () => {
    const rule = mirrorRules.get(first.slug)?.[0];
    if (rule) {
      expect(evidenceDeployment(first)).toBe(rule.source_deployment_id);
      expect(replayTarget(first, '')).toEqual({ rule });
      expect(replayTarget(first, rule.mirror_deployment_id)).toEqual({ rule });
      expect(replayTarget(first, '00000000-0000-4000-8000-000000000000')).toMatchObject({
        problem: expect.stringMatching(/not an enabled target/),
      });
    }
    expect(replayTarget(second, '')).toMatchObject({
      problem: expect.stringMatching(/no enabled mirror rule/),
    });
  });
});
