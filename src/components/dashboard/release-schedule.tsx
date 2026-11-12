import { useState } from 'react';
import { CheckCircle, Clock, Hourglass, WarningTriangle, XmarkCircle } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { FIELD, FieldError, Select } from '@/components/ui/field';
import { Timestamp } from '@/components/ui/timestamp';
import { useToast } from '@/components/ui/toast';
import { useCapabilityStage } from '@/lib/api/capabilities';
import { ApiError, errorMessage } from '@/lib/api/errors';
import type { Deployment } from '@/lib/api/queries';
import {
  SCHEDULE_PRESETS,
  SCHEDULE_STATES,
  releaseAtProblem,
  scheduleBlocker,
  useCancelSchedule,
  useDeploymentSchedule,
  useScheduleRelease,
  useScheduledReleases,
  type CanaryPreset,
  type ScheduleReleaseRequest,
  type ScheduledRelease,
} from '@/lib/api/scheduled-releases';
import { cn } from '@/lib/utils';
import { InlinePhase, queryPhase } from './primitives';
import { ReleaseChannelPicker } from './release-channel-picker';
import { FrozenRefusal, localInputToIso, localZone, zonedTime } from './release-freezes';
import { SafetyCard } from './release-safety-card';
import { scheduleCardWords, scheduleOutcome, spokenTime } from './release-safety-words';

const STATE_STYLE: Record<ScheduledRelease['state'], { color: string; icon: typeof Clock }> = {
  scheduled: { color: 'var(--status-warning)', icon: Clock },
  started: { color: 'var(--status-good)', icon: CheckCircle },
  blocked: { color: 'var(--status-critical)', icon: WarningTriangle },
  expired: { color: 'var(--status-serious)', icon: Hourglass },
  cancelled: { color: 'var(--muted-foreground)', icon: XmarkCircle },
  superseded: { color: 'var(--muted-foreground)', icon: XmarkCircle },
};

export function ScheduleStateBadge({ state }: { state: ScheduledRelease['state'] }) {
  const { color, icon: Icon } = STATE_STYLE[state] ?? STATE_STYLE.cancelled;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color }}>
      <Icon aria-hidden className="h-3.5 w-3.5 shrink-0" />
      {SCHEDULE_STATES[state] ?? state}
    </span>
  );
}

const ref = (s: Pick<ScheduledRelease, 'revision' | 'deployment_id'>) =>
  s.revision ? `v${s.revision}` : s.deployment_id.slice(0, 8);

const at = zonedTime;

function cancelFailure(err: unknown) {
  if (err instanceof ApiError && err.code === 'scheduled_release_not_found')
    return {
      kind: 'info' as const,
      title: 'No longer scheduled',
      description: 'It started, ended or was cancelled first.',
    };
  return { kind: 'error' as const, title: 'Could not cancel the schedule', error: err };
}

/** Cancel a pending schedule after saying what stays as it is. */
function useCancelWithConfirm() {
  const cancel = useCancelSchedule();
  const confirm = useConfirm();
  const { toast } = useToast();
  return {
    pending: cancel.isPending,
    run: async (
      schedule: Pick<ScheduledRelease, 'app' | 'deployment_id' | 'release_at' | 'revision'>
    ) => {
      const ok = await confirm({
        title: `Cancel ${schedule.app} ${ref(schedule)}’s schedule?`,
        description: `Its rollout will not start ${at(schedule.release_at)}. The release stays live without traffic, and production stays on the release serving now; schedule it again or promote it by hand later.`,
        confirmLabel: 'Cancel schedule',
        destructive: true,
      });
      if (!ok) return false;
      try {
        await cancel.mutateAsync(schedule.deployment_id);
        toast({
          kind: 'success',
          title: 'Schedule cancelled',
          description: `${schedule.app} ${ref(schedule)} stays without traffic.`,
        });
        return true;
      } catch (err) {
        toast(cancelFailure(err));
        return false;
      }
    },
  };
}

