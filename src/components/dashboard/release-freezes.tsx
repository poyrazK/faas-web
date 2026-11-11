import { useState, type ReactNode } from 'react';
import { Calendar, Clock, Lock, Plus, Undo } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { FIELD, FieldError, Textarea } from '@/components/ui/field';
import { Timestamp } from '@/components/ui/timestamp';
import { useToast } from '@/components/ui/toast';
import { useCapabilityStage } from '@/lib/api/capabilities';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  FREEZE_AFTER_ROLLBACK_MAX_MINUTES,
  FREEZE_BLOCKS,
  FREEZE_REASON_MAX,
  FREEZE_SPARES,
  FREEZE_WEEKLY_MAX_MINUTES,
  WEEKDAYS,
  freezeCoverage,
  minutesLabel,
  ownerCoverage,
  reasonProblem,
  useCreateReleaseFreeze,
  useFreezeStatus,
  useLiftReleaseFreeze,
  useReleaseFreezes,
  validTimeZone,
  windowEndProblem,
  weeklyLabel,
  type CreateReleaseFreeze,
  type FreezeKind,
  type FreezeOwner,
  type ReleaseFreeze,
  type Weekday,
} from '@/lib/api/release-freezes';
import { cn } from '@/lib/utils';
import { Sheet } from './kit/sheet';
import { InlinePhase, queryPhase } from './primitives';
import { SafetyCard } from './release-safety-card';
import { freezeCardWords, spokenTime } from './release-safety-words';
import { SegmentedControl } from './tabs';

/** The browser's IANA zone: `datetime-local` inputs speak its wall clock. */
export function localZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/** "Nov 4, 2026, 02:00 GMT+3": an instant in the viewer's zone, with the zone named. */
export function zonedTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(Date.parse(iso));
}

/** A `datetime-local` value as an instant, or null when blank or malformed. */
export function localInputToIso(value: string): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** Status is colour, icon and label together (README Conventions). */
function Badge({
  color,
  icon: Icon,
  children,
}: {
  color: string;
  icon: typeof Lock;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color }}>
      <Icon aria-hidden className="h-3.5 w-3.5 shrink-0" />
      {children}
    </span>
  );
}

export function FreezeBadge({ freeze }: { freeze: ReleaseFreeze }) {
  if (freeze.active)
    return (
      <Badge color="var(--status-critical)" icon={Lock}>
        Frozen now
      </Badge>
    );
  if (freeze.kind === 'after_rollback')
    return (
      <Badge color="var(--muted-foreground)" icon={Undo}>
        Standing policy
      </Badge>
    );
  if (freeze.next_starts_at)
    return (
      <Badge color="var(--status-warning)" icon={Clock}>
        Starts <Timestamp value={freeze.next_starts_at} />
      </Badge>
    );
  return (
    <Badge color="var(--muted-foreground)" icon={Calendar}>
      Not active now
    </Badge>
  );
}

/** When a freeze withholds releases, with the zone every time is read in. */
export function FreezeWhen({ freeze }: { freeze: ReleaseFreeze }) {
  if (freeze.kind === 'weekly' && freeze.weekly) return <>{weeklyLabel(freeze.weekly)}</>;
  if (freeze.kind === 'after_rollback')
    return (
      <>
        Freezes the app for {minutesLabel(freeze.after_rollback_minutes ?? 0)} each time Gregale
        rolls it back on its own
      </>
    );
  return (
    <>
      From <Timestamp value={freeze.starts_at} mode="absolute" />{' '}
      {freeze.ends_at ? (
        <>
          until <Timestamp value={freeze.ends_at} mode="absolute" />
        </>
      ) : (
        'until lifted'
      )}
    </>
  );
}

function liftFailure(err: unknown): {
  kind: 'info' | 'error';
  title: string;
  description?: string;
  error?: unknown;
} {
  if (err instanceof ApiError) {
    if (err.code === 'release_freeze_not_found')
      return {
        kind: 'info',
        title: 'Already lifted',
        description: 'Someone lifted it, or it ended.',
      };
    if (err.code === 'org_role_forbidden' || err.code === 'forbidden')
      return {
        kind: 'error',
        title: 'Only an owner or admin can lift this freeze',
        description: 'A member who deploys may lift only a window they created.',
      };
  }
  return { kind: 'error', title: 'Could not lift the freeze', error: err };
}

/**
 * Lift a freeze after a confirmation saying what goes through again; `busy`
 * names the freeze being lifted. Shared by the freeze list and the tab's
 * headline, so both say and do the same.
 */
