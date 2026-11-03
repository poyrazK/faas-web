import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Trash } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { FIELD } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  deleteSavedView,
  putSavedView,
  savedViewsKey,
  useSavedViews,
  viewKey,
  type SavedView,
  type SavedViewFilters,
} from '@/lib/api/issue-policies';
import type { IssueSearch } from './issues-search';
import { InlinePhase, queryPhase } from './primitives';
import { ProblemHelp } from './problem-help';

/**
 * Shared, named inbox filters for one app (faas docs/issues.md § Shared saved
 * inbox views), gated on `issue-saved-views`. A view is a bounded set of known
 * filters, not a query, and grants no extra access; `me` stays relative to
 * whoever opens it. At most 20 per app.
 */

const FILTER_KEYS = [
  'issueState',
  'issueEnvironment',
  'issueAssignee',
  'issueSort',
  'issueMinCustomers',
  'issueTag',
  'issueTeam',
] as const;

export function filtersFromSearch(search: IssueSearch): SavedViewFilters {
  return {
    ...(search.issueState ? { state: search.issueState } : {}),
    ...(search.issueEnvironment ? { environment: search.issueEnvironment } : {}),
    ...(search.issueTeam
      ? { team: search.issueTeam }
      : search.issueAssignee
        ? { assignee: search.issueAssignee }
        : {}),
    ...(search.issueSort ? { sort: search.issueSort } : {}),
    ...(search.issueMinCustomers ? { min_customers: search.issueMinCustomers } : {}),
    ...(search.issueTag ? { tag: search.issueTag } : {}),
  };
}

/** Every inbox filter, replaced by the view's: a filter the view omits is cleared. */
export function searchFromFilters(filters: SavedViewFilters): Partial<IssueSearch> {
  return {
    issueState: filters.state,
    issueEnvironment: filters.environment,
    issueAssignee: filters.team ? undefined : filters.assignee,
    issueSort: filters.sort,
    issueMinCustomers: filters.min_customers || undefined,
    issueTag: filters.tag,
    issueTeam: filters.team,
    issue: undefined,
  };
}

function sameFilters(view: SavedView, search: IssueSearch): boolean {
  const a = searchFromFilters(view.filters);
  return FILTER_KEYS.every(
    (k) =>
      (a[k] ?? undefined) === (search[k] ?? undefined) ||
      (k === 'issueSort' && (a[k] ?? 'recent') === (search[k] ?? 'recent'))
  );
}

function explain(err: unknown): string {
  if (err instanceof ApiError && err.code === 'issue_quota_exceeded')
    return 'This app already has 20 saved views. Delete one to save another.';
  return errorMessage(err);
}

export function IssueSavedViews({
  accountId,
  slug,
  search,
  onApply,
}: {
  accountId: string;
  slug: string;
  search: IssueSearch;
  onApply: (changes: Partial<IssueSearch>) => void;
}) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { toast } = useToast();
  const views = useSavedViews(accountId, slug);
  const items = views.data?.items ?? [];
  const current = items.find((v) => sameFilters(v, search));
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const key = viewKey(name);
  const phase = queryPhase({ error: views.error, loading: views.isPending });
  const store = (next: SavedView[]) =>
    qc.setQueryData(savedViewsKey(accountId, slug), {
      items: [...next].sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key)),
    });

  const save = async () => {
    if (!name.trim() || !key || busy) return;
    const existing = items.find((v) => v.key === key);
    if (
      existing &&
      !(await confirm({
        title: `Replace the view “${existing.name}”?`,
        description: 'Its filters are replaced for everyone who uses it.',
        confirmLabel: 'Replace view',
      }))
    )
      return;
    setBusy(true);
    setFailure(undefined);
    try {
      const saved = await putSavedView(slug, key, {
        name: name.trim(),
        filters: filtersFromSearch(search),
      });
      store([...items.filter((v) => v.key !== saved.key), saved]);
      setNaming(false);
      setName('');
      toast({ kind: 'success', title: `Saved view “${saved.name}”` });
    } catch (err) {
      setFailure(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (view: SavedView) => {
    if (
      !(await confirm({
        title: `Delete the view “${view.name}”?`,
        description: 'It is removed for everyone. No issue changes.',
        confirmLabel: 'Delete view',
        destructive: true,
      }))
    )
      return;
    try {
      await deleteSavedView(slug, view.key);
      store(items.filter((v) => v.key !== view.key));
    } catch (err) {
      toast({
        kind: 'error',
        title: 'Could not delete the view',
        description: explain(err),
        error: err,
      });
    }
  };

  if (phase !== 'ready')
    return (
      <InlinePhase
        phase={phase}
        error={views.error}
        loadingMessage="Reading saved views…"
        onRetry={() => void views.refetch()}
      />
    );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Saved view
          <select
            aria-label="Saved view"
            className="rounded border border-border bg-background px-2 py-1 text-sm text-foreground"
            value={current?.key ?? ''}
            onChange={(e) => {
              const view = items.find((v) => v.key === e.target.value);
              onApply(view ? searchFromFilters(view.filters) : searchFromFilters({}));
            }}
          >
            <option value="">{items.length ? 'Unsaved filters' : 'No saved views yet'}</option>
            {items.map((v) => (
              <option key={v.key} value={v.key}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        {current && (
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Delete view ${current.name}`}
            onClick={() => void remove(current)}
          >
            <Trash aria-hidden className="h-3.5 w-3.5" />
          </Button>
        )}
        {!naming ? (
          <Button
            variant="outline"
            size="sm"
            disabled={items.length >= 20 && !current}
            onClick={() => setNaming(true)}
          >
            Save these filters
          </Button>
        ) : (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              View name
              <input
                value={name}
                maxLength={64}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                className={`${FIELD} h-8`}
              />
            </label>
            <Button type="submit" size="sm" disabled={!key || busy}>
              Save view
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setNaming(false)}>
              Cancel
            </Button>
            {name.trim() && !key && (
              <span className="text-xs" style={{ color: 'var(--status-critical)' }}>
                Use at least one letter or digit.
              </span>
            )}
          </form>
        )}
      </div>
      {failure !== undefined && (
        <div role="alert" className="flex flex-col gap-1 text-sm">
          <span style={{ color: 'var(--status-critical)' }}>{explain(failure)}</span>
          <ProblemHelp error={failure} />
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Views are shared with everyone on this app and grant no extra access. “Mine” stays relative
        to whoever opens the view.
      </p>
    </div>
  );
}
