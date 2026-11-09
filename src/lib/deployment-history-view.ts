import type { components } from './api/schema';
import { deploymentPhase } from './deployment-status';

type Deployment = components['schemas']['DeploymentResponse'];

/**
 * The plain-English reading of an app's deployment history: what is serving
 * now, how each older version ended, and how long it took to build. Every word
 * comes from a field the deployment carries; when a field is missing the
 * sentence says less rather than guessing.
 */

/** The first seven hex characters of an image digest, without its algorithm. */
export function shortDigest(digest: string | null | undefined): string {
  if (!digest) return '';
  const bare = digest.includes(':') ? digest.slice(digest.indexOf(':') + 1) : digest;
  return bare.slice(0, 7);
}

/** "38 s", "4 min", "1 h 5 min" — whole units a person reads at a glance. */
export function humanDuration(seconds: number | null | undefined): string | undefined {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return undefined;
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/** An unscoped deployment serves the app's default environment. */
export function isDefaultScope(deployment: Pick<Deployment, 'scope'>): boolean {
  return !deployment.scope || deployment.scope === 'default';
}

/** A rollout that has been admitted and has not completed or been aborted. */
export function isRolloutInFlight(deployment: Pick<Deployment, 'rollout_state'>): boolean {
  return deployment.rollout_state === 'pending' || deployment.rollout_state === 'rolling_out';
}

export type VersionTone = 'good' | 'active' | 'idle' | 'warning' | 'critical';

export interface VersionStatus {
  /** What a person reads: "Current version (serving 90%)", "Replaced". */
  word: string;
  tone: VersionTone;
}

function serving(percent: number | null | undefined): string {
  return percent == null ? '' : ` (serving ${percent}%)`;
}

/**
 * apid's open status vocabulary, with the rollout and traffic fields that
 * decide what a live row means. A live row can be the version serving
 * everyone, a canary taking a share, a canary that was stopped (its rollout
 * aborted and its traffic returned), or a release parked at zero traffic.
 * A status the console does not know is shown as the API wrote it.
 */
export function versionStatus(deployment: Deployment): VersionStatus {
  const status = deployment.status.toLowerCase();
  const scope = isDefaultScope(deployment) ? '' : ` in ${deployment.scope}`;
  switch (deploymentPhase(status)) {
    case 'live': {
      if (isRolloutInFlight(deployment))
        return {
          word:
            deployment.traffic_percent != null
              ? `New version${scope} (getting ${deployment.traffic_percent}%)`
              : `New version${scope} (rolling out)`,
          tone: 'active',
        };
      if (deployment.rollout_state === 'aborted') return { word: 'Rolled back', tone: 'warning' };
      if (deployment.traffic_percent === 0)
        return { word: `Ready${scope}, no traffic`, tone: 'idle' };
      return {
        word: scope
          ? `Live${scope}${serving(deployment.traffic_percent)}`
          : `Current version${serving(deployment.traffic_percent)}`,
        tone: 'good',
      };
    }
    case 'superseded':
      return { word: 'Replaced', tone: 'idle' };
    case 'failed':
      return status === 'cancelled'
        ? { word: 'Cancelled', tone: 'idle' }
        : { word: 'Failed', tone: 'critical' };
    case 'building':
      return { word: 'Building', tone: 'active' };
    case 'queued':
      if (status === 'pending' || status === 'queued') return { word: 'Queued', tone: 'idle' };
      return { word: deployment.status, tone: 'idle' };
  }
}

/**
 * The checked rollback accepts a superseded release of this app (faas
 * planRollback: "only a superseded or zero-traffic live deployment"); a
 * zero-traffic live release is promoted instead, so only replaced rows offer
 * "Roll back to this" — the same rule as the release drawer.
 */
export function canRollBackTo(deployment: Pick<Deployment, 'status'>): boolean {
  return deployment.status.toLowerCase() === 'superseded';
}

/**
 * The traffic ladder of each catalog canary preset, mirrored from faas
 * pkg/api/canary/preset.go. The deployment carries only the preset name, the
 * zero-based step and the step count, so the ladder is used only when it
 * agrees with both the step count and the traffic the row reports.
 */
const CANARY_LADDERS: Record<string, readonly number[]> = {
  slow: [1, 10, 100],
  balanced: [1, 10, 50, 100],
  aggressive: [5, 50, 100],
  '1-10-50-100': [1, 10, 50, 100],
  adaptive: [1, 10, 50, 100],
};

export interface RolloutStep {
  /** "10%" when the ladder is known, otherwise "Step 2". */
  label: string;
  state: 'done' | 'current' | 'next';
}

export interface RolloutView {
  deployment: Deployment;
  percent?: number;
  /** Zero-based, as the API counts. */
  step: number;
  total: number;
  steps: RolloutStep[];
  /** The next rung's share of traffic, when the ladder is known. */
  nextPercent?: number;
}

function ladderFor(deployment: Deployment): readonly number[] | undefined {
  const ladder = deployment.canary_preset ? CANARY_LADDERS[deployment.canary_preset] : undefined;
  if (!ladder || ladder.length !== deployment.canary_total_steps) return undefined;
  const step = deployment.canary_step ?? 0;
  if (deployment.traffic_percent != null && ladder[step] !== deployment.traffic_percent)
    return undefined;
  return ladder;
}

export function rolloutView(deployment: Deployment): RolloutView {
  const total = deployment.canary_total_steps ?? 0;
  const step = Math.min(deployment.canary_step ?? 0, Math.max(total - 1, 0));
  const percent = deployment.traffic_percent ?? undefined;
  const ladder = ladderFor(deployment);
  const steps: RolloutStep[] = Array.from({ length: total }, (_, index) => ({
    label: ladder
      ? `${ladder[index]}%`
      : index === step && percent != null
        ? `${percent}%`
        : `Step ${index + 1}`,
    state: index < step ? 'done' : index === step ? 'current' : 'next',
  }));
  return {
    deployment,
    percent,
    step,
    total,
    steps,
    nextPercent: ladder && step + 1 < ladder.length ? ladder[step + 1] : undefined,
  };
}

/** The headline while a rollout runs. */
export function rolloutSentence(view: RolloutView): string {
  if (view.deployment.rollout_state === 'pending') return 'A new version is about to roll out';
  return view.percent != null
    ? `A new version is getting ${view.percent}% of traffic`
    : 'A new version is rolling out';
}

/**
 * What the screen leads with: a rollout in flight, else the version serving
 * the default environment, else whatever is newest (a first build, or a
 * failure with nothing live behind it). The default environment wins over a
 * named one, because that is the app's public address.
 */
export type NowSubject =
  | { kind: 'rollout'; deployment: Deployment; predecessor?: Deployment }
  | { kind: 'live'; deployment: Deployment; newer?: Deployment }
  | { kind: 'latest'; deployment: Deployment }
  | { kind: 'none' };

export function nowSubject(items: readonly Deployment[]): NowSubject {
  const live = items.filter((d) => deploymentPhase(d.status) === 'live');
  const inFlight = live.filter(isRolloutInFlight);
  const rollout = inFlight.find(isDefaultScope) ?? inFlight[0];
  if (rollout) {
    const predecessor = live.find(
      (d) =>
        d.id !== rollout.id &&
        !isRolloutInFlight(d) &&
        (d.scope ?? '') === (rollout.scope ?? '') &&
        (d.traffic_percent ?? 0) > 0
    );
    return { kind: 'rollout', deployment: rollout, predecessor };
  }
  const serving = live.filter((d) => d.rollout_state !== 'aborted' && d.traffic_percent !== 0);
  const current =
    serving
      .filter(isDefaultScope)
      .sort((a, b) => (b.traffic_percent ?? 100) - (a.traffic_percent ?? 100))[0] ?? serving[0];
  if (current) {
    const newest = items[0];
    const phase = newest ? deploymentPhase(newest.status) : undefined;
    const newer =
      newest && newest.id !== current.id && (phase === 'building' || phase === 'queued')
        ? newest
        : undefined;
    return { kind: 'live', deployment: current, newer };
  }
  return items[0] ? { kind: 'latest', deployment: items[0] } : { kind: 'none' };
}

/** Where a release came from, in words: "GitHub", "an uploaded archive". */
export function sourceLabel(deployment: Pick<Deployment, 'kind' | 'deployed_via'>): string {
  switch (deployment.kind.toLowerCase()) {
    case 'github':
      return 'GitHub';
    case 'tarball':
      return 'an uploaded archive';
    case 'image':
      return 'a container image';
    default:
      return deployment.kind;
  }
}
