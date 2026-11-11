import type { AppMetrics, Deployment } from '@/lib/api/queries';
import { deploymentPhase } from '@/lib/deployment-status';
import {
  isDefaultScope,
  nowSubject,
  rolloutView,
  type VersionTone,
} from '@/lib/deployment-history-view';
import { deploymentLabel } from './deployment-promote';
import { failureSummary } from './failure-summary';
import { FIELD_ERROR_MIN_REQUESTS, FIELD_ERROR_PCT } from './error-threshold';

/**
 * The app Overview's answer, in plain English (docs/console-plain-english.md):
 * which version is live, and whether anything needs doing. Every sentence is
 * built from fields the API returned; when a field is missing the sentence
 * says less rather than guessing.
 */

/** One name per version across the console: "v44", else the short id. */
export const versionName = deploymentLabel;

/** "the last 24 hours" for an analytics or metrics window such as `24h`. */
export function windowWords(range: string | undefined): string {
  const match = /^(\d+)([hd])$/.exec(range?.trim() ?? '');
  if (!match) return range ? `the ${range} window` : 'this window';
  const amount = Number(match[1]);
  const unit = match[2] === 'h' ? 'hour' : 'day';
  return amount === 1 ? `the last ${unit}` : `the last ${amount} ${unit}s`;
}

export interface ReleaseAnswer {
  /** The release the sentence is about. */
  deployment: Deployment;
  /** Short state word beside the dot: "Live", "Rolling out", "Failed". */
  label: string;
  tone: VersionTone;
  /** The one sentence the Overview opens with. */
  headline: string;
  /** Plain follow-ups, smaller: "A newer version is building." */
  detail: string[];
}

function servingWords(percent: number | null | undefined): string {
  return percent == null || percent === 100
    ? 'serving all traffic'
    : `serving ${percent}% of traffic`;
}

/**
 * What the Overview leads with, using the same choice as the Deployments
 * tab: a rollout in flight, else the version serving the default
 * environment, else the newest attempt. `undefined` when there is none.
 */
export function releaseAnswer(items: readonly Deployment[]): ReleaseAnswer | undefined {
  const subject = nowSubject(items);
  if (subject.kind === 'none') return undefined;
  const deployment = subject.deployment;
  const name = versionName(deployment);
  const where = isDefaultScope(deployment) ? '' : ` in ${deployment.scope}`;
  const detail: string[] = [];

  if (subject.kind === 'rollout') {
    const view = rolloutView(deployment);
    if (subject.predecessor && view.percent != null)
      detail.push(`The rest stays on ${versionName(subject.predecessor)}.`);
    return {
      deployment,
      label: 'Rolling out',
      tone: 'active',
      headline:
        deployment.rollout_state === 'pending'
          ? `${name} is about to roll out${where}.`
          : view.percent != null
            ? `${name} is rolling out${where} and getting ${view.percent}% of traffic.`
            : `${name} is rolling out${where}.`,
      detail,
    };
  }

  if (subject.kind === 'live') {
    if (subject.newer)
      detail.push(
        deploymentPhase(subject.newer.status) === 'building'
          ? 'A newer version is building.'
          : 'A newer version is queued to build.'
      );
    // The other environments' live versions, which the headline does not name.
    const elsewhere = items.filter(
      (other) =>
        other.id !== deployment.id &&
        deploymentPhase(other.status) === 'live' &&
        !isDefaultScope(other) &&
        other.scope !== deployment.scope &&
        other.traffic_percent !== 0 &&
        other.rollout_state !== 'aborted'
    );
    const seen = new Set<string>();
    for (const other of elsewhere) {
      if (seen.has(other.scope ?? '')) continue;
      seen.add(other.scope ?? '');
      detail.push(`${versionName(other)} is live in ${other.scope}.`);
    }
    return {
      deployment,
      label: 'Live',
      tone: 'good',
      headline: `${name} is live${where} and ${servingWords(deployment.traffic_percent)}.`,
      detail,
    };
  }

  const phase = deploymentPhase(deployment.status);
  const status = deployment.status.toLowerCase();
  const nothing = 'Nothing is serving traffic.';
  switch (phase) {
    case 'building':
      return {
        deployment,
        label: 'Building',
        tone: 'active',
        headline: `${name} is building.`,
        detail: [nothing],
      };
    case 'queued':
      return {
        deployment,
        label: 'Queued',
        tone: 'idle',
        headline: `${name} is queued to build.`,
        detail: [nothing],
      };
    case 'failed':
      return status === 'cancelled'
        ? {
            deployment,
            label: 'Cancelled',
            tone: 'idle',
            headline: `The latest version, ${name}, was cancelled.`,
            detail: [nothing],
          }
        : {
            deployment,
            label: 'Failed',
            tone: 'critical',
            headline: `The latest version, ${name}, failed to deploy.`,
            detail: [nothing],
          };
    case 'live':
      // Live but taking no traffic, or a rollout that was stopped.
      return {
        deployment,
        label: deployment.rollout_state === 'aborted' ? 'Rolled back' : 'Ready',
        tone: deployment.rollout_state === 'aborted' ? 'warning' : 'idle',
        headline: `${name} is ready${where} but taking no traffic.`,
        detail: [],
      };
    default:
      return {
        deployment,
        label: deployment.status,
        tone: 'idle',
        headline: `The latest version is ${name}.`,
        detail: [nothing],
      };
  }
}

