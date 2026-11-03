import { useId, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Plus, Xmark } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { ApiError, errorMessage } from '@/lib/api/errors';
import type { GitHubConnection } from '@/lib/api/github-connection';
import { useApp, useBindRepo } from '@/lib/api/queries';
import { useWorkspaceTarget } from '@/lib/api/workspace-apps';
import { ProblemHelp } from './problem-help';

/**
 * Which branch deploys where, for a bound app.
 *
 * The binding's production branch deploys the app; a project's
 * `deploy_branches` send other branches' pushes to a deployment scope —
 * `default` (the app's own) or a project environment (faas
 * handlers_github_connection.go:534-544, docs/preview-environments.md "CLI
 * bootstrap"). The mappings belong to the project, so one change routes
 * every app in it (state/github_deploy_branches.go). A browser changes them
 * only by binding the same repository again with a new map
 * (handlers_install_github.go:327, :347-350), which apid refuses with
 * `project_required` for an app outside a project (:494-503).
 *
 * The rest of the GitHub deployment policy — whether pull requests get
 * previews, and whether production deploys come from the App's webhook or an
 * Actions workflow — is served only on the bearer-only
 * `/github/deployment-policy` (server.go:5161-5162), so it is neither shown
 * nor guessed here.
 */

/** InstallBindRequest.deploy_branches: values match this, at most 32 keys. */
const SCOPE = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/;
const MAX_MAPPINGS = 32;
// eslint-disable-next-line no-control-regex -- a control character is what it refuses
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

const destination = (scope: string) =>
  scope === 'default' ? 'Production (default scope)' : `${scope} environment`;

type Row = { key: number; branch: string; scope: string };
type RowErrors = { branch?: string; scope?: string };

function validate(rows: Row[]): RowErrors[] {
  const seen = new Set<string>();
  return rows.map(({ branch, scope }) => {
    const errors: RowErrors = {};
    const name = branch.trim();
    if (!name) errors.branch = 'Enter a branch name.';
    else if (name.length > 255 || CONTROL.test(name))
      errors.branch = 'Branch names are at most 255 characters, with no control characters.';
    else if (seen.has(name)) errors.branch = 'This branch is already mapped.';
    seen.add(name);
    if (!SCOPE.test(scope.trim()))
      errors.scope =
        'Use default, or an environment name: lowercase letters, digits and hyphens, at most 40 characters.';
    return errors;
  });
}

/** The prose for a refused rebind, by the problem's stable code. */
function bindFailure(err: unknown, organization: string): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'project_required':
        return 'Branch mappings belong to a project, and this app is not in one.';
      case 'github_install_not_owned':
      case 'forged':
        return 'The GitHub installation could not be verified. Confirm the GitHub App is still installed, then try again.';
      case 'github_unreachable':
        return 'Could not reach GitHub. Try again in a minute.';
      case 'validation_failed':
        return 'The request’s security token expired before it arrived. Try again — each attempt reads a fresh one.';
      case 'org_role_forbidden':
        // POST /install/bind is not a reviewed organization route, so only the
        // app's creator passes, as an owner or admin (appaccess/access.go:263-270).
        return `Changing a company app’s GitHub binding takes the member who created the app, while they are an owner or admin of ${organization}.`;
    }
  }
  return errorMessage(err);
}

