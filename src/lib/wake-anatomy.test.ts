import { describe, expect, it } from 'vitest';
import { parseWake, type RawWakeEvent } from './wake-anatomy';
import {
  at,
  coldBootFrames,
  failedFrames,
  fallbackFrames,
  frame,
  restoreFrames,
  stalledFrames,
  thawFrames,
} from '@/test/wake-frames';

describe('parseWake', () => {
  it('reads a restore: milestones on a real axis, ordered by time', () => {
    const { generations, otherFrames } = parseWake(restoreFrames());
    expect(otherFrames).toEqual([]);
    expect(generations).toHaveLength(1);
    const g = generations[0];
    expect(g.method).toBe('restore');
    expect(g.outcome).toEqual({ status: 'ready' });
    expect(g.totalMs).toBe(311);
    // readiness_200 (vmmd) lands before boot_completed (schedd): order is by time.
    expect(g.segments.map((s) => [s.label, s.startMs, s.endMs, s.actor])).toEqual([
      ['Until admitted', 0, 4, 'schedd'],
      ['Until boot started', 4, 9, 'schedd'],
      ['Until ready', 9, 282, 'vmmd'],
      ['Until boot recorded', 282, 290, 'schedd'],
      ['Until first byte', 290, 311, 'gatewayd'],
    ]);
    expect(g.breakdownAt).toBe('wake.readiness_200');
    expect(g.firstByte).toEqual({
      latencyMs: 311,
      proxyLatencyMs: 3,
      gatewayPhasesMs: { route: 1, wake_wait: 300 },
    });
  });

  it('attributes restore phases by share of the total and keeps pre-window phases apart', () => {
    const b = parseWake(restoreFrames()).generations[0].breakdown!;
    expect(b.kind).toBe('restore');
    expect(b.totalMs).toBe(302);
    expect(b.beforeWindow.map((p) => p.key)).toEqual([
      'lease_acquire_ms',
      'env_prepare_ms',
      'pre_network_ms',
      'setup_network_ms',
    ]);
    expect(b.phases[0]).toEqual({
      key: 'restore_gate_wait_ms',
      label: 'Wait for restore slot',
      ms: 0,
      share: 0,
    });
    expect(b.largest).toMatchObject({ key: 'load_snapshot_ms', label: 'Load snapshot', ms: 142 });
    expect(b.largest!.share).toBeCloseTo(142 / 302);
    expect(b.phaseSumMs).toBe(263);
    expect(b.artifacts).toEqual([
      { artifact: 'kernel', source: 'cache_hit', durationMs: 1, bytes: 12_000_000 },
      { artifact: 'main', source: 'materialized', durationMs: 5, bytes: 480_000_000 },
    ]);
  });

  it('never names a pre-window phase as the largest', () => {
    const frames = restoreFrames().map((f) =>
      f.kind === 'wake.restore_breakdown' ? { ...f, data: { ...f.data, setup_network_ms: 900 } } : f
    );
    expect(parseWake(frames).generations[0].breakdown!.largest?.key).toBe('load_snapshot_ms');
  });

  it('draws a leading Queued segment from queue_wait_ms', () => {
    const frames = restoreFrames().map((f) =>
      f.kind === 'wake.queue_accepted' ? { ...f, data: { queue_wait_ms: 15 } } : f
    );
    const g = parseWake(frames).generations[0];
    expect(g.segments[0]).toMatchObject({ label: 'Queued', startMs: 0, endMs: 15 });
    expect(g.segments[1]).toMatchObject({ label: 'Until admitted', startMs: 15, endMs: 19 });
  });

  it('reads a cold boot and drops a zero byte size', () => {
    const g = parseWake(coldBootFrames).generations[0];
    expect(g.method).toBe('cold_boot');
    expect(g.breakdown).toMatchObject({ kind: 'cold_boot', totalMs: 872, phaseSumMs: 872 });
    expect(g.breakdown!.beforeWindow).toEqual([]);
    expect(g.breakdown!.largest?.key).toBe('wait_ready_ms');
    expect(g.breakdown!.artifacts).toEqual([
      { artifact: 'base', source: 'direct', durationMs: 120 },
    ]);
    expect(g.totalMs).toBe(910);
  });

  it('splits thaws into generations after each first byte', () => {
    const gens = parseWake(thawFrames).generations;
    expect(gens.map((g) => g.method)).toEqual(['restore', 'thaw', 'thaw']);
    expect(gens[2].breakdown).toMatchObject({ kind: 'thaw', totalMs: 26, phaseSumMs: 26 });
    expect(gens[2].segments).toEqual([
      {
        key: 'wake.proxy_first_byte',
        label: 'Until first byte',
        startMs: 0,
        endMs: 30,
        actor: 'gatewayd',
      },
    ]);
    expect(gens[2].breakdownAt).toBe('wake.proxy_first_byte');
    expect(gens[2].totalMs).toBe(30);
  });

  it('keeps a boot_completed that lands after the first byte in the same generation', () => {
    // schedd publishes RUNNING before it stamps boot_completed, so a waiting
    // request can reach its first byte first. That is still one wake.
    const frames = restoreFrames().map((f) =>
      f.kind === 'wake.boot_completed' ? { ...f, at: at(316) } : f
    );
    const gens = parseWake(frames).generations;
    expect(gens).toHaveLength(1);
    expect(gens[0].outcome).toEqual({ status: 'ready' });
    expect(gens[0].method).toBe('restore');
    expect(gens[0].totalMs).toBe(311);
  });

  it('keeps frames after the last first byte as an in-progress generation', () => {
    const gens = parseWake([
      ...restoreFrames(),
      frame(60_000, 'wake.admitted', 'schedd'),
    ]).generations;
    expect(gens).toHaveLength(2);
    expect(gens[1].outcome).toEqual({ status: 'in_progress' });
    expect(gens[1].totalMs).toBeUndefined();
  });

  it.each([
    ['failed', failedFrames, { status: 'failed', reason: 'oom_killed' }],
    ['stalled', stalledFrames, { status: 'stalled', reason: 'watchdog_timeout' }],
  ])('reports a %s wake with its reason', (_name, frames, outcome) => {
    expect(parseWake(frames).generations[0].outcome).toEqual(outcome);
  });

  it('notes a restore that fell back to a cold boot', () => {
    const g = parseWake(fallbackFrames).generations[0];
    expect(g.fallback).toBe('after_restore_failed');
    expect(g.method).toBe('cold_boot');
    expect(g.outcome).toEqual({ status: 'ready' });
  });

  it('drops malformed numbers and unknown artifact sources instead of drawing them', () => {
    const b = parseWake([
      {
        at: at(100),
        kind: 'wake.restore_breakdown',
        actor: 'vmmd',
        data: {
          load_snapshot_ms: '142',
          resume_hook_ms: -3,
          wait_ready_ms: Number.NaN,
          chroot_ms: 4,
          total_ms: 'soon',
          resolve_artifacts: [
            { artifact: 'main', source: 'teleported', duration_ms: 5 },
            { artifact: 'x' },
            'junk',
          ],
        },
      },
    ]).generations[0].breakdown!;
    expect(b.phases.map((p) => p.key)).toEqual(['chroot_ms']);
    expect(b.totalMs).toBe(0);
    expect(b.phases[0].share).toBe(0);
    expect(b.artifacts).toEqual([{ artifact: 'main', source: 'unknown', durationMs: 5 }]);
  });

  it('tolerates frames with no data at all', () => {
    const frames: RawWakeEvent[] = [
      { at: at(0), kind: 'wake.boot_started', actor: 'schedd' },
      { at: at(250), kind: 'wake.boot_completed', data: null },
    ];
    const g = parseWake(frames).generations[0];
    expect(g.method).toBe('unknown');
    expect(g.totalMs).toBe(250);
    expect(g.segments).toEqual([
      {
        key: 'wake.boot_completed',
        label: 'Until boot recorded',
        startMs: 0,
        endMs: 250,
        actor: '',
      },
    ]);
  });

  it('keeps unknown, legacy, unused and undated frames in otherFrames, unchanged', () => {
    const odd: RawWakeEvent[] = [
      frame(1, 'state_transition', 'schedd'),
      frame(2, 'wake.cold_boot_cpu', 'vmmd'),
      { at: 'not a time', kind: 'wake.admitted', actor: 'schedd', data: {} },
    ];
    expect(parseWake([...restoreFrames(), ...odd]).otherFrames).toEqual(odd);
  });

  it('returns nothing for an empty timeline', () => {
    expect(parseWake([])).toEqual({ generations: [], otherFrames: [] });
  });
});