export function useLiftFreeze() {
  const lift = useLiftReleaseFreeze();
  const confirm = useConfirm();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (freeze: ReleaseFreeze) => {
    const coverage = freezeCoverage(freeze);
    const ok = await confirm({
      title: `Lift the freeze on ${coverage}?`,
      description: `“${freeze.reason}” stops withholding releases: production releases of ${coverage} go through again unless another freeze covers them${
        freeze.kind === 'after_rollback' ? ', and automatic rollbacks no longer freeze it' : ''
      }. The freeze is kept, with who lifted it and when, in the audit log.`,
      confirmLabel: 'Lift freeze',
    });
    if (!ok) return;
    setBusy(freeze.id);
    try {
      await lift.mutateAsync(freeze);
      toast({
        kind: 'success',
        title: 'Freeze lifted',
        description: `${coverage} can be released again.`,
      });
    } catch (err) {
      toast(liftFailure(err));
    } finally {
      setBusy(null);
    }
  };
  return { busy, lift: run };
}

/** The freezes, each with what it covers, when, why, who set it, and Lift. */
export function FreezeList({
  freezes,
  showCoverage = true,
}: {
  freezes: ReleaseFreeze[];
  showCoverage?: boolean;
}) {
  const { busy, lift } = useLiftFreeze();
  const onLift = lift;

  return (
    <ul className="divide-y divide-border">
      {freezes.map((freeze) => (
        <li
          key={freeze.id}
          className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <FreezeBadge freeze={freeze} />
              <span className="font-medium [overflow-wrap:anywhere]">{freeze.reason}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              <FreezeWhen freeze={freeze} />
            </p>
            <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {showCoverage && <span>Covers {freezeCoverage(freeze)}</span>}
              <span
                title={
                  freeze.source_deployment_id
                    ? `Rolled back deployment ${freeze.source_deployment_id}`
                    : undefined
                }
              >
                {freeze.source === 'automatic_rollback'
                  ? 'Set by Gregale after a rollback'
                  : `Set by ${freeze.created_by}`}{' '}
                <Timestamp value={freeze.created_at} />
              </span>
            </p>
          </div>
          <Button
            size="xs"
            variant="secondary"
            busy={busy === freeze.id}
            disabled={busy !== null}
            onClick={() => void onLift(freeze)}
          >
            Lift <span className="sr-only">“{freeze.reason}”</span>
          </Button>
        </li>
      ))}
    </ul>
  );
}

/** A labelled control with its hint or error below, outside the label's name. */
function Field({
  label,
  hint,
  error,
  errorId,
  className,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  errorId?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label className="flex flex-col gap-1.5">
        <span className="label-mono text-muted-foreground">{label}</span>
        {children}
      </label>
      {error && errorId ? (
        <FieldError id={errorId}>{error}</FieldError>
      ) : (
        hint && <span className="text-xs text-muted-foreground">{hint}</span>
      )}
    </div>
  );
}

const KINDS: { key: FreezeKind; label: string }[] = [
  { key: 'window', label: 'Window' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'after_rollback', label: 'After rollback' },
];

