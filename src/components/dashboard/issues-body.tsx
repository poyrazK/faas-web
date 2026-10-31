import { Button } from '@/components/ui/button';
import { useCapability } from '@/lib/api/capabilities';
import { useIssues, type IssueFilters } from '@/lib/api/issues';
import { CapabilityNotice } from './capability-notice';
import { IssueDetail } from './issue-detail';
import { IssueReportingSetup } from './issue-reporting-setup';
import type { IssueSearch } from './issues-search';

type Props = {
  accountId: string;
  slug: string;
  search: IssueSearch;
  onSearch: (changes: Partial<IssueSearch>) => void;
};

export function IssuesBody({ accountId, slug, search, onSearch }: Props) {
  const availability = useCapability('issues');
  const permitted = availability.accountId === accountId && availability.state === 'available';
  const filters: IssueFilters = {
    state: search.issueState,
    environment: search.issueEnvironment,
    assignee: search.issueAssignee,
    sort: search.issueSort,
    min_customers: search.issueMinCustomers,
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
        <Button
          variant="outline"
          disabled={!permitted}
          onClick={() => onSearch({ issueView: 'setup', issue: undefined })}
        >
          Reporting setup
        </Button>
      </div>
      <CapabilityNotice
        capability={availability.capability}
        state={availability.state}
        onRetry={availability.refresh}
      />
      {!permitted ? null : search.issueView === 'setup' ? (
        <IssueReportingSetup
          accountId={accountId}
          slug={slug}
          onClose={() => onSearch({ issueView: 'inbox' })}
        />
      ) : search.issue ? (
        <IssueDetail
          key={`${accountId}/${slug}/${search.issue}`}
          accountId={accountId}
          slug={slug}
          issueId={search.issue}
          onBack={() => onSearch({ issue: undefined })}
        />
      ) : (
        <>
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
                value={search.issueAssignee ?? ''}
                onChange={(event) =>
                  updateFilter({
                    issueAssignee:
                      (event.target.value as IssueSearch['issueAssignee']) || undefined,
                  })
                }
              >
                <option value="">Everyone</option>
                <option value="me">Mine</option>
                <option value="unassigned">Unassigned</option>
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
