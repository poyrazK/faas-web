import type { ReactNode } from 'react';
import { Refresh } from 'iconoir-react';
import { Pill } from '@/components/dashboard/resource-table';
import { Timestamp } from '@/components/ui/timestamp';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import {
  replayErrorDescription,
  replayPath,
  useReplayKeyedInvocation,
  type Invocation,
} from '@/lib/api/async-invocations';
import { useCapabilityAccess } from '@/lib/api/capabilities';
import { useReplayInvocation, useWebhooks } from '@/lib/api/queries';
import { describeRetryPolicy, type RetryPolicy } from '@/lib/invocation-options';

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
  const busy = plain.isPending || keyed.isPending;

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
      toast({
        kind: 'error',
        title: 'Could not replay',
        description: replayErrorDescription(error),
        error,
      });
    }
  };

  if (variant === 'icon') {
    return (
      <button
        type="button"
        aria-label={`Replay invocation ${invocation.id}`}
        disabled={busy}
        onClick={(event) => {
          event.stopPropagation();
          void replay();
        }}
        className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
      >
        <Refresh className="h-3.5 w-3.5" />
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm" variant="outline" busy={busy} onClick={() => void replay()}>
        {path.kind === 'keyed' ? 'Replay in lane' : 'Replay'}
      </Button>
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
  | 'retry_policy'
  | 'result_retention_until'
>;

/**
 * How an async invocation was admitted: its work policy, its two lifetimes,
 * the retry curve and retention it carries, and the webhooks told when it
 * finishes. The stored curve is already the effective one — request, else app
 * default, with attempts capped at the plan (handlers_invocations.go:987) — so
 * it is described as it is, without the plan. Destinations are app webhook ids
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
      invocation.work_expires_at ? <Timestamp value={invocation.work_expires_at} /> : null,
    ],
    ['Deadline', <Timestamp key="deadline" value={invocation.deadline_at} />],
    [
      'Retries',
      invocation.retry_policy ? (
        <span>{describeRetryPolicy(invocation.retry_policy as RetryPolicy, undefined)}</span>
      ) : null,
    ],
    [
      'Kept until',
      invocation.result_retention_until ? (
        <Timestamp value={invocation.result_retention_until} />
      ) : (
        <span className="text-muted-foreground">The plan&apos;s window</span>
      ),
    ],
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
