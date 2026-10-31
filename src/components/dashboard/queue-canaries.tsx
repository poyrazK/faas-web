import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { useCapability } from '@/lib/api/capabilities';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  bindingInventoryKey,
  useBindingInventory,
  type BindingInventoryItem,
} from '@/lib/api/bindings';
import {
  QUEUE_CANARY_MAX_TTL_SECONDS,
  cancelQueueCanary,
  createQueueCanary,
  queueCanaryKey,
  useQueueCanary,
  type QueueCanary,
} from '@/lib/api/binding-verification';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { CapabilityNotice } from './capability-notice';
import { InlinePhase, Panel, queryPhase } from './primitives';

const STATUS: Record<QueueCanary['status'], string> = {
  published: 'Published',
  dispatching: 'Dispatching',
  succeeded: 'Succeeded',
  failed: 'Failed',
  blocked: 'Blocked',
  expired: 'Expired',
  cancelled: 'Cancelled',
};
const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
const active = (canary?: QueueCanary) =>
  canary?.status === 'published' || canary?.status === 'dispatching';

/** Messages by `ApiError.code` (faas pkg/apid/bindings/queue_canary.go:11-28). */
function explain(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'validation_failed':
        return 'The server refused the canary. The live deployment must declare this binding in GREGALE_QUEUE_CANARY_BINDINGS (a JSON array in its override env), and the binding needs a push consumer.';
      case 'queue_canary_changed':
        return 'Another canary is still active for this binding, or its consumer changed. Cancel the earlier canary, then publish again.';
      case 'plan_queue_depth':
        return 'The app’s queue is at its plan depth limit, so no canary can be published now.';
      case 'not_found':
        return 'The canary, the live deployment or its push consumer was not found.';
      case 'email_verification_required':
        return 'Verify your email address before publishing a canary.';
    }
  }
  return errorMessage(error);
}

function detail(canary: QueueCanary): string {
  switch (canary.status) {
    case 'succeeded':
      return `Delivered ${canary.delivered_at ? when(canary.delivered_at) : ''}; handler completed ${canary.completed_at ? when(canary.completed_at) : ''}.`;
    case 'published':
      return 'Published, not delivered yet. Publication is not a pass.';
    case 'dispatching':
      return 'Delivered and being handled. Not a pass until the handler completes.';
    default:
      return `Ended ${canary.status}${canary.reason ? ` (${canary.reason})` : ''}. It is not evidence.`;
  }
}

/**
 * Push queue completion canaries (faas ADR-1352): one reserved message
 * through a binding to the live deployment's consumer, observed until its
 * handler completes. Gated on the `queue-bindings` capability, whose routes
 * these are in the product catalog.
 */
export function QueueCanaries({ slug }: { slug: string }) {
  const capability = useCapability('queue-bindings');
  const available = capability.state === 'available';
  return (
    <Panel
      title="Queue canaries"
      description="Proves a push queue binding end to end: one reserved message goes to the live deployment’s consumer, and the evidence counts once its handler completes. It changes no traffic."
    >
      <div className="space-y-4 text-sm">
        <CapabilityNotice
          capability={capability.capability}
          state={capability.state}
          onRetry={capability.refresh}
        />
        {available && <QueueCanaryList slug={slug} />}
      </div>
    </Panel>
  );
}

