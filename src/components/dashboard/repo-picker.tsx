import type * as React from 'react';
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
 * A value the installation does not list (an app already bound to a repo the
 * installation no longer shows, say) is still rendered as an option, labelled
 * with `unlistedNote`: a select without a matching option falls back to the
 * placeholder and hides what is about to be deployed.
 */
type ControlProps = Pick<
  React.ComponentProps<'input'>,
  'id' | 'name' | 'form' | 'aria-invalid' | 'aria-describedby'
>;

export function RepoPicker({
  value,
  onChange,
  className,
  unlistedNote = 'not listed for this installation',
  ...control
}: {
  value: string;
  onChange: (repo: string, defaultBranch?: string) => void;
  className?: string;
  unlistedNote?: string;
} & ControlProps) {
  const { account } = useAuth();
  const installId = account?.github_install_id ? Number(account.github_install_id) : null;
  const repos = useInstallRepos(installId, account?.id);
  const list = repos.data ?? [];

  if (!installId || repos.error || (!repos.isPending && list.length === 0)) {
    return (
      <div className="flex flex-col gap-2">
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
      {value && !list.some((r) => r.full_name === value) && (
        <option value={value}>
          {value} ({unlistedNote})
        </option>
      )}
      {list.map((r) => (
        <option key={r.id} value={r.full_name}>
          {r.full_name}
          {r.private ? ' (private)' : ''}
        </option>
      ))}
    </Select>
  );
}
