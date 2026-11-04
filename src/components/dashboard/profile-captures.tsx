import { useId, useState, type FormEvent, type ReactNode } from 'react';
import {
  CheckCircle,
  Clock,
  Download,
  NavArrowDown,
  NavArrowRight,
  Refresh,
  Trash,
  WarningTriangle,
} from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { CopyableId } from '@/components/ui/copyable-id';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Timestamp } from '@/components/ui/timestamp';
import { useToast } from '@/components/ui/toast';
import { useCapabilityAccess } from '@/lib/api/capabilities';
import { ApiError } from '@/lib/api/errors';
import {
  CAPTURE_DURATION,
  automaticCapturesOn,
  downloadProfileCapture,
  useCreateProfileCapture,
  useDeleteProfileCapture,
  useProfileCapture,
  useProfileCaptureDiff,
  useProfileCaptureView,
  useProfileCaptures,
  useSaveCaptureSettings,
  RESERVED_PPROF_PORTS,
  type ProfileCapture,
  type ProfileCaptureView,
  type ProfileKind,
  type ProfileStackDelta,
} from '@/lib/api/profile-captures';
import { useApp, useAppInstances } from '@/lib/api/queries';
import { formatUsageBytes } from '@/lib/usage-format';
import { CapabilityGate } from './capability-gate';
import { MaturityLabel } from './maturity-label';
import { InlinePhase, Panel, queryPhase } from './primitives';
import type { ProfileCaptureSearch } from './profile-captures-search';
import { SegmentedControl } from './tabs';

/**
 * The app's Profile captures tab (capability `profile-captures`, faas
 * ADR-1155, docs/profiling.md "Capture a running instance on demand"): start
 * a capture of a running instance, see the ones Gregale took on its own, read
 * one kind as the API merged it, download its pprof file, and compare it with
 * an earlier capture. Everything mounts, and reads, only past the gate.
 */
export function ProfileCapturesBody({
  slug,
  search,
  onSelect,
}: {
  slug: string;
  search: ProfileCaptureSearch;
  onSelect: (patch: ProfileCaptureSearch) => void;
}) {
  return (
    <CapabilityGate capability="profile-captures" title="Profile captures">
      <div className="flex flex-col gap-6">
        <CapturesPanel slug={slug} selected={search.capture} onSelect={onSelect} />
        {search.capture && (
          <CaptureDetail
            key={search.capture}
            slug={slug}
            id={search.capture}
            search={search}
            onSelect={onSelect}
          />
        )}
      </div>
    </CapabilityGate>
  );
}

const KINDS: { kind: ProfileKind; label: string; hint: string }[] = [
  { kind: 'cpu', label: 'CPU', hint: 'where time goes over the window' },
  { kind: 'heap', label: 'Heap', hint: 'where memory is held' },
  { kind: 'stacks', label: 'Stacks', hint: 'where every goroutine or thread waits, at the start' },
  { kind: 'block', label: 'Block (Go only)', hint: 'time blocked on channels and locks' },
  { kind: 'mutex', label: 'Mutex (Go only)', hint: 'time waiting for a contended mutex' },
];
const KIND_LABEL: Record<ProfileKind, string> = {
  cpu: 'CPU',
  heap: 'Heap',
  stacks: 'Stacks',
  block: 'Block',
  mutex: 'Mutex',
};

const TRIGGER: Record<NonNullable<ProfileCapture['trigger']>, string> = {
  manual: 'You started it',
  memory_pressure: 'Memory pressure',
  slow_request: 'Slow request',
  cpu_saturation: 'CPU saturation',
};

const STATUS: Record<
  ProfileCapture['status'],
  { label: string; color: string; icon: typeof CheckCircle }
> = {
  queued: { label: 'Queued', color: 'var(--chart-muted)', icon: Clock },
  capturing: { label: 'Capturing', color: 'var(--status-warning)', icon: Refresh },
  ready: { label: 'Ready', color: 'var(--status-good)', icon: CheckCircle },
  failed: { label: 'Failed', color: 'var(--status-critical)', icon: WarningTriangle },
};

/** Colour, icon and label, so a state never rests on hue alone. */
function CaptureStatus({ status }: { status: ProfileCapture['status'] }) {
  const { label, color, icon: Icon } = STATUS[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs"
      style={{ borderColor: `color-mix(in oklab, ${color} 35%, transparent)`, color }}
    >
      <Icon aria-hidden className="size-3" />
      {label}
    </span>
  );
}

