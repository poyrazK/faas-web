import type { components, paths } from './api/schema';
import { deploymentPhase } from './deployment-status';

type Deployment = components['schemas']['DeploymentResponse'];
/** The typed shape lives on GET /v1/deployments/{id}/stages; the deployment
 * carries the same jsonb untyped, so it is read through `readStageState`. */
type StageState =
  paths['/v1/deployments/{id}/stages']['get']['responses'][200]['content']['application/json'];
// `current` is '' when no stage runs; a stage name is never empty.
type StageName = Exclude<NonNullable<StageState['current']>, ''>;
const STAGE_NAMES: readonly StageName[] = [
  'source_download',
  'dependency_restore',
  'image_build',
  'security_scan',
  'snapshot_prepare',
  'readiness',
];
const isStage = (value: unknown): value is StageName =>
  typeof value === 'string' && (STAGE_NAMES as readonly string[]).includes(value);

type StageRow = StageState['history'][number];
const ROW_STATUSES: readonly StageRow['status'][] = ['completed', 'failed', 'cancelled'];
const isRowStatus = (value: unknown): value is StageRow['status'] =>
  typeof value === 'string' && (ROW_STATUSES as readonly string[]).includes(value);
const isoOrNull = (value: unknown) => (typeof value === 'string' ? value : null);

/** Keep only well-formed stage rows; anything else is treated as not recorded. */
export function readStageState(raw: unknown): StageState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as Record<string, unknown>;
  const history: StageRow[] = Array.isArray(value.history)
    ? value.history.flatMap((row) => {
        if (!row || typeof row !== 'object') return [];
        const r = row as Record<string, unknown>;
        if (!isStage(r.name) || !isRowStatus(r.status)) return [];
        return [
          {
            name: r.name,
            status: r.status,
            started_at: isoOrNull(r.started_at),
            ended_at: isoOrNull(r.ended_at),
            duration_ms: typeof r.duration_ms === 'number' ? r.duration_ms : 0,
            ...(typeof r.reason === 'string' ? { reason: r.reason } : {}),
          },
        ];
      })
    : [];
  // apid sends '' when no stage is running (DeploymentStageState.current).
  const current = isStage(value.current) ? value.current : '';
  if (!history.length && !current) return undefined;
  return { current, history };
}

export type PhaseKey = 'build' | 'verify' | 'prepare' | 'rollout' | 'serve';
/** `unrecorded` is not a failure: older deployments carry no stage history. */
export type PhaseState = 'done' | 'active' | 'failed' | 'pending' | 'skipped' | 'unrecorded';

export interface ReleasePhase {
  key: PhaseKey;
  label: string;
  state: PhaseState;
  detail?: string;
}

/**
 * apid's stage vocabulary (deployments.stage_state), grouped into the phases a
 * person reasons about. A container image deploy never downloads source or
 * builds, so an empty phase in a deployment that moved past it is skipped.
 */
const STAGES: Record<'build' | 'verify' | 'prepare', StageName[]> = {
  build: ['source_download', 'dependency_restore', 'image_build'],
  verify: ['security_scan'],
  prepare: ['snapshot_prepare', 'readiness'],
};
const LABELS: Record<PhaseKey, string> = {
  build: 'Build',
  verify: 'Verify',
  prepare: 'Prepare',
  rollout: 'Roll out',
  serve: 'Serve',
};
const PRESETS: Record<string, string> = {
  none: 'immediate cutover',
  slow: 'slow canary',
  balanced: 'balanced canary',
  aggressive: 'fast canary',
  '1-10-50-100': '1 → 10 → 50 → 100%',
  adaptive: 'adaptive canary',
};

const ORDER: PhaseKey[] = ['build', 'verify', 'prepare', 'rollout', 'serve'];

/**
 * A release as a process: build, verify, prepare, roll out, serve — each
 * done, active, failed, pending, skipped, or not recorded, read only from
 * fields the deployment carries. Nothing is inferred as done that the record
 * does not show, except that a deployment which is live or superseded
 * finished every phase before rollout.
 *
 * When apid's per-deployment `release` object (release commands such as
 * migrations) lands, it slots in between Prepare and Roll out.
 */
