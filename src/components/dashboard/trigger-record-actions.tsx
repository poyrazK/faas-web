import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useDropTriggerRecord, useRetryTriggerRecord } from '@/lib/api/queries';

/**
 * The two verbs that get a stuck record out of the queue, shared by the record
 * log and the dead-letter list — both address the same rows.
 *
 * Retry is not destructive and gets no confirm; it is the whole point of
 * looking at a dead-lettered record. Drop discards the work with nothing to
 * undo it, so it does.
 *
 * A `409 trigger_dlq_retry_failed` means the record's state was neither
 * `retry` nor `dead_letter` — it already succeeded, or it is mid-flight. That
 * is a fact about the record, not a fault, so it reads as one. Where the state
 * is known up front the retry button is simply not offered, because a button
 * whose only possible outcome is a 409 is worse than no button.
 */
export function TriggerRecordActions({
  triggerId,
  recordId,
  retryable = true,
}: {
  triggerId: string;
  recordId: string;
  /** False for a record whose state already rules a re-drive out. */
  retryable?: boolean;
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const retry = useRetryTriggerRecord();
  const drop = useDropTriggerRecord();

  const onRetry = () => {
    void retry
      .mutateAsync({ triggerId, recordId })
      .then(() =>
        toast({
          kind: 'success',
          title: 'Record re-driven',
          description: 'It is back in the dispatch queue.',
        })
      )
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 409) {
          toast({
            kind: 'info',
            title: 'Nothing to re-drive',
            description: 'Only a record in retry or dead_letter can be sent again.',
          });
          return;
        }
        toast({ kind: 'error', title: 'Could not retry', description: errorMessage(err) });
      });
  };

  const onDrop = async () => {
    if (
      !(await confirm({
        title: 'Drop this record?',
        description:
          'The payload is discarded without being delivered. There is no way to bring it back.',
        confirmLabel: 'Drop record',
        destructive: true,
      }))
    )
      return;

    void drop
      .mutateAsync({ triggerId, recordId })
      .then(() => toast({ kind: 'success', title: 'Record dropped' }))
      .catch((err: unknown) =>
        toast({ kind: 'error', title: 'Could not drop', description: errorMessage(err) })
      );
  };

  return (
    <span className="flex items-center gap-1.5">
      {retryable && (
        <Button size="xs" variant="secondary" busy={retry.isPending} onClick={onRetry}>
          Retry
        </Button>
      )}
      <Button size="xs" variant="outline" busy={drop.isPending} onClick={() => void onDrop()}>
        Drop
      </Button>
    </span>
  );
}
