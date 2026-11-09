import { Fragment, type CSSProperties, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  EmptyState,
  ErrorState,
  InlinePhase,
  Panel,
  UnreachableState,
  queryPhase,
} from './primitives';
import { useAppDeployments, type Deployment } from '@/lib/api/queries';
import { Timestamp } from '@/components/ui/timestamp';
import { releaseProcess, releaseProcessSummary } from '@/lib/release-process';
import { deploymentPhase } from '@/lib/deployment-status';
import {
  canRollBackTo,
  humanDuration,
  nowSubject,
  rolloutSentence,
  rolloutView,
  shortDigest,
  sourceLabel,
  versionStatus,
  type NowSubject,
  type VersionTone,
} from '@/lib/deployment-history-view';
import { BindingsGateNotice } from './bindings-gate';
import { RollbackStatus, useRollbackFlow } from './rollback-status';
import { useRolloutRecovery } from './rollout-recovery';

export interface DeploymentHistoryTiming {
  durationSeconds?: number;
}

type Timings = ReadonlyMap<string, DeploymentHistoryTiming>;

/** The name a person knows a version by: its revision, else its image. */
function versionName(deployment: Deployment): string {
  if (deployment.revision) return `v${deployment.revision}`;
  return shortDigest(deployment.image_digest) || deployment.id.slice(0, 8);
}

const TONE: Record<VersionTone, string> = {
  good: 'var(--status-good)',
  active: 'var(--brand)',
  idle: 'var(--muted-foreground)',
  warning: 'var(--status-warning)',
  critical: 'var(--status-critical)',
};

/** Colour is never the only signal: every dot sits beside its status word. */
function StatusDot({ tone }: { tone: VersionTone }) {
  const style: CSSProperties =
    tone === 'idle'
      ? { boxShadow: `inset 0 0 0 1.5px ${TONE.idle}` }
      : { backgroundColor: TONE[tone] };
  return <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={style} />;
}

/**
 * App-scoped deployment history, read in plain English: what is happening
 * now, then every other version with how it ended. The API owns ordering and
 * pagination, so an app with thousands of releases is not truncated by the
 * account-wide feed.
 */
export function DeploymentHistoryPanel({
  slug,
  selectedDeploymentId,
  buildTimings,
  onSelect,
  cleanup,
}: {
  slug: string;
  selectedDeploymentId?: string;
  buildTimings: Timings;
  onSelect: (id: string) => void;
  /** The quiet "Clean up old versions" control beside the list. */
  cleanup?: ReactNode;
}) {
  const deployments = useAppDeployments(slug);
  const rollback = useRollbackFlow(slug);
  const items = deployments.data?.pages.flatMap((page) => page.items) ?? [];
  const phase = queryPhase({
    error: items.length === 0 ? deployments.error : undefined,
    loading: deployments.isPending,
  });
  const nextPagePhase = queryPhase({ error: deployments.error });

  let body: ReactNode;
  if (phase === 'unreachable') {
    body = <UnreachableState onRetry={() => void deployments.refetch()} />;
  } else if (phase === 'error') {
    body = <ErrorState error={deployments.error} onRetry={() => void deployments.refetch()} />;
  } else if (phase === 'loading') {
    body = <p className="text-sm text-muted-foreground">Loading deployment history…</p>;
  } else if (items.length === 0) {
    body = <EmptyState message="No deployments yet." />;
  } else {
    const subject = nowSubject(items);
    const subjectId = subject.kind === 'none' ? undefined : subject.deployment.id;
    const others = items.filter((deployment) => deployment.id !== subjectId);
    body = (
      <div className="flex flex-col gap-6">
        {subject.kind !== 'none' && (
          <NowWell slug={slug} subject={subject} timings={buildTimings} onSelect={onSelect} />
        )}
        {rollback.operation && (
          <RollbackStatus
            slug={slug}
            operation={rollback.operation}
            targetLabel={rollback.operationLabel}
          />
        )}
        <section aria-labelledby="deployment-history-others" className="flex flex-col">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <h3 id="deployment-history-others" className="text-sm font-semibold">
              Other versions
            </h3>
            {cleanup}
          </div>
          {others.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">No other versions yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border/60">
              {others.map((deployment) => (
                <VersionRow
                  key={deployment.id}
                  deployment={deployment}
                  selected={selectedDeploymentId === deployment.id}
                  timing={buildTimings.get(deployment.id)}
                  onSelect={onSelect}
                  onRollBack={
                    canRollBackTo(deployment)
                      ? () => void rollback.start(deployment.id, versionName(deployment))
                      : undefined
                  }
                  rollbackBusy={rollback.isPending}
                />
              ))}
            </ul>
          )}
          {deployments.error ? (
            <div className="mt-3">
              <InlinePhase phase={nextPagePhase} error={deployments.error} />
            </div>
          ) : null}
          {deployments.hasNextPage && (
            <div className="mt-4 flex justify-center">
              <Button
                size="xs"
                variant="outline"
                busy={deployments.isFetchingNextPage}
                onClick={() => void deployments.fetchNextPage().catch(() => undefined)}
              >
                Load older
              </Button>
            </div>
          )}
        </section>
      </div>
    );
  }

  return <Panel title="Deployments">{body}</Panel>;
}

