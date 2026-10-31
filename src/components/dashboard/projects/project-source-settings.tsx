import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { FIELD, FieldError, fieldErrorProps } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  useOwningCompany,
  useUpdateProject,
  type UpdateProjectRequest,
} from '@/lib/api/project-settings';
import type { ProjectDetail } from '@/lib/api/projects';
import { useWorkspaceTarget } from '@/lib/api/workspace-apps';
import { Panel } from '../primitives';

/** faas validProjectBranch (handlers_projects.go:274). */
export function validBranch(branch: string) {
  if (!branch || branch.length > 255 || branch.startsWith('/') || branch.endsWith('/'))
    return false;
  if (branch.includes('..')) return false;
  for (const char of branch) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f) return false;
  }
  return !/[~^:?*[\\]/.test(branch);
}
/** faas validProjectRepoFullName (scan_service.go:141). */
const validRepo = (repo: string) => /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo);

/**
 * Repository and production branch (PATCH /v1/projects/{slug}, faas
 * handlers_projects.go:67). A project shared through a company refuses a
 * repository change with `conflict` (handlers_projects.go:82), so its
 * repository is shown, not offered.
 */
export function ProjectSourceSettings({
  accountId,
  project,
}: {
  accountId: string;
  project: ProjectDetail;
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const { org, label } = useWorkspaceTarget();
  const company = useOwningCompany(project.org_id);
  const update = useUpdateProject(accountId, project.slug);
  const [repo, setRepo] = useState(project.repo_full_name ?? '');
  const [branch, setBranch] = useState(project.production_branch ?? '');
  const [failure, setFailure] = useState<string | null>(null);
  const id = useId();
  const shared = Boolean(org || company);
  const owner = org ? label : company?.name;

  const repoChanged = !shared && repo.trim() !== (project.repo_full_name ?? '');
  const branchChanged = branch.trim() !== (project.production_branch ?? '');
  const repoError =
    repo.trim() && !validRepo(repo.trim())
      ? 'Use the GitHub owner/name, like acme/shop.'
      : undefined;
  const branchError =
    branch.trim() && !validBranch(branch.trim())
      ? 'That is not a valid Git branch name.'
      : undefined;
  const ready =
    (repoChanged || branchChanged) &&
    Boolean(branch.trim()) &&
    !repoError &&
    !branchError &&
    !update.isPending;

  function explain(err: unknown) {
    if (err instanceof ApiError && err.code === 'org_role_forbidden')
      return `Only ${owner ?? 'the company'}'s owners and admins can change this project.`;
    if (err instanceof ApiError && err.code === 'conflict')
      return "This project belongs to a company, and the repository of a company's project can't be changed yet. You can still change the production branch.";
    return errorMessage(err);
  }

  return (
    <Panel
      title="Source settings"
      description="The repository and branch production deploys come from."
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!ready) return;
          const body: UpdateProjectRequest = {};
          if (repoChanged) body.repo_full_name = repo.trim();
          if (branchChanged) body.production_branch = branch.trim();
          if (
            body.repo_full_name === '' &&
            !(await confirm({
              title: `Disconnect ${project.repo_full_name}?`,
              description: `Pushes to ${project.repo_full_name} stop deploying this project. Its apps keep running what they run now. Connect a repository again here or with gregale project update.`,
              confirmLabel: 'Disconnect',
            }))
          )
            return;
          setFailure(null);
          update.mutate(body, {
            onSuccess: () => toast({ kind: 'success', title: 'Source settings saved' }),
            onError: (err) => setFailure(explain(err)),
          });
        }}
      >
        {owner && !org && (
          <p className="text-sm">Belongs to {owner}. Its owners and admins change and delete it.</p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {shared ? (
            <div className="flex flex-col gap-1.5">
              <span className="label-mono text-muted-foreground">Repository</span>
              <span className="break-all text-sm">{project.repo_full_name || 'Not connected'}</span>
              <span className="text-xs text-muted-foreground">
                The repository of a company's project can't be changed yet; the API needs the
                company's own GitHub installation for that.
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-repo`} className="label-mono text-muted-foreground">
                Repository
              </label>
              <input
                id={`${id}-repo`}
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                placeholder="owner/name"
                spellCheck={false}
                autoComplete="off"
                className={`${FIELD} w-full`}
                {...fieldErrorProps(repoError, `${id}-repo-error`)}
              />
              {repoError ? (
                <FieldError id={`${id}-repo-error`}>{repoError}</FieldError>
              ) : (
                <span className="text-xs text-muted-foreground">
                  Empty disconnects the repository.
                </span>
              )}
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-branch`} className="label-mono text-muted-foreground">
              Production branch
            </label>
            <input
              id={`${id}-branch`}
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="main"
              spellCheck={false}
              autoComplete="off"
              className={`${FIELD} w-full`}
              {...fieldErrorProps(branchError, `${id}-branch-error`)}
            />
            {branchError && <FieldError id={`${id}-branch-error`}>{branchError}</FieldError>}
          </div>
        </div>
        {failure && (
          <p role="alert" className="text-sm" style={{ color: 'var(--status-critical)' }}>
            {failure}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-xl text-xs text-muted-foreground">
            Workloads, their names and the services they call come from the repository (Compose or{' '}
            <code>.gregale/project.yaml</code>) and change on the next deploy, not here.
          </p>
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={!ready}
            busy={update.isPending}
          >
            Save source settings
          </Button>
        </div>
      </form>
    </Panel>
  );
}
