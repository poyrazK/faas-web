import { useState } from 'react';
import { CheckCircle, RefreshDouble, WarningTriangle } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/api/errors';
import {
  type OperatorIntentAccepted,
  useForceColdBootApp,
  useForceParkInstance,
  useForceRestartInstance,
  useOperatorIntent,
} from '@/lib/api/queries';

const INPUT_CLASS =
  'mt-1.5 h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-brand/50';

export type RecoveryTarget =
  | { kind: 'force-park'; id: string; label: string }
  | { kind: 'force-restart'; id: string; label: string }
  | { kind: 'force-cold-boot'; slug: string; label: string };

function targetCopy(target: RecoveryTarget) {
  switch (target.kind) {
    case 'force-park':
      return {
        title: 'Force-park instance',
        description: 'Enqueue a park request for a wedged live microVM.',
        action: 'Force-park',
        defaultReason: 'operator_force_park',
        warning:
          'The instance will stop serving requests. The state machine remains the source of truth.',
      };
    case 'force-restart':
      return {
        title: 'Force-restart instance',
        description: 'Kill the live microVM and invalidate its warm snapshots.',
        action: 'Force-restart',
        defaultReason: 'operator_force_restart',
        warning: 'The next wake will take the cold-boot path. Use this only for a confirmed wedge.',
      };
    case 'force-cold-boot':
      return {
        title: 'Force cold boot next wake',
        description:
          'Invalidate the app’s warm and init snapshots without changing its current instance.',
        action: 'Force cold boot',
        defaultReason: 'operator_force_cold_boot',
        warning:
          'The next wake will rebuild from the deployment image. Current live instances are not mutated.',
      };
  }
}

export function OperatorRecoveryDialog({
  target,
  onClose,
  onAccepted,
}: {
  target: RecoveryTarget | null;
  onClose: () => void;
  onAccepted: (intent: OperatorIntentAccepted) => void;
}) {
  const { toast } = useToast();
  const park = useForceParkInstance();
  const restart = useForceRestartInstance();
  const coldBoot = useForceColdBootApp();
  const [reason, setReason] = useState('');

  if (!target) return null;

  const copy = targetCopy(target);
  const pending = park.isPending || restart.isPending || coldBoot.isPending;

  const submit = () => {
    const trimmedReason = reason.trim();
    if (!/^[a-z0-9_]{1,64}$/.test(trimmedReason) || pending) return;

    const request =
      target.kind === 'force-park'
        ? park.mutateAsync({ id: target.id, reason: trimmedReason })
        : target.kind === 'force-restart'
          ? restart.mutateAsync({ id: target.id, reason: trimmedReason })
          : coldBoot.mutateAsync({ slug: target.slug, reason: trimmedReason });

    void request
      .then((accepted) => {
        onAccepted(accepted);
        onClose();
      })
      .catch((error: unknown) =>
        toast({ kind: 'error', title: `${copy.action} failed`, description: errorMessage(error) })
      );
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={copy.title}
      description={copy.description}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" onClick={submit} disabled={pending}>
            {pending ? 'Enqueuing…' : copy.action}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div
          className="flex items-start gap-3 rounded-lg border p-3"
          style={{
            borderColor: 'color-mix(in oklab, var(--status-warning) 35%, transparent)',
            background: 'color-mix(in oklab, var(--status-warning) 8%, transparent)',
          }}
        >
          <WarningTriangle
            className="mt-0.5 h-4 w-4 shrink-0"
            style={{ color: 'var(--status-warning)' }}
          />
          <div className="min-w-0 text-sm">
            <p className="font-medium">Target: {target.label}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{copy.warning}</p>
          </div>
        </div>
        <label className="text-xs">
          <span className="label-mono text-muted-foreground">Audit reason</span>
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className={INPUT_CLASS}
            pattern="[a-z0-9_]{1,64}"
            aria-label="Audit reason"
          />
          <span className="mt-1 block text-xs text-muted-foreground">
            Lowercase letters, numbers, and underscores only. This is written to the operator audit
            trail.
          </span>
        </label>
      </div>
    </Modal>
  );
}

export function OperatorIntentDialog({
  intentId,
  onClose,
}: {
  intentId: string | null;
  onClose: () => void;
}) {
  const intent = useOperatorIntent(intentId ?? '');
  const status = intent.data?.status;
  const terminal = status === 'succeeded' || status === 'failed' || status === 'cancelled';

  return (
    <Modal
      open={Boolean(intentId)}
      onClose={onClose}
      title="Recovery intent"
      description="The controller owns the state transition. This view polls the durable intent row."
      footer={
        <Button size="sm" variant="outline" onClick={onClose}>
          Close
        </Button>
      }
    >
      {intent.isPending ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <RefreshDouble className="h-4 w-4 animate-spin" />
          Waiting for the controller…
        </div>
      ) : intent.error ? (
        <p className="py-4 text-sm" style={{ color: 'var(--status-critical)' }}>
          Could not read intent status.
        </p>
      ) : intent.data ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            {status === 'succeeded' ? (
              <CheckCircle className="h-4 w-4" style={{ color: 'var(--status-good)' }} />
            ) : status === 'failed' || status === 'cancelled' ? (
              <WarningTriangle className="h-4 w-4" style={{ color: 'var(--status-critical)' }} />
            ) : (
              <RefreshDouble
                className="h-4 w-4 animate-spin"
                style={{ color: 'var(--status-warning)' }}
              />
            )}
            <span className="font-medium capitalize">{status}</span>
            {!terminal && <span className="text-xs text-muted-foreground">polling every 2s</span>}
          </div>
          <dl className="grid gap-3 sm:grid-cols-2">
            {[
              ['Action', intent.data.kind.replaceAll('_', ' ')],
              ['Target', intent.data.target_id],
              ['Requested', new Date(intent.data.requested_at).toLocaleString()],
              [
                'Finished',
                intent.data.finished_at ? new Date(intent.data.finished_at).toLocaleString() : '—',
              ],
            ].map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="label-mono text-muted-foreground">{label}</dt>
                <dd className="mt-1 truncate font-mono text-xs">{value}</dd>
              </div>
            ))}
          </dl>
          {intent.data.error && (
            <p
              className="rounded-md px-3 py-2 text-xs"
              style={{
                color: 'var(--status-critical)',
                background: 'color-mix(in oklab, var(--status-critical) 10%, transparent)',
              }}
            >
              {intent.data.error}
            </p>
          )}
          {intent.data.snap_ids_marked_stale && intent.data.snap_ids_marked_stale.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Invalidated {intent.data.snap_ids_marked_stale.length} snapshot
              {intent.data.snap_ids_marked_stale.length === 1 ? '' : 's'}.
            </p>
          )}
        </div>
      ) : null}
    </Modal>
  );
}
