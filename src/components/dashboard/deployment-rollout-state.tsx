import type { ReactNode } from 'react';
import type { Deployment } from '@/lib/api/queries';
import type { RolloutDecision, ScheduledRelease } from '@/lib/api/deployment-detail';
import { isRolloutInFlight } from './rollout-recovery';

/**
 * One sentence per rollout rule (RolloutDecision.rule is a closed set; ADR-1447).
 * The API's own `summary` follows it when present, so these only have to say
 * which rule decided.
 */
export const ROLLOUT_RULES: Record<RolloutDecision['rule'], string> = {
  advance_healthy: 'Advanced: both releases had enough requests and no regression.',
  advance_probe_evidence: 'Advanced on synthetic probes: the new release answered them cleanly.',
  advance_low_traffic:
    'Advanced on low traffic: too few requests to compare, but no 5xx, OOM kill or restart.',
  advance_no_predecessor: 'Advanced: there was no earlier release to compare with.',
  advance_manual: 'Advanced by hand.',
  hold_insufficient_samples: 'Waiting for enough requests to compare the two releases.',
  hold_signal_unavailable: 'Waiting: a health signal could not be read.',
  hold_observation_unavailable: 'Waiting: the observation window could not be read.',
  hold_health_alert: 'Held: an alert rule with a rollback or demote action is firing.',
  hold_awaiting_approval: 'Held until the release is approved.',
  abort_5xx: 'Stopped: the new release returned more 5xx responses than the current one.',
  abort_p95_latency: 'Stopped: the new release’s p95 latency regressed.',
  abort_cold_boot_p95: 'Stopped: the new release’s cold-boot p95 latency regressed.',
  abort_cpu_per_request: 'Stopped: the new release used more CPU per request.',
  abort_dependency_errors: 'Stopped: calls to dependencies failed more often.',
  abort_oom: 'Stopped: the new release was killed for running out of memory.',
  abort_crash_loop: 'Stopped: the liveness probe kept restarting the new release.',
  abort_manual: 'Stopped by hand.',
  abort_worker_lease_expired: 'Stopped: the worker running the rollout lost its lease.',
  abort_post_release_5xx: 'Rolled back after reaching 100%: 5xx responses regressed.',
  abort_post_release_p95_latency: 'Rolled back after reaching 100%: p95 latency regressed.',
  abort_release_gate: 'Stopped: a release gate failed.',
  abort_post_release_gate: 'Rolled back after reaching 100%: a release gate failed.',
  abort_approval_rejected: 'Stopped: the release was rejected.',
  abort_approval_timeout: 'Stopped: nobody approved the release in time.',
  abort_route_health_timeout: 'Stopped: the critical routes did not report healthy in time.',
};

const when = (iso?: string) =>
  iso ? iso.replace('T', ' ').replace(/(:\d\d)(\.\d+)?Z$/, '$1 UTC') : '';

function scheduleSentence(schedule: ScheduledRelease): ReactNode {
  switch (schedule.state) {
    case 'scheduled':
      return `Scheduled for ${when(schedule.release_at)}. Until then it waits live without traffic; production stays on the current release.`;
    case 'started':
      return `Its scheduled rollout started ${when(schedule.started_at ?? schedule.release_at)}.`;
    case 'cancelled':
      return 'Its schedule was cancelled. It stays built without traffic.';
    case 'superseded':
      return 'A newer release served traffic first, so this scheduled release never started.';
    default:
      return (
        <>
          Its schedule for {when(schedule.release_at)} ended without starting
          {schedule.outcome_code ? ` (${schedule.outcome_code})` : ''}.{' '}
          {schedule.outcome_detail ? `${schedule.outcome_detail} ` : ''}It stays built without
          traffic: schedule it again, or promote it by hand.
        </>
      );
  }
}

/**
 * The deployment fields that explain where a release stands but have no route
 * of their own: its schedule, why its rollout waits, the latest rollout
 * decision and cron activation. GET /v1/deployments/{id} fills them only when
 * they apply, so each renders only when present.
 */
export function DeploymentRolloutState({ deployment }: { deployment: Deployment }) {
  const schedule = deployment.scheduled_release;
  const hold = isRolloutInFlight(deployment) ? deployment.rollout_hold : undefined;
  const decision = deployment.rollout_decision;
  const crons = deployment.configuration?.crons;
  const showCrons = crons && crons.status !== 'not_managed' && crons.status !== 'activated';
  if (!schedule && !hold && !decision && !showCrons) return null;

  return (
    <section
      aria-label="Rollout state"
      className="flex flex-col gap-3 rounded-lg border border-border p-4"
    >
      <p className="label-mono text-muted-foreground">Rollout state</p>
      {schedule && <Row label="Schedule">{scheduleSentence(schedule)}</Row>}
      {hold && (
        <Row label="Waiting">
          <DecisionBody decision={hold} />
        </Row>
      )}
      {decision && (
        <Row label="Latest decision">
          <DecisionBody decision={decision} />
        </Row>
      )}
      {showCrons && (
        <Row label="Cron schedules">
          {crons.message}
          {crons.hint && <span className="text-muted-foreground"> {crons.hint}</span>}
        </Row>
      )}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 border-t border-border pt-3 text-sm">
      <p className="label-mono mb-1 text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

function DecisionBody({ decision }: { decision: RolloutDecision }) {
  const sides = [
    ['This release', decision.candidate],
    ['The release before it', decision.stable],
  ] as const;
  return (
    <div className="flex flex-col gap-2">
      <p>
        {ROLLOUT_RULES[decision.rule]}{' '}
        {decision.summary && <span className="text-muted-foreground">{decision.summary}</span>}
      </p>
      <p className="text-xs text-muted-foreground">
        Step {decision.step + 1} at {decision.traffic_percent}% of traffic · decided{' '}
        {when(decision.decided_at)}
      </p>
      {(decision.candidate || decision.stable) && (
        <dl className="grid gap-2 text-xs sm:grid-cols-2">
          {sides.map(([label, sample]) =>
            sample ? (
              <div key={label} className="rounded-md bg-muted px-3 py-2">
                <dt className="label-mono text-muted-foreground">{label}</dt>
                <dd className="mt-1 font-mono">
                  5xx: {sample.server_errors} of {sample.requests} requests
                  {sample.p95_latency_ms != null &&
                    ` · p95 ${Math.round(sample.p95_latency_ms)} ms`}
                </dd>
              </div>
            ) : null
          )}
        </dl>
      )}
      {decision.gates && decision.gates.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs">
          {decision.gates.map((gate) => (
            <li key={gate.name} className="flex flex-wrap gap-x-2">
              <span className="font-mono">{gate.name}</span>
              <span
                style={{
                  color: gate.not_judged
                    ? 'var(--muted-foreground)'
                    : gate.passed
                      ? 'var(--status-good)'
                      : 'var(--status-critical)',
                }}
              >
                {gate.not_judged ? 'not judged' : gate.passed ? 'passed' : 'failed'}
              </span>
              <span className="text-muted-foreground">{gate.summary}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
