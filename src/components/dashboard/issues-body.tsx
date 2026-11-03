import { Button } from '@/components/ui/button';
import { useCapability, useCapabilityAccess } from '@/lib/api/capabilities';
import { useIssues, type IssueFilters } from '@/lib/api/issues';
import { CapabilityGate } from './capability-gate';
import { CapabilityNotice } from './capability-notice';
import { IssueAlertPolicies } from './issue-alert-policies';
import { IssueDetail } from './issue-detail';
import { IssueReportingSetup } from './issue-reporting-setup';
import { IssueSavedViews } from './issue-saved-views';
import { IssueSourceMaps } from './issue-source-maps';
import { IssueTrackerLinks, LinearConnectionPanel } from './issue-trackers';
import type { IssueSearch, IssueView } from './issues-search';

/**
 * The Issues tab's pages besides the inbox. Alert policies and Linear are
 * catalog children of `issues` (issue-alert-policies, issue-trackers) and are
 * offered only while the account has them; a deep link to one explains its
 * gate. Source maps sit on `issues` itself.
 */
const PAGES: { view: IssueView; label: string; capability?: string }[] = [
  { view: 'inbox', label: 'Inbox' },
  { view: 'alerts', label: 'Alert policies', capability: 'issue-alert-policies' },
  { view: 'sourcemaps', label: 'Source maps' },
  { view: 'linear', label: 'Linear', capability: 'issue-trackers' },
  { view: 'setup', label: 'Reporting setup' },
];

type Props = {
  accountId: string;
  slug: string;
  search: IssueSearch;
  onSearch: (changes: Partial<IssueSearch>) => void;
};

