import { describe, expect, it } from 'vitest';
import type { App, Deployment } from '@/lib/api/queries';
import {
  effectiveLifecycle,
  effectiveProbes,
  gracePeriodSeconds,
  lifecycleLimits,
  servingDeployment,
} from './health-probes';

const app = (manifest: Record<string, unknown> = {}) =>
  ({ slug: 'api-gateway', manifest: { entrypoint: ['node'], ...manifest } }) as unknown as App;
const dep = (fields: Record<string, unknown>) =>
  ({ id: 'd', status: 'live', created_at: '2026-10-30T00:00:00Z', ...fields }) as Deployment;

describe('gracePeriodSeconds', () => {
  it('reads the nanoseconds apid actually sends (time.Duration has no JSON marshaller)', () => {
    expect(gracePeriodSeconds(30_000_000_000)).toBe(30);
    expect(gracePeriodSeconds(1_500_000_000)).toBe(2);
  });
  it('reads the Go duration string the spec documents', () => {
    expect(gracePeriodSeconds('45s')).toBe(45);
    expect(gracePeriodSeconds('1m30s')).toBe(90);
    expect(gracePeriodSeconds('1500ms')).toBe(2);
  });
  it('treats absent, zero and unreadable values as unset', () => {
    expect(gracePeriodSeconds(undefined)).toBe(0);
    expect(gracePeriodSeconds(null)).toBe(0);
    expect(gracePeriodSeconds(0)).toBe(0);
    expect(gracePeriodSeconds('soon')).toBe(0);
  });
});

describe('lifecycleLimits', () => {
  it('mirrors the per-plan defaults and caps in faas limits.go', () => {
    expect(lifecycleLimits('free')).toEqual({
      stopGraceS: 15,
      startupDeadlineS: 15,
      maxRetries: 3,
    });
    expect(lifecycleLimits('hobby')).toEqual({
      stopGraceS: 30,
      startupDeadlineS: 30,
      maxRetries: 5,
    });
    expect(lifecycleLimits('pro')).toEqual({
      stopGraceS: 60,
      startupDeadlineS: 30,
      maxRetries: 10,
    });
    expect(lifecycleLimits('scale')).toEqual({
      stopGraceS: 120,
      startupDeadlineS: 30,
      maxRetries: 20,
    });
    expect(lifecycleLimits(undefined)).toBeUndefined();
  });
});

describe('effectiveLifecycle', () => {
  it('marks every unset value as a default and resolves it per mode and plan', () => {
    const out = effectiveLifecycle(app(), 'hobby');
    expect(out.mode).toBe('request');
    expect(out.restartPolicy).toEqual({ value: 'on-failure', isDefault: true });
    expect(out.maxRetries).toEqual({ value: 5, isDefault: true });
    expect(out.startupDeadlineS).toEqual({ value: 30, isDefault: true });
    expect(out.stopSignal).toEqual({ value: 'SIGTERM', isDefault: true });
    // The scheduler's own fallback, not the plan cap (faas sched/lifecycle.go:1541).
    expect(out.stopGraceS).toEqual({ value: 30, isDefault: true });
  });

  it('derives the restart default from the execution mode', () => {
    expect(effectiveLifecycle(app({ execution_mode: 'worker' }), 'pro').restartPolicy.value).toBe(
      'always'
    );
    expect(effectiveLifecycle(app({ execution_mode: 'service' }), 'pro').restartPolicy.value).toBe(
      'always'
    );
    expect(effectiveLifecycle(app({ execution_mode: 'job' }), 'pro').restartPolicy.value).toBe(
      'no'
    );
  });

  it('reports stored values as set', () => {
    const out = effectiveLifecycle(
      app({
        execution_mode: 'worker',
        restart_policy: 'unless-stopped',
        max_retries: 2,
        startup_deadline_s: 12,
        stop_signal: 'SIGINT',
        stop_grace_period: 45_000_000_000,
      }),
      'pro'
    );
    expect(out.restartPolicy).toEqual({ value: 'unless-stopped', isDefault: false });
    expect(out.maxRetries).toEqual({ value: 2, isDefault: false });
    expect(out.startupDeadlineS).toEqual({ value: 12, isDefault: false });
    expect(out.stopSignal).toEqual({ value: 'SIGINT', isDefault: false });
    expect(out.stopGraceS).toEqual({ value: 45, isDefault: false });
  });

  it('leaves plan defaults unknown while the plan is', () => {
    const out = effectiveLifecycle(app(), undefined);
    expect(out.maxRetries).toEqual({ value: undefined, isDefault: true });
    expect(out.startupDeadlineS).toEqual({ value: undefined, isDefault: true });
  });
});

describe('servingDeployment', () => {
  it('picks the newest live deployment', () => {
    const rows = [
      dep({ id: 'new', status: 'building', created_at: '2026-10-31T00:00:00Z' }),
      dep({ id: 'live', status: 'live', created_at: '2026-10-30T00:00:00Z' }),
      dep({ id: 'old', status: 'superseded', created_at: '2026-10-29T00:00:00Z' }),
    ];
    expect(servingDeployment(rows)?.id).toBe('live');
    expect(servingDeployment([rows[0], rows[2]])).toBeUndefined();
  });
});

describe('effectiveProbes', () => {
  it('describes the platform defaults for a request app with no overrides', () => {
    const out = effectiveProbes(app({ port: 3000 }), dep({}))!;
    expect(out.startup).toMatchObject({ kind: 'default', action: 'TCP connect on port 3000' });
    expect(out.readiness).toMatchObject({ kind: 'off' });
    expect(out.liveness).toMatchObject({
      kind: 'default',
      action: 'GET /healthz',
      timing: 'every 5 s · 2 s timeout · restart after 3 failures',
    });
  });

  it('uses the image health path for startup when the build recorded one', () => {
    expect(effectiveProbes(app({ healthz: '/ready' }), dep({}))!.startup).toMatchObject({
      kind: 'set',
      action: 'GET /ready',
    });
  });

  it('reads the deployment overrides, filling unset timing with the defaults', () => {
    const out = effectiveProbes(
      app(),
      dep({
        override_healthcheck: { path: '/startz' },
        override_readiness_probe: { grpc: { service: 'orders' }, failure_threshold: 5 },
        override_liveness_probe: { path: '/livez', interval_s: 10, consecutive_failures: 4 },
      })
    )!;
    expect(out.startup).toMatchObject({ kind: 'set', action: 'GET /startz' });
    expect(out.readiness).toMatchObject({
      kind: 'set',
      action: 'gRPC health check (orders)',
      timing: 'every 5 s · 2 s timeout · out of routing after 5 failures',
    });
    expect(out.liveness).toMatchObject({
      kind: 'set',
      action: 'GET /livez',
      timing: 'every 10 s · 2 s timeout · restart after 4 failures',
    });
  });

  it('turns the default liveness probe off for workers and jobs, which never listen', () => {
    for (const mode of ['worker', 'job']) {
      const out = effectiveProbes(app({ execution_mode: mode }), dep({}))!;
      expect(out.liveness.kind).toBe('off');
      expect(out.startup.kind).toBe('off');
    }
    // An explicit override still runs (faas fcvm/manager.go:2598).
    const probed = effectiveProbes(
      app({ execution_mode: 'worker' }),
      dep({ override_liveness_probe: { path: '/livez' } })
    )!;
    expect(probed.liveness).toMatchObject({ kind: 'set', action: 'GET /livez' });
  });

  it('says nothing about probes when no deployment is serving', () => {
    expect(effectiveProbes(app(), undefined)).toBeUndefined();
  });
});
