import { describe, expect, it } from 'vitest';
import type { components } from './api/schema';
import { readStageState, releaseProcess, releaseProcessSummary } from './release-process';

type Deployment = components['schemas']['DeploymentResponse'];

const deployment = (over: Partial<Deployment> = {}): Deployment => ({
  id: 'dep-1',
  app_id: 'app-1',
  image_digest: 'sha256:abc',
  kind: 'github',
  status: 'live',
  created_at: '2026-10-15T10:00:00Z',
  ...over,
});
/** The spec types the deployment's stage_state as an empty object; apid sends the stages shape. */
const stages = (value: unknown) => value as Deployment['stage_state'];
const row = (name: string, status = 'completed', duration_ms = 2000, reason?: string) => ({
  name,
  status,
  duration_ms,
  ...(reason ? { reason } : {}),
});
const ALL_STAGES = [
  row('source_download'),
  row('dependency_restore'),
  row('image_build', 'completed', 40_000),
  row('security_scan'),
  row('snapshot_prepare'),
  row('readiness'),
];
const states = (d: Deployment) => releaseProcess(d).map((p) => `${p.key}:${p.state}`);

describe('releaseProcess', () => {
  it('shows a finished source release as five completed phases', () => {
    const phases = releaseProcess(
      deployment({
        stage_state: stages({ history: ALL_STAGES }),
        rollout_state: 'complete',
        canary_preset: 'balanced',
        traffic_percent: 100,
      })
    );
    expect(phases.map((p) => p.state)).toEqual(['done', 'done', 'done', 'done', 'done']);
    expect(phases[0].detail).toBe('44 s');
    expect(phases[3].detail).toBe('balanced canary');
    expect(phases[4].detail).toBe('100% of traffic');
  });

  it('marks build and verify as skipped for an image deploy that never built', () => {
    expect(
      states(
        deployment({
          kind: 'image',
          stage_state: stages({ history: [row('snapshot_prepare'), row('readiness')] }),
        })
      )
    ).toEqual(['build:skipped', 'verify:skipped', 'prepare:done', 'rollout:done', 'serve:done']);
  });

  it('shows the phase in progress and leaves later ones pending', () => {
    expect(
      states(
        deployment({
          status: 'building',
          stage_state: stages({ current: 'image_build', history: [row('source_download')] }),
        })
      )
    ).toEqual([
      'build:active',
      'verify:pending',
      'prepare:pending',
      'rollout:pending',
      'serve:pending',
    ]);
  });

  it('stops at a failed security scan and says why', () => {
    const phases = releaseProcess(
      deployment({
        status: 'failed',
        stage_state: stages({
          history: [
            ...ALL_STAGES.slice(0, 3),
            row('security_scan', 'failed', 900, 'critical CVE in openssl'),
          ],
        }),
      })
    );
    expect(phases.map((p) => p.state)).toEqual(['done', 'failed', 'pending', 'skipped', 'skipped']);
    expect(phases[1].detail).toBe('critical CVE in openssl');
    expect(releaseProcessSummary(phases)).toBe('Verify failed: critical CVE in openssl');
  });

  it('shows a canary in flight with its step and traffic share', () => {
    const phases = releaseProcess(
      deployment({
        stage_state: stages({ history: ALL_STAGES }),
        rollout_state: 'rolling_out',
        canary_preset: '1-10-50-100',
        canary_step: 2,
        canary_total_steps: 4,
        traffic_percent: 10,
      })
    );
    expect(phases[3]).toMatchObject({
      state: 'active',
      detail: '1 → 10 → 50 → 100% · step 2 of 4 · 10% of traffic',
    });
    expect(phases[4].state).toBe('active');
    expect(releaseProcessSummary(phases)).toMatch(/^Roll out — /);
  });

  it('reports an aborted rollout with its reason', () => {
    const phases = releaseProcess(
      deployment({
        status: 'failed',
        stage_state: stages({ history: ALL_STAGES }),
        rollout_state: 'aborted',
        rollout_aborted_reason: 'canary 5xx rate 4.2% over 1%',
      })
    );
    expect(phases[3]).toMatchObject({
      state: 'failed',
      detail: 'Aborted: canary 5xx rate 4.2% over 1%',
    });
    expect(phases[4].state).toBe('skipped');
  });

  it('never claims phases a pre-stage-history deployment did not record', () => {
    expect(states(deployment({ stage_state: undefined }))).toEqual([
      'build:unrecorded',
      'verify:unrecorded',
      'prepare:unrecorded',
      'rollout:done',
      'serve:done',
    ]);
  });

  it('puts a failure after readiness on Serve, with the error code', () => {
    const phases = releaseProcess(
      deployment({
        status: 'failed',
        stage_state: stages({ history: ALL_STAGES }),
        error_code: 'app_not_listening',
      })
    );
    expect(phases[4]).toMatchObject({ state: 'failed', detail: 'app_not_listening' });
  });

  it('names a superseded release as such', () => {
    const phases = releaseProcess(
      deployment({ status: 'superseded', stage_state: stages({ history: ALL_STAGES }) })
    );
    expect(phases[4]).toMatchObject({ state: 'done', detail: 'Superseded by a newer release' });
  });
});

describe('readStageState', () => {
  it('drops malformed rows and unknown stage names', () => {
    expect(
      readStageState({
        current: 'not_a_stage',
        history: [row('image_build'), { name: 'mystery', status: 'completed' }, null, 'x'],
      })
    ).toEqual({ current: '', history: [expect.objectContaining({ name: 'image_build' })] });
    expect(readStageState({})).toBeUndefined();
    expect(readStageState('nope')).toBeUndefined();
  });

  it('reads an idle stage as no current stage, not an unknown one', () => {
    const state = readStageState({
      current: '',
      history: [
        {
          name: 'image_build',
          status: 'completed',
          started_at: null,
          ended_at: null,
          duration_ms: 4000,
        },
      ],
    });
    expect(state?.current).toBe('');
    expect(state?.history[0]).toMatchObject({
      name: 'image_build',
      status: 'completed',
      duration_ms: 4000,
    });
  });

  it('keeps cancelled stage rows instead of dropping them', () => {
    const state = readStageState({ current: '', history: [row('image_build', 'cancelled', 10)] });
    expect(state?.history.map((r) => r.status)).toEqual(['cancelled']);
  });
});

describe('releaseProcess with a cancelled stage', () => {
  it('shows a cancelled build as skipped with the reason, not as pending', () => {
    const phases = releaseProcess(
      deployment({
        status: 'cancelled',
        stage_state: stages({ current: '', history: [row('image_build', 'cancelled', 10)] }),
      })
    );
    expect(phases.find((p) => p.key === 'build')).toMatchObject({
      state: 'skipped',
      detail: 'image build cancelled',
    });
  });
});

describe('releaseProcess without a stage record', () => {
  it("does not show a failed deployment's phases as still waiting", () => {
    const phases = releaseProcess(deployment({ status: 'failed', error_code: 'boot_failed' }));
    expect(phases.slice(0, 3).map((p) => p.state)).toEqual([
      'unrecorded',
      'unrecorded',
      'unrecorded',
    ]);
    expect(phases[4]).toMatchObject({ state: 'failed', detail: 'boot_failed' });
  });
});
