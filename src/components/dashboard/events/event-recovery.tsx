import { Redo } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api/errors';
import { useCapabilityAccess } from '@/lib/api/capabilities';
import { recoveryTarget, useSubmitRecovery, type RecoveryAction } from '@/lib/api/event-recoveries';

const LABEL: Record<RecoveryAction['kind'], string> = {
  routing_replay: 'Replay routing',
  handler_replay: 'Replay handler',
  keyed_handler_replay: 'Replay keyed handler',
  dead_letter_replay: 'Replay dead letter',
};

/** What each recovery does, said before it happens (faas openapi for each operation). */
const EFFECT: Record<RecoveryAction['kind'], string> = {
  routing_replay:
    'Requeues routing for this one failed recipient. Other recipients and their outcomes are untouched. If the recipient changed since this receipt was read, nothing is queued.',
  handler_replay:
    'Runs the failed invocation again as a new invocation with the original request. Your handler runs again, so its side effects repeat unless it is idempotent.',
  keyed_handler_replay:
    'Runs the failed keyed invocation again with its captured work key, policy and payload. Your handler runs again, so its side effects repeat unless it is idempotent.',
  dead_letter_replay:
    'Puts the dead-lettered delivery back to pending with its original payload and identity. Your handler runs it again; an entry is replayed only once.',
};

/** Why a recovery was refused, by stable code; anything else falls back to the problem itself. */
const REFUSED: Record<string, string> = {
  event_recovery_changed: 'The recipient changed since this receipt was read. Look it up again.',
  event_replay_generation_changed:
    'The recipient was routed again since this receipt was read. Look it up again.',
  invocation_not_replayable: 'The invocation is no longer failed, so there is nothing to replay.',
  invocation_not_found: 'The invocation is no longer retained.',
  keyed_replay_expired: 'The keyed work’s pending deadline has passed. Publish the event again.',
  keyed_replay_not_allowed: 'Only failed keyed work without a queue binding can be replayed.',
  dead_letter_not_replayable: 'This dead letter has nothing to redrive.',
  not_found: 'It was already replayed or is no longer retained.',
};

/**
 * One button per recovery the receipt lists, each behind a confirmation that
 * says what runs again. An action whose URL is not an operation the console
 * knows stays a label: it is shown, not guessed at.
 */
export function RecoveryActions({
  accountId,
  actions,
}: {
  accountId: string;
  actions: RecoveryAction[];
}) {
  const confirm = useConfirm();
  const { toast } = useToast();
  const submit = useSubmitRecovery(accountId);
  // Routing replay belongs to event-replays and dead-letter replay to
  // dead-letter-queues in faas's catalog; while either is off, its action
  // is listed but not offered.
  const replays = useCapabilityAccess('event-replays').access === 'on';
  const deadLetters = useCapabilityAccess('dead-letter-queues').access === 'on';
  const offered = (action: RecoveryAction) =>
    (action.kind !== 'routing_replay' || replays) &&
    (action.kind !== 'dead_letter_replay' || deadLetters) &&
    recoveryTarget(action) !== null;

  const run = async (action: RecoveryAction) => {
    const target = recoveryTarget(action);
    if (!target) return;
    const ok = await confirm({
      title: `${LABEL[action.kind]}?`,
      description: EFFECT[action.kind],
      confirmLabel: LABEL[action.kind],
    });
    if (!ok) return;
    try {
      await submit.mutateAsync({ target });
      toast({
        kind: 'success',
        title: 'Recovery accepted',
        description: 'The receipt is read again.',
      });
    } catch (error) {
      const code = error instanceof ApiError ? error.code : '';
      toast({
        kind: 'error',
        title: 'Recovery refused',
        ...(REFUSED[code] ? { description: REFUSED[code] } : {}),
        error,
      });
    }
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      {actions.map((action) =>
        offered(action) ? (
          <Button
            key={`${action.kind}:${action.url}`}
            size="sm"
            variant="secondary"
            busy={submit.isPending && submit.variables?.target.op === action.kind}
            onClick={() => void run(action)}
          >
            <Redo /> {LABEL[action.kind]}
          </Button>
        ) : (
          <span key={`${action.kind}:${action.url}`} className="text-xs text-muted-foreground">
            {LABEL[action.kind]} ({recoveryTarget(action) ? 'not enabled' : 'API only'})
          </span>
        )
      )}
    </div>
  );
}