function QueueCanaryList({ slug }: { slug: string }) {
  const { account } = useAuth();
  const accountId = account?.id ?? '';
  const inventory = useBindingInventory(accountId, slug);
  const rows = inventory.data?.bindings.filter((item) => item.type === 'queue') ?? [];
  const phase = queryPhase({
    error: inventory.error,
    loading: inventory.isLoading,
    isEmpty: rows.length === 0,
  });
  const deployment = inventory.data?.verification_deployment_id;
  return (
    <>
      <InlinePhase
        phase={phase}
        error={inventory.error}
        loadingMessage="Loading queue bindings…"
        emptyMessage="The live deployment has no queue bindings."
        onRetry={() => void inventory.refetch()}
      />
      {phase === 'ready' && (
        <>
          <ul
            aria-label="Queue bindings"
            className="divide-y divide-border rounded-lg border border-border"
          >
            {rows.map((item) => (
              <CanaryRow
                key={`${item.name}:${item.binding}:${item.scope}`}
                slug={slug}
                item={item}
                deployment={deployment}
              />
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            The consumer must handle the reserved gregale_queue_canary message safely. Each canary
            expires after {QUEUE_CANARY_MAX_TTL_SECONDS / 60} minutes.
          </p>
        </>
      )}
    </>
  );
}

function CanaryRow({
  slug,
  item,
  deployment,
}: {
  slug: string;
  item: BindingInventoryItem;
  deployment?: string;
}) {
  const { account } = useAuth();
  const accountId = account?.id ?? '';
  const client = useQueryClient();
  const confirm = useConfirm();
  const [tracked, setTracked] = useState('');
  const [failure, setFailure] = useState('');
  // The inventory is a snapshot: a canary it reports in flight (say, after a
  // reload) is read directly and polled until it settles, like one published here.
  const fromInventory = active(item.queue_canary) ? (item.queue_canary?.id ?? '') : '';
  const watched = tracked || fromInventory;
  const live = useQueueCanary(accountId, slug, watched, true);
  const canary = (watched ? live.data : undefined) ?? item.queue_canary;
  const settle = (next: QueueCanary) => {
    client.setQueryData(queueCanaryKey(accountId, slug, next.id), next);
    setTracked(next.id);
    setFailure('');
    void client.invalidateQueries({ queryKey: bindingInventoryKey(accountId, slug) });
  };
  const publish = useMutation({
    mutationFn: () =>
      createQueueCanary(slug, {
        deployment_id: deployment ?? '',
        binding: item.binding,
        ttl_seconds: QUEUE_CANARY_MAX_TTL_SECONDS,
      }),
    onSuccess: settle,
    onError: (error) => setFailure(explain(error)),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => cancelQueueCanary(slug, id),
    onSuccess: settle,
    onError: (error) => setFailure(explain(error)),
  });

  async function requestPublish() {
    const ok = await confirm({
      title: `Publish one canary message to ${item.binding}?`,
      description:
        'The message goes through this push queue binding to the live deployment’s consumer, which must handle it safely. It uses normal queue capacity and changes no traffic.',
      confirmLabel: 'Publish',
    });
    if (ok) publish.mutate();
  }
  async function requestCancel(id: string) {
    const ok = await confirm({
      title: `Cancel the canary on ${item.binding}?`,
      description:
        'Cancelling revokes its evidence, even if the handler is still finishing. A release requiring handler completion then needs a new canary.',
      confirmLabel: 'Cancel canary',
      destructive: true,
    });
    if (ok) cancel.mutate(id);
  }

  const busy = publish.isPending || cancel.isPending;
  return (
    <li className="space-y-1 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="min-w-0 break-all font-mono">{item.binding || item.name}</span>
          <span className="text-xs text-muted-foreground">
            {item.access} · consumer {item.runtime_status}
          </span>
          {canary && (
            <Badge variant={canary.status === 'succeeded' ? 'default' : 'outline'}>
              {STATUS[canary.status]}
            </Badge>
          )}
        </div>
        <div className="flex gap-2">
          {canary && active(canary) && (
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => void requestCancel(canary.id)}
            >
              Cancel canary
            </Button>
          )}
          {item.queue_canary_supported && !active(canary) && deployment && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void requestPublish()}
            >
              Publish canary
            </Button>
          )}
        </div>
      </div>
      {canary ? (
        <p className="text-xs text-muted-foreground">{detail(canary)}</p>
      ) : (
        <p className="text-xs text-muted-foreground">No canary for this deployment yet.</p>
      )}
      {!item.queue_canary_supported && (
        <p className="text-xs text-muted-foreground">
          Canaries cannot be published here:{' '}
          <span className="font-mono">{item.queue_canary_reason ?? 'not supported'}</span>
        </p>
      )}
      {failure && (
        <p role="alert" className="text-xs" style={{ color: 'var(--status-critical)' }}>
          {failure}
        </p>
      )}
    </li>
  );
}
