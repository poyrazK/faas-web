import { useId, useRef, useState, type ComponentProps } from 'react';
import { Check, GitBranch, Lock, Search } from 'iconoir-react';
import { Select } from '@/components/ui/field';
import { FIELD } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { useInstallRepos } from '@/lib/api/queries';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { cn } from '@/lib/utils';

/**
 * A repository field that lists what the GitHub App installation can
 * actually see (`POST /v1/install/repos/list`) instead of trusting a typed
 * owner/name. Picking a repo also reports its default branch, so callers
 * can pre-fill the ref. Without an installation — or when the list cannot
 * be read — it degrades to the plain text input it replaces.
 *
 * Either way the caller's `id`, `name`, `form` and ARIA wiring land on the
 * one control, so a `<label htmlFor>` names it and validation can focus it.
 *
 * `variant="list"` shows the repositories as a list of choices instead of a
 * select: owner, name, privacy and default branch at a glance. A long list
 * leads with search (and owner chips when it spans several owners) and shows
 * five rows, the chosen one pinned first, until asked for all. Its rows are radios under `name`, in a radio group named
 * by `labelledBy`, so the form and its validation see one field.
 */
type ControlProps = Pick<
  ComponentProps<'input'>,
  'id' | 'name' | 'form' | 'aria-invalid' | 'aria-describedby'
>;

