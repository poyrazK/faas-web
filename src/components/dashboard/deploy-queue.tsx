import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { Timestamp } from '@/components/ui/timestamp';
import { useToast } from '@/components/ui/toast';
import { useCapabilityAccess, useCapabilityStage } from '@/lib/api/capabilities';
import { QUEUE_WINDOW, useDeployQueue } from '@/lib/api/deploy-queue';
import { ApiError } from '@/lib/api/errors';
import {
  useApps,
  useCancelDeployment,
  useReorderDeployment,
  type Deployment,
} from '@/lib/api/queries';
import { InlinePhase, Panel, queryPhase } from './primitives';
import { ReleaseStatusLabel } from './release-status-label';
import { Pill } from './resource-table';
import { inScope } from '@/lib/project-scope';
import { scopedIn, type ScopeGate } from './scope-gate';

/** The three points of faas's priority scale (ADR-124): 0 first, 100 FIFO, 1000 last. */
const PRIORITY = {
  0: { action: 'Deploy now', state: 'Deploys next', done: 'Deploys next' },
  100: { action: 'In turn', state: 'In turn', done: 'Back in turn' },
  1000: { action: 'Background', state: 'Waits for everything else', done: 'Moved to background' },
} as const;
type Priority = keyof typeof PRIORITY;
const PRIORITIES: Priority[] = [0, 100, 1000];

const ACCESS_NOTE: Partial<Record<string, string>> = {
  'plan-not-entitled': 'Reordering needs the Hobby plan or higher. Cancel works on every plan.',
  off: 'Reordering is not enabled for this account. Cancel still works.',
  'runtime-unavailable': 'Reordering is unavailable on this installation. Cancel still works.',
  'registry-error': 'Could not check whether reordering is available.',
};

const ref = (d: Deployment) => (d.revision ? `v${d.revision}` : d.id.slice(0, 8));

/**
 * Queue controls (faas ADR-124) on Releases: every deployment still waiting to
 * build or building, with deploy now / background / in turn for one the
 * builder has not claimed (POST /v1/deployments/{id}/reorder, pending only,
 * plan-gated by `deploy-queue-controls`) and cancel for any of them (POST
 * /v1/apps/{slug}/deployments/{id}/cancel, every plan). The API never echoes
 * a deployment's priority on reads, so the list is in creation order and a
 * priority is shown only once this page has set it.
 */
