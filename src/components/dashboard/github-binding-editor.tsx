import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/field';
import { useGitHubAccounts } from '@/lib/api/github-accounts';
import { useBindRepo } from '@/lib/api/queries';
import { errorMessage } from '@/lib/api/errors';
import { isValidGitHubRepo, isValidGitRef } from './new-app-source';
import { RepoPicker } from './repo-picker';
import type { GitHubConnection } from '@/lib/api/github-connection';

export function GitHubBindingEditor({
  slug,
  current,
  onClose,
}: {
  slug: string;
  current: GitHubConnection;
  onClose: () => void;
}) {
  const accounts = useGitHubAccounts();
  const bind = useBindRepo(slug);
  const [selection, setSelection] = useState<number | null>(current.installation_id ?? null);
  const [repo, setRepo] = useState(current.repo_full_name ?? '');
  const [branch, setBranch] = useState(current.production_branch ?? '');
  const [error, setError] = useState('');
  const list = accounts.data?.connections ?? [];
  const installation = selection ?? (list.length === 1 ? list[0].installation_id : null);
  async function save() {
    if (!installation) return;
    setError('');
    try {
      await bind.mutateAsync({
        installationId: installation,
        repo: repo.trim(),
        branch: branch.trim(),
        deployBranches: current.deploy_branches,
      });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  return (
    <form
      aria-label="Repository connection"
      className="mb-4 flex flex-col gap-3 rounded-lg border border-border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label className="text-sm font-medium">
        GitHub installation
        <Select
          aria-label="GitHub installation"
          value={installation ?? ''}
          disabled={bind.isPending}
          onChange={(event) => {
            setSelection(Number(event.target.value) || null);
            setRepo('');
          }}
        >
          <option value="">Choose an installation</option>
          {list.map((i) => (
            <option key={i.installation_id} value={i.installation_id}>
              {i.github_login} · {i.installation_id}
            </option>
          ))}
        </Select>
      </label>
      {accounts.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading installations…
        </p>
      )}
      {Boolean(accounts.error) && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(accounts.error)}
        </p>
      )}
      <label className="text-sm font-medium">
        Repository
        <RepoPicker
          installationId={installation}
          value={repo}
          onChange={(next, defaultBranch) => {
            setRepo(next);
            if (defaultBranch) setBranch(defaultBranch);
          }}
        />
      </label>
      <label className="text-sm font-medium">
        Production branch
        <Input
          value={branch}
          placeholder="Repository default branch"
          onChange={(event) => setBranch(event.target.value)}
        />
      </label>
      {current.state === 'bound' && (
        <p className="text-xs text-muted-foreground">
          Changing the repository or installation retires this app’s existing PR previews.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          type="submit"
          size="sm"
          busy={bind.isPending}
          disabled={
            !installation || !isValidGitHubRepo(repo) || (Boolean(branch) && !isValidGitRef(branch))
          }
        >
          Save connection
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={bind.isPending} onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