export type AttentionTarget = 'Deployments' | 'Logs' | 'Errors';

export interface AttentionItem {
  key: 'release' | 'app' | 'requests';
  /** The plain sentence. */
  sentence: string;
  /** The API's own explanation, quieter, when there is one. */
  detail?: string;
  /** The exact term behind the sentence, for a `title`. */
  term?: string;
  action: { label: string; tab: AttentionTarget; deploymentId?: string };
}

/** Whether the newest attempt failed — a cancel is a choice, not a failure. */
export function newestFailed(latest: Deployment | undefined): latest is Deployment {
  return Boolean(
    latest &&
    deploymentPhase(latest.status) === 'failed' &&
    latest.status.toLowerCase() !== 'cancelled'
  );
}

const APP_ERROR_STATES = ['error', 'failed', 'crashed'];

export function appReportsError(rawState: string): boolean {
  return APP_ERROR_STATES.includes(rawState.trim().toLowerCase());
}

function measured(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Metrics a sentence can stand on: Prometheus-backed, not degraded. */
export function observedMetrics(metrics: AppMetrics | undefined): AppMetrics | undefined {
  return metrics?.source === 'prometheus' ? metrics : undefined;
}

export function hasTraffic(observed: AppMetrics | undefined): boolean {
  return Boolean(observed && measured(observed.request_count) && observed.request_count > 0);
}

/**
 * The request figures the Overview judges errors by. Request analytics is the
 * source the Traffic section's sentence and cards read, for the same window,
 * so the two always agree; the platform metrics are only a labelled fallback
 * when analytics could not be read.
 */
export interface RequestEvidence {
  source: 'analytics' | 'metrics';
  requests: number;
  /** Undefined when the source did not report it. */
  errorPct?: number;
  /** "the last 24 hours", or "this window" when retention cut it short. */
  window: string;
}

export function analyticsEvidence(
  summary: { requests?: number; error_rate_pct?: number; window_clamped?: boolean } | undefined,
  since: string
): RequestEvidence | undefined {
  if (!summary || !measured(summary.requests)) return undefined;
  return {
    source: 'analytics',
    requests: summary.requests,
    errorPct: measured(summary.error_rate_pct) ? summary.error_rate_pct : undefined,
    window: windowWords(summary.window_clamped ? '' : since),
  };
}

export function metricsEvidence(observed: AppMetrics | undefined): RequestEvidence | undefined {
  if (!observed || !measured(observed.request_count)) return undefined;
  return {
    source: 'metrics',
    requests: observed.request_count,
    errorPct: measured(observed.error_rate_pct) ? observed.error_rate_pct : undefined,
    window: windowWords(observed.range),
  };
}

/**
 * Errors need attention at the same bar as the Overview's hour field: at least
 * FIELD_ERROR_PCT of requests, over at least FIELD_ERROR_MIN_REQUESTS of them.
 * Below it the rate is reported neutrally (Traffic), not flagged.
 */
export function errorsNeedAttention(evidence: RequestEvidence | undefined): boolean {
  return Boolean(
    evidence &&
    evidence.errorPct !== undefined &&
    evidence.requests >= FIELD_ERROR_MIN_REQUESTS &&
    evidence.errorPct >= FIELD_ERROR_PCT
  );
}

/**
 * Everything the Overview flags, each a sentence with one action. The newest
 * attempt is checked separately from what is serving: a failed latest
 * attempt needs attention even when an older version still serves.
 */
export function attentionItems({
  items,
  rawState,
  requests,
}: {
  items: readonly Deployment[];
  rawState: string;
  requests: RequestEvidence | undefined;
}): AttentionItem[] {
  const out: AttentionItem[] = [];
  // The app-scoped API orders deployments newest-first.
  const latest = items[0];
  if (newestFailed(latest)) {
    const subject = nowSubject(items);
    const serving =
      subject.kind === 'live' || subject.kind === 'rollout' ? subject.deployment : undefined;
    out.push({
      key: 'release',
      sentence:
        serving && serving.id !== latest.id
          ? `${versionName(latest)} failed to deploy. ${versionName(serving)} is still serving.`
          : `${versionName(latest)} failed to deploy.`,
      detail: failureSummary({ deployment: latest }).cause,
      term: latest.error_code ?? latest.status,
      action: { label: 'Inspect failure', tab: 'Deployments', deploymentId: latest.id },
    });
  }
  if (appReportsError(rawState))
    out.push({
      key: 'app',
      sentence: 'The app is reporting an error.',
      term: `Status: ${rawState}`,
      action: { label: 'Inspect logs', tab: 'Logs' },
    });
  if (requests && errorsNeedAttention(requests)) {
    const pct = `${requests.errorPct!.toFixed(2)}%`;
    out.push(
      requests.source === 'analytics'
        ? {
            key: 'requests',
            sentence: `Requests returned errors: ${pct} in ${requests.window}.`,
            term: 'Request analytics, the same figures as Traffic',
            action: { label: 'Inspect errors', tab: 'Errors' },
          }
        : {
            key: 'requests',
            // Said as a different source: these platform figures can differ
            // from request analytics, which could not be read.
            sentence: `Platform metrics show ${pct} of requests failing in ${requests.window}.`,
            term: 'Platform metrics; request analytics could not be read',
            action: { label: 'Inspect errors', tab: 'Errors' },
          }
    );
  }
  return out;
}

/**
 * The all-clear, said only as strongly as the evidence allows: without
 * request figures the Overview cannot vouch for requests.
 */
export function allClear({
  releasesKnown,
  requests,
  metricsAccess,
}: {
  releasesKnown: boolean;
  requests: RequestEvidence | undefined;
  metricsAccess: 'checking' | 'available' | 'restricted';
}): { sentence: string; note?: string } {
  if (!releasesKnown) return { sentence: 'No confirmed issues yet.' };
  if (!requests)
    return {
      sentence: 'Nothing flagged so far.',
      note:
        metricsAccess === 'restricted'
          ? 'Request errors are tracked on Hobby and above.'
          : 'Request errors are unconfirmed without metrics.',
    };
  if (requests.requests === 0)
    return {
      sentence: 'Nothing needs your attention.',
      note: `No requests in ${requests.window}, so request errors can’t be judged.`,
    };
  if (requests.errorPct === undefined)
    return { sentence: 'Nothing flagged so far.', note: 'Request errors were not reported.' };
  if (requests.requests < FIELD_ERROR_MIN_REQUESTS && requests.errorPct >= FIELD_ERROR_PCT)
    return {
      sentence: 'Nothing flagged so far.',
      note: `Only ${requests.requests} ${requests.requests === 1 ? 'request' : 'requests'} in ${requests.window}, too few to judge the error rate.`,
    };
  return {
    sentence: 'Nothing needs your attention.',
    note:
      requests.errorPct > 0
        ? `${requests.errorPct.toFixed(2)}% of requests returned errors, under the ${FIELD_ERROR_PCT}% that is flagged.`
        : undefined,
  };
}

/** Where a release came from, capitalised for the start of a meta line. */
export function sourceWords(kind: string): string {
  switch (kind.toLowerCase()) {
    case 'github':
      return 'GitHub';
    case 'tarball':
      return 'an uploaded archive';
    case 'image':
    case 'oci':
      return 'a container image';
    default:
      return kind;
  }
}

/** "1a2b3c4": the first seven characters of a commit. */
export function shortCommit(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 7) : '';
}