function VersionRow({
  deployment,
  selected,
  timing,
  onSelect,
  onRollBack,
  rollbackBusy,
}: {
  deployment: Deployment;
  selected: boolean;
  timing?: DeploymentHistoryTiming;
  onSelect: (id: string) => void;
  onRollBack?: () => void;
  rollbackBusy: boolean;
}) {
  const status = versionStatus(deployment);
  const built = humanDuration(timing?.durationSeconds);
  const digest = shortDigest(deployment.image_digest);
  return (
    <li className="flex items-center gap-2">
      <button
        type="button"
        aria-current={selected ? 'true' : undefined}
        onClick={() => onSelect(deployment.id)}
        // Where the release is in its process, on hover; the drawer has the rest.
        title={releaseProcessSummary(releaseProcess(deployment))}
        className="-mx-2 flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand aria-[current=true]:bg-muted/60"
      >
        <StatusDot tone={status.tone} />
        {/* One line on a wide screen; on a phone the detail drops below the word. */}
        <span className="flex min-w-0 flex-1 flex-col text-sm sm:block sm:truncate">
          <span
            title={deployment.status}
            className={status.tone === 'idle' ? 'text-muted-foreground' : 'font-medium'}
          >
            {status.word}
          </span>
          <span className="truncate text-[13px] text-muted-foreground sm:text-sm">
            {[
              deployment.revision ? `v${deployment.revision}` : undefined,
              digest ? (
                <span key="digest" className="font-mono text-xs">
                  {digest}
                </span>
              ) : undefined,
              built ? `built in ${built}` : undefined,
            ]
              .filter(Boolean)
              .map((part, index) => (
                <Fragment key={index}>
                  <span className={index === 0 ? 'hidden sm:inline' : undefined}>{' · '}</span>
                  {part}
                </Fragment>
              ))}
          </span>
        </span>
        <Timestamp
          value={deployment.created_at}
          className="shrink-0 text-[13px] text-muted-foreground [font-variant-numeric:tabular-nums]"
        />
      </button>
      <span className="flex shrink-0 justify-end sm:w-32">
        {onRollBack && (
          <Button size="xs" variant="outline" disabled={rollbackBusy} onClick={onRollBack}>
            Roll back to this <span className="sr-only">({versionName(deployment)})</span>
          </Button>
        )}
      </span>
    </li>
  );
}

/** "Started 2h ago from GitHub · commit 1a2b3c4 · image f35835e · built in 38 s · Details" */
function MetaLine({
  deployment,
  verb,
  at,
  timing,
  onSelect,
}: {
  deployment: Deployment;
  verb: string;
  at: string | null | undefined;
  timing?: DeploymentHistoryTiming;
  onSelect: (id: string) => void;
}) {
  const digest = shortDigest(deployment.image_digest);
  const built = humanDuration(timing?.durationSeconds);
  return (
    <p className="text-[13px] leading-5 text-muted-foreground [font-variant-numeric:tabular-nums]">
      {deployment.revision ? `v${deployment.revision} ${verb.toLowerCase()}` : verb}{' '}
      <Timestamp value={at} /> from {sourceLabel(deployment)}
      {deployment.commit_sha && (
        <>
          {' · commit '}
          <span className="font-mono text-xs" title={deployment.commit_sha}>
            {deployment.commit_sha.slice(0, 7)}
          </span>
        </>
      )}
      {digest && (
        <>
          {' · image '}
          <span className="font-mono text-xs" title={deployment.image_digest}>
            {digest}
          </span>
        </>
      )}
      {built && ` · built in ${built}`}
      {' · '}
      <button
        type="button"
        onClick={() => onSelect(deployment.id)}
        className="text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        Details <span className="sr-only">of {versionName(deployment)}</span>
      </button>
    </p>
  );
}

/**
 * Rule 1 of the console: answer first. One sentence, set larger than anything
 * else, built only from the deployment's own fields.
 */
