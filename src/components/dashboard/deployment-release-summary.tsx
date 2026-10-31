import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/errors';
import { useDeploymentSummary, type DeploymentSummary } from '@/lib/api/queries';
import { InlinePhase, queryPhase } from './primitives';
import { RollbackStatus, useRollbackFlow } from './rollback-status';

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
  // The drawer's own rollback flow: confirmation, cross-release check, status.
  const rollback = useRollbackFlow(appSlug);
  const phase = queryPhase({ error: summary.error, loading: summary.isPending });
  const targetId = summary.data?.rollback_target_id ?? undefined;
  const targetRevision = summary.data?.rollback_target_revision;
  const targetLabel = targetRevision ? `v${targetRevision}` : targetId?.slice(0, 8);
  // A superseded release carries its own "Roll back to vN" in the drawer.
  const offerRollback = summary.data?.deployment.status.toLowerCase() !== 'superseded';

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
            Selected release compared with its immediate predecessor.
          </p>
        </div>
        {targetId && (
          <div className="flex max-w-sm flex-col items-start gap-2 sm:items-end">
            <div className="text-left sm:text-right">
              <p className="label-mono text-muted-foreground">Eligible rollback target</p>
              <p className="mt-1 break-all font-mono text-xs">{targetId}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                The platform determines this target from the app&apos;s current release state; it
                may differ from the selected release above.
              </p>
            </div>
            {offerRollback && targetLabel && (
              <Button
                size="xs"
                variant="destructive"
                busy={rollback.isPending}
                onClick={() => void rollback.start(targetId, targetLabel)}
              >
                Roll back to {targetLabel}
              </Button>
            )}
          </div>
        )}
      </div>
      {rollback.operation && (
        <div className="mt-3">
          <RollbackStatus
            slug={appSlug}
            operation={rollback.operation}
            targetLabel={rollback.operationLabel}
          />
        </div>
      )}
      <div className="mt-4">{body}</div>
    </div>
  );
}

function SummaryBody({ summary }: { summary: DeploymentSummary }) {
  const previous = summary.previous ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <ReleaseRef label="Selected release" id={summary.deployment.id} />
        <ReleaseRef label="Previous to selected" id={previous?.id} emptyLabel="Initial release" />
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