export function GitHubBranchDeployments({
  slug,
  status,
}: {
  slug: string;
  status: GitHubConnection;
}) {
  const app = useApp(slug);
  const [editing, setEditing] = useState(false);
  const production = status.production_branch ?? '';
  const mappings = Object.entries(status.deploy_branches ?? {}).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  // Unknown until the app read answers; a failed read is not "standalone".
  const projectId = app.data ? (app.data.project_id ?? null) : undefined;
  // Saving rebinds with this branch, and apid falls back to the repository's
  // default branch when it is empty (handlers_install_github.go), which would
  // move production. Without a known production branch there is no editor.
  const canEdit = Boolean(
    projectId && status.installation_id && production && status.repo_full_name
  );
  const headingId = useId();

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={headingId} className="label-mono text-muted-foreground">
          Branch deployments
        </h3>
        {canEdit && !editing ? (
          <Button size="xs" variant="outline" onClick={() => setEditing(true)}>
            Edit mappings
          </Button>
        ) : null}
      </div>
      {editing && canEdit && status.installation_id ? (
        <BranchMappingsForm
          slug={slug}
          installationId={status.installation_id}
          repo={status.repo_full_name ?? ''}
          production={production}
          mappings={mappings}
          onDone={() => setEditing(false)}
        />
      ) : (
        <ul
          aria-labelledby={headingId}
          className="mt-2 divide-y divide-border rounded-lg border border-border"
        >
          <li className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-sm">
            <code className="font-mono">{production || '—'}</code>
            <span className="sr-only"> deploys to </span>
            <ArrowRight aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
            <span>Production</span>
            <span className="text-xs text-muted-foreground"> · production branch</span>
          </li>
          {mappings.map(([branch, scope]) => (
            <li
              key={branch}
              className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-sm"
            >
              <code className="min-w-0 font-mono [overflow-wrap:anywhere]">{branch}</code>
              <span className="sr-only"> deploys to </span>
              <ArrowRight aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
              <span>{destination(scope)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
        {projectId === null && (
          <p>
            No other branch deploys this app. Mapping branches to environments is a project setting:
            branch mappings belong to a project, and this app is not in one.
          </p>
        )}
        {projectId && mappings.length === 0 && !editing && (
          <p>No other branch deploys. Map one to send its pushes to a project environment.</p>
        )}
        <p>
          Whether pull requests get previews, and whether production deploys come from the GitHub
          App or a GitHub Actions workflow, is the project’s GitHub deployment policy. apid serves
          that policy only to API keys with the github:manage scope, not to a signed-in browser, so
          the console cannot show or change it.
        </p>
      </div>
    </div>
  );
}

function BranchMappingsForm({
  slug,
  installationId,
  repo,
  production,
  mappings,
  onDone,
}: {
  slug: string;
  installationId: number;
  repo: string;
  production: string;
  mappings: [string, string][];
  onDone: () => void;
}) {
  const id = useId();
  const { toast } = useToast();
  const workspace = useWorkspaceTarget();
  const bind = useBindRepo(slug);
  const next = useRef(mappings.length);
  const [rows, setRows] = useState<Row[]>(() =>
    mappings.map(([branch, scope], key) => ({ key, branch, scope }))
  );
  const [submitted, setSubmitted] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const errors = validate(rows);
  const invalid = errors.some((e) => e.branch || e.scope);
  const shown = (value: string, message: string | undefined) =>
    message && (submitted || value.trim() !== '') ? message : undefined;
  const organization = workspace.org ? workspace.label : 'the app’s organization';

  const update = (key: number, patch: Partial<Row>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (invalid) return;
    setFailure(null);
    const deployBranches = Object.fromEntries(
      rows.map(({ branch, scope }) => [branch.trim(), scope.trim()])
    );
    try {
      await bind.mutateAsync({ installationId, repo, branch: production, deployBranches });
      const count = rows.length;
      toast({
        kind: 'success',
        title: 'Branch deployments saved',
        description:
          count === 0
            ? `Only ${production} deploys now.`
            : `${count} ${count === 1 ? 'branch deploys' : 'branches deploy'} besides ${production}.`,
      });
      onDone();
    } catch (err) {
      setFailure(err);
    }
  };

  return (
    <form
      aria-label="Edit branch deployments"
      noValidate
      onSubmit={(event) => void submit(event)}
      className="mt-2 flex flex-col gap-3 rounded-lg border border-border p-3"
    >
      <p className="text-xs text-muted-foreground">
        Mappings belong to this app’s project, so they route pushes for every app in it. Use{' '}
        <code className="font-mono text-foreground">default</code> for the app’s own production
        scope, or the name of a project environment. Saving binds {repo} again, with{' '}
        <code className="font-mono text-foreground">{production}</code> still the production branch.
      </p>
      {rows.length > 0 && (
        <ul className="flex flex-col gap-2">
          {rows.map((row, i) => {
            const branchError = shown(row.branch, errors[i]?.branch);
            const scopeError = shown(row.scope, errors[i]?.scope);
            const branchErrorId = `${id}-${row.key}-branch`;
            const scopeErrorId = `${id}-${row.key}-scope`;
            return (
              <li
                key={row.key}
                className="flex flex-wrap items-start gap-2 border-b border-border pb-2 last:border-0 last:pb-0 sm:flex-nowrap sm:border-0 sm:pb-0"
              >
                <div className="flex min-w-0 flex-1 basis-40 flex-col gap-1">
                  <Input
                    aria-label={`Branch ${i + 1}`}
                    placeholder="staging"
                    autoComplete="off"
                    spellCheck={false}
                    value={row.branch}
                    onChange={(event) => update(row.key, { branch: event.target.value })}
                    aria-invalid={Boolean(branchError)}
                    aria-describedby={branchError ? branchErrorId : undefined}
                  />
                  {branchError && <FieldError id={branchErrorId}>{branchError}</FieldError>}
                </div>
                <ArrowRight
                  aria-hidden
                  className="mt-2.5 hidden h-3.5 w-3.5 shrink-0 text-muted-foreground sm:block"
                />
                <div className="flex min-w-0 flex-1 basis-40 flex-col gap-1">
                  <Input
                    aria-label={`Environment for branch ${i + 1}`}
                    placeholder="default"
                    autoComplete="off"
                    spellCheck={false}
                    value={row.scope}
                    onChange={(event) => update(row.key, { scope: event.target.value })}
                    aria-invalid={Boolean(scopeError)}
                    aria-describedby={scopeError ? scopeErrorId : undefined}
                  />
                  {scopeError && <FieldError id={scopeErrorId}>{scopeError}</FieldError>}
                </div>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remove ${row.branch.trim() || `branch ${i + 1}`}`}
                  onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
                >
                  <Xmark />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <Button
        type="button"
        size="xs"
        variant="outline"
        className="w-fit gap-1"
        disabled={rows.length >= MAX_MAPPINGS}
        onClick={() =>
          setRows((current) => [...current, { key: next.current++, branch: '', scope: '' }])
        }
      >
        <Plus />
        Add branch
      </Button>
      {rows.length >= MAX_MAPPINGS && (
        <p className="text-xs text-muted-foreground">
          A project maps at most {MAX_MAPPINGS} branches.
        </p>
      )}
      {failure != null && (
        <div role="alert" className="flex flex-col gap-1 text-sm">
          <p className="text-[color:var(--status-critical)]">
            {bindFailure(failure, organization)}
          </p>
          <ProblemHelp error={failure} />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {/* Not disabled while invalid: a press is what reveals an empty row's errors. */}
        <Button type="submit" size="sm" busy={bind.isPending} disabled={bind.isPending}>
          Save mappings
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