/** A value in the view's unit: CPU and contention in time, heap in bytes, stacks as counts. */
export function formatProfileValue(value: number, unit: ProfileCaptureView['unit']): string {
  if (unit === 'bytes') return formatUsageBytes(value);
  if (unit === 'count') return value.toLocaleString();
  const abs = Math.abs(value);
  if (abs >= 1e9)
    return `${(value / 1e9).toLocaleString(undefined, { maximumFractionDigits: 2 })} s`;
  if (abs >= 1e6)
    return `${(value / 1e6).toLocaleString(undefined, { maximumFractionDigits: 1 })} ms`;
  return `${(value / 1e3).toLocaleString(undefined, { maximumFractionDigits: 1 })} µs`;
}

function deltaText(delta: number, unit: ProfileCaptureView['unit']): string {
  if (delta === 0) return 'unchanged';
  return `${delta > 0 ? 'grew' : 'shrank'} ${formatProfileValue(Math.abs(delta), unit)}`;
}
const deltaColor = (delta: number) =>
  delta > 0 ? 'var(--status-critical)' : delta < 0 ? 'var(--chart-1)' : 'var(--chart-muted)';

/** The 32-hex instance id the instances route returns, in the UUID form the capture request takes. */
const asUuid = (id: string) =>
  /^[0-9a-f]{32}$/i.test(id)
    ? id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5')
    : id;

const WEEK = 7 * 24 * 3_600_000;

/** Why a capture was refused, by the stable code (faas pkg/apid/profilecapture/service.go:141-161). */
function createFailure(error: unknown): { title: string; description?: string } {
  if (!(error instanceof ApiError)) return { title: 'Could not start the capture' };
  switch (error.code) {
    case 'conflict':
      return {
        title: 'A capture of this app is already running',
        description: 'One capture per app runs at a time. Wait for it to finish.',
      };
    case 'quota_exhausted': {
      const limit = error.problem.limit_bytes;
      if (typeof limit === 'number') {
        const used = error.problem.observed_bytes;
        return {
          title: 'Capture storage is full',
          description: `Stored captures use ${typeof used === 'number' ? formatUsageBytes(used) : 'all'} of ${formatUsageBytes(limit)}. Delete a capture, or wait for one to expire.`,
        };
      }
      return {
        title: 'An account can start 60 per hour',
        description: 'The hourly capture limit is reached. Try again later.',
      };
    }
    case 'plan_feature_gated':
      return { title: 'Your plan does not include profile captures' };
    case 'validation_failed':
      return { title: 'Check the capture settings' };
    default:
      return { title: 'Could not start the capture' };
  }
}