/** Creates a window, weekly or after-rollback freeze for `owner`, confirmed first. */
export function NewFreezeForm({ owner, onDone }: { owner: FreezeOwner; onDone: () => void }) {
  const create = useCreateReleaseFreeze();
  const confirm = useConfirm();
  const { toast } = useToast();
  const zone = localZone();
  const [kind, setKind] = useState<FreezeKind>('window');
  const [reason, setReason] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [days, setDays] = useState<Weekday[]>(['fri']);
  const [start, setStart] = useState('16:00');
  const [duration, setDuration] = useState('3840');
  const [timeZone, setTimeZone] = useState(zone);
  const [afterRollback, setAfterRollback] = useState('60');
  const [failure, setFailure] = useState<unknown>(null);
  const [tried, setTried] = useState(false);

  const startIso = localInputToIso(startsAt);
  const endIso = localInputToIso(endsAt);
  const durationMinutes = Number(duration);
  const rollbackMinutes = Number(afterRollback);
  const errors: Partial<
    Record<'reason' | 'ends' | 'days' | 'start' | 'duration' | 'zone' | 'rollback', string>
  > = {
    reason: reasonProblem(reason),
  };
  if (kind === 'window') errors.ends = windowEndProblem(startIso, endIso);
  if (kind === 'weekly') {
    if (days.length === 0) errors.days = 'Pick at least one day.';
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start)) errors.start = 'Use HH:MM, 00:00 to 23:59.';
    if (
      !Number.isInteger(durationMinutes) ||
      durationMinutes < 1 ||
      durationMinutes > FREEZE_WEEKLY_MAX_MINUTES
    )
      errors.duration = `Whole minutes from 1 to ${FREEZE_WEEKLY_MAX_MINUTES} (a week).`;
    if (!validTimeZone(timeZone))
      errors.zone = 'An IANA time zone, such as Europe/Istanbul or UTC.';
  }
  if (
    kind === 'after_rollback' &&
    (!Number.isInteger(rollbackMinutes) ||
      rollbackMinutes < 1 ||
      rollbackMinutes > FREEZE_AFTER_ROLLBACK_MAX_MINUTES)
  )
    errors.rollback = `Whole minutes from 1 to ${FREEZE_AFTER_ROLLBACK_MAX_MINUTES} (a day).`;
  const invalid = Object.values(errors).some(Boolean);
  const shown = (key: keyof typeof errors) => (tried ? errors[key] : undefined);

  const body = (): CreateReleaseFreeze => {
    const base = { kind, reason: reason.trim() };
    if (kind === 'weekly')
      return {
        ...base,
        weekly: { days, start, duration_minutes: durationMinutes, time_zone: timeZone },
      };
    if (kind === 'after_rollback') return { ...base, after_rollback_minutes: rollbackMinutes };
    return {
      ...base,
      ...(startIso ? { starts_at: startIso } : {}),
      ...(endIso ? { ends_at: endIso } : {}),
    };
  };

  const when = (): string => {
    if (kind === 'weekly')
      return weeklyLabel({
        days,
        start,
        duration_minutes: durationMinutes,
        time_zone: timeZone,
      }).replace(/^Every/, 'every');
    if (kind === 'after_rollback')
      return `for ${minutesLabel(rollbackMinutes)} each time Gregale rolls an app back on its own (the rollout breaker, the post-release watch, the first-wake 5xx guard or an alert rule)`;
    const fmt = zonedTime;
    return `${startIso ? `from ${fmt(startIso)}` : 'from now'} ${endIso ? `until ${fmt(endIso)}` : 'until someone lifts it'}`;
  };

  const submit = async () => {
    setTried(true);
    if (invalid || create.isPending) return;
    const ok = await confirm({
      title:
        owner.kind === 'app'
          ? `Freeze ${owner.slug}?`
          : owner.kind === 'org'
            ? `Freeze every app of ${owner.org}?`
            : 'Freeze every personal app?',
      description: `This blocks ${ownerCoverage(owner)}, ${when()}. Deploys, GitHub pushes, retries and promotions into production are refused with release_frozen. ${FREEZE_SPARES} Anyone who may lift it can still release with an audited override.`,
      confirmLabel: kind === 'window' ? 'Freeze releases' : 'Create policy',
      destructive: true,
    });
    if (!ok) return;
    setFailure(null);
    try {
      await create.mutateAsync({ owner, body: body() });
      toast({
        kind: 'success',
        title: kind === 'window' ? 'Releases frozen' : 'Freeze policy created',
        description: reason.trim(),
      });
      onDone();
    } catch (err) {
      setFailure(err);
    }
  };

  const failureText = (err: unknown): string => {
    if (err instanceof ApiError) {
      if (err.code === 'org_role_forbidden')
        return owner.kind === 'org'
          ? `Only owners and admins of ${owner.org} create weekly and after-rollback freezes; a member who deploys may create a window.`
          : 'Only the organization’s owners and admins create weekly and after-rollback freezes; a member who deploys may create a window.';
      if (err.code === 'release_freeze_limit')
        return 'This owner already holds 50 freezes that have not ended. Lift ones you no longer need.';
    }
    return errorMessage(err);
  };

  return (
    <form
      noValidate
      aria-label="New freeze"
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <SegmentedControl label="Freeze kind" value={kind} options={KINDS} onChange={setKind} />
      <p className="text-xs text-muted-foreground">
        {kind === 'window'
          ? 'One stretch of time, starting now or later, until a set time or until lifted.'
          : kind === 'weekly'
            ? 'A recurring window, such as no releases over the weekend. A standing policy: in an organization, only owners and admins create one.'
            : 'After each automatic rollback, freeze the rolled-back app for a while so a fix is not rushed out. A standing policy: in an organization, only owners and admins create one.'}
      </p>

      {kind === 'window' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Starts" hint="Blank starts now.">
            <input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className={cn(FIELD, 'w-full')}
            />
          </Field>
          <Field
            label="Ends"
            hint="Blank lasts until lifted."
            error={shown('ends')}
            errorId="freeze-ends-error"
          >
            <input
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              aria-invalid={Boolean(shown('ends')) || undefined}
              aria-describedby={shown('ends') ? 'freeze-ends-error' : undefined}
              className={cn(FIELD, 'w-full')}
            />
          </Field>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            Times are in your time zone, {zone}.
          </p>
        </div>
      )}

      {kind === 'weekly' && (
        <div className="flex flex-col gap-3">
          <fieldset className="flex flex-col gap-1.5">
            <legend className="label-mono text-muted-foreground">Opens on</legend>
            <div className="flex flex-wrap gap-1.5 pt-1.5">
              {WEEKDAYS.map((day) => (
                <label
                  key={day}
                  className="pressable flex cursor-pointer items-center gap-1.5 well rounded-xl bg-muted/40 px-2 py-1 text-xs capitalize has-[:checked]:border-brand"
                >
                  <input
                    type="checkbox"
                    checked={days.includes(day)}
                    onChange={() =>
                      setDays((d) =>
                        d.includes(day)
                          ? d.filter((x) => x !== day)
                          : WEEKDAYS.filter((x) => x === day || d.includes(x))
                      )
                    }
                  />
                  {day}
                </label>
              ))}
            </div>
            {shown('days') && <FieldError id="freeze-days-error">{shown('days')}</FieldError>}
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="At" error={shown('start')} errorId="freeze-start-error">
              <input
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                aria-invalid={Boolean(shown('start')) || undefined}
                className={cn(FIELD, 'w-full')}
              />
            </Field>
            <Field
              label="Lasts (minutes)"
              hint={`${minutesLabel(durationMinutes)}; it may run past midnight or into the next week.`}
              error={shown('duration')}
              errorId="freeze-duration-error"
            >
              <input
                type="number"
                min={1}
                max={FREEZE_WEEKLY_MAX_MINUTES}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                aria-invalid={Boolean(shown('duration')) || undefined}
                className={cn(FIELD, 'w-full')}
              />
            </Field>
            <Field
              label="Time zone"
              hint="An IANA zone; the window follows its daylight saving."
              error={shown('zone')}
              errorId="freeze-zone-error"
            >
              <input
                value={timeZone}
                onChange={(e) => setTimeZone(e.target.value.trim())}
                aria-invalid={Boolean(shown('zone')) || undefined}
                className={cn(FIELD, 'w-full font-mono')}
              />
            </Field>
          </div>
        </div>
      )}

      {kind === 'after_rollback' && (
        <Field
          label="Freeze for (minutes)"
          className="sm:max-w-xs"
          hint={`${minutesLabel(rollbackMinutes)}. If the rollback does not restore the previous release, Gregale lifts the freeze again.`}
          error={shown('rollback')}
          errorId="freeze-rollback-error"
        >
          <input
            type="number"
            min={1}
            max={FREEZE_AFTER_ROLLBACK_MAX_MINUTES}
            value={afterRollback}
            onChange={(e) => setAfterRollback(e.target.value)}
            aria-invalid={Boolean(shown('rollback')) || undefined}
            className={cn(FIELD, 'w-full')}
          />
        </Field>
      )}

      <Field
        label="Reason"
        hint="Shown in every refused release, with your name."
        error={shown('reason')}
        errorId="freeze-reason-error"
      >
        <Textarea
          rows={2}
          maxLength={FREEZE_REASON_MAX}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="holiday freeze"
          aria-invalid={Boolean(shown('reason')) || undefined}
          aria-describedby={shown('reason') ? 'freeze-reason-error' : undefined}
        />
      </Field>

      {Boolean(failure) && (
        <p role="alert" className="text-xs text-[color:var(--status-critical)]">
          {failureText(failure)}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" busy={create.isPending}>
          {kind === 'window' ? 'Freeze releases' : 'Create policy'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

const SHEET_TITLE = (owner: FreezeOwner) =>
  owner.kind === 'app'
    ? `Freeze ${owner.slug}`
    : owner.kind === 'org'
      ? `Freeze every app of ${owner.org}`
      : 'Freeze every personal app';

/**
 * Deploy freezes for one owner, as a card: whether releases are paused now
 * and what pauses them next, the freezes with Lift, and "Add a freeze" opening
 * the form in a sheet. For an app it lists every freeze covering it (its own
 * and its owner's on all apps) and reads the app's freeze status; for an
 * account or an organization, the freezes it holds. Mount it behind the
 * `deploy-freezes` capability.
 */
export function ReleaseFreezes({
  owner,
  description,
}: {
  owner: FreezeOwner;
  description?: string;
}) {
  const freezes = useReleaseFreezes(owner);
  const status = useFreezeStatus(owner.kind === 'app' ? owner.slug : '', owner.kind === 'app');
  const stage = useCapabilityStage('deploy-freezes');
  const [adding, setAdding] = useState(false);
  // What withholds releases now comes first.
  const list = [...(freezes.data ?? [])].sort((a, b) => Number(b.active) - Number(a.active));
  const phase = queryPhase({
    error: freezes.error ?? (owner.kind === 'app' ? status.error : undefined),
    loading: freezes.isPending || (owner.kind === 'app' && status.isPending),
    isEmpty: list.length === 0,
  });
  const words =
    phase === 'ready' || phase === 'empty'
      ? freezeCardWords({
          owner,
          freezes: list,
          status: owner.kind === 'app' ? status.data : undefined,
          when: (iso) => spokenTime(iso),
        })
      : undefined;
  return (
    <SafetyCard
      id="release-freezes"
      title="Freezes"
      term="Deploy freezes"
      stage={stage}
      word={words?.word}
      tone={words?.tone}
      help={
        <>
          {description ?? `${FREEZE_BLOCKS} ${FREEZE_SPARES}`} A freeze can be a one-off window, a
          weekly window, or a pause after each automatic rollback.
        </>
      }
      sentence={
        words ? (
          words.sentence
        ) : (
          <InlinePhase
            phase={phase}
            error={freezes.error ?? status.error}
            loadingMessage="Reading freezes…"
            onRetry={() => {
              void freezes.refetch();
              if (owner.kind === 'app') void status.refetch();
            }}
          />
        )
      }
      action={
        <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
          <Plus aria-hidden className="h-3.5 w-3.5" />
          Add a freeze
        </Button>
      }
    >
      {phase === 'ready' && (
        <FreezeList
          freezes={list}
          showCoverage={owner.kind !== 'app' || list.some((f) => !f.app)}
        />
      )}
      <Sheet open={adding} onClose={() => setAdding(false)} title={SHEET_TITLE(owner)}>
        {adding && <NewFreezeForm owner={owner} onDone={() => setAdding(false)} />}
      </Sheet>
    </SafetyCard>
  );
}

/**
 * The freezes a `release_frozen` refusal names (Problem.freezes), and, when
 * the caller can resend, a reason to release into them anyway. The override
 * is audited (`release.freeze_overridden`) and a company's freeze accepts it
 * only from someone who may lift it.
 */
export function FrozenRefusal({
  error,
  onOverride,
  busy = false,
  action = 'Release anyway',
}: {
  error: ApiError;
  onOverride?: (reason: string) => void;
  busy?: boolean;
  action?: string;
}) {
  const [reason, setReason] = useState('');
  const freezes = error.problem.freezes ?? [];
  const problem = reasonProblem(reason);
  return (
    <div
      role="alert"
      aria-label="Release frozen"
      className="flex flex-col gap-3 well rounded-xl bg-muted/40 p-3"
    >
      <Badge color="var(--status-critical)" icon={Lock}>
        {error.detail ?? 'Production releases are frozen.'}
      </Badge>
      {freezes.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
          {freezes.map((f) => (
            <li key={f.id}>
              “{f.reason}” by {f.created_by} · <FreezeWhen freeze={f} />
            </li>
          ))}
        </ul>
      )}
      {onOverride && (
        // Not a <form>: this sits inside the schedule form, and a nested
        // form's submit would bubble to the outer one.
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Override reason</span>
            <input
              value={reason}
              maxLength={FREEZE_REASON_MAX}
              onChange={(e) => setReason(e.target.value)}
              placeholder="hotfix for incident 4711"
              className={cn(FIELD, 'w-full')}
            />
          </label>
          <span className="text-xs text-muted-foreground">
            Recorded in the audit log with the freezes it overrides. A company’s freeze accepts it
            only from an owner, an admin or the member who created the window.
          </span>
          <div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={Boolean(problem)}
              busy={busy}
              onClick={() => onOverride(reason.trim())}
            >
              {action}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
