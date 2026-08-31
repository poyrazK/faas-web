import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/api/errors';
import { useApp, useDeployments, useRecoverRollout } from '@/lib/api/queries';
import { inFlightRollout, ROLLOUT_ACTIONS } from '@/lib/rollout';
import type { components } from '@/lib/api/schema';

type Action = components['schemas']['RecoverRolloutRequest']['action'];

const PAST: Record<Action, string> = {
  advance: 'Rollout advanced',
  promote: 'Rollout promoted',
  abort: 'Rollout aborted',
};

/**
 * When a canary stalls — the health gate never resolves, or the on-call
 * wants it over now — the CLI's `rollouts recover` moves it by hand. The
 * reason is optional on the wire but the audit row is worth more with it.
 */
export function RolloutRecovery({
  trafficPercent,
  busy,
  onAct,
}: {
  trafficPercent: number;
  busy: boolean;
  onAct: (action: Action, reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <div
      className="rounded-md border p-3"
      style={{
        borderColor: 'color-mix(in oklab, var(--status-warning) 40%, transparent)',
        background: 'color-mix(in oklab, var(--status-warning) 6%, transparent)',
      }}
    >
      <p className="mb-2 text-sm">
        Rollout in progress — {trafficPercent}% still on the previous deployment.
      </p>
      <label className="mb-2 flex flex-col gap-1.5">
        <span className="label-mono text-muted-foreground">Reason</span>
        <input
          aria-label="Reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Recorded in the audit log"
          className="h-9 rounded-md border border-border bg-background px-2 font-mono text-sm outline-none focus:border-brand/50"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        {ROLLOUT_ACTIONS.map((a) => (
          <Button
            key={a.action}
            size="sm"
            variant={a.action === 'abort' ? 'destructive' : 'outline'}
            title={a.description}
            busy={busy}
            onClick={() => onAct(a.action, reason.trim())}
          >
            {a.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** Self-contained: finds the in-flight rollout from the raw deployment list. */
export function RolloutRecoveryBar({ slug }: { slug: string }) {
  const app = useApp(slug);
  const deployments = useDeployments();
  const recover = useRecoverRollout(slug);
  const confirm = useConfirm();
  const { toast } = useToast();

  const mine = (deployments.data?.items ?? []).filter((d) => d.app_id === app.data?.id);
  const rollout = inFlightRollout(mine);
  if (!rollout) return null;

  const go = (action: Action, reason: string) =>
    void recover
      .mutateAsync(reason ? { action, reason } : { action })
      .then((r) =>
        toast({
          kind: 'success',
          title: PAST[action],
          description: `Audit ${r.audit_id.slice(0, 8)} recorded.`,
        })
      )
      .catch((err: unknown) =>
        toast({ kind: 'error', title: 'Recovery failed', description: errorMessage(err) })
      );

  return (
    <RolloutRecovery
      trafficPercent={rollout.traffic_percent ?? 0}
      busy={recover.isPending}
      onAct={(action, reason) => {
        if (action === 'abort' || action === 'promote') {
          void confirm({
            title: action === 'abort' ? 'Abort the rollout?' : 'Promote the new deployment?',
            description:
              action === 'abort'
                ? 'All traffic returns to the previous deployment.'
                : 'All traffic moves to the new deployment; the previous one stops receiving requests.',
            confirmLabel: action === 'abort' ? 'Abort' : 'Promote',
            destructive: action === 'abort',
          }).then((ok) => {
            if (ok) go(action, reason);
          });
        } else {
          go(action, reason);
        }
      }}
    />
  );
}
