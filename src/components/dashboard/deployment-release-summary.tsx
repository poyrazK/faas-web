import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useDeploymentSummary, useRollback, type DeploymentSummary } from '@/lib/api/queries';
import { InlinePhase, queryPhase } from './primitives';

type ChangeValue = DeploymentSummary['changes'][number]['before'];

function formatValue(value: ChangeValue): string {
  if (value == null || value === '') return '—';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'not_found';
}

/**
 * Customer-facing release context for one deployment. The API owns the
 * predecessor and rollback eligibility so the browser never guesses which
 * version is safe to restore.
 */
export function DeploymentReleaseSummary({
  appSlug,
  deploymentId,
}: {
  appSlug: string;
  deploymentId: string;
}) {
  const summary = useDeploymentSummary(appSlug, deploymentId);
  const rollback = useRollback();
  const confirm = useConfirm();
  const { toast } = useToast();
  const phase = queryPhase({ error: summary.error, loading: summary.isPending });
  const targetId = summary.data?.rollback_target_id ?? undefined;

  const onRollback = async () => {
    if (!targetId) return;
    if (
      !(await confirm({
        title: 'Roll back this app?',
        description: `The platform will queue a new deployment from superseded release ${targetId}. The current release remains in history.`,
        confirmLabel: 'Roll back',
        destructive: true,
      }))
    )
      return;

    try {
      const result = await rollback.mutateAsync({
        slug: appSlug,
        targetDeploymentId: targetId,
      });
      void summary.refetch();
      toast({
        kind: 'success',
        title: 'Rollback queued',
        description: `New deployment ${result.id.slice(0, 12)} is being prepared.`,
      });
    } catch (err) {
      toast({ kind: 'error', title: 'Could not roll back', description: errorMessage(err) });
    }
  };

  let body: React.ReactNode;
  if (phase === 'loading') {
    body = <InlinePhase phase={phase} loadingMessage="Reading release history…" />;
  } else if (phase === 'unreachable') {
    body = <InlinePhase phase={phase} error={summary.error} />;
  } else if (phase === 'error') {
    body = isNotFound(summary.error) ? (
      <p className="text-sm text-muted-foreground">
        This deployment is not available for the selected app.
      </p>
    ) : (
      <InlinePhase phase={phase} error={summary.error} />
    );
  } else if (!summary.data) {
    body = <p className="text-sm text-muted-foreground">No release summary is available yet.</p>;
  } else {
    body = <SummaryBody summary={summary.data} />;
  }

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="label-mono text-muted-foreground">Release summary</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Current release compared with its immediate predecessor.
          </p>
        </div>
        {targetId && (
          <Button
            size="xs"
            variant="destructive"
            busy={rollback.isPending}
            onClick={() => void onRollback()}
          >
            Roll back to {targetId.slice(0, 8)}
          </Button>
        )}
      </div>
      <div className="mt-4">{body}</div>
    </div>
  );
}

function SummaryBody({ summary }: { summary: DeploymentSummary }) {
  const previous = summary.previous ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <ReleaseRef label="Current" id={summary.deployment.id} />
        <ReleaseRef label="Previous" id={previous?.id} emptyLabel="Initial release" />
      </div>

      {summary.changes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No non-secret release fields changed.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[34rem] text-left text-xs">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Field
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Before
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  After
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {summary.changes.map((change) => (
                <tr key={change.field}>
                  <th scope="row" className="px-3 py-2 font-mono font-normal">
                    {change.field}
                  </th>
                  <td className="max-w-[16rem] truncate px-3 py-2 font-mono text-muted-foreground">
                    {formatValue(change.before)}
                  </td>
                  <td className="max-w-[16rem] truncate px-3 py-2 font-mono">
                    {formatValue(change.after)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ReleaseRef({
  label,
  id,
  emptyLabel = '—',
}: {
  label: string;
  id?: string;
  emptyLabel?: string;
}) {
  return (
    <div className="min-w-0 rounded-md bg-muted px-3 py-2">
      <p className="label-mono text-muted-foreground">{label}</p>
      <p className="mt-1 truncate font-mono text-xs" title={id ?? emptyLabel}>
        {id ?? emptyLabel}
      </p>
    </div>
  );
}
