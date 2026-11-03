import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { FIELD } from '@/components/ui/field';
import { Timestamp } from '@/components/ui/timestamp';
import { useToast } from '@/components/ui/toast';
import {
  useDebugRegressionAction,
  useDebugRegressionReview,
  type DebugRegressionAction,
  type DebugRegressionReview,
} from '@/lib/api/debug';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { cn } from '@/lib/utils';
import { InlinePhase, queryPhase } from './primitives';
import { RegressionState } from './debug-regression-state';

/*
 * Regression review (faas capability `debug-regressions`, beta): read the
 * exact, versioned observation (GET .../debug/regressions/review) and apply a
 * checked action against that version (POST .../debug/regressions/actions,
 * handlers_debug_regression_lifecycle.go). apid refuses a stale version with
 * 409 `regression_changed`, so the console re-reads rather than retrying.
 * Triage is workflow metadata: it never changes traffic or proves health.
 */

/** Which actions make sense from each stored state; apid accepts any of the four. */
const ACTIONS: Record<DebugRegressionReview['state'], DebugRegressionAction[]> = {
  active: ['acknowledge', 'dismiss', 'resolve'],
  acknowledged: ['dismiss', 'resolve', 'reopen'],
  dismissed: ['resolve', 'reopen'],
  resolved: ['reopen'],
};
const LABELS: Record<DebugRegressionAction, string> = {
  acknowledge: 'Acknowledge',
  dismiss: 'Dismiss',
  resolve: 'Resolve',
  reopen: 'Reopen',
};
const DONE: Record<DebugRegressionAction, string> = {
  acknowledge: 'Regression acknowledged',
  dismiss: 'Regression dismissed',
  resolve: 'Regression resolved',
  reopen: 'Regression reopened',
};

/** apid caps a dismissal at 30 days from its own clock; leave room for skew. */
const DISMISS_FOR = [
  ['1d', 'for a day', 24 * 3600_000],
  ['7d', 'for a week', 7 * 24 * 3600_000],
  ['30d', 'for 30 days', 30 * 24 * 3600_000 - 10 * 60_000],
] as const;
type DismissFor = (typeof DISMISS_FOR)[number][0];

/** An absolute expiry, read from the clock when the action is taken. */
const fromNow = (ms: number) => new Date(Date.now() + ms).toISOString();

export function RegressionTriage({
  slug,
  deploymentId,
  route,
}: {
  slug: string;
  deploymentId: string;
  route: string;
}) {
  const review = useDebugRegressionReview(slug, deploymentId, route);
  const action = useDebugRegressionAction(slug);
  const { toast } = useToast();
  const [reason, setReason] = useState('');
  const [dismissFor, setDismissFor] = useState<DismissFor>('1d');
  const [changed, setChanged] = useState(false);
  const phase = queryPhase({ error: review.error, loading: review.isPending });
  const data = review.data;
  const trimmed = reason.trim();

  const apply = async (kind: DebugRegressionAction) => {
    if (!data || !trimmed) return;
    setChanged(false);
    const ms = DISMISS_FOR.find(([key]) => key === dismissFor)![2];
    try {
      await action.mutateAsync({
        deployment_id: data.deployment_id,
        route: data.route,
        action: kind,
        expected_app_id: data.app_id,
        expected_version: data.version,
        reason: trimmed,
        ...(kind === 'dismiss' ? { dismissed_until: fromNow(ms) } : {}),
      });
      setReason('');
      toast({ kind: 'success', title: DONE[kind], description: route });
      void review.refetch();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'regression_changed') {
        setChanged(true);
        void review.refetch();
        return;
      }
      toast({ kind: 'error', title: `Could not ${LABELS[kind].toLowerCase()}`, error: err });
    }
  };

  return (
    <section aria-label="Triage" className="flex flex-col gap-3 border-t border-border pt-4">
      <h4 className="text-sm font-medium">Triage</h4>
      {phase !== 'ready' || !data ? (
        <InlinePhase
          phase={phase}
          error={review.error}
          loadingMessage="Reading the triage record…"
          onRetry={() => void review.refetch()}
        />
      ) : (
        <>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <RegressionState state={data.state} />
            {data.acknowledged_at && (
              <span>
                acknowledged <Timestamp value={data.acknowledged_at} />
              </span>
            )}
            {data.state === 'dismissed' && data.dismissed_until && (
              <span>
                dismissed until <Timestamp value={data.dismissed_until} mode="absolute" />
              </span>
            )}
            {data.resolved_at && (
              <span>
                resolved <Timestamp value={data.resolved_at} />
              </span>
            )}
          </p>
          {changed && (
            <p role="alert" className="text-xs" style={{ color: 'var(--status-warning)' }}>
              This regression changed after you opened it, so nothing was applied. Its current state
              is above; choose again.
            </p>
          )}
          <label className="flex flex-col gap-1.5 text-xs font-medium">
            Reason
            <textarea
              value={reason}
              maxLength={280}
              rows={2}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why, for whoever reads the audit log next"
              className={cn(FIELD, 'h-auto resize-y py-2 font-normal')}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {ACTIONS[data.state].map((kind) =>
              kind === 'dismiss' ? (
                <span key={kind} className="flex items-center gap-1.5">
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={!trimmed || action.isPending}
                    onClick={() => void apply(kind)}
                  >
                    {LABELS[kind]}
                  </Button>
                  <select
                    aria-label="Dismiss for"
                    value={dismissFor}
                    onChange={(event) => setDismissFor(event.target.value as DismissFor)}
                    className="h-7 rounded-md border border-border bg-background px-2 text-xs"
                  >
                    {DISMISS_FOR.map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </span>
              ) : (
                <Button
                  key={kind}
                  size="xs"
                  variant="outline"
                  disabled={!trimmed || action.isPending}
                  onClick={() => void apply(kind)}
                >
                  {LABELS[kind]}
                </Button>
              )
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            A reason is required and goes to the audit log. Triage changes how this regression is
            filed, not traffic. A dismissed regression leaves the list until the dismissal ends, a
            resolved one until the detector sees it again.
          </p>
          {action.error && !(action.error instanceof ApiError) && (
            <p className="text-xs" style={{ color: 'var(--status-critical)' }}>
              {errorMessage(action.error)}
            </p>
          )}
        </>
      )}
    </section>
  );
}