export function IssuesBody({ accountId, slug, search, onSearch }: Props) {
  const availability = useCapability('issues');
  const permitted = availability.accountId === accountId && availability.state === 'available';
  const alertsAccess = useCapabilityAccess('issue-alert-policies').access;
  const trackersAccess = useCapabilityAccess('issue-trackers').access;
  const viewsAccess = useCapabilityAccess('issue-saved-views').access;
  const offered = (capability?: string) =>
    !capability || (capability === 'issue-alert-policies' ? alertsAccess : trackersAccess) === 'on';
  const view = search.issueView ?? 'inbox';
  const filters: IssueFilters = {
    state: search.issueState,
    environment: search.issueEnvironment,
    assignee: search.issueTeam ? undefined : search.issueAssignee,
    sort: search.issueSort,
    min_customers: search.issueMinCustomers,
    ...(search.issueTag ? { tag: search.issueTag } : {}),
    ...(search.issueTeam ? { team: search.issueTeam } : {}),
  };
  const result = useIssues(permitted ? accountId : '', permitted ? slug : '', filters);
  const items = result.data?.pages.flatMap((page) => page.items) ?? [];
  const updateFilter = (changes: Partial<IssueSearch>) =>
    onSearch({ ...changes, issue: undefined });

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Issues</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Instrumented exceptions reported by your app or SDK. Automatic HTTP Errors are shown in
            their separate tab. Counts and impact cover retained, verified reports only; they do not
            establish complete coverage.
          </p>
        </div>
        <div role="group" aria-label="Issues pages" className="flex flex-wrap gap-2">
          {PAGES.filter((p) => offered(p.capability) || p.view === view).map((p) => (
            <Button
              key={p.view}
              variant={p.view === view ? 'secondary' : 'outline'}
              size="sm"
              aria-pressed={p.view === view}
              disabled={!permitted}
              onClick={() =>
                onSearch({ issueView: p.view === 'inbox' ? undefined : p.view, issue: undefined })
              }
            >
              {p.label}
            </Button>
          ))}
        </div>
      </div>
      <CapabilityNotice
        capability={availability.capability}
        state={availability.state}
        onRetry={availability.refresh}
      />
      {!permitted ? null : view === 'setup' ? (
        <IssueReportingSetup
          accountId={accountId}
          slug={slug}
          onClose={() => onSearch({ issueView: 'inbox' })}
        />
      ) : view === 'alerts' ? (
        <CapabilityGate capability="issue-alert-policies" title="Alert policies">
          <IssueAlertPolicies accountId={accountId} slug={slug} />
        </CapabilityGate>
      ) : view === 'sourcemaps' ? (
        <IssueSourceMaps accountId={accountId} slug={slug} />
      ) : view === 'linear' ? (
        <CapabilityGate capability="issue-trackers" title="Linear">
          <LinearConnectionPanel accountId={accountId} slug={slug} />
        </CapabilityGate>
      ) : search.issue ? (
        <div className="flex min-w-0 flex-col gap-5">
          <IssueDetail
            key={`${accountId}/${slug}/${search.issue}`}
            accountId={accountId}
            slug={slug}
            issueId={search.issue}
            onBack={() => onSearch({ issue: undefined })}
          />
          {trackersAccess === 'on' && (
            <IssueTrackerLinks
              key={`${accountId}/${slug}/${search.issue}/links`}
              accountId={accountId}
              slug={slug}
              issueId={search.issue}
            />
          )}
        </div>
      ) : (
        <>
          {viewsAccess === 'on' && (
            <IssueSavedViews
              accountId={accountId}
              slug={slug}
              search={search}
              onApply={(changes) => onSearch(changes)}
            />
          )}
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Issue state
              <select
                aria-label="Issue state"
                className="rounded border border-border bg-background px-2 py-1 text-sm text-foreground"
                value={search.issueState ?? ''}
                onChange={(event) =>
                  updateFilter({
                    issueState: (event.target.value as IssueSearch['issueState']) || undefined,
                  })
                }
              >
                <option value="">All states</option>
                <option value="open">Open</option>
                <option value="resolved">Resolved</option>
                <option value="ignored">Ignored</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Assignee
              <select
                aria-label="Assignee"
                className="rounded border border-border bg-background px-2 py-1 text-sm text-foreground"
                value={search.issueTeam ? '' : (search.issueAssignee ?? '')}
                disabled={Boolean(search.issueTeam)}
                onChange={(event) =>
                  updateFilter({ issueAssignee: event.target.value || undefined })
                }
              >
                <option value="">Everyone</option>
                <option value="me">Mine</option>
                <option value="unassigned">Unassigned</option>
                {search.issueAssignee &&
                  search.issueAssignee !== 'me' &&
                  search.issueAssignee !== 'unassigned' && (
                    <option value={search.issueAssignee}>
                      Account {search.issueAssignee.slice(0, 8)}
                    </option>
                  )}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Order
              <select
                aria-label="Issue order"
                className="rounded border border-border bg-background px-2 py-1 text-sm text-foreground"
                value={search.issueSort ?? 'recent'}
                onChange={(event) =>
                  updateFilter({ issueSort: event.target.value as IssueSearch['issueSort'] })
                }
              >
                <option value="recent">Most recent</option>
                <option value="impact">Observed impact</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Environment
              <input
                aria-label="Issue environment"
                className="rounded border border-border bg-background px-2 py-1 text-sm text-foreground"
                value={search.issueEnvironment ?? ''}
                onChange={(event) =>
                  updateFilter({ issueEnvironment: event.target.value || undefined })
                }
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Minimum verified customers
              <input
                aria-label="Minimum verified customers"
                type="number"
                min={0}
                max={10000}
                className="w-28 rounded border border-border bg-background px-2 py-1 text-sm text-foreground"
                value={search.issueMinCustomers ?? ''}
                onChange={(event) =>
                  updateFilter({
                    issueMinCustomers: event.target.value
                      ? Math.min(10000, Math.max(0, Number(event.target.value)))
                      : undefined,
                  })
                }
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Tag (key=value, 24 hours)
              <input
                aria-label="Issue tag"
                placeholder="route=/checkout"
                maxLength={193}
                className="rounded border border-border bg-background px-2 py-1 font-mono text-sm text-foreground"
                defaultValue={search.issueTag ?? ''}
                key={search.issueTag ?? ''}
                onBlur={(event) => {
                  const tag = event.target.value.trim();
                  if (tag !== (search.issueTag ?? '') && (!tag || tag.includes('=')))
                    updateFilter({ issueTag: tag || undefined });
                }}
              />
            </label>
            {search.issueTeam && (
              <p className="flex items-center gap-2 self-end text-xs">
                Team inbox <span className="font-mono">{search.issueTeam.slice(0, 8)}</span>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => updateFilter({ issueTeam: undefined })}
                >
                  Clear
                </Button>
              </p>
            )}
          </div>
          {result.isPending ? (
            <p role="status">Loading issues…</p>
          ) : result.error ? (
            <div role="alert">
              Could not load issues.{' '}
              <Button variant="outline" onClick={() => void result.refetch()}>
                Retry
              </Button>
            </div>
          ) : items.length === 0 ? (
            <p>
              No retained issues match these filters. Reporting requires an instrumented deployment
              and a valid reporting token.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
                >
                  <div className="min-w-0">
                    <button
                      type="button"
                      className="break-all text-left font-medium text-brand hover:underline"
                      onClick={() => onSearch({ issue: item.id })}
                    >
                      {item.title}
                    </button>
                    <p className="text-xs text-muted-foreground">
                      {item.environment} · {item.state} · {item.event_count} retained events ·{' '}
                      {item.regression_count} recurrences
                    </p>
                    {item.impact_24h && (
                      <p className="text-xs text-muted-foreground">
                        {item.impact_24h.identified_customers} verified customers ·{' '}
                        {item.impact_24h.unattributed_events} unattributed events in 24 hours
                      </p>
                    )}
                  </div>
                  <time className="text-xs text-muted-foreground" dateTime={item.last_seen_at}>
                    {new Date(item.last_seen_at).toLocaleString()}
                  </time>
                </li>
              ))}
            </ul>
          )}
          {result.hasNextPage && (
            <Button
              variant="outline"
              disabled={result.isFetchingNextPage}
              onClick={() => void result.fetchNextPage()}
            >
              {result.isFetchingNextPage ? 'Loading…' : 'Load more issues'}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
