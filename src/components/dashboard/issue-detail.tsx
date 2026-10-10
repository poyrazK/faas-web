import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  actOnIssue,
  issueDetailKey,
  useIssueDeployments,
  useIssueDetail,
  useIssueHistory,
  type IssueHistoryKind,
} from '@/lib/api/issues';

type Props = { accountId: string; slug: string; issueId: string; onBack: () => void };

function History({
  accountId,
  slug,
  issueId,
  kind,
  since,
  first,
  initial,
}: Props & {
  kind: IssueHistoryKind;
  since: string;
  first: string | undefined;
  initial: { id: string; text: string }[];
}) {
  const continuation = useIssueHistory(accountId, slug, issueId, kind, since, first ?? '');
  const later =
    continuation.data?.pages.flatMap((page) =>
      kind === 'events'
        ? page.events.map((event) => ({
            id: event.id ?? `${event.deployment_id}-${event.received_at}`,
            text: `${event.id ?? 'Event'} · ${event.attribution} · ${event.deployment_id}`,
          }))
        : kind === 'releases'
          ? page.releases.map((release) => ({
              id: release.deployment_id,
              text: `${release.deployment_id} · ${release.event_count} retained events`,
            }))
          : page.activity.map((activity) => ({
              id: activity.id,
              text: `${activity.action} · ${activity.created_at}`,
            }))
    ) ?? [];
  const rows = [...initial, ...later];
  return (
    <section className="min-w-0 space-y-2">
      <h4 className="text-sm font-semibold capitalize">{kind}</h4>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No retained {kind} in this window.</p>
      ) : (
        <ul className="divide-y divide-border rounded border border-border text-xs">
          {rows.map((row) => (
            <li key={row.id} className="break-all p-2">
              {row.text}
            </li>
          ))}
        </ul>
      )}
      {Boolean(first && continuation.error) && (
        <p role="alert">
          Could not load older {kind}.{' '}
          <Button variant="outline" onClick={() => void continuation.refetch()}>
            Retry
          </Button>
        </p>
      )}
      {first && continuation.hasNextPage && (
        <Button
          variant="outline"
          disabled={continuation.isFetchingNextPage}
          onClick={() => void continuation.fetchNextPage()}
        >
          Load more {kind}
        </Button>
      )}
    </section>
  );
}

