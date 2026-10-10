import { Select } from '@/components/ui/field';
import { FIELD } from '@/components/ui/field';
import { useAuth } from '@/lib/auth';
import { useInstallRepos } from '@/lib/api/queries';
import { cn } from '@/lib/utils';
import { useEffect } from 'react';

/**
 * A repository field that lists what the GitHub App installation can
 * actually see (`POST /v1/install/repos/list`) instead of trusting a typed
 * owner/name. Picking a repo also reports its default branch, so callers
 * can pre-fill the ref. Without an installation — or when the list cannot
 * be read — it degrades to the plain text input it replaces.
 */
export function RepoPicker({
  value,
  onChange,
  className,
  onAvailabilityChange,
}: {
  value: string;
  onChange: (repo: string, defaultBranch?: string) => void;
  className?: string;
  onAvailabilityChange?: (available: boolean) => void;
}) {
  const { account } = useAuth();
  const installId = account?.github_install_id ? Number(account.github_install_id) : null;
  const repos = useInstallRepos(installId);
  const list = repos.data ?? [];
  const selected = list.find((repo) => repo.full_name.toLowerCase() === value.toLowerCase());
  const missing = Boolean(value) && !repos.isPending && !repos.error && !selected;
  useEffect(() => {
    onAvailabilityChange?.(!repos.isPending && !missing);
  }, [onAvailabilityChange, repos.isPending, missing]);

  if (!installId || repos.error) {
    return (
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="owner/repo"
        spellCheck={false}
        className={cn(FIELD, 'font-mono', className)}
      />
    );
  }

  return (
    <>
      <Select
        value={selected?.full_name ?? value}
        disabled={repos.isPending}
        onChange={(e) => {
          const repo = list.find((r) => r.full_name === e.target.value);
          onChange(e.target.value, repo?.default_branch);
        }}
        className={cn('font-mono', className)}
      >
        <option value="">
          {repos.isPending ? 'Reading repositories…' : 'Choose a repository…'}
        </option>
        {value && !selected && <option value={value}>{value}</option>}
        {list.map((r) => (
          <option key={r.id} value={r.full_name}>
            {r.full_name}
            {r.private ? ' (private)' : ''}
          </option>
        ))}
      </Select>
      {missing && (
        <span role="status" className="text-xs leading-relaxed text-muted-foreground">
          This repository is not listed in your GitHub installation. Choose an accessible repository
          or{' '}
          <a
            href="https://github.com/settings/installations"
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand underline"
          >
            update repository access on GitHub
          </a>
          , then reload this page.
        </span>
      )}
    </>
  );
}