/**
 * The traffic section's answer, from the analytics summary for the same
 * window the charts draw. Unknown stays unknown: no sentence, never zero.
 */
export function trafficSentence(
  summary: { requests?: number; error_rate_pct?: number } | undefined,
  since: string
): string | undefined {
  if (!summary || !measured(summary.requests)) return undefined;
  const window = windowWords(since);
  if (summary.requests === 0) return `No requests in ${window}.`;
  const count = new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(summary.requests);
  const requests = `${count} ${summary.requests === 1 ? 'request' : 'requests'} in ${window}`;
  if (!measured(summary.error_rate_pct)) return `${requests}.`;
  if (summary.error_rate_pct === 0) return `${requests}, none returned an error.`;
  return `${requests}; ${summary.error_rate_pct.toFixed(2)}% returned errors.`;
}

/**
 * Short card captions for the Overview's traffic grid. The full meaning of
 * each figure lives in the section's tip (`CARD_MEANING`), not on the card.
 */
export const CARD_CAPTION: Record<string, string> = {
  requests: 'Total',
  errors: 'Errored responses',
  error_rate: 'Share errored',
  p50: 'Median',
  p95: '95th percentile',
  p99: '99th percentile',
  cold_boots: 'Parked-app starts',
};

export const CARD_MEANING: { id: string; label: string; text: string }[] = [
  { id: 'requests', label: 'Requests', text: 'Total requests in this window.' },
  { id: 'errors', label: 'Errors', text: 'Errored responses in this window.' },
  { id: 'error_rate', label: 'Error rate', text: 'Errored share of the window.' },
  {
    id: 'latency',
    label: 'Latency',
    text: 'Percentiles of recorded responses across the whole window, not an average of hours.',
  },
  { id: 'cold_boots', label: 'Cold boots', text: 'Starts of parked instances in this window.' },
];