export function DeployQueue({
  onOpen,
  scope,
}: {
  onOpen: (deploymentId: string) => void;
  /** Inside a project, only its apps' deployments; the queue is still the account's. */
  scope?: ScopeGate;
}) {
  const queue = useDeployQueue();
  const apps = useApps();
  const { access, refresh } = useCapabilityAccess('deploy-queue-controls');
  const stage = useCapabilityStage('deploy-queue-controls');
  const reorder = useReorderDeployment();
  const cancel = useCancelDeployment();
  const confirm = useConfirm();
  const { toast } = useToast();
  const [priorities, setPriorities] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const slugOf = (d: Deployment) => apps.data?.find((a) => a.id === d.app_id)?.slug;
  const scoped = scope?.scope.project ? scope : undefined;
  // A queued deployment is placed by its app's slug, so a scoped queue waits
  // for the app list and project membership rather than showing every app's.
  const rows = scoped
    ? inScope(queue.data ?? [], scoped.scope, (d) => slugOf(d) ?? '')
    : (queue.data ?? []);
  const phase = queryPhase({
    error: queue.error ?? (scoped ? (scoped.error ?? apps.error) : undefined),
    loading: queue.isPending || Boolean(scoped && (scoped.pending || apps.isPending)),
    isEmpty: rows.length === 0,
  });

  const onReorder = async (d: Deployment, priority: Priority) => {
    setBusy(d.id);
    try {
      const result = await reorder.mutateAsync({ id: d.id, priority });
      const set = (result.priority ?? priority) as Priority;
      setPriorities((current) => ({ ...current, [d.id]: set }));
      toast({
        kind: 'success',
        title: `${ref(d)}: ${PRIORITY[set]?.done ?? `priority ${set}`}`,
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'deployment_reorder_not_pending')
        toast({
          kind: 'info',
          title: 'Already left the queue',
          description: 'The builder picked it up first; it can still be cancelled.',
        });
      else if (err instanceof ApiError && err.code === 'plan_reorder_disabled')
        toast({
          kind: 'info',
          title: 'Not on your plan',
          description: 'Queue controls need the Hobby plan or higher.',
        });
      else toast({ kind: 'error', title: 'Could not reorder', error: err });
    } finally {
      setBusy(null);
    }
  };

  const onCancel = async (d: Deployment, slug: string) => {
    const approved = await confirm({
      title: `Cancel ${slug} ${ref(d)}?`,
      description:
        'It stops before it serves, and any build it started is cancelled too. The live release keeps serving.',
      confirmLabel: 'Cancel deployment',
      destructive: true,
    });
    if (!approved) return;
    setBusy(d.id);
    try {
      await cancel.mutateAsync({ slug, id: d.id });
      toast({ kind: 'success', title: `${slug} ${ref(d)} cancelled` });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'deployment_cancel_live_forbidden')
        toast({
          kind: 'info',
          title: 'Already live',
          description: 'It went live first. Roll back to the previous release instead.',
        });
      else if (err instanceof ApiError && err.code === 'deployment_cancel_not_cancellable')
        toast({
          kind: 'info',
          title: 'Already finished',
          description: 'It left the queue before the cancel arrived.',
        });
      else toast({ kind: 'error', title: 'Could not cancel', error: err });
    } finally {
      setBusy(null);
    }
  };

  const note = ACCESS_NOTE[access];
  return (
    <section aria-label="Deploy queue">
      <Panel
        title="Deploy queue"
        help="Waiting to build or building, oldest first. Deploy now moves a waiting release ahead; Background lets the rest go first."
        actions={stage && <Pill label={stage} />}
        padded={false}
      >
        {phase !== 'ready' ? (
          <div className="p-5">
            <InlinePhase
              phase={phase}
              error={queue.error}
              loadingMessage="Reading the queue…"
              emptyMessage={
                scoped
                  ? `Nothing ${scopedIn(scoped.scope)} is waiting to deploy.`
                  : 'Nothing is waiting to deploy.'
              }
              onRetry={() => {
                if (scoped?.error) scoped.retry();
                if (scoped && apps.error) void apps.refetch();
                void queue.refetch();
              }}
            />
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((d) => {
              const slug = slugOf(d);
              const known = priorities[d.id] as Priority | undefined;
              const pending = d.status.toLowerCase() === 'pending';
              const locked = busy === d.id;
              return (
                <li
                  key={d.id}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3"
                >
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-x-2 text-sm">
                      <span className="truncate font-medium">{slug ?? d.app_id.slice(0, 8)}</span>
                      <button
                        type="button"
                        onClick={() => onOpen(d.id)}
                        aria-label={`Open release ${ref(d)}`}
                        className="font-mono text-xs text-brand underline-offset-4 hover:underline"
                      >
                        {ref(d)}
                      </button>
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <ReleaseStatusLabel status={d.status} compact />
                      <Timestamp value={d.created_at} />
                      {pending && known !== undefined && PRIORITY[known] && (
                        <span>{PRIORITY[known].state}</span>
                      )}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {pending &&
                      access === 'on' &&
                      PRIORITIES.filter((p) => p !== (known ?? 100)).map((p) => (
                        <Button
                          key={p}
                          size="xs"
                          variant="outline"
                          disabled={locked}
                          onClick={() => void onReorder(d, p)}
                        >
                          {PRIORITY[p].action}
                        </Button>
                      ))}
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={locked || !slug}
                      title={slug ? undefined : 'The app for this deployment is not loaded yet.'}
                      onClick={() => slug && void onCancel(d, slug)}
                    >
                      Cancel
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex flex-col gap-1 border-t border-border px-5 py-3 text-xs text-muted-foreground">
          {note && (
            <p className="flex flex-wrap items-center gap-x-3">
              <span>{note}</span>
              {access === 'plan-not-entitled' && (
                <a className="text-brand underline" href="/dashboard/plans">
                  View plans
                </a>
              )}
              {access === 'registry-error' && (
                <button type="button" className="text-brand underline" onClick={refresh}>
                  Retry
                </button>
              )}
            </p>
          )}
          <p>
            From the account’s {QUEUE_WINDOW} newest deployments. The API does not report a
            deployment’s priority, so one set elsewhere is not shown here.
          </p>
        </div>
      </Panel>
    </section>
  );
}