/** What the API's refusals of a schedule mean, by code (scheduled_releases.go). */
function scheduleFailure(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'release_not_parked':
        return `${err.detail ?? 'This release cannot be scheduled.'}`;
      case 'release_approval_canary_required':
        return 'This app requires release approvals, which wait in a canary stage. Choose a canary rollout instead of all traffic at once.';
      case 'platform_release_paused':
        return 'Gregale has paused new releases for every account during an incident. Schedule again once the pause is lifted.';
      case 'release_freeze_override_not_allowed':
        return 'Only an owner, an admin or the member who created the window may release into this organization’s freeze.';
    }
  }
  return errorMessage(err);
}

/**
 * Schedule, move or cancel the start of a release that waits live without
 * traffic (PUT/DELETE /v1/deployments/{id}/schedule). Mount it behind the
 * `scheduled-releases` capability.
 */
export function ReleaseSchedule({ deployment, slug }: { deployment: Deployment; slug: string }) {
  const schedule = useDeploymentSchedule(deployment.id);
  const stage = useCapabilityStage('scheduled-releases');
  const cancel = useCancelWithConfirm();
  const [editing, setEditing] = useState(false);
  const current = schedule.data ?? null;
  const pending = current?.state === 'scheduled' ? current : null;
  const blocker = scheduleBlocker(deployment);
  const phase = queryPhase({ error: schedule.error, loading: schedule.isPending });

  return (
    <section
      aria-label="Scheduled release"
      className="flex flex-col gap-3 well rounded-xl bg-muted/40 p-4"
    >
      <p className="label-mono text-muted-foreground">
        {stage ? `Schedule · ${stage}` : 'Schedule'}
      </p>
      {phase !== 'ready' ? (
        <InlinePhase
          phase={phase}
          error={schedule.error}
          loadingMessage="Reading the schedule…"
          onRetry={() => void schedule.refetch()}
        />
      ) : (
        <>
          {current && (
            <div className="flex flex-col gap-1 text-sm">
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <ScheduleStateBadge state={current.state} />
                <span>
                  {current.state === 'scheduled' ? 'Starts' : 'Was due'}{' '}
                  <Timestamp value={current.release_at} mode="absolute" />
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                {current.canary
                  ? `Rollout: ${SCHEDULE_PRESETS.find((p) => p.value === current.canary?.preset)?.label ?? current.canary.preset}`
                  : 'Rollout: all traffic at once'}
                {current.notify_channels.length > 0 &&
                  ` · tells ${current.notify_channels.join(', ')}`}
                {current.override_freeze &&
                  ` · overrides ${current.overridden_freezes?.length ?? 0} freeze(s): “${current.override_freeze}”`}
                {` · by ${current.scheduled_by}`}
              </p>
              {current.outcome_code && (
                <p className="text-xs text-muted-foreground">
                  <code className="font-mono">{current.outcome_code}</code>
                  {current.outcome_detail && ` · ${current.outcome_detail}`}
                </p>
              )}
            </div>
          )}
          {pending && !editing && (
            <div className="flex flex-wrap gap-2">
              <Button size="xs" variant="outline" onClick={() => setEditing(true)}>
                Move
              </Button>
              <Button
                size="xs"
                variant="ghost"
                busy={cancel.pending}
                onClick={() => void cancel.run(pending)}
              >
                Cancel schedule
              </Button>
            </div>
          )}
          {!pending && !editing && !blocker && (
            <div className="flex flex-col items-start gap-2">
              <p className="text-xs text-muted-foreground">
                It waits live without traffic. Choose when its rollout starts; production stays on
                the current release until then.
              </p>
              <Button size="xs" variant="outline" onClick={() => setEditing(true)}>
                Schedule rollout
              </Button>
            </div>
          )}
          {!pending && !editing && blocker && !current && (
            <p className="text-xs text-muted-foreground">{blocker}</p>
          )}
          {editing && (
            <ScheduleForm
              slug={slug}
              deployment={deployment}
              moving={pending}
              onDone={() => setEditing(false)}
            />
          )}
        </>
      )}
    </section>
  );
}