function CapturesPanel({
  slug,
  selected,
  onSelect,
}: {
  slug: string;
  selected: string | undefined;
  onSelect: (patch: ProfileCaptureSearch) => void;
}) {
  const { capability } = useCapabilityAccess('profile-captures');
  const captures = useProfileCaptures(slug);
  const create = useCreateProfileCapture(slug);
  const { toast } = useToast();
  const [kinds, setKinds] = useState<ProfileKind[]>(['cpu']);
  const [duration, setDuration] = useState<number>(CAPTURE_DURATION.default);
  const [instance, setInstance] = useState('');
  const [mountedAt] = useState(() => Date.now());
  const id = useId();
  const items = captures.data?.captures ?? [];
  const phase = queryPhase({
    error: captures.error,
    loading: captures.isPending,
    isEmpty: items.length === 0,
  });
  const durationValid =
    Number.isInteger(duration) &&
    duration >= CAPTURE_DURATION.min &&
    duration <= CAPTURE_DURATION.max;
  const valid = kinds.length > 0 && durationValid;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || create.isPending) return;
    try {
      const created = await create.mutateAsync({
        kinds: KINDS.map((k) => k.kind).filter((k) => kinds.includes(k)),
        duration_seconds: duration,
        ...(instance ? { instance_id: asUuid(instance) } : {}),
      });
      onSelect({ capture: created.id, captureKind: undefined, captureBase: undefined });
    } catch (err) {
      toast({ kind: 'error', ...createFailure(err), error: err });
    }
  };

  // Captures Gregale took on its own, and any an OOM kill followed (docs:
  // "Get notified about automatic captures").
  // Counted as of the read, so the figure only moves when the data does.
  const asOf = captures.dataUpdatedAt || mountedAt;
  const recent = items.filter((c) => asOf - Date.parse(c.created_at) < WEEK);
  const review = recent.filter((c) => (c.trigger && c.trigger !== 'manual') || c.oom_killed_at);
  const oomFollowed = review.filter((c) => c.oom_killed_at).length;

  return (
    <Panel
      title="Profile captures"
      description="Profile one running instance now: CPU, heap, stacks, and Go lock contention."
      actions={<MaturityLabel capability={capability} />}
    >
      <div className="flex flex-col gap-5">
        {review.length > 0 && (
          <p
            role="status"
            aria-label="Profile captures to review"
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border px-3 py-2 text-xs"
          >
            <span>
              {review.length} automatic capture{review.length === 1 ? '' : 's'} in the last 7 days,{' '}
              {oomFollowed} followed by an OOM kill.
            </span>
            <button
              type="button"
              className="text-brand underline underline-offset-2"
              onClick={() => onSelect({ capture: review[0].id, captureBase: undefined })}
            >
              Open the newest
            </button>
          </p>
        )}

        <form
          aria-label="Capture a running instance"
          onSubmit={(e) => void submit(e)}
          className="flex flex-col gap-3"
        >
          <fieldset className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
            <legend className="mb-1.5 text-muted-foreground">Kinds</legend>
            {KINDS.map(({ kind, label, hint }) => (
              <label key={kind} className="flex items-center gap-1.5" title={hint}>
                <input
                  type="checkbox"
                  checked={kinds.includes(kind)}
                  onChange={(e) =>
                    setKinds(e.target.checked ? [...kinds, kind] : kinds.filter((k) => k !== kind))
                  }
                />
                {label}
              </label>
            ))}
          </fieldset>
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3 text-xs">
            <span className="flex flex-col gap-1">
              <label htmlFor={`${id}-window`} className="text-muted-foreground">
                Window (seconds)
              </label>
              <Input
                id={`${id}-window`}
                type="number"
                min={CAPTURE_DURATION.min}
                max={CAPTURE_DURATION.max}
                value={Number.isNaN(duration) ? '' : duration}
                onChange={(e) => setDuration(e.target.valueAsNumber)}
                className="h-8 w-24"
              />
            </span>
            <InstancePicker
              slug={slug}
              id={`${id}-instance`}
              value={instance}
              onChange={setInstance}
            />
            <Button type="submit" size="sm" disabled={!valid || create.isPending}>
              {create.isPending ? 'Queuing…' : 'Capture profile'}
            </Button>
          </div>
          {!durationValid && (
            <p className="text-xs" style={{ color: 'var(--status-critical)' }}>
              The window is 1 to 60 seconds.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Only a running instance is captured; a parked app is not woken, so send it a request
            first. While a capture runs the instance counts as busy. One capture per app runs at a
            time, an account can start 60 per hour, and captures are kept for 7 days. A deployment
            made before captures reached your plan needs one redeploy. Python heap captures slow
            allocation-heavy code while they run.
          </p>
        </form>

        <CaptureSettings slug={slug} />

        {phase !== 'ready' ? (
          <InlinePhase
            phase={phase}
            error={captures.error}
            loadingMessage="Loading captures…"
            emptyMessage="No captures yet."
            onRetry={() => void captures.refetch()}
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {items.map((capture) => (
              <li
                key={capture.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5 text-sm first:pt-0 last:pb-0"
              >
                <CaptureStatus status={capture.status} />
                <span>{TRIGGER[capture.trigger ?? 'manual']}</span>
                <span className="text-xs text-muted-foreground">
                  {capture.kinds.map((k) => KIND_LABEL[k]).join(', ')} · {capture.duration_seconds}{' '}
                  s · <Timestamp value={capture.created_at} />
                </span>
                {capture.oom_killed_at && (
                  <span className="text-xs" style={{ color: 'var(--status-critical)' }}>
                    <WarningTriangle aria-hidden className="mr-1 inline size-3 align-[-1px]" />
                    OOM-killed after
                  </span>
                )}
                <Button
                  size="xs"
                  variant={selected === capture.id ? 'secondary' : 'outline'}
                  className="ml-auto"
                  aria-label={`Open capture ${capture.id.slice(0, 8)}`}
                  aria-pressed={selected === capture.id}
                  onClick={() =>
                    onSelect({
                      capture: capture.id,
                      captureKind: undefined,
                      captureBase: undefined,
                    })
                  }
                >
                  Open
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

function InstancePicker({
  slug,
  id,
  value,
  onChange,
}: {
  slug: string;
  id: string;
  value: string;
  onChange: (id: string) => void;
}) {
  const instances = useAppInstances(slug);
  // Captures only run on a RUNNING instance; nothing else is offered.
  const running = (instances.data ?? []).filter((i) => i.state === 'running');
  return (
    <span className="flex flex-col gap-1">
      <label htmlFor={id} className="text-muted-foreground">
        Instance
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 max-w-64 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-brand/50"
      >
        <option value="">Earliest running instance</option>
        {running.map((i) => (
          <option key={i.id} value={i.id}>
            {i.id.slice(0, 12)}…
          </option>
        ))}
      </select>
    </span>
  );
}

const RETIRES_SNAPSHOTS =
  "Saving changes the app's profiling settings, which retires its snapshots: the next request starts a fresh instance.";

function CaptureSettings({ slug }: { slug: string }) {
  const app = useApp(slug);
  const save = useSaveCaptureSettings(slug);
  const confirm = useConfirm();
  const { toast } = useToast();
  const id = useId();
  const profiling = app.data?.manifest?.profiling;
  const on = automaticCapturesOn(profiling);
  const [port, setPort] = useState<string | null>(null);
  const shownPort = port ?? (profiling?.pprof_port ? String(profiling.pprof_port) : '');
  const portNumber = shownPort.trim() === '' ? undefined : Number(shownPort);
  const portError =
    portNumber === undefined
      ? undefined
      : !Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535
        ? 'Use a port from 1 to 65535.'
        : RESERVED_PPROF_PORTS.includes(portNumber)
          ? `${portNumber} belongs to the platform.`
          : undefined;
  const portChanged = port !== null && portNumber !== profiling?.pprof_port;

  const toggle = async (next: boolean) => {
    const ok = await confirm({
      title: next ? 'Turn automatic captures on?' : 'Turn automatic captures off?',
      description: `Gregale captures heap when an instance runs low on memory, stacks and CPU when a request is in flight for 10 seconds, and CPU when an instance uses its whole CPU limit for 30 seconds. ${RETIRES_SNAPSHOTS} Captures you start are unaffected.`,
      confirmLabel: next ? 'Turn on' : 'Turn off',
    });
    if (!ok) return;
    try {
      await save.mutateAsync({ current: profiling, patch: { automatic_captures: next } });
    } catch (err) {
      toast({ kind: 'error', title: 'Could not change automatic captures', error: err });
    }
  };

  const savePort = async (e: FormEvent) => {
    e.preventDefault();
    if (portError || !portChanged) return;
    const ok = await confirm({
      title: portNumber
        ? `Read Go profiles from port ${portNumber}?`
        : 'Stop reading a pprof port?',
      description: `guest-init reads /debug/pprof/ on that port inside the VM; it is never exposed outside it. It applies to the next deployment. ${RETIRES_SNAPSHOTS}`,
      confirmLabel: 'Save',
    });
    if (!ok) return;
    try {
      await save.mutateAsync({ current: profiling, patch: { pprof_port: portNumber } });
      setPort(null);
    } catch (err) {
      toast({ kind: 'error', title: 'Could not save the pprof port', error: err });
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 text-sm">
          <Switch
            id={id}
            aria-label="Automatic captures"
            checked={on}
            disabled={!app.data || save.isPending}
            onCheckedChange={(next) => void toggle(next)}
          />
          <label htmlFor={id}>Automatic captures</label>
        </div>
        <p className="text-xs text-muted-foreground">
          Low memory, a stuck request or a pinned CPU starts a capture on its own, at most once per
          app per hour or 15 minutes, from a separate limit of 30 per hour and half the capture
          storage.
        </p>
      </div>
      <form
        onSubmit={(e) => void savePort(e)}
        className="flex flex-wrap items-end gap-x-3 gap-y-2 text-xs"
      >
        <span className="flex flex-col gap-1">
          <label htmlFor={`${id}-port`} className="text-muted-foreground">
            Go pprof port
          </label>
          <Input
            id={`${id}-port`}
            inputMode="numeric"
            placeholder="none"
            value={shownPort}
            disabled={!app.data}
            onChange={(e) => setPort(e.target.value)}
            className="h-8 w-28"
          />
        </span>
        <Button
          type="submit"
          size="xs"
          variant="outline"
          disabled={!portChanged || Boolean(portError) || save.isPending}
        >
          Save port
        </Button>
        <span className="basis-full text-muted-foreground">
          {portError ?? (
            <>
              For a Go app that already serves <code className="font-mono">net/http/pprof</code>:
              captures then need no Gregale code.
            </>
          )}
        </span>
      </form>
    </div>
  );
}

function CaptureDetail({
  slug,
  id,
  search,
  onSelect,
}: {
  slug: string;
  id: string;
  search: ProfileCaptureSearch;
  onSelect: (patch: ProfileCaptureSearch) => void;
}) {
  const read = useProfileCapture(slug, id);
  const list = useProfileCaptures(slug);
  const remove = useDeleteProfileCapture(slug);
  const confirm = useConfirm();
  const { toast } = useToast();
  const capture = read.data;
  const missing = read.error instanceof ApiError && read.error.code === 'not_found';
  const phase = queryPhase({ error: missing ? null : read.error, loading: read.isPending });
  const kind =
    search.captureKind && capture?.kinds.includes(search.captureKind)
      ? search.captureKind
      : capture?.kinds[0];
  const ready = capture?.status === 'ready';
  const collected = ready && capture.processes > 0;
  const short = id.slice(0, 8);

  const onDelete = async () => {
    const ok = await confirm({
      title: `Delete capture ${short}?`,
      description:
        'Its profiles are deleted now and its storage is freed. A capture still queued or running is cancelled. This cannot be undone.',
      confirmLabel: 'Delete capture',
      destructive: true,
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(id);
      onSelect({ capture: undefined, captureKind: undefined, captureBase: undefined });
    } catch (err) {
      toast({ kind: 'error', title: 'Could not delete the capture', error: err });
    }
  };

  const bases = (list.data?.captures ?? []).filter(
    (c) => c.id !== id && c.status === 'ready' && c.processes > 0
  );
  const base = bases.find((c) => c.id === search.captureBase);

  return (
    <section aria-label={`Capture ${short}`}>
      <Panel
        title={`Capture ${short}`}
        actions={
          <Button
            size="xs"
            variant="ghost"
            aria-label="Delete capture"
            disabled={remove.isPending || !capture}
            onClick={() => void onDelete()}
          >
            <Trash aria-hidden className="size-3.5" />
            Delete
          </Button>
        }
      >
        {missing ? (
          <p className="text-sm text-muted-foreground">
            This capture was deleted or has expired; captures are kept for 7 days.
          </p>
        ) : phase !== 'ready' || !capture ? (
          <InlinePhase
            phase={phase}
            error={read.error}
            loadingMessage="Loading the capture…"
            onRetry={() => void read.refetch?.()}
          />
        ) : (
          <div className="flex flex-col gap-5">
            <CaptureFacts slug={slug} capture={capture} />
            {(capture.status === 'queued' || capture.status === 'capturing') && (
              <p className="text-sm text-muted-foreground">
                Capturing {capture.duration_seconds} s from the instance; this page follows it.
              </p>
            )}
            {capture.status === 'failed' && (
              <p className="text-sm" style={{ color: 'var(--status-critical)' }}>
                {capture.reason || 'The capture failed.'}
              </p>
            )}
            {ready && !collected && (
              <p className="text-sm">
                The instance has no collector, so nothing was captured: a custom image without an
                instrumented runtime, or a Go app that neither calls{' '}
                <code className="font-mono">guestprofiling.Start</code> nor sets{' '}
                <code className="font-mono">profiling.pprof_port</code>.
                {capture.reason && (
                  <span className="mt-1 block text-muted-foreground">{capture.reason}</span>
                )}
              </p>
            )}
            {collected && kind && (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  {capture.kinds.length > 1 && (
                    <SegmentedControl
                      label="Profile kind"
                      value={kind}
                      options={capture.kinds.map((k) => ({ key: k, label: KIND_LABEL[k] }))}
                      onChange={(next) => onSelect({ captureKind: next })}
                    />
                  )}
                  <PprofDownload slug={slug} id={id} kind={kind} />
                </div>
                <KindView slug={slug} id={id} kind={kind} />
                <div className="flex flex-col gap-2">
                  <label className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    Compare with
                    <select
                      aria-label="Compare with"
                      value={base?.id ?? ''}
                      onChange={(e) => onSelect({ captureBase: e.target.value || undefined })}
                      className="h-8 max-w-full rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-brand/50"
                    >
                      <option value="">No comparison</option>
                      {bases.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.id.slice(0, 8)} · {TRIGGER[c.trigger ?? 'manual']} ·{' '}
                          {c.kinds.map((k) => KIND_LABEL[k]).join(', ')} ·{' '}
                          {new Date(c.created_at).toLocaleString()}
                        </option>
                      ))}
                    </select>
                  </label>
                  {base && (
                    <Comparison
                      slug={slug}
                      id={id}
                      base={base}
                      kind={base.kinds.includes(kind) ? kind : undefined}
                    />
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </Panel>
    </section>
  );
}

function CaptureFacts({ slug, capture }: { slug: string; capture: ProfileCapture }) {
  const facts: [string, ReactNode][] = [
    ['Status', <CaptureStatus key="s" status={capture.status} />],
    ['Started by', TRIGGER[capture.trigger ?? 'manual']],
    ['Kinds', capture.kinds.map((k) => KIND_LABEL[k]).join(', ')],
    ['Window', `${capture.duration_seconds} s`],
    ['Requested', <Timestamp key="r" value={capture.created_at} />],
    ['Deleted after', <Timestamp key="e" value={capture.expires_at} />],
    ['Processes', capture.processes],
  ];
  if (capture.instance_id)
    facts.push([
      'Instance',
      <CopyableId key="i" value={capture.instance_id} label="instance ID" />,
    ]);
  if (capture.deployment_id)
    facts.push([
      'Deployment',
      <CopyableId key="d" value={capture.deployment_id} label="deployment ID" />,
    ]);
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="mt-1 min-w-0">{value}</dd>
          </div>
        ))}
      </dl>
      {capture.trigger_detail && <p className="text-sm">{capture.trigger_detail}</p>}
      {capture.request_id && (
        <p className="text-sm">
          Taken while a request stayed in flight for 10 seconds.{' '}
          <a
            className="text-brand underline underline-offset-2"
            href={`/dashboard/apps/${encodeURIComponent(slug)}?${new URLSearchParams({ tab: 'Debugger', debugView: 'requests', request: capture.request_id })}`}
          >
            Open request {capture.request_id} in the debugger
          </a>
        </p>
      )}
      {capture.oom_killed_at && (
        <p className="text-sm" style={{ color: 'var(--status-critical)' }}>
          OOM-killed after the capture, <Timestamp value={capture.oom_killed_at} />
          {capture.oom_peak_mb !== undefined &&
            `: ${capture.oom_peak_mb} MB in use against a ${capture.oom_plan_mb ?? '—'} MB plan`}
          .
        </p>
      )}
      {capture.partial && (
        <p className="text-xs text-muted-foreground">
          The capture ended early; its heap profiles are the last checkpoints before the kill.
          {capture.reason ? ` ${capture.reason}` : ''}
        </p>
      )}
      {(capture.dropped ?? 0) > 0 && (
        <p className="text-xs text-muted-foreground">
          {capture.dropped} profile{capture.dropped === 1 ? ' was' : 's were'} discarded by the
          reply bounds.
        </p>
      )}
    </div>
  );
}

function PprofDownload({ slug, id, kind }: { slug: string; id: string; kind: ProfileKind }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const run = async () => {
    setPending(true);
    setError(null);
    setSaved(null);
    try {
      const file = await downloadProfileCapture(slug, id, kind);
      const url = URL.createObjectURL(file.blob);
      try {
        const link = document.createElement('a');
        link.href = url;
        link.download = file.filename;
        link.click();
      } finally {
        URL.revokeObjectURL(url);
      }
      setSaved(file.filename);
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <Button
        size="xs"
        variant="outline"
        className="self-start"
        aria-label={`Download ${kind} pprof`}
        disabled={pending}
        onClick={() => void run()}
      >
        <Download aria-hidden className="size-3.5" />
        {pending ? 'Downloading…' : `Download ${KIND_LABEL[kind]} pprof`}
      </Button>
      <p className="text-xs text-muted-foreground">
        A gzip pprof file merged by the API; open it with{' '}
        <code className="font-mono">go tool pprof -http=: FILE</code>, speedscope or Grafana
        Pyroscope.
      </p>
      {error ? (
        <InlinePhase phase="error" error={error} onRetry={() => void run()} />
      ) : (
        saved && (
          <p role="status" className="text-xs text-muted-foreground">
            Downloaded {saved}.
          </p>
        )
      )}
    </div>
  );
}

const UNIT_NOTE: Record<ProfileKind, string> = {
  cpu: 'CPU time over the window.',
  heap: 'Go reports the sampled live heap; Node and Python report memory allocated during the window and still live at its end.',
  stacks:
    'How many goroutines or threads were waiting on each path when the capture started; Node reports what its event loop waits on.',
  block: 'Time goroutines spent blocked during the window.',
  mutex:
    'Time goroutines waited for a contended mutex during the window, at the code that held it.',
};

function SourceLink({
  name,
  file,
  line,
  url,
}: {
  name?: string;
  file?: string;
  line?: number;
  url?: string;
}) {
  const where = file ? `${file}${line ? `:${line}` : ''}` : '';
  if (!where) return name ? null : <span className="text-muted-foreground">—</span>;
  return url ? (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="break-all text-brand underline-offset-2 hover:underline"
    >
      {where}
    </a>
  ) : (
    <span className="break-all text-muted-foreground">{where}</span>
  );
}

function KindView({ slug, id, kind }: { slug: string; id: string; kind: ProfileKind }) {
  const view = useProfileCaptureView(slug, id, kind);
  const data = view.data;
  const phase = queryPhase({
    error: view.error,
    loading: view.isPending,
    isEmpty: data?.empty || (data && data.functions.length === 0),
  });
  if (phase !== 'ready' || !data)
    return (
      <InlinePhase
        phase={phase}
        error={view.error}
        loadingMessage="Merging the profile…"
        emptyMessage={`No ${KIND_LABEL[kind].toLowerCase()} samples were recorded.`}
        onRetry={() => void view.refetch()}
      />
    );
  const functions = [...data.functions].sort((a, b) => b.self - a.self).slice(0, 15);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        Total {formatProfileValue(data.total, data.unit)}. {UNIT_NOTE[kind]}{' '}
        {data.source?.available
          ? `Source links point at ${data.source.repository ?? 'the repository'} at the deployment's recorded commit${data.source.commit_sha ? ` ${data.source.commit_sha.slice(0, 7)}` : ''}.`
          : data.source?.reason
            ? `No source links: ${data.source.reason}`
            : ''}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] text-left text-xs">
          <caption className="sr-only">Hottest functions by self cost</caption>
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1.5 pr-3 font-normal">Function</th>
              <th className="py-1.5 pr-3 font-normal">Where</th>
              <th className="py-1.5 pr-3 text-right font-normal">Self</th>
              <th className="py-1.5 text-right font-normal">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {functions.map((fn) => (
              <tr key={`${fn.name}:${fn.file ?? ''}:${fn.line ?? ''}`}>
                <td className="max-w-64 truncate py-1.5 pr-3 font-mono" title={fn.name}>
                  {fn.name}
                </td>
                <td className="py-1.5 pr-3 font-mono">
                  <SourceLink file={fn.file} line={fn.line} url={fn.source?.url} />
                </td>
                <td className="py-1.5 pr-3 text-right font-mono [font-variant-numeric:tabular-nums]">
                  {formatProfileValue(fn.self, data.unit)}
                </td>
                <td className="py-1.5 text-right font-mono [font-variant-numeric:tabular-nums]">
                  {formatProfileValue(fn.total, data.unit)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-1.5">
        <h3 className="label-mono text-muted-foreground">Call paths</h3>
        <p className="text-xs text-muted-foreground">
          The call-path tree the API returned, widest first; a bar is the path&apos;s share of the
          total.
        </p>
        <CallTree
          root={data.flamegraph}
          width={(n) => n.value}
          describe={(n) => formatProfileValue(n.value, data.unit)}
        />
      </div>
    </div>
  );
}

type TreeNode = { name: string; file?: string; line?: number; children?: TreeNode[] };

/**
 * A call-path tree, drawn from the nodes as returned: children by width,
 * the first two levels open, a dozen siblings before "show more".
 */
function CallTree<T extends TreeNode>({
  root,
  width,
  describe,
  color,
}: {
  root: T;
  width: (node: T) => number;
  describe: (node: T) => ReactNode;
  color?: (node: T) => string;
}) {
  const total = Math.max(1, width(root));
  const top = (root.children ?? []) as T[];
  if (top.length === 0)
    return <p className="text-xs text-muted-foreground">The API returned no call paths.</p>;
  return (
    <ul role="tree" aria-label="Call paths" className="flex flex-col text-xs">
      <TreeLevel
        nodes={top}
        depth={0}
        total={total}
        width={width}
        describe={describe}
        color={color}
      />
    </ul>
  );
}

const SIBLINGS = 12;

function TreeLevel<T extends TreeNode>({
  nodes,
  depth,
  total,
  width,
  describe,
  color,
}: {
  nodes: T[];
  depth: number;
  total: number;
  width: (node: T) => number;
  describe: (node: T) => ReactNode;
  color?: (node: T) => string;
}) {
  const [all, setAll] = useState(false);
  const sorted = [...nodes].sort((a, b) => width(b) - width(a));
  const shown = all ? sorted : sorted.slice(0, SIBLINGS);
  return (
    <>
      {shown.map((node, i) => (
        <TreeRow
          key={`${node.name}:${node.file ?? ''}:${node.line ?? ''}:${i}`}
          node={node}
          depth={depth}
          total={total}
          width={width}
          describe={describe}
          color={color}
        />
      ))}
      {sorted.length > shown.length && (
        <li style={{ paddingLeft: `${depth * 0.9}rem` }}>
          <button
            type="button"
            className="py-1 text-brand underline underline-offset-2"
            onClick={() => setAll(true)}
          >
            Show {sorted.length - shown.length} more
          </button>
        </li>
      )}
    </>
  );
}

function TreeRow<T extends TreeNode>({
  node,
  depth,
  total,
  width,
  describe,
  color,
}: {
  node: T;
  depth: number;
  total: number;
  width: (node: T) => number;
  describe: (node: T) => ReactNode;
  color?: (node: T) => string;
}) {
  const children = (node.children ?? []) as T[];
  const [open, setOpen] = useState(depth < 2);
  const share = Math.max(0, Math.min(1, width(node) / total));
  return (
    <li role="treeitem" aria-expanded={children.length ? open : undefined} className="min-w-0">
      <div
        className="flex min-w-0 items-center gap-1.5 py-1"
        style={{ paddingLeft: `${depth * 0.9}rem` }}
      >
        {children.length ? (
          <button
            type="button"
            aria-label={`${open ? 'Collapse' : 'Expand'} ${node.name}`}
            className="pressable shrink-0 rounded text-muted-foreground"
            onClick={() => setOpen(!open)}
          >
            {open ? (
              <NavArrowDown aria-hidden className="size-3.5" />
            ) : (
              <NavArrowRight aria-hidden className="size-3.5" />
            )}
          </button>
        ) : (
          <span className="size-3.5 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate font-mono" title={node.name}>
          {node.name}
        </span>
        <span className="shrink-0 font-mono [font-variant-numeric:tabular-nums]">
          {describe(node)}
        </span>
        <span className="hidden w-24 shrink-0 sm:block" aria-hidden>
          <span className="block h-1.5 rounded bg-muted">
            <span
              className="block h-full rounded"
              style={{
                width: `${share * 100}%`,
                backgroundColor: color ? color(node) : 'var(--chart-1)',
              }}
            />
          </span>
        </span>
      </div>
      {open && children.length > 0 && (
        <ul role="group" className="flex flex-col">
          <TreeLevel
            nodes={children}
            depth={depth + 1}
            total={total}
            width={width}
            describe={describe}
            color={color}
          />
        </ul>
      )}
    </li>
  );
}

function Comparison({
  slug,
  id,
  base,
  kind,
}: {
  slug: string;
  id: string;
  base: ProfileCapture;
  kind: ProfileKind | undefined;
}) {
  const diff = useProfileCaptureDiff(slug, id, base.id, kind);
  const data = diff.data;
  const phase = queryPhase({ error: diff.error, loading: diff.isPending });
  return (
    <section
      aria-label="Comparison"
      className="flex flex-col gap-3 rounded-lg border border-border p-3"
    >
      {phase !== 'ready' || !data ? (
        <InlinePhase phase={phase} error={diff.error} loadingMessage="Comparing the captures…" />
      ) : (
        <>
          <p className="text-sm">
            {KIND_LABEL[data.kind]} against capture {base.id.slice(0, 8)}:{' '}
            {formatProfileValue(data.baseline_total, data.unit)} →{' '}
            {formatProfileValue(data.candidate_total, data.unit)},{' '}
            <span style={{ color: deltaColor(data.delta) }}>
              {deltaText(data.delta, data.unit)}
            </span>
            .
          </p>
          <p className="text-xs text-muted-foreground">
            Values are not rescaled. Red grew and blue shrank, each also said in words; a
            frame&apos;s bar is its cost in both captures together.
          </p>
          {data.warnings.length > 0 && (
            <ul className="flex flex-col gap-1 text-xs" style={{ color: 'var(--status-warning)' }}>
              {data.warnings.map((warning) => (
                <li key={warning} className="flex gap-1.5">
                  <WarningTriangle aria-hidden className="mt-0.5 size-3 shrink-0" />
                  {warning}
                </li>
              ))}
            </ul>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-left text-xs">
              <caption className="sr-only">Functions by growth</caption>
              <thead className="text-muted-foreground">
                <tr>
                  <th className="py-1.5 pr-3 font-normal">Function</th>
                  <th className="py-1.5 pr-3 text-right font-normal">Before</th>
                  <th className="py-1.5 pr-3 text-right font-normal">After</th>
                  <th className="py-1.5 text-right font-normal">Change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.functions.slice(0, 15).map((fn) => (
                  <tr key={`${fn.name}:${fn.file ?? ''}:${fn.line ?? ''}`}>
                    <td className="max-w-64 truncate py-1.5 pr-3 font-mono" title={fn.name}>
                      {fn.name}
                    </td>
                    <td className="py-1.5 pr-3 text-right font-mono">
                      {formatProfileValue(fn.baseline, data.unit)}
                    </td>
                    <td className="py-1.5 pr-3 text-right font-mono">
                      {formatProfileValue(fn.candidate, data.unit)}
                    </td>
                    <td
                      className="py-1.5 text-right font-mono"
                      style={{ color: deltaColor(fn.delta) }}
                    >
                      {deltaText(fn.delta, data.unit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CallTree<ProfileStackDelta>
            root={data.flamegraph}
            width={(n) => n.baseline + n.candidate}
            describe={(n) => deltaText(n.delta, data.unit)}
            color={(n) => deltaColor(n.delta)}
          />
        </>
      )}
    </section>
  );
}
