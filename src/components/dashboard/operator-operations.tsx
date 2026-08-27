import { useState } from 'react';
import { CheckCircle, RefreshDouble, WarningTriangle } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/api/errors';
import {
  type OperatorAccountAction,
  type OperatorNodeAction,
  useOperatorAccountAction,
  useOperatorNodeAction,
  useSweepOperatorStuckBuilds,
} from '@/lib/api/queries';

const INPUT_CLASS =
  'mt-1.5 h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-brand/50';

export type OperatorLifecycleTarget =
  | {
      kind: 'node';
      name: string;
      action: OperatorNodeAction;
      label: string;
    }
  | {
      kind: 'account';
      id: string;
      action: OperatorAccountAction;
      label: string;
    };

function lifecycleCopy(target: OperatorLifecycleTarget) {
  if (target.kind === 'node') {
    switch (target.action) {
      case 'drain':
        return {
          title: 'Drain compute node',
          action: 'Drain node',
          warning:
            'New placement will stop on this node. Existing workloads remain until they finish or are moved.',
          destructive: false,
        };
      case 'force-drain':
        return {
          title: 'Force-drain compute node',
          action: 'Force-drain node',
          warning:
            'This marks the node inactive even with live workloads. Use only when the host is unhealthy.',
          destructive: true,
        };
      case 'activate':
        return {
          title: 'Activate compute node',
          action: 'Activate node',
          warning: 'The scheduler may place new workloads on this node immediately.',
          destructive: false,
        };
    }
  }

  switch (target.action) {
    case 'suspend':
      return {
        title: 'Suspend customer account',
        action: 'Suspend account',
        warning: 'The customer will lose access and all active sessions will be revoked.',
        destructive: true,
      };
    case 'restore':
      return {
        title: 'Restore customer account',
        action: 'Restore account',
        warning: 'The customer will be allowed to authenticate again.',
        destructive: false,
      };
    case 'revoke-sessions':
      return {
        title: 'Revoke customer sessions',
        action: 'Revoke sessions',
        warning: 'All active browser and API sessions for this customer will be invalidated.',
        destructive: true,
      };
  }
}

export function OperatorLifecycleDialog({
  target,
  onClose,
  onCompleted,
}: {
  target: OperatorLifecycleTarget | null;
  onClose: () => void;
  onCompleted?: () => void;
}) {
  const { toast } = useToast();
  const nodeAction = useOperatorNodeAction();
  const accountAction = useOperatorAccountAction();
  const [reason, setReason] = useState('');

  if (!target) return null;
  const copy = lifecycleCopy(target);
  const pending = nodeAction.isPending || accountAction.isPending;

  const submit = () => {
    const trimmed = reason.trim();
    if (!/^[a-z0-9_]{1,64}$/.test(trimmed) || pending) return;
    const request =
      target.kind === 'node'
        ? nodeAction.mutateAsync({ name: target.name, action: target.action, reason: trimmed })
        : accountAction.mutateAsync({ id: target.id, action: target.action, reason: trimmed });
    void request
      .then(() => {
        onCompleted?.();
        onClose();
        toast({ kind: 'success', title: copy.action });
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
      description="This action is MFA-gated on the server and recorded in the operator audit log."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant={copy.destructive ? 'destructive' : 'default'}
            size="sm"
            onClick={submit}
            disabled={pending || !/^[a-z0-9_]{1,64}$/.test(reason.trim())}
          >
            {pending ? 'Applying…' : copy.action}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div
          className="flex items-start gap-3 rounded-lg border p-3"
          style={{
            borderColor: `color-mix(in oklab, ${copy.destructive ? 'var(--status-critical)' : 'var(--status-warning)'} 35%, transparent)`,
            background: `color-mix(in oklab, ${copy.destructive ? 'var(--status-critical)' : 'var(--status-warning)'} 8%, transparent)`,
          }}
        >
          {copy.destructive ? (
            <WarningTriangle
              className="mt-0.5 h-4 w-4 shrink-0"
              style={{ color: 'var(--status-critical)' }}
            />
          ) : (
            <CheckCircle
              className="mt-0.5 h-4 w-4 shrink-0"
              style={{ color: 'var(--status-good)' }}
            />
          )}
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
            placeholder="incident_2026_08_27"
            pattern="[a-z0-9_]{1,64}"
            aria-label="Audit reason"
          />
          <span className="mt-1 block text-xs text-muted-foreground">
            Lowercase letters, numbers, and underscores only.
          </span>
        </label>
      </div>
    </Modal>
  );
}

export function OperatorBuildSweepDialog({
  open,
  onClose,
  onCompleted,
}: {
  open: boolean;
  onClose: () => void;
  onCompleted?: (sweptCount: number) => void;
}) {
  const { toast } = useToast();
  const sweep = useSweepOperatorStuckBuilds();
  const [olderThan, setOlderThan] = useState('15m');
  const [reason, setReason] = useState('operator_reclaim_build');

  const submit = () => {
    const trimmed = reason.trim();
    if (sweep.isPending || !/^[a-z0-9_]{1,64}$/.test(trimmed)) return;
    void sweep
      .mutateAsync({ olderThan, reason: trimmed })
      .then((result) => {
        onCompleted?.(result.swept_count);
        onClose();
        toast({
          kind: 'success',
          title: 'Stuck-build sweep completed',
          description: `${result.swept_count} build rows reclaimed.`,
        });
      })
      .catch((error: unknown) =>
        toast({
          kind: 'error',
          title: 'Stuck-build sweep failed',
          description: errorMessage(error),
        })
      );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Sweep stuck builds"
      description="Reclaim running build rows that have exceeded the selected threshold."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={sweep.isPending}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" onClick={submit} disabled={sweep.isPending}>
            {sweep.isPending ? 'Sweeping…' : 'Sweep builds'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div
          className="flex items-start gap-3 rounded-lg border p-3"
          style={{
            borderColor: 'color-mix(in oklab, var(--status-critical) 35%, transparent)',
            background: 'color-mix(in oklab, var(--status-critical) 8%, transparent)',
          }}
        >
          <WarningTriangle
            className="mt-0.5 h-4 w-4 shrink-0"
            style={{ color: 'var(--status-critical)' }}
          />
          <p className="text-xs leading-relaxed">
            Only builds older than the threshold are changed. The server clamps this operation to
            its safe one-to-sixty-minute range and writes an audit row even when no rows match.
          </p>
        </div>
        <label className="text-xs">
          <span className="label-mono text-muted-foreground">Older than</span>
          <select
            value={olderThan}
            onChange={(event) => setOlderThan(event.target.value)}
            className={INPUT_CLASS}
            aria-label="Sweep threshold"
          >
            <option value="15m">15 minutes</option>
            <option value="30m">30 minutes</option>
            <option value="60m">60 minutes</option>
          </select>
        </label>
        <label className="text-xs">
          <span className="label-mono text-muted-foreground">Audit reason</span>
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className={INPUT_CLASS}
            placeholder="operator_reclaim_build"
            pattern="[a-z0-9_]{1,64}"
            aria-label="Sweep audit reason"
          />
          <span className="mt-1 block text-xs text-muted-foreground">
            Lowercase letters, numbers, and underscores only.
          </span>
        </label>
        {sweep.isPending && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <RefreshDouble className="h-3.5 w-3.5 animate-spin" /> Updating the durable build queue…
          </p>
        )}
      </div>
    </Modal>
  );
}
