import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useJoinPreview, useLeavePreview, usePreviews, type Preview } from '@/lib/api/previews';
import { useWorkspaceTarget } from '@/lib/api/workspace-apps';
import { InlinePhase, Panel, queryPhase } from './primitives';

/** A refusal in the API's own terms (faas ADR-20261021080640). */
function explain(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'preview_full') return 'This preview is full.';
    if (err.code === 'preview_plan_not_eligible') return 'Not available on your plan.';
    if (err.code === 'preview_not_offered') return 'This preview is no longer offered.';
  }
  return errorMessage(err);
}

/**
 * Self-serve platform previews: capabilities that are off by default and that
 * the workspace may turn on. Joining one makes its pages appear; leaving hides
 * them for everyone in the workspace.
 */
export function PreviewsSettings() {
  const { org, label } = useWorkspaceTarget();
  const previews = usePreviews();
  const items = previews.data?.items ?? [];
  const phase = queryPhase({
    loading: previews.isPending,
    error: previews.error,
    isEmpty: items.length === 0,
  });
  return (
    <Panel
      title={org ? `Previews for ${label}` : 'Previews'}
      description="Features that are off by default. Joining one turns it on for this workspace; it may change before general availability."
    >
      <InlinePhase
        phase={phase}
        error={previews.error}
        emptyMessage="No previews are open to join right now."
        onRetry={() => void previews.refetch()}
      />
      {phase === 'ready' && (
        <ul className="flex flex-col divide-y divide-border">
          {items.map((preview) => (
            <PreviewRow key={preview.key} preview={preview} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function PreviewRow({ preview }: { preview: Preview }) {
  const confirm = useConfirm();
  const join = useJoinPreview();
  const leave = useLeavePreview();
  const [error, setError] = useState<string | null>(null);
  const busy = join.isPending || leave.isPending;

  const onJoin = () => {
    setError(null);
    join.mutate(preview.key, { onError: (err) => setError(explain(err)) });
  };
  const onLeave = async () => {
    const ok = await confirm({
      title: `Leave ${preview.label}?`,
      description:
        'Pages and commands for this preview disappear for everyone in this workspace until you join again.',
      confirmLabel: 'Leave preview',
      destructive: true,
    });
    if (!ok) return;
    setError(null);
    leave.mutate(preview.key, { onError: (err) => setError(explain(err)) });
  };

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
          {preview.label}
          {preview.joined && (
            <span className="rounded-full border border-border px-2 py-0.5 text-xs font-normal text-muted-foreground">
              Joined
            </span>
          )}
        </p>
        <p className="text-sm text-muted-foreground">{preview.description}</p>
        {preview.retire_by && (
          <p className="text-xs text-muted-foreground">
            Ends {new Date(preview.retire_by).toLocaleDateString()}
          </p>
        )}
        {!preview.joined && !preview.eligible && (
          <p className="text-xs text-muted-foreground">Not available on your plan</p>
        )}
        {error && (
          <p role="alert" className="text-xs text-[color:var(--status-critical)]">
            {error}
          </p>
        )}
      </div>
      {preview.joined ? (
        <Button
          size="sm"
          variant="outline"
          busy={leave.isPending}
          disabled={busy}
          onClick={onLeave}
        >
          Leave
        </Button>
      ) : (
        <Button
          size="sm"
          busy={join.isPending}
          disabled={busy || !preview.eligible}
          onClick={onJoin}
        >
          Join
        </Button>
      )}
    </li>
  );
}
