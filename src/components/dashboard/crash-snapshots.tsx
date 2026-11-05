import { useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Camera, CheckCircle, Clock, Refresh, WarningTriangle } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { CopyableId } from '@/components/ui/copyable-id';
import { Switch } from '@/components/ui/switch';
import { Timestamp } from '@/components/ui/timestamp';
import { useToast } from '@/components/ui/toast';
import { useOneTimeSecret } from '@/components/ui/one-time-secret';
import { useCapabilityAccess } from '@/lib/api/capabilities';
import { ApiError } from '@/lib/api/errors';
import {
  FORK_TTL,
  forkCrashSnapshot,
  forksKey,
  useCaptureCrashSnapshot,
  useCrashSnapshotSettings,
  useCrashSnapshots,
  useSetCrashSnapshots,
  type CrashCapture,
} from '@/lib/api/forks';
import { formatUsageBytes } from '@/lib/usage-format';
import {
  ForkToken,
  LifetimeSelect,
  StatusChip,
  forkConsequences,
  forkWriteFailure,
} from './fork-shared';
import { MaturityLabel } from './maturity-label';
import { InlinePhase, Panel, queryPhase } from './primitives';

/**
 * Crash snapshots (capability `crash-snapshots`, faas ADR-733,
 * docs/crash-snapshots.md): copies of an instance's memory taken after a 5xx,
 * from the app's own error handler, on request, or by a live fork. A ready one
 * opens as a production fork and nothing else. Every route answers 402
 * `plan_app_forks_not_allowed` below Pro (handlers_crash_snapshots.go:28-38).
 */

const CAPTURE_STATUS: Record<
  CrashCapture['status'],
  { label: string; color: string; icon: typeof CheckCircle }
> = {
  requested: { label: 'Requested', color: 'var(--chart-muted)', icon: Clock },
  capturing: { label: 'Capturing', color: 'var(--status-warning)', icon: Refresh },
  ready: { label: 'Ready', color: 'var(--status-good)', icon: CheckCircle },
  failed: { label: 'Failed', color: 'var(--status-critical)', icon: WarningTriangle },
  expired: { label: 'Expired', color: 'var(--chart-muted)', icon: Clock },
};

function trigger(capture: CrashCapture): string {
  switch (capture.trigger) {
    case 'http_5xx':
      return `After a ${capture.status_code ?? '5xx'} on ${capture.route ?? 'an unreported path'}`;
    case 'sdk':
      return `From your code: ${capture.reason || 'no reason given'}${capture.route ? ` (${capture.route})` : ''}`;
    case 'live_fork':
      return 'Taken by a live fork';
    default:
      return 'Captured on request';
  }
}

