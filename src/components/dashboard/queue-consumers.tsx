import { useAuth } from '@/lib/auth';
import { useCapability } from '@/lib/api/capabilities';
import {
  useQueueBindingStatus,
  useQueueBindings,
  type QueueBinding,
} from '@/lib/api/queue-bindings';
import { Button } from '@/components/ui/button';
import { Panel } from './primitives';
import { QueueConsumerControls } from './queue-consumer-controls';

function ConsumerStatus({
  accountId,
  slug,
  binding,
}: {
  accountId: string;
  slug: string;
  binding: QueueBinding;
}) {
  const status = useQueueBindingStatus(accountId, slug, binding.id);
  const evidence = status.data;
  return (
    <li className="min-w-0 space-y-2 border-t border-border p-3 first:border-t-0">
      <p className="break-all font-medium">
        {binding.name} · {binding.mode} {binding.workload_class}
      </p>
      <p className="break-all text-xs text-muted-foreground">
        Queue {binding.queue_name} · {binding.enabled ? 'Enabled' : 'Disabled'} · Max concurrency{' '}
        {binding.max_concurrency}
      </p>
      {status.isPending ? (
        <p role="status">Reading consumer state…</p>
      ) : status.error ? (
        <p role="alert">
          Consumer status unavailable.{' '}
          <Button variant="outline" onClick={() => void status.refetch()}>
            Retry status
          </Button>
        </p>
      ) : evidence ? (
        <div className="space-y-1 text-xs">
          <p>Consumer state: {evidence.consumer_state}</p>
          <p>Scheduler liveness: {evidence.consumer_liveness}</p>
          {binding.mode === 'pull' ? (
            <p>External pull consumers are not observed by the platform scheduler.</p>
          ) : evidence.consumer_state === 'active' && evidence.consumer_liveness !== 'healthy' ? (
            <p role="status">Active configuration does not prove a healthy consumer.</p>
          ) : null}
          {evidence.consumer_state_reason && <p>Reason: {evidence.consumer_state_reason}</p>}
          {evidence.last_poll_at && <p>Last scheduler poll: {evidence.last_poll_at}</p>}
          {evidence.last_error && <p>Last scheduler error: {evidence.last_error}</p>}
          <p>
            Depth {evidence.depth} · In flight {evidence.in_flight} · Dead letter{' '}
            {evidence.dead_letter}
          </p>
          <p>Observed at {evidence.generated_at}</p>
          <Button variant="outline" onClick={() => void status.refetch()}>
            Refresh status
          </Button>
        </div>
      ) : (
        <p role="status">Consumer status was not returned.</p>
      )}
    </li>
  );
}

export function QueueConsumers({ slug }: { slug: string }) {
  const { account } = useAuth();
  const accountId = account?.id ?? '';
  const capability = useCapability('worker-pools');
  const list = useQueueBindings(accountId, slug);
  return (
    <Panel
      title="Queue consumers"
      description="Durable bindings and binding-scoped scheduler evidence. Queue messages remain below."
    >
      <div className="space-y-3 p-4 text-sm">
        {capability.accountId !== accountId || capability.state !== 'available' ? (
          <p role="status">Worker controls require confirmed worker-pool availability.</p>
        ) : null}
        {list.isPending ? (
          <p role="status">Loading queue bindings…</p>
        ) : list.error ? (
          <p role="alert">
            Could not read queue bindings.{' '}
            <Button variant="outline" onClick={() => void list.refetch()}>
              Retry
            </Button>
          </p>
        ) : list.data?.length ? (
          <ul className="min-w-0 rounded border border-border">
            {list.data.map((binding) => (
              <ConsumerStatus
                key={binding.id}
                accountId={accountId}
                slug={slug}
                binding={binding}
              />
            ))}
          </ul>
        ) : (
          <p>No production queue bindings are configured for this app.</p>
        )}
        {capability.accountId === accountId &&
          capability.state === 'available' &&
          !list.isPending &&
          !list.error &&
          account?.plan && (
            <QueueConsumerControls
              accountId={accountId}
              plan={account.plan}
              slug={slug}
              bindings={list.data ?? []}
            />
          )}
        <p className="text-xs text-muted-foreground">
          Pull workers poll and acknowledge externally. Push delivery invokes the configured
          handler; accepted configuration does not prove that it is processing messages. Each
          attempt consumes compute and retries may repeat work, so handlers should be safe to
          replay.
        </p>
      </div>
    </Panel>
  );
}