export function IssueDetail({ accountId, slug, issueId, onBack }: Props) {
  const detail = useIssueDetail(accountId, slug, issueId);
  const deployments = useIssueDeployments(accountId, slug);
  const cache = useQueryClient();
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [fixDeployment, setFixDeployment] = useState('');
  const [ignoreHours, setIgnoreHours] = useState(24);
  const context = useRef(`${accountId}/${slug}/${issueId}`);
  useEffect(() => {
    return () => {
      context.current = '';
    };
  }, []);

  const issue = detail.data?.issue;
  const deploymentRows = deployments.data?.pages.flatMap((page) => page.items) ?? [];
  async function submit(action: 'reopen' | 'ignore' | 'assign' | 'resolve', assignee?: string) {
    if (!issue || pending || uncertain) return;
    if (action === 'resolve' && !deploymentRows.some((row) => row.id === fixDeployment)) return;
    if (
      action === 'ignore' &&
      (!Number.isInteger(ignoreHours) || ignoreHours < 1 || ignoreHours > 2160)
    )
      return;
    const expected = `${accountId}/${slug}/${issueId}`;
    const key = crypto.randomUUID();
    setPending(true);
    setActionError('');
    try {
      await actOnIssue(
        slug,
        issueId,
        {
          action,
          ...(assignee ? { assignee_account_id: assignee } : {}),
          ...(action === 'resolve' ? { fixed_deployment_id: fixDeployment } : {}),
          ...(action === 'ignore'
            ? { ignored_until: new Date(Date.now() + ignoreHours * 60 * 60 * 1000).toISOString() }
            : {}),
        },
        key
      );
      if (context.current !== expected) return;
      await Promise.all([
        cache.invalidateQueries({ queryKey: issueDetailKey(accountId, slug, issueId) }),
        cache.invalidateQueries({ queryKey: ['account', accountId, 'app', slug, 'issues'] }),
      ]);
    } catch (error) {
      if (context.current !== expected) return;
      setUncertain(true);
      setActionError(error instanceof Error ? error.message : 'Action outcome is uncertain.');
    } finally {
      if (context.current === expected) setPending(false);
    }
  }

  return (
    <article className="min-w-0 space-y-5">
      <Button variant="outline" onClick={onBack}>
        Back to issues
      </Button>
      {detail.isPending ? (
        <p role="status">Loading issue…</p>
      ) : detail.error ? (
        <p role="alert">
          Could not load this issue.{' '}
          <Button variant="outline" onClick={() => void detail.refetch()}>
            Retry
          </Button>
        </p>
      ) : !issue ? (
        <p>Issue not found.</p>
      ) : (
        <>
          <header>
            <h3 className="text-lg font-semibold">{issue.title}</h3>
            <p className="text-sm text-muted-foreground">
              {issue.environment} · {issue.state} · {issue.event_count} retained events ·{' '}
              {issue.regression_count} recurrences
            </p>
            {issue.fixed_deployment_id && (
              <p className="text-xs text-muted-foreground">
                Recorded fix deployment:{' '}
                <span className="font-mono">{issue.fixed_deployment_id}</span>
              </p>
            )}
          </header>
          {detail.data && (
            <div className="rounded border border-border bg-card p-3 text-sm">
              <p>
                {detail.data.impact.identified_customers} verified customers ·{' '}
                {detail.data.impact.observed_events} retained events ·{' '}
                {detail.data.impact.unattributed_events} unattributed events
              </p>
              <p className="text-xs text-muted-foreground">
                Observed from {new Date(detail.data.impact.window_start).toLocaleString()} to{' '}
                {new Date(detail.data.impact.window_end).toLocaleString()}. Impact reflects
                retained, verified attribution only and may omit unreported failures.
              </p>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {issue.state !== 'open' && (
              <Button
                variant="outline"
                disabled={pending || uncertain}
                onClick={() => void submit('reopen')}
              >
                Reopen issue
              </Button>
            )}
            {issue.state !== 'ignored' && (
              <label className="flex items-center gap-2 text-xs">
                Ignore for hours
                <input
                  aria-label="Ignore for hours"
                  type="number"
                  min={1}
                  max={2160}
                  value={ignoreHours}
                  onChange={(event) => setIgnoreHours(Number(event.target.value))}
                  className="w-20 rounded border border-border bg-background p-1"
                />
                <Button
                  variant="outline"
                  disabled={pending || uncertain}
                  onClick={() => void submit('ignore')}
                >
                  Ignore issue
                </Button>
              </label>
            )}
            {issue.assignee_account_id !== accountId && (
              <Button
                variant="outline"
                disabled={pending || uncertain}
                onClick={() => void submit('assign', accountId)}
              >
                Assign to me
              </Button>
            )}
            {issue.assignee_account_id && (
              <Button
                variant="outline"
                disabled={pending || uncertain}
                onClick={() => void submit('assign')}
              >
                Unassign
              </Button>
            )}
          </div>
          {issue.state === 'open' && (
            <div className="flex flex-wrap items-end gap-2 text-xs">
              <label className="flex flex-col gap-1">
                Deployment containing the fix
                <select
                  aria-label="Fix deployment"
                  value={fixDeployment}
                  onChange={(event) => setFixDeployment(event.target.value)}
                  className="max-w-64 rounded border border-border bg-background p-1 font-mono"
                >
                  <option value="">Choose an app deployment</option>
                  {deploymentRows.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.id} · {row.status}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                variant="outline"
                disabled={pending || uncertain || !fixDeployment || Boolean(deployments.error)}
                onClick={() => void submit('resolve')}
              >
                Resolve with deployment
              </Button>
              {deployments.hasNextPage && (
                <Button variant="outline" onClick={() => void deployments.fetchNextPage()}>
                  Older deployments
                </Button>
              )}
            </div>
          )}
          {actionError && (
            <p role="alert">{actionError} Review the current issue before any new action.</p>
          )}
          {uncertain && (
            <Button
              variant="outline"
              onClick={async () => {
                const refreshed = await detail.refetch();
                if (refreshed.isSuccess) {
                  setUncertain(false);
                  setActionError('');
                }
              }}
            >
              Refresh issue state
            </Button>
          )}
          {detail.data && (
            <div className="grid gap-5 lg:grid-cols-3">
              <History
                accountId={accountId}
                slug={slug}
                issueId={issueId}
                onBack={onBack}
                kind="events"
                since={detail.data.impact.window_start}
                first={detail.data.next_event_cursor}
                initial={detail.data.events.map((event) => ({
                  id: event.id ?? `${event.deployment_id}-${event.received_at}`,
                  text: `${event.id ?? 'Event'} · ${event.attribution} · ${event.deployment_id}`,
                }))}
              />
              <History
                accountId={accountId}
                slug={slug}
                issueId={issueId}
                onBack={onBack}
                kind="releases"
                since={detail.data.impact.window_start}
                first={detail.data.next_release_cursor}
                initial={detail.data.releases.map((release) => ({
                  id: release.deployment_id,
                  text: `${release.deployment_id} · ${release.event_count} retained events`,
                }))}
              />
              <History
                accountId={accountId}
                slug={slug}
                issueId={issueId}
                onBack={onBack}
                kind="activity"
                since={detail.data.impact.window_start}
                first={detail.data.next_activity_cursor}
                initial={detail.data.activity.map((activity) => ({
                  id: activity.id,
                  text: `${activity.action} · ${activity.created_at}`,
                }))}
              />
            </div>
          )}
        </>
      )}
    </article>
  );
}
