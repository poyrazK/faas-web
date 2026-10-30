import { useId, useState, type ComponentProps } from 'react';
import { Check, GitBranch, Lock } from 'iconoir-react';
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
 * select: owner, name, privacy and default branch at a glance, filterable once
 * the list is long. Its rows are radios under `name`, in a radio group named
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

// A long list gets a filter; a short one reads at a glance without it.
const FILTER_FROM = 7;
const TONES = ['lime', 'cyan', 'magenta', 'yellow', 'orange', 'blue'] as const;

/** A stable tone per repository, so its tile keeps its colour between visits. */
function tone(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length];
}

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
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  // The chosen repository stays in view whatever the filter says.
  const shown = q
    ? repos.filter((r) => r.full_name.toLowerCase().includes(q) || r.full_name === value)
    : repos;

  if (pending)
    return (
      <p role="status" className="px-4 py-6 text-sm text-muted-foreground">
        Reading repositories…
      </p>
    );

  return (
    // Sized by its own width: rows stack their details under the name when narrow.
    <div className="@container flex flex-col">
      {repos.length >= FILTER_FROM && (
        <div className="border-b border-border px-4 py-2.5">
          <input
            type="search"
            aria-label="Filter repositories"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Filter ${repos.length} repositories`}
            spellCheck={false}
            className={cn(FIELD, 'h-8 font-mono text-[13px]')}
          />
        </div>
      )}
      <div
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
              className="group flex min-h-12 cursor-pointer items-center gap-3 px-4 py-2 transition-colors hover:bg-accent/50 has-checked:bg-brand/5 has-checked:shadow-[inset_2px_0_0_var(--brand)] has-focus-visible:ring-2 has-focus-visible:ring-inset has-focus-visible:ring-brand"
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
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--art-ground)] font-mono text-xs font-semibold uppercase"
                style={{ color: `var(--art-${tone(r.full_name)})` }}
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
        {shown.length === 0 && (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            No repository matches “{query}”.
          </p>
        )}
      </div>
    </div>
  );
}
