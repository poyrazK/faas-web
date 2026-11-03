import { expect, it } from 'vitest';
import * as db from './data';
import { applyLifecycle } from './lifecycle';

const fresh = (manifest: Record<string, unknown> = {}) =>
  ({ ...db.apps[0], manifest: { entrypoint: ['node'], ...manifest } }) as db.App;

it('stores lifecycle fields the way AppResponse reads them back', () => {
  const app = fresh();
  expect(
    applyLifecycle(
      app,
      {
        restart_policy: 'always',
        max_retries: 4,
        startup_deadline_s: 20,
        stop_signal: 'SIGINT',
        stop_grace_period_s: 25,
      },
      'pro'
    )
  ).toBeUndefined();
  expect(app.manifest).toMatchObject({
    restart_policy: 'always',
    max_retries: 4,
    startup_deadline_s: 20,
    stop_signal: 'SIGINT',
    // time.Duration, in nanoseconds, as apid encodes it.
    stop_grace_period: 25_000_000_000,
  });
});

it('clears a field back to its default on an empty value', () => {
  const app = fresh({ restart_policy: 'always', stop_grace_period: 25e9, max_retries: 4 });
  applyLifecycle(app, { restart_policy: '', stop_grace_period_s: 0, max_retries: 0 }, 'pro');
  expect(app.manifest?.restart_policy).toBeUndefined();
  expect(app.manifest?.stop_grace_period).toBeUndefined();
  expect(app.manifest?.max_retries).toBeUndefined();
});

it('leaves the manifest alone when the body names no lifecycle field', () => {
  const app = fresh({ restart_policy: 'no' });
  expect(applyLifecycle(app, { ram_mb: 512 }, 'pro')).toBeUndefined();
  expect(app.manifest?.restart_policy).toBe('no');
});

it('refuses what apid refuses, with its 400 validation_failed, and writes nothing', () => {
  const cases: [Record<string, unknown>, string, RegExp][] = [
    [{ restart_policy: 'sometimes' }, 'pro', /restart_policy/],
    [{ stop_grace_period_s: 31 }, 'hobby', /stop_grace_period 31s exceeds plan "hobby" cap 30s/],
    [{ startup_deadline_s: 16 }, 'free', /startup_deadline_s 16 exceeds plan "free" cap 15/],
    [{ max_retries: 11 }, 'pro', /max_retries 11 exceeds plan "pro" cap 10/],
    [{ max_retries: -1 }, 'pro', /must be >= 0/],
  ];
  for (const [body, plan, detail] of cases) {
    const app = fresh();
    const refusal = applyLifecycle(app, body, plan);
    expect(refusal).toMatchObject({ status: 400, code: 'validation_failed' });
    expect(refusal?.detail).toMatch(detail);
    expect(app.manifest).toEqual({ entrypoint: ['node'] });
  }
  const job = fresh({ execution_mode: 'job' });
  expect(applyLifecycle(job, { restart_policy: 'always' }, 'pro')?.detail).toMatch(
    /restart_policy=always is rejected for execution_mode=job/
  );
});

it('stores snapshot hooks under the manifest, and clears one on an empty object', () => {
  const app = fresh();
  expect(
    applyLifecycle(
      app,
      {
        after_restore: { path: '/internal/after-restore', timeout_ms: 1500 },
        before_checkpoint: { path: '/flush' },
      },
      'free'
    )
  ).toBeUndefined();
  expect(app.manifest).toMatchObject({
    after_restore: { path: '/internal/after-restore', timeout_ms: 1500 },
    before_checkpoint: { path: '/flush' },
  });
  applyLifecycle(app, { after_restore: {} }, 'free');
  expect(app.manifest?.after_restore).toBeUndefined();
  expect(app.manifest?.before_checkpoint).toEqual({ path: '/flush' });
});

it('refuses the hooks apid refuses (appmanifest.go validateLifecycleHook)', () => {
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ after_restore: { path: 'relative' } }, /after_restore\.path must be an absolute path/],
    [{ before_checkpoint: { path: '/x?y' } }, /before_checkpoint\.path must be an absolute path/],
    [{ after_restore: { path: '/x', timeout_ms: 2001 } }, /timeout_ms must be between 0 and 2000/],
  ];
  for (const [body, detail] of cases) {
    const app = fresh();
    const refusal = applyLifecycle(app, body, 'pro');
    expect(refusal).toMatchObject({ status: 400, code: 'validation_failed' });
    expect(refusal?.detail).toMatch(detail);
    expect(app.manifest).toEqual({ entrypoint: ['node'] });
  }
  const worker = fresh({ execution_mode: 'worker' });
  expect(applyLifecycle(worker, { after_restore: { path: '/x' } }, 'pro')?.detail).toMatch(
    /after_restore requires request or service execution mode/
  );
});
