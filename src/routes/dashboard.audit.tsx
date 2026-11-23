import { useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { groupByDay } from '@/components/dashboard/activity-words';
import {
  describeAuditEntry,
  matchesAuditSearch,
  type AuditNarrative,
} from '@/components/dashboard/audit-words';
import { InlinePhase, PageHeader, queryPhase } from '@/components/dashboard/primitives';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Timestamp } from '@/components/ui/timestamp';
import { useInfiniteAuditLog } from '@/lib/api/queries';
import { useAuth } from '@/lib/auth';
import { consoleHead } from '@/lib/seo';
import { parseTime } from '@/lib/time';

export const Route = createFileRoute('/dashboard/audit')({
  component: AuditPage,
  head: () => consoleHead('audit'),
});

function AuditEvent({ row }: { row: AuditNarrative }) {
  return (
    <li className="min-w-0 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium [overflow-wrap:anywhere]">{row.sentence}</p>
          {row.actor && (
            <p className="mt-0.5 break-all text-xs text-muted-foreground">By {row.actor}</p>
          )}
        </div>
        {parseTime(row.received_at) === undefined ? (
          <span className="shrink-0 text-xs text-muted-foreground">Time unknown</span>
        ) : (
          <Timestamp
            value={row.received_at}
            mode="clock"
            className="shrink-0 text-xs text-muted-foreground tabular-nums"
          />
        )}
      </div>
      <details className="mt-1.5">
        <summary className="w-fit cursor-pointer rounded text-xs text-muted-foreground hover:text-foreground">
          View details<span className="sr-only"> for {row.sentence}</span>
        </summary>
        <dl className="mt-2 grid gap-y-2 rounded-md bg-muted/50 p-3 text-xs">
          {row.detail.map(({ label, value }) => (
            <div key={label} className="grid gap-x-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 [overflow-wrap:anywhere]">{value}</dd>
            </div>
          ))}
        </dl>
      </details>
    </li>
  );
}

function AuditPage() {
  const { account, refreshAccount, sessionError } = useAuth();
  const [search, setSearch] = useState('');
  const [kindPrefix, setKindPrefix] = useState('');
  const [date, setDate] = useState<{ days: string; since: string }>();
  const serverFilters =
    date || kindPrefix ? { since: date?.since, kind_prefix: kindPrefix || undefined } : undefined;
  const auditLog = useInfiniteAuditLog(account?.id ?? '', 50, serverFilters);
  const rows = useMemo(
    () => (auditLog.data?.pages ?? []).flatMap((page) => page.entries.map(describeAuditEntry)),
    [auditLog.data]
  );
  const grouped = useMemo(
    () => groupByDay(rows.filter((row) => matchesAuditSearch(row, search))),
    [rows, search]
  );
  const searchLabel = auditLog.hasNextPage ? 'Search loaded events' : 'Search events';
  const empty = search.trim()
    ? auditLog.hasNextPage
      ? 'No loaded events match your search.'
      : 'No events match your search.'
    : serverFilters
      ? 'No audit events match these filters.'
      : 'No audit events have been recorded.';
  const readError = auditLog.error ?? (!account ? sessionError : undefined);
  const phase = queryPhase({
    error: rows.length ? undefined : readError,
    loading: auditLog.isPending && !readError,
    isEmpty: grouped.length === 0,
  });

  const retry = () => {
    const read = !account
      ? refreshAccount()
      : auditLog.isFetchNextPageError
        ? auditLog.fetchNextPage()
        : auditLog.refetch();
    void read.catch(() => undefined);
  };

  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <PageHeader
        title="Audit log"
        help="Events recorded for your personal account, newest first."
      />
      <div
        className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
        role="group"
        aria-label="Filter audit events"
      >
        <label className="flex min-w-0 flex-col gap-1.5 text-xs text-muted-foreground">
          {searchLabel}
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by action, actor, or resource"
            className="text-foreground"
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1.5 text-xs text-muted-foreground">
          Event type
          <Select
            className="text-foreground"
            value={kindPrefix}
            onChange={(event) => setKindPrefix(event.target.value)}
          >
            <option value="">All events</option>
            <option value="api_key.">API keys</option>
            <option value="key.">Older API key records</option>
            <option value="auth.">Sign-in and sessions</option>
            <option value="secret.">Secrets</option>
            <option value="account.">Account changes</option>
            <option value="app.">Apps</option>
            <option value="env.">Environment variables</option>
            <option value="domain.">Domains</option>
          </Select>
        </label>
        <label className="flex min-w-0 flex-col gap-1.5 text-xs text-muted-foreground">
          Date range
          <Select
            className="text-foreground"
            value={date?.days ?? ''}
            onChange={(event) => {
              const days = event.target.value;
              const since = days
                ? new Date(Date.now() - Number(days) * 86_400_000).toISOString()
                : undefined;
              setDate(since ? { days, since } : undefined);
            }}
          >
            <option value="">All dates</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
          </Select>
        </label>
      </div>
      <InlinePhase
        phase={phase}
        error={readError}
        loadingMessage="Reading your audit log…"
        emptyMessage={empty}
        onRetry={retry}
      />
      {grouped.map((group) => (
        <section key={group.key} aria-label={group.label} className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold text-muted-foreground">{group.label}</h2>
          <ol className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {group.rows.map((row) => (
              <AuditEvent key={row.id} row={row} />
            ))}
          </ol>
        </section>
      ))}
      {rows.length > 0 && Boolean(auditLog.error) && (
        <InlinePhase
          phase={queryPhase({ error: auditLog.error })}
          error={auditLog.error}
          onRetry={retry}
        />
      )}
      {auditLog.hasNextPage && (
        <div>
          <Button
            size="sm"
            variant="outline"
            busy={auditLog.isFetchingNextPage}
            onClick={() => void auditLog.fetchNextPage().catch(() => undefined)}
          >
            Load older events
          </Button>
        </div>
      )}
    </div>
  );
}
