import { beforeEach, describe, expect, it } from 'vitest';
import { deployments, scenarioOf } from './data';
import type { App, Build, Deployment } from './data';
import {
  advanceDeployments,
  buildLogAt,
  lifecyclePlan,
  phaseAt,
  resetLifecycle,
  settleMs,
  stagesAt,
  startDeployment,
} from './deploy-lifecycle';

const T0 = Date.parse('2026-10-17T12:00:00Z');

function rows(runtime = 'node24', status: App['status'] = 'undeployed') {
  const app = {
    id: 'a'.repeat(32),
    slug: 'fresh-app',
    runtime,
    status,
    url: 'https://fresh-app.gregale.app',
  } as App;
  const deployment = {
    id: 'd'.repeat(32),
    app_id: app.id,
    build_id: 'b'.repeat(32),
    image_digest: `sha256:${'e'.repeat(64)}`,
    kind: 'github',
    status: 'pending',
    created_at: new Date(T0).toISOString(),
  } as Deployment;
  const build = {
    id: 'b'.repeat(32),
    deployment_id: deployment.id,
    kind: 'railpack',
    source_bytes: 1,
    status: 'queued',
    enqueued_at: deployment.created_at,
  } as Build;
  // An app that was already serving has a live release the new one replaces.
  if (status === 'active')
    deployments.push({ ...deployment, id: 'f'.repeat(32), status: 'live' } as Deployment);
  return { app, deployment, build };
}

beforeEach(() => {
  resetLifecycle();
  for (let i = deployments.length - 1; i >= 0; i--)
    if (deployments[i].app_id === 'a'.repeat(32)) deployments.splice(i, 1);
});

describe('phaseAt', () => {
  it('walks pending → building → imaging → snapshotting → live for a source build', () => {
    const plan = lifecyclePlan('source');
    const seen = [0, 2_000, 7_000, 9_000, 10_500].map((ms) => phaseAt(plan, ms));
    expect(seen.map((p) => p.status)).toEqual([
      'pending',
      'building',
      'imaging',
      'snapshotting',
      'live',
    ]);
    expect(seen.map((p) => p.build)).toEqual([
      'queued',
      'running',
      'succeeded',
      'succeeded',
      'succeeded',
    ]);
    expect(settleMs(plan)).toBeGreaterThanOrEqual(8_000);
    expect(settleMs(plan)).toBeLessThanOrEqual(12_000);
  });

  it('skips the build for an image deploy', () => {
    const plan = lifecyclePlan('image');
    expect(phaseAt(plan, 0)).toMatchObject({ status: 'imaging', build: undefined });
    expect(phaseAt(plan, 7_000).status).toBe('snapshotting');
    expect(phaseAt(plan, settleMs(plan)).status).toBe('live');
  });

  it('fails during the build when asked to', () => {
    const plan = lifecyclePlan('source', true);
    expect(phaseAt(plan, 3_000)).toMatchObject({ status: 'building', build: 'running' });
    expect(phaseAt(plan, settleMs(plan))).toMatchObject({ status: 'failed', build: 'failed' });
  });
});

describe('a tracked deployment', () => {
  it('reads as building early and live after the window, with the app and build agreeing', () => {
    const { app, deployment, build } = rows();
    const rec = startDeployment({ deployment, app, build, now: T0, source: 'acme/repo@main' });
    expect(deployment.status).toBe('pending');
    expect(scenarioOf(app)).toBe('deploying');

    advanceDeployments(T0 + 3_000);
    expect(deployment.status).toBe('building');
    expect(build.status).toBe('running');
    expect(scenarioOf(app)).toBe('deploying');
    const midLog = buildLogAt(rec, T0 + 3_000);
    expect(midLog.done).toBe(false);
    expect(midLog.frames.at(-1)?.msg).toBe('#4 npm ci');

    advanceDeployments(T0 + 12_000);
    expect(deployment.status).toBe('live');
    expect(deployment.traffic_percent).toBe(100);
    expect(build).toMatchObject({ status: 'succeeded', duration_seconds: 5 });
    expect(build.finished_at).toBe(new Date(T0 + 6_500).toISOString());
    expect(app.status).toBe('active');
  });

  it('reports stages and build output consistent with the phase', () => {
    const { app, deployment, build } = rows();
    const rec = startDeployment({ deployment, app, build, now: T0, source: 'acme/repo@main' });
    expect(stagesAt(rec, T0 + 500)).toEqual({ history: [] });
    expect(stagesAt(rec, T0 + 3_000)).toMatchObject({
      current: 'dependency_restore',
      history: [{ name: 'source_download', status: 'completed' }],
    });
    const done = stagesAt(rec, T0 + 11_000);
    expect(done).not.toHaveProperty('current');
    expect(done.history.map((row) => row.name)).toEqual([
      'source_download',
      'dependency_restore',
      'image_build',
      'security_scan',
      'snapshot_prepare',
      'readiness',
    ]);
    const log = buildLogAt(rec, T0 + 11_000);
    expect(log.done).toBe(true);
    expect(log.frames[0].msg).toBe('#1 resolving source for acme/repo@main');
    expect(log.frames.at(-1)?.msg).toBe('build succeeded');
  });

  it('supersedes the previous mock-created release when a newer one goes live', () => {
    const first = rows();
    startDeployment({ ...first, now: T0 });
    advanceDeployments(T0 + 11_000);
    const second = { ...rows(), app: first.app };
    second.deployment = { ...second.deployment, id: 'f'.repeat(32) };
    startDeployment({ ...second, now: T0 + 20_000 });
    advanceDeployments(T0 + 31_000);
    expect(second.deployment.status).toBe('live');
    expect(first.deployment).toMatchObject({ status: 'superseded', traffic_percent: 0 });
  });

  it('stops advancing a deployment a route moved, such as a cancel', () => {
    const { app, deployment, build } = rows('node24', 'active');
    startDeployment({ deployment, app, build, now: T0 });
    advanceDeployments(T0 + 2_000);
    deployment.status = 'cancelled';
    advanceDeployments(T0 + 20_000);
    expect(deployment.status).toBe('cancelled');
    expect(app.status).toBe('active');
  });
});

describe('MOCK_BUILD_FAIL', () => {
  it('fails the build installing dependencies with a classified error', () => {
    const { app, deployment, build } = rows('python313');
    const rec = startDeployment({ deployment, app, build, fail: true, now: T0 });
    advanceDeployments(T0 + 3_000);
    expect(deployment.status).toBe('building');

    advanceDeployments(T0 + 12_000);
    expect(deployment).toMatchObject({ status: 'failed', error_code: 'dep_install_failed' });
    expect(deployment.error_why).toContain('No matching distribution found');
    expect(deployment.error_relevant_logs?.[0]).toMatchObject({ source: 'build', level: 'error' });
    expect(build).toMatchObject({ status: 'failed', failure_class: 'user_error' });
    expect(scenarioOf(app)).toBe('failing');

    const stages = stagesAt(rec, T0 + 12_000);
    expect(stages.history.at(-1)).toMatchObject({ name: 'dependency_restore', status: 'failed' });
    const log = buildLogAt(rec, T0 + 12_000);
    expect(log.done).toBe(true);
    expect(log.frames.at(-1)).toMatchObject({ level: 'error', msg: 'build failed' });
  });

  it('leaves an app that was already serving active when a redeploy fails', () => {
    const { app, deployment, build } = rows('node24', 'active');
    startDeployment({ deployment, app, build, fail: true, now: T0 });
    advanceDeployments(T0 + 12_000);
    expect(deployment.status).toBe('failed');
    expect(app.status).toBe('active');
  });
});