function ScheduleForm({
  slug,
  deployment,
  moving,
  onDone,
}: {
  slug: string;
  deployment: Deployment;
  moving: ScheduledRelease | null;
  onDone: () => void;
}) {
  const save = useScheduleRelease();
  const confirm = useConfirm();
  const { toast } = useToast();
  const zone = localZone();
  const [now, setNow] = useState(false);
  const [when, setWhen] = useState('');
  const [preset, setPreset] = useState<'' | Exclude<CanaryPreset, 'custom'>>('');
  const [notify, setNotify] = useState<string[]>(moving?.notify_channels ?? []);
  const [refusal, setRefusal] = useState<ApiError | null>(null);
  const [failure, setFailure] = useState('');
  const [tried, setTried] = useState(false);
  const iso = now ? new Date().toISOString() : localInputToIso(when);
  const problem = now ? undefined : releaseAtProblem(iso);
  const label = deployment.revision ? `v${deployment.revision}` : deployment.id.slice(0, 8);

  const send = async (override?: string) => {
    setTried(true);
    if (problem || save.isPending) return;
    const releaseAt = now ? new Date().toISOString() : iso!;
    const rollout = preset
      ? (SCHEDULE_PRESETS.find((p) => p.value === preset)?.label ?? preset).toLowerCase()
      : 'the rollout a deploy would get now (the app’s release policy)';
    const ok = await confirm(
      override
        ? {
            title: `Schedule ${slug} ${label} into the freeze?`,
            description: `It starts ${now ? 'on the next pass' : at(releaseAt)} even though production releases of ${slug} are frozen then. The override covers exactly the freezes active at that time and is recorded in the audit log with your reason, “${override}”.`,
            confirmLabel: 'Schedule into the freeze',
            destructive: true,
          }
        : {
            title: `${moving ? 'Move' : 'Schedule'} ${slug} ${label}?`,
            description: `${now ? 'Its rollout starts on the API’s next pass' : `Its rollout starts ${at(releaseAt)}`}, with ${rollout}, and production moves off the release serving now. Until then it waits live without traffic. A freeze active at that time stops it, and a newer release serving by then supersedes it.${moving ? ' It replaces the current schedule.' : ' Any other pending schedule of this app is cancelled.'}`,
            confirmLabel: moving ? 'Move schedule' : 'Schedule',
          }
    );
    if (!ok) return;
    const body: ScheduleReleaseRequest = {
      release_at: releaseAt,
      ...(preset ? { canary: { preset } } : {}),
      ...(notify.length ? { notify_channels: notify } : {}),
      ...(override ? { override_freeze: override } : {}),
    };
    setFailure('');
    try {
      await save.mutateAsync({ id: deployment.id, body });
      setRefusal(null);
      toast({
        kind: 'success',
        title: moving ? 'Schedule moved' : 'Release scheduled',
        description: now ? 'It starts on the next pass.' : `It starts ${at(releaseAt)}.`,
      });
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'release_frozen') {
        setRefusal(err);
        return;
      }
      setFailure(scheduleFailure(err));
    }
  };

  return (
    <form
      noValidate
      aria-label={moving ? 'Move schedule' : 'Schedule rollout'}
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={`schedule-at-${deployment.id}`}
            className="label-mono text-muted-foreground"
          >
            Start the rollout
          </label>
          <input
            id={`schedule-at-${deployment.id}`}
            type="datetime-local"
            value={when}
            disabled={now}
            onChange={(e) => setWhen(e.target.value)}
            aria-invalid={Boolean(tried && problem) || undefined}
            aria-describedby={tried && problem ? 'schedule-at-error' : undefined}
            className={cn(FIELD, 'w-full')}
          />
          {tried && problem ? (
            <FieldError id="schedule-at-error">{problem}</FieldError>
          ) : (
            <span className="text-xs text-muted-foreground">
              In your time zone, {zone}; at most 7 days ahead.
            </span>
          )}
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={now} onChange={(e) => setNow(e.target.checked)} />
            Now, on the next pass
          </label>
        </div>
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={`schedule-rollout-${deployment.id}`}
            className="label-mono text-muted-foreground"
          >
            Rollout
          </label>
          <Select
            id={`schedule-rollout-${deployment.id}`}
            value={preset}
            onChange={(e) => setPreset(e.target.value as typeof preset)}
          >
            <option value="">
              {moving ? 'Keep the scheduled rollout' : 'The app’s release policy'}
            </option>
            {SCHEDULE_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
          <span className="text-xs text-muted-foreground">
            An app that requires approvals needs a canary to wait in.
          </span>
        </div>
      </div>
      <ReleaseChannelPicker
        value={notify}
        onChange={setNotify}
        idPrefix={`schedule-${deployment.id}`}
        legend="Tell when it starts or cannot"
      />
      {refusal && (
        <FrozenRefusal
          error={refusal}
          busy={save.isPending}
          action="Schedule into the freeze"
          onOverride={(reason) => void send(reason)}
        />
      )}
      {failure && (
        <p role="alert" className="text-xs text-[color:var(--status-critical)]">
          {failure}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" busy={save.isPending && !refusal}>
          {moving ? 'Move schedule' : 'Schedule'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Close
        </Button>
      </div>
    </form>
  );
}

/**
 * The account's scheduled releases, or one app's, as a card: one sentence
 * for what goes live next, then pending ones first and the most recently
 * ended, each opening its release. Scheduling itself happens on a release
 * that waits without traffic, in its details. Mount it behind the
 * `scheduled-releases` capability.
 */
export function ScheduledReleases({
  app,
  onOpen,
}: {
  app?: string;
  onOpen?: (deploymentId: string) => void;
}) {
  const list = useScheduledReleases(app);
  const stage = useCapabilityStage('scheduled-releases');
  const cancel = useCancelWithConfirm();
  const rows = list.data ?? [];
  const phase = queryPhase({
    error: list.error,
    loading: list.isPending,
    isEmpty: rows.length === 0,
  });
  const words =
    phase === 'ready' || phase === 'empty'
      ? scheduleCardWords({ schedules: rows, app, version: ref, when: (iso) => spokenTime(iso) })
      : undefined;
  return (
    <SafetyCard
      id="scheduled-releases"
      title="Scheduled releases"
      stage={stage}
      word={words?.word}
      tone={words?.tone}
      help={
        <>
          A version that is live without traffic can wait for a set time before its rollout starts:
          schedule it from its details on Deployments. A freeze active at that time stops it, and a
          newer version serving by then replaces it. Times are in your time zone, {localZone()}.
        </>
      }
      sentence={
        words ? (
          words.sentence
        ) : (
          <InlinePhase
            phase={phase}
            error={list.error}
            loadingMessage="Reading schedules…"
            onRetry={() => void list.refetch()}
          />
        )
      }
    >
      {phase === 'ready' && (
        <ul aria-label="Scheduled releases" className="flex flex-col divide-y divide-border/60">
          {rows.map((s) => {
            const outcome = scheduleOutcome(s);
            return (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    {onOpen ? (
                      <button
                        type="button"
                        onClick={() => onOpen(s.deployment_id)}
                        className="font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                        aria-label={`Open release ${ref(s)}`}
                      >
                        {app ? ref(s) : `${s.app} ${ref(s)}`}
                      </button>
                    ) : (
                      <span className="font-medium">{app ? ref(s) : `${s.app} ${ref(s)}`}</span>
                    )}
                    <ScheduleStateBadge state={s.state} />
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {s.state === 'scheduled'
                      ? 'Starts'
                      : s.state === 'started'
                        ? 'Started'
                        : 'Was due'}{' '}
                    <Timestamp
                      value={s.state === 'started' ? (s.started_at ?? s.release_at) : s.release_at}
                      mode="absolute"
                    />
                    {outcome && (
                      <span title={s.outcome_code}>
                        {' · '}
                        {outcome}
                      </span>
                    )}
                    {!outcome && s.outcome_code && (
                      <>
                        {' · '}
                        <code className="font-mono">{s.outcome_code}</code>
                      </>
                    )}
                  </p>
                </div>
                {s.state === 'scheduled' && (
                  <Button
                    size="xs"
                    variant="ghost"
                    busy={cancel.pending}
                    onClick={() => void cancel.run(s)}
                  >
                    Cancel schedule <span className="sr-only">{ref(s)}</span>
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </SafetyCard>
  );
}