export function CrashSnapshotsPanel({ slug }: { slug: string }) {
  const { capability } = useCapabilityAccess('crash-snapshots');
  const snapshots = useCrashSnapshots(slug);
  const settings = useCrashSnapshotSettings(slug);
  const setEnabled = useSetCrashSnapshots(slug);
  const captureNow = useCaptureCrashSnapshot(slug);
  const confirm = useConfirm();
  const { toast } = useToast();
  const qc = useQueryClient();
  const token = useOneTimeSecret<{ forkId: string; token: string }>();
  const [ttl, setTtl] = useState<number>(FORK_TTL.default);
  const [opening, setOpening] = useState<string | null>(null);
  const id = useId();
  const items = snapshots.data?.items ?? [];
  const phase = queryPhase({
    error: snapshots.error,
    loading: snapshots.isPending,
    isEmpty: items.length === 0,
  });
  const settingsPhase = queryPhase({ error: settings.error, loading: settings.isPending });
  const enabled = settings.data?.enabled ?? false;

  const toggle = async (next: boolean) => {
    // Turning captures on copies more production memory; turning them off
    // only stops that, so it needs no second thought.
    if (next) {
      const ok = await confirm({
        title: 'Capture memory after a 5xx?',
        description:
          "When one of this app's instances answers with a 5xx, Gregale pauses it briefly (typically under a second per 512 MB) and copies its memory, including any of your users' data in it, then it keeps serving. At most one capture runs at a time and none within 10 minutes of the last. Captures are encrypted, kept 7 days and only open as forks.",
        confirmLabel: 'Turn on',
      });
      if (!ok) return;
    }
    try {
      await setEnabled.mutateAsync(next);
    } catch (err) {
      toast({ kind: 'error', title: 'Could not change the setting', error: err });
    }
  };

  const capture = async () => {
    const ok = await confirm({
      title: 'Capture the newest running instance now?',
      description:
        "Gregale pauses it briefly (typically under a second per 512 MB) while its memory, including any of your users' data, is copied; then it keeps serving. This works whether or not 5xx captures are on.",
      confirmLabel: 'Capture now',
    });
    if (!ok) return;
    try {
      await captureNow.mutateAsync();
      toast({ kind: 'success', title: 'Capture requested' });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'crash_capture_refused')
        toast({
          kind: 'info',
          title: 'Capture not started',
          description:
            'A capture is already running, one was taken in the last 10 minutes, or no instance is running.',
        });
      else toast({ kind: 'error', title: 'Could not request a capture', error: err });
    }
  };

  const open = async (snapshot: CrashCapture) => {
    const ok = await confirm({
      title: 'Open this crash snapshot as a fork?',
      description: `The fork restores the memory captured ${snapshot.captured_at ? 'at that moment' : 'then'}, with secrets in memory and any of your users' data it held. ${forkConsequences(ttl)}`,
      confirmLabel: 'Open as fork',
    });
    if (!ok) return;
    const receive = token.capture();
    setOpening(snapshot.id);
    try {
      const created = await forkCrashSnapshot(slug, snapshot.id, { ttl_seconds: ttl });
      if (created.access_token) receive({ forkId: created.id, token: created.access_token });
    } catch (err) {
      toast({ kind: 'error', ...forkWriteFailure(err), error: err });
    } finally {
      setOpening(null);
      void qc.invalidateQueries({ queryKey: forksKey(slug) });
    }
  };

  return (
    <div role="region" aria-label="Crash snapshots">
      <Panel title="Crash snapshots" actions={<MaturityLabel capability={capability} />}>
        <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
          {
            'Memory captured after a 5xx, opened as a fork to see the state that produced the error.'
          }
        </p>

        <div className="flex flex-col gap-5">
          <p
            role="note"
            className="rounded-lg border px-3 py-2.5 text-xs leading-relaxed"
            style={{ borderColor: 'color-mix(in oklab, var(--status-warning) 45%, transparent)' }}
          >
            <WarningTriangle
              aria-hidden
              className="mr-1.5 inline size-3.5 align-[-2px]"
              style={{ color: 'var(--status-warning)' }}
            />
            <strong className="font-medium">Sensitive.</strong> Each snapshot is a copy of an
            instance&apos;s memory, including your users&apos; data that was in memory at the time.
            Snapshots are encrypted before they are stored, kept for 7 days, and can only be opened
            as a fork.
          </p>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            {settingsPhase === 'ready' ? (
              <div className="flex items-center gap-2 text-sm">
                <Switch
                  id={`${id}-on`}
                  checked={enabled}
                  disabled={setEnabled.isPending}
                  onCheckedChange={(next) => void toggle(next)}
                />
                <label htmlFor={`${id}-on`}>Capture after a 5xx</label>
                {settings.data?.updated_at && (
                  <span className="text-xs text-muted-foreground">
                    · changed <Timestamp value={settings.data.updated_at} />
                  </span>
                )}
              </div>
            ) : (
              <InlinePhase
                phase={settingsPhase}
                error={settings.error}
                loadingMessage="Loading the setting…"
              />
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={captureNow.isPending}
              onClick={() => void capture()}
            >
              <Camera aria-hidden className="size-3.5" />
              {captureNow.isPending ? 'Requesting…' : 'Capture now'}
            </Button>
            <LifetimeSelect id={`${id}-ttl`} value={ttl} onChange={setTtl} />
          </div>
          <p className="text-xs text-muted-foreground">
            A 5xx capture is taken right after the failing response, so state your code unwound is
            gone. To keep it, capture from the error handler with{' '}
            <code className="font-mono">captureCrashSnapshot</code> (Node),{' '}
            <code className="font-mono">capture_crash_snapshot</code> (Python) or{' '}
            <code className="font-mono">preview.CaptureCrashSnapshot</code> (Go).
          </p>

          {token.secret && (
            <ForkToken
              key={token.version}
              forkId={token.secret.forkId}
              token={token.secret.token}
              onDismiss={token.dismiss}
            />
          )}

          {phase !== 'ready' ? (
            <InlinePhase
              phase={phase}
              error={snapshots.error}
              loadingMessage="Loading crash snapshots…"
              emptyMessage="No crash snapshots. They appear here after a 5xx once captures are on, or when you capture now."
              onRetry={() => void snapshots.refetch()}
            />
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {items.map((snapshot) => (
                <li
                  key={snapshot.id}
                  className="flex flex-col gap-2 py-3 text-sm first:pt-0 last:pb-0"
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <StatusChip {...CAPTURE_STATUS[snapshot.status]} />
                    <span>{trigger(snapshot)}</span>
                    {snapshot.status === 'ready' && (
                      <Button
                        size="xs"
                        variant="outline"
                        className="ml-auto"
                        aria-label={`Open snapshot ${snapshot.id.slice(0, 8)} as a fork`}
                        disabled={opening !== null}
                        onClick={() => void open(snapshot)}
                      >
                        {opening === snapshot.id ? 'Opening…' : 'Open as fork'}
                      </Button>
                    )}
                  </div>
                  <dl className="grid gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
                    <div className="flex min-w-0 gap-1.5">
                      <dt>Snapshot</dt>
                      <dd className="min-w-0">
                        <CopyableId value={snapshot.id} label="snapshot ID" />
                      </dd>
                    </div>
                    <div className="flex gap-1.5">
                      <dt>Memory</dt>
                      <dd>{formatUsageBytes(snapshot.mem_bytes)}</dd>
                    </div>
                    <div className="flex gap-1.5">
                      <dt>Captured</dt>
                      <dd>
                        <Timestamp value={snapshot.captured_at ?? snapshot.requested_at} />
                      </dd>
                    </div>
                    <div className="flex gap-1.5">
                      <dt>{snapshot.status === 'expired' ? 'Deleted' : 'Deleted after'}</dt>
                      <dd>
                        <Timestamp value={snapshot.expires_at} />
                      </dd>
                    </div>
                  </dl>
                  {snapshot.failure && (
                    <p className="text-xs">
                      <span style={{ color: 'var(--status-critical)' }}>
                        {snapshot.failure.message}
                      </span>{' '}
                      <code className="font-mono text-muted-foreground">
                        {snapshot.failure.code}
                      </code>
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>
    </div>
  );
}