function NowWell({
  slug,
  subject,
  timings,
  onSelect,
}: {
  slug: string;
  subject: Exclude<NowSubject, { kind: 'none' }>;
  timings: Timings;
  onSelect: (id: string) => void;
}) {
  const recovery = useRolloutRecovery(slug);
  const deployment = subject.deployment;
  const timing = timings.get(deployment.id);

  let label: string;
  let tone: VersionTone;
  let headline: ReactNode;
  const explanation: string[] = [];
  let actions: ReactNode = null;
  let steps: ReactNode = null;
  let meta: ReactNode;

  if (subject.kind === 'rollout') {
    const view = rolloutView(deployment);
    label = 'Rolling out';
    tone = 'active';
    headline = rolloutSentence(view);
    if (subject.predecessor && view.percent != null)
      explanation.push(`The rest stays on ${versionName(subject.predecessor)}.`);
    if (view.nextPercent != null) explanation.push(`The next step is ${view.nextPercent}%.`);
    actions = (
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button
          size="sm"
          disabled={recovery.isPending}
          onClick={() => void recovery.act('promote')}
        >
          Send all traffic now
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={recovery.isPending}
          onClick={() => void recovery.act('abort')}
        >
          Roll back
        </Button>
      </div>
    );
    if (view.total > 0)
      steps = (
        <ol
          aria-label={`Rollout step ${view.step + 1} of ${view.total}`}
          className="grid gap-1.5"
          style={{ gridTemplateColumns: `repeat(${view.total}, minmax(0, 1fr))` }}
        >
          {view.steps.map((step, index) => (
            <li key={index} className="flex min-w-0 flex-col gap-1.5">
              <span
                aria-hidden="true"
                className="h-1.5 rounded-full"
                style={{
                  backgroundColor:
                    step.state === 'next'
                      ? 'color-mix(in oklch, var(--foreground) 10%, transparent)'
                      : TONE.active,
                  opacity: step.state === 'done' ? 0.55 : 1,
                }}
              />
              <span
                className="truncate text-xs [font-variant-numeric:tabular-nums]"
                style={{
                  color: step.state === 'current' ? TONE.active : 'var(--muted-foreground)',
                }}
              >
                {step.label}
                {step.state === 'current' && ' · now'}
                {step.state === 'done' && <span className="sr-only"> (done)</span>}
              </span>
            </li>
          ))}
        </ol>
      );
    meta = (
      <MetaLine
        deployment={deployment}
        verb="Started"
        at={deployment.rollout_started_at ?? deployment.created_at}
        timing={timing}
        onSelect={onSelect}
      />
    );
  } else if (subject.kind === 'live') {
    label = 'Live';
    tone = 'good';
    headline = (
      <>
        Live: {versionName(deployment)}
        {deployment.rollout_completed_at && (
          <>
            {' since '}
            <Timestamp value={deployment.rollout_completed_at} mode="absolute" />
          </>
        )}
      </>
    );
    const percent = deployment.traffic_percent;
    const where =
      deployment.scope && deployment.scope !== 'default' ? ` in ${deployment.scope}` : '';
    explanation.push(
      percent == null || percent === 100
        ? `Serving all traffic${where}.`
        : `Serving ${percent}% of traffic${where}.`
    );
    if (subject.newer) {
      const newerPhase = deploymentPhase(subject.newer.status);
      explanation.push(
        newerPhase === 'building'
          ? 'A newer version is building.'
          : 'A newer version is queued to build.'
      );
    }
    meta = (
      <MetaLine
        deployment={deployment}
        verb="Deployed"
        at={deployment.created_at}
        timing={timing}
        onSelect={onSelect}
      />
    );
  } else {
    const phase = deploymentPhase(deployment.status);
    const status = versionStatus(deployment);
    label = status.word;
    tone = status.tone;
    headline =
      phase === 'building'
        ? 'A new version is building'
        : phase === 'queued'
          ? 'A new version is queued'
          : phase === 'failed'
            ? deployment.status.toLowerCase() === 'cancelled'
              ? 'The latest version was cancelled'
              : 'The latest version failed'
            : `Latest: ${versionName(deployment)}`;
    explanation.push('Nothing is serving traffic.');
    meta = (
      <MetaLine
        deployment={deployment}
        verb="Started"
        at={deployment.created_at}
        timing={timing}
        onSelect={onSelect}
      />
    );
  }

  return (
    <section
      aria-label="What's happening now"
      className="well flex flex-col gap-4 rounded-2xl bg-muted/40 px-5 py-5 sm:px-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 flex-1 basis-72 flex-col gap-1">
          <span className="bento-label flex items-center gap-2" title={deployment.status}>
            <StatusDot tone={tone} />
            {label}
          </span>
          <p className="text-xl leading-7 font-medium tracking-[-0.01em] text-balance">
            {headline}
          </p>
          {explanation.length > 0 && (
            <p className="text-sm text-muted-foreground">{explanation.join(' ')}</p>
          )}
        </div>
        {actions}
      </div>
      {steps}
      {meta}
      {recovery.refusal && (
        <BindingsGateNotice
          refusal={recovery.refusal}
          slug={slug}
          deploymentId={deployment.id}
          action="rollout recovery"
        />
      )}
    </section>
  );
}