export function releaseProcess(deployment: Deployment): ReleasePhase[] {
  const phase = deploymentPhase(deployment.status);
  const shipped = phase === 'live' || phase === 'superseded';
  const stage = readStageState(deployment.stage_state);
  const history = stage?.history ?? [];
  const current = stage?.current || undefined;

  const prep = (key: 'build' | 'verify' | 'prepare'): ReleasePhase => {
    const names = STAGES[key];
    const rows = history.filter((row) => row.name && names.includes(row.name));
    const failed = rows.find((row) => row.status === 'failed');
    if (failed)
      return {
        key,
        label: LABELS[key],
        state: 'failed',
        detail: failed.reason || `${failed.name?.replace(/_/g, ' ')} failed`,
      };
    const cancelled = rows.find((row) => row.status === 'cancelled');
    if (cancelled)
      return {
        key,
        label: LABELS[key],
        state: 'skipped',
        detail: `${cancelled.name.replace(/_/g, ' ')} cancelled`,
      };
    if (current && names.includes(current) && !shipped)
      return {
        key,
        label: LABELS[key],
        state: phase === 'failed' ? 'failed' : 'active',
        detail: current.replace(/_/g, ' '),
      };
    const completed = rows.filter((row) => row.status === 'completed');
    if (completed.length) {
      const ms = completed.reduce((sum, row) => sum + row.duration_ms, 0);
      return {
        key,
        label: LABELS[key],
        state: 'done',
        detail: ms > 0 ? `${Math.max(1, Math.round(ms / 1000))} s` : undefined,
      };
    }
    // Nothing recorded for this phase. If a later phase ran, it was skipped.
    const laterStarted =
      shipped ||
      ORDER.slice(ORDER.indexOf(key) + 1).some(
        (later) =>
          later in STAGES &&
          history.some((row) => row.name && STAGES[later as keyof typeof STAGES].includes(row.name))
      ) ||
      (current !== undefined && ORDER.indexOf(phaseOfStage(current)) > ORDER.indexOf(key));
    // With no stage record at all, a finished deployment (shipped or failed)
    // simply did not report its phases; none of them is still waiting.
    if (!stage && (shipped || phase === 'failed'))
      return { key, label: LABELS[key], state: 'unrecorded' };
    return { key, label: LABELS[key], state: laterStarted ? 'skipped' : 'pending' };
  };

  const build = prep('build');
  const verify = prep('verify');
  const prepare = prep('prepare');
  const earlierFailed = [build, verify, prepare].some((p) => p.state === 'failed');

  const rollout = ((): ReleasePhase => {
    const preset = deployment.canary_preset ? PRESETS[deployment.canary_preset] : undefined;
    if (deployment.rollout_state === 'aborted')
      return {
        key: 'rollout',
        label: LABELS.rollout,
        state: 'failed',
        detail: deployment.rollout_aborted_reason
          ? `Aborted: ${deployment.rollout_aborted_reason}`
          : 'Aborted',
      };
    if (deployment.rollout_state === 'rolling_out') {
      const steps = deployment.canary_total_steps
        ? `step ${deployment.canary_step ?? 0} of ${deployment.canary_total_steps}`
        : undefined;
      const traffic =
        deployment.traffic_percent != null
          ? `${deployment.traffic_percent}% of traffic`
          : undefined;
      return {
        key: 'rollout',
        label: LABELS.rollout,
        state: 'active',
        detail: [preset, steps, traffic].filter(Boolean).join(' · ') || undefined,
      };
    }
    if (deployment.rollout_state === 'complete' || (shipped && !deployment.rollout_state))
      return {
        key: 'rollout',
        label: LABELS.rollout,
        state: 'done',
        detail: preset ?? (deployment.canary_total_steps ? undefined : 'immediate cutover'),
      };
    if (earlierFailed || phase === 'failed')
      return { key: 'rollout', label: LABELS.rollout, state: 'skipped' };
    return { key: 'rollout', label: LABELS.rollout, state: 'pending', detail: preset };
  })();

  const serve = ((): ReleasePhase => {
    if (deployment.rollback_operation)
      return { key: 'serve', label: LABELS.serve, state: 'done', detail: 'Rolled back' };
    if (phase === 'superseded')
      return {
        key: 'serve',
        label: LABELS.serve,
        state: 'done',
        detail: 'Superseded by a newer release',
      };
    if (phase === 'live')
      return {
        key: 'serve',
        label: LABELS.serve,
        state: rollout.state === 'active' ? 'active' : 'done',
        detail:
          deployment.traffic_percent != null
            ? `${deployment.traffic_percent}% of traffic`
            : 'Serving',
      };
    if (phase === 'failed') {
      const failedEarlier = earlierFailed || rollout.state === 'failed';
      return failedEarlier
        ? { key: 'serve', label: LABELS.serve, state: 'skipped' }
        : {
            key: 'serve',
            label: LABELS.serve,
            state: 'failed',
            detail: deployment.error_code || deployment.error || undefined,
          };
    }
    return { key: 'serve', label: LABELS.serve, state: 'pending' };
  })();

  return [build, verify, prepare, rollout, serve];
}

function phaseOfStage(stage: StageName): PhaseKey {
  if (STAGES.build.includes(stage)) return 'build';
  if (STAGES.verify.includes(stage)) return 'verify';
  return 'prepare';
}

/** One line for a list row: where the release is now. */
export function releaseProcessSummary(phases: ReleasePhase[]): string {
  const failed = phases.find((p) => p.state === 'failed');
  if (failed) return `${failed.label} failed${failed.detail ? `: ${failed.detail}` : ''}`;
  const active = phases.find((p) => p.state === 'active');
  if (active) return `${active.label}${active.detail ? ` — ${active.detail}` : ''}`;
  const pending = phases.find((p) => p.state === 'pending');
  if (pending) return `Waiting to ${pending.label.toLowerCase()}`;
  const serve = phases[phases.length - 1];
  return serve.detail ?? 'Complete';
}
