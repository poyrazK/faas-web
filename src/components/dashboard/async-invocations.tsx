import type { ReactNode } from 'react';
import { Refresh } from 'iconoir-react';
import { Pill } from '@/components/dashboard/resource-table';
import { Timestamp } from '@/components/dashboard/events/event-format';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import {
  replayErrorMessage,
  replayPath,
  useReplayKeyedInvocation,
  type Invocation,
} from '@/lib/api/async-invocations';
import { useCapabilityAccess } from '@/lib/api/capabilities';
import { useReplayInvocation, useWebhooks } from '@/lib/api/queries';

type ReplayTarget = Pick<Invocation, 'id' | 'state' | 'work_policy_name' | 'queue_name'>;

/** The async-invocations capability's maturity, as a label; nothing once GA. */
export function AsyncInvocationsMaturity() {
  const { capability } = useCapabilityAccess('async-invocations');
  const label =
    capability?.maturity === 'beta' ? 'Beta' : capability?.maturity === 'preview' ? 'Preview' : '';
  return label ? <Pill label={label} /> : null;
}

/**
 * Replays an invocation through the route faas requires for it: keyed work
 * through `/replay-keyed`, so the copy waits its turn in the captured lane,
 * everything else through `/replay`. Either way faas records one replay per
 * failed execution and returns that same replay when asked again (ADR-609,
 * ADR-612), so a double click cannot run the work twice.
 */
export function ReplayInvocationButton({
  invocation,
  variant = 'icon',
}: {
  invocation: ReplayTarget;
  variant?: 'icon' | 'full';
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const plain = useReplayInvocation();
  const keyed = useReplayKeyedInvocation();
  const path = replayPath(invocation);

  if (path.kind === 'none') {
    return variant === 'full' ? (
      <p className="text-xs text-muted-foreground">{path.reason}</p>
    ) : null;
  }

  const replay = async () => {
    const ok = await confirm(
      path.kind === 'keyed'
        ? {
            title: 'Replay this keyed invocation?',
            description: `Your app runs it again with the same payload, in the ${path.policy} work-policy lane, after work already queued for the same key. Replaying it again returns this same replay rather than running it a third time.`,
            confirmLabel: 'Replay',
          }
        : {
            title: 'Replay this invocation?',
            description:
              'Your app runs it again with the same payload. Replaying it again returns this same replay rather than running it a third time. If the handler is not idempotent, anything the failed attempt already did may happen twice.',
            confirmLabel: 'Replay',
          }
    );
    if (!ok) return;
    const mutation = path.kind === 'keyed' ? keyed : plain;
    try {
      const child = await mutation.mutateAsync(invocation.id);
      toast({ kind: 'success', title: 'Replay queued', description: child.id });
    } catch (error) {
      toast({ kind: 'error', title: 'Could not replay', description: replayErrorMessage(error) });
    }
  };

  if (variant === 'icon') {
    return (
      <button
        type="button"
        aria-label={`Replay invocation ${invocation.id}`}
        onClick={(event) => {
          event.stopPropagation();
          void replay();
        }}
        className="text-muted-foreground transition-colors hover:text-foreground"
      >
        <Refresh className="h-3.5 w-3.5" />
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        size="sm"
        variant="outline"
        busy={plain.isPending || keyed.isPending}
        onClick={() => void replay()}
      >
        {path.kind === 'keyed' ? 'Replay in lane' : 'Replay'}
      </Button>
      <p className="min-w-0 flex-1 text-xs text-muted-foreground">
        {path.kind === 'keyed'
          ? 'Keyed replay joins its work-policy lane, so per-key order holds; unkeyed work replays on its own.'
          : 'Runs again on its own; keyed work would instead rejoin its work-policy lane.'}
      </p>
    </div>
  );
}

type DeliveryFields = Pick<
  Invocation,
  | 'work_policy_name'
  | 'work_policy_revision'
  | 'work_expires_at'
  | 'deadline_at'
  | 'on_success_destination_id'
  | 'on_failure_destination_id'
>;

/**
 * How an async invocation was admitted: its work policy, its two lifetimes,
 * and the webhooks told when it finishes. Destinations are app webhook ids
 * (faas handlers_invocations.go:283); they are named by target URL, as the
 * Webhooks page shows them, and never by secret.
 */
export function InvocationDelivery({
  invocation,
  appSlug,
}: {
  invocation: DeliveryFields;
  appSlug: string;
}) {
  const hasDestination = Boolean(
    invocation.on_success_destination_id || invocation.on_failure_destination_id
  );
  const hooks = useWebhooks(hasDestination ? appSlug : '');
  const target = (id: string | null | undefined) => {
    if (!id) return <span className="text-muted-foreground">None</span>;
    const hook = hooks.data?.find((h) => h.id === id);
    return <span className="break-all">{hook?.target_url ?? id}</span>;
  };
  const rows: [string, ReactNode | null][] = [
    [
      'Work policy',
      invocation.work_policy_name ? (
        <>
          <span>{invocation.work_policy_name}</span>
          {invocation.work_policy_revision ? (
            <span className="text-muted-foreground">
              {' '}
              · revision {invocation.work_policy_revision}
            </span>
          ) : null}
        </>
      ) : (
        <span className="text-muted-foreground">None</span>
      ),
    ],
    // Pending expiry exists only when the policy sets one (expires_after_ms).
    [
      'Pending expiry',
      invocation.work_expires_at ? <Timestamp iso={invocation.work_expires_at} /> : null,
    ],
    ['Deadline', <Timestamp key="deadline" iso={invocation.deadline_at} />],
    ['On success', target(invocation.on_success_destination_id)],
    ['On failure', target(invocation.on_failure_destination_id)],
  ];
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {rows
        .filter(([, value]) => value !== null)
        .map(([label, value]) => (
          <div key={label} className="flex min-w-0 flex-col gap-0.5">
            <dt className="label-mono text-muted-foreground">{label}</dt>
            <dd className="min-w-0 font-mono text-xs">{value}</dd>
          </div>
        ))}
    </dl>
  );
}