export function RepoPicker({
  value,
  onChange,
  className,
  variant = 'select',
  labelledBy,
  ...control
}: {
  value: string;
  onChange: (repo: string, defaultBranch?: string) => void;
  className?: string;
  variant?: 'select' | 'list';
  /** The list variant's group name: the id of the caller's visible label. */
  labelledBy?: string;
} & ControlProps) {
  const { account } = useAuth();
  const installId = account?.github_install_id ? Number(account.github_install_id) : null;
  const repos = useInstallRepos(installId, account?.id);
  const list = repos.data ?? [];

  if (!installId || repos.error || (!repos.isPending && list.length === 0)) {
    return (
      <div className={cn('flex flex-col gap-2', variant === 'list' && 'p-4')}>
        <input
          {...control}
          aria-label={control.id ? undefined : 'Repository'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="owner/repo"
          spellCheck={false}
          className={cn(FIELD, 'font-mono', className)}
        />
        {installId && (
          <>
            <p role={repos.error ? 'alert' : 'status'} className="text-xs text-muted-foreground">
              {repos.error instanceof ApiError && repos.error.code === 'github_login_required'
                ? 'Refresh your GitHub connection in account settings to load repositories.'
                : repos.error
                  ? `Could not load repositories. ${errorMessage(repos.error)}`
                  : 'GitHub returned no accessible repositories. Check repository access in account settings.'}{' '}
              You can enter owner/repo manually.
            </p>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="self-start"
              busy={repos.isFetching}
              onClick={() => void repos.refetch()}
            >
              Reload repositories
            </Button>
          </>
        )}
      </div>
    );
  }

  if (variant === 'list')
    return (
      <RepoList
        repos={list}
        pending={repos.isPending}
        value={value}
        onChange={onChange}
        labelledBy={labelledBy}
        control={control}
      />
    );

  return (
    <Select
      {...control}
      aria-label={control.id ? undefined : 'Repository'}
      value={value}
      disabled={repos.isPending}
      onChange={(e) => {
        const repo = list.find((r) => r.full_name === e.target.value);
        onChange(e.target.value, repo?.default_branch);
      }}
      className={cn('font-mono', className)}
    >
      <option value="">{repos.isPending ? 'Reading repositories…' : 'Choose a repository…'}</option>
      {list.map((r) => (
        <option key={r.id} value={r.full_name}>
          {r.full_name}
          {r.private ? ' (private)' : ''}
        </option>
      ))}
    </Select>
  );
}

type Repo = { id: number; full_name: string; default_branch: string; private: boolean };

// A short list reads at a glance. A long one leads with search and shows a
// handful at a time, so forty repositories never arrive as a wall.
const FILTER_FROM = 7;
const SHOWN = 5;
function RepoList({
  repos,
  pending,
  value,
  onChange,
  labelledBy,
  control,
}: {
  repos: Repo[];
  pending: boolean;
  value: string;
  onChange: (repo: string, defaultBranch?: string) => void;
  labelledBy?: string;
  control: ControlProps;
}) {
  const uid = useId();
  const group = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [owner, setOwner] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const long = repos.length >= FILTER_FROM;
  const q = query.trim().toLowerCase();
  const ownerOf = (r: Repo) => r.full_name.split('/')[0];
  const owners = [...new Set(repos.map(ownerOf))].map((o) => ({
    name: o,
    count: repos.filter((r) => ownerOf(r) === o).length,
  }));
  const matches = repos.filter(
    (r) => (!owner || ownerOf(r) === owner) && (!q || r.full_name.toLowerCase().includes(q))
  );
  // The chosen repository stays in view, first, whatever narrows the list.
  const chosen = repos.find((r) => r.full_name === value);
  const candidates = chosen ? [chosen, ...matches.filter((r) => r !== chosen)] : matches;
  const shown = long && !all ? candidates.slice(0, SHOWN) : candidates;
  const hidden = candidates.length - shown.length;

  if (pending)
    return (
      <p role="status" className="px-4 py-6 text-sm text-muted-foreground">
        Reading repositories…
      </p>
    );

  return (
    // Sized by its own width: rows stack their details under the name when narrow.
    <div className="@container flex flex-col">
      {long && (
        <div className="flex flex-col gap-2 border-b border-border px-4 py-2.5">
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="search"
              aria-label="Search repositories"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // Enter takes the top match rather than submitting the form;
                // ArrowDown steps into the list.
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (q && matches[0]) onChange(matches[0].full_name, matches[0].default_branch);
                } else if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  group.current?.querySelector<HTMLInputElement>('input[type="radio"]')?.focus();
                }
              }}
              placeholder={`Search ${repos.length} repositories`}
              spellCheck={false}
              className={cn(FIELD, 'h-8 w-full pl-8 font-mono text-[13px]')}
            />
          </div>
          {owners.length > 1 && (
            <div role="group" aria-label="Owner" className="flex flex-wrap gap-1.5">
              {[{ name: null, count: repos.length }, ...owners].map((o) => (
                <button
                  key={o.name ?? '*'}
                  type="button"
                  aria-pressed={owner === o.name}
                  onClick={() => setOwner(o.name)}
                  className={cn(
                    'inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 font-mono text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
                    owner === o.name
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border text-muted-foreground hover:text-foreground'
                  )}
                >
                  {o.name ?? 'All'}
                  <span className="opacity-70">{o.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div
        ref={group}
        role="radiogroup"
        id={control.id}
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : 'Repository'}
        aria-invalid={control['aria-invalid']}
        aria-describedby={control['aria-describedby']}
        className="flex max-h-[19rem] flex-col divide-y divide-border overflow-y-auto"
      >
        {shown.map((r) => {
          const [owner, name] = r.full_name.includes('/')
            ? [
                r.full_name.slice(0, r.full_name.indexOf('/') + 1),
                r.full_name.slice(r.full_name.indexOf('/') + 1),
              ]
            : ['', r.full_name];
          return (
            <label
              key={r.id}
              className="group flex min-h-12 cursor-pointer items-center gap-3 px-4 py-2 transition-colors hover:bg-accent/50 has-checked:bg-accent/50 has-focus-visible:ring-2 has-focus-visible:ring-inset has-focus-visible:ring-brand"
            >
              <input
                type="radio"
                name={control.name}
                form={control.form}
                value={r.full_name}
                aria-label={r.full_name}
                aria-describedby={`${uid}-${r.id}-meta`}
                checked={value === r.full_name}
                onChange={() => onChange(r.full_name, r.default_branch)}
                className="sr-only"
              />
              <span
                aria-hidden="true"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted font-mono text-xs font-semibold uppercase text-muted-foreground"
              >
                {name.charAt(0)}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 @md:flex-row @md:items-center @md:gap-3">
                <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
                  <span className="text-muted-foreground">{owner}</span>
                  <span className="font-semibold text-foreground">{name}</span>
                </span>
                <span id={`${uid}-${r.id}-meta`} className="flex shrink-0 items-center gap-3">
                  {r.private && (
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                      <Lock aria-hidden className="h-3 w-3" />
                      Private
                    </span>
                  )}
                  <span className="inline-flex shrink-0 items-center gap-1 font-mono text-xs text-muted-foreground">
                    <GitBranch aria-hidden className="h-3 w-3" />
                    <span className="sr-only">default branch </span>
                    {r.default_branch}
                  </span>
                </span>
              </span>
              <Check
                aria-hidden
                className="h-4 w-4 shrink-0 text-brand opacity-0 group-has-checked:opacity-100"
              />
            </label>
          );
        })}
        {matches.length === 0 && q && (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            No repository matches “{query}”.
          </p>
        )}
      </div>
      {hidden > 0 && (
        <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2 text-xs text-muted-foreground">
          <span>
            {shown.length} of {candidates.length} {q || owner ? 'matches ' : ''}shown
            {q ? '' : ' · search to find the rest'}
          </span>
          <button
            type="button"
            onClick={() => setAll(true)}
            className="shrink-0 font-medium text-foreground hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            Show all {candidates.length}
          </button>
        </div>
      )}
    </div>
  );
}
