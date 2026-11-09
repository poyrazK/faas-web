import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/errors';
import { parsePreviewSlug } from '@/lib/api/pr-previews';
import {
  usePreviewApp,
  usePreviewSet,
  useProjectPreviewApps,
  type PreviewApp,
} from '@/lib/api/preview-environments';
import { useOrgApps, useWorkspaceTarget } from '@/lib/api/workspace-apps';
import { publicAppUrl } from '@/lib/app-url';
import { useAuth } from '@/lib/auth';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ErrorState, LoadingState, Panel } from '../primitives';
function evidenceHref(value: string) {
  if (value.startsWith('/v1/') && !value.includes('\\') && !/\s/.test(value)) return value;
  return publicAppUrl(value);
}
export function PreviewWorkloadSet({
  accountId,
  app,
  organization = 'its organization',
}: {
  accountId: string;
  app: PreviewApp;
  /** Names the company in a role refusal. */
  organization?: string;
}) {
  const query = usePreviewSet(accountId, app.slug, app.preview_pr_number ?? 0);
  const unavailable = query.error instanceof ApiError && query.error.status === 404;
  // The preview environment is not a reviewed organization route, so a
  // company preview's passes only for its app's creator, as an owner or admin
  // (faas appaccess/indirect.go:107-109, access.go:263-270).
  const refused = query.error instanceof ApiError && query.error.code === 'org_role_forbidden';
  const data = query.isError ? undefined : query.data;
  const ready = Boolean(
    data?.ready &&
    data.phase === 'live' &&
    data.live_workloads === data.total_workloads &&
    data.members.length === data.total_workloads &&
    data.members.every(
      (member) =>
        member.deployment_id &&
        member.deployment_status === 'live' &&
        member.app_status !== 'missing'
    )
  );
  const repo = data?.repo_full_name;
  return (
    <Panel
      title="PR preview workload set"
      help="Production dependencies may be shared; a preview is not an isolated clone."
    >
      <div className="space-y-4 p-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p>
            PR #{app.preview_pr_number ?? 'Unknown'} · app lifecycle{' '}
            {app.preview_pr_state ?? 'unknown'}
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            Refresh preview
          </Button>
        </div>
        {app.preview_of_slug && (
          <Link
            to="/dashboard/apps/$appSlug"
            params={{ appSlug: app.preview_of_slug }}
            className="text-brand hover:underline"
          >
            Production parent
          </Link>
        )}
        {app.preview_expires_at && <p>App expires: {app.preview_expires_at}</p>}
        {unavailable ? (
          <div>
            <p className="font-medium">Workload set unavailable</p>
            <p className="mt-1 text-muted-foreground">App-level information only.</p>
          </div>
        ) : refused ? (
          <p role="status" className="text-muted-foreground">
            Only the member who created {app.preview_of_slug ?? 'its app'}, while an owner or admin
            of {organization}, can read this preview’s workload set: the API has not opened it to
            other members yet. The app-level facts above come from the app itself.
          </p>
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : query.isPending ? (
          <LoadingState message="Reading current PR head…" />
        ) : (
          data && (
            <>
              <dl className="grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">Recorded root</dt>
                  <dd>{data.root_slug}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Current commit</dt>
                  <dd className="break-all">{data.commit_sha}</dd>
                </div>
              </dl>
              {repo && /^[\w.-]+\/[\w.-]+$/.test(repo) && (
                <a
                  href={`https://github.com/${repo}/pull/${data.pr_number}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand hover:underline"
                >
                  Open pull request
                </a>
              )}
              <p className={ready ? 'font-medium text-brand' : 'font-medium'}>
                {ready ? 'Ready for this commit' : `Not ready · ${data.phase}`}
              </p>
              <p>{data.summary}</p>
              <p className="text-muted-foreground">
                {data.live_workloads}/{data.total_workloads} expected workloads live for this
                commit.
              </p>
              <ul className="divide-y divide-border well rounded-xl bg-muted/40">
                {data.members.map((member) => (
                  <li key={member.app_id || member.workload_name} className="space-y-2 p-3">
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="font-medium">{member.workload_name}</span>
                      <span>{member.deployment_status || 'Unknown'}</span>
                    </div>
                    <p>
                      {member.slug || 'Missing app'} · app {member.app_status} · preview{' '}
                      {member.preview_state}
                    </p>
                    <p className="break-all text-xs text-muted-foreground">
                      Current-head deployment: {member.deployment_id || 'None reported'}
                    </p>
                    {member.expires_at && <p className="text-xs">Expires: {member.expires_at}</p>}
                    {member.links && (
                      <div className="flex flex-wrap gap-3 text-xs">
                        {Object.entries(member.links).map(([label, value]) => {
                          const href = evidenceHref(value);
                          return href ? (
                            <a
                              key={label}
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-brand hover:underline"
                            >
                              {label === 'url' ? 'Open preview' : `${label} API`}
                            </a>
                          ) : null;
                        })}
                      </div>
                    )}
                    {member.changes_from_production && (
                      <details>
                        <summary className="cursor-pointer text-xs">
                          Changes from production
                        </summary>
                        <p className="mt-2 text-xs">
                          Artifact:{' '}
                          {member.changes_from_production.artifact_changed
                            ? 'changed'
                            : 'unchanged'}
                          . Configuration groups:{' '}
                          {member.changes_from_production.configuration_changed_groups.join(', ') ||
                            'none reported'}
                          .
                        </p>
                        <p className="mt-1 break-all text-xs">
                          Preview artifact:{' '}
                          {member.changes_from_production.preview_artifact.image_digest ||
                            member.changes_from_production.preview_artifact.commit_sha ||
                            member.changes_from_production.preview_artifact.deployment_id ||
                            'unknown'}
                        </p>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )
        )}
      </div>
    </Panel>
  );
}
function PreviewAppDiscovery({ accountId, slug }: { accountId: string; slug: string }) {
  const query = usePreviewApp(accountId, slug);
  const [open, setOpen] = useState(false);
  // An app read failure is not evidence that this is a production app.
  if (query.isError)
    return <p className="text-xs text-muted-foreground">Preview identity unavailable.</p>;
  if (!query.data?.preview_of_slug) return null;
  const app = query.data;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 well rounded-xl bg-muted/40 p-3 text-sm">
        <p>
          Preview of {app.preview_of_slug}
          {app.preview_pr_number ? ` · PR #${app.preview_pr_number}` : ' · Developer preview'}
        </p>
        <Button size="sm" variant="outline" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Hide preview details' : 'Inspect preview workload set'}
        </Button>
      </div>
      {open &&
        (app.preview_pr_number ? (
          <PreviewWorkloadSet accountId={accountId} app={app} />
        ) : (
          <p className="text-sm text-muted-foreground">
            Workload set unavailable. Developer preview; app-level information only.
          </p>
        ))}
    </div>
  );
}
export function PreviewDiscovery({ slug }: { slug: string }) {
  const { account } = useAuth();
  return account ? (
    <PreviewAppDiscovery key={`${account.id}:${slug}`} accountId={account.id} slug={slug} />
  ) : null;
}
type ProjectPreviewsProps = {
  accountId: string;
  projectId: string;
  projectSlug: string;
  parents: string[];
  selected?: string;
  onSelect: (slug?: string) => void;
};
/**
 * Personal discovery reads GET /v1/apps, the signed-in account's own apps, so
 * a company's project reads the organization's inventory instead
 * (GET /v1/orgs/{slug}/apps), where a preview carries its parent's
 * organization and project (faas handlers_preview_create.go:211, :216).
 */
export function ProjectPreviews(props: ProjectPreviewsProps) {
  const { org, label } = useWorkspaceTarget();
  if (org) return <CompanyProjectPreviews {...props} org={org} label={label} />;
  return <PersonalProjectPreviews {...props} />;
}
/**
 * A company project's previews. The inventory (OrgAppSummary) has no preview
 * fields, so a preview is known by its reserved `pr-{N}-{parent}` slug (faas
 * pkg/api/app_slug.go:39-43) and the project's id; selecting one reads the app
 * itself, a route every member reaches (appaccess/routes.go:28).
 */
function CompanyProjectPreviews({
  accountId,
  projectId,
  projectSlug,
  parents,
  selected,
  onSelect,
  org,
  label,
}: ProjectPreviewsProps & { org: string; label: string }) {
  const [open, setOpen] = useState(Boolean(selected));
  const [limit, setLimit] = useState(10);
  const shown = open || Boolean(selected);
  const query = useOrgApps(shown ? org : null);
  const candidates = (query.data?.apps ?? []).flatMap((app) => {
    const preview = parsePreviewSlug(app.slug);
    return preview &&
      preview.prNumber > 0 &&
      app.project_id === projectId &&
      parents.includes(preview.parent)
      ? [{ id: app.id, slug: app.slug, ...preview }]
      : [];
  });
  const found = candidates.find((item) => item.slug === selected);
  return (
    <Panel
      title="PR previews"
      help={`${label}’s previews of this project's apps. The list names each preview; select one for its pull request state and expiry.`}
    >
      <div className="space-y-4 p-4">
        <Button
          size="sm"
          variant="outline"
          aria-expanded={shown}
          onClick={() => {
            setOpen(!open);
            if (selected) onSelect(undefined);
          }}
        >
          {shown ? 'Hide previews' : 'Browse previews'}
        </Button>
        {shown &&
          (query.isError ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          ) : query.isPending ? (
            <LoadingState message="Loading preview apps…" />
          ) : (
            <>
              <ul aria-label={`Previews of ${projectSlug}`} className="space-y-2">
                {candidates.slice(0, limit).map((item) => (
                  <li key={item.id}>
                    <Button
                      size="sm"
                      variant={item.slug === selected ? 'secondary' : 'ghost'}
                      onClick={() => onSelect(item.slug)}
                    >
                      {item.slug} · PR #{item.prNumber} of {item.parent}
                    </Button>
                  </li>
                ))}
              </ul>
              {!candidates.length && (
                <p className="text-sm text-muted-foreground">No project preview apps reported.</p>
              )}
              {candidates.length > limit && (
                <Button size="sm" variant="outline" onClick={() => setLimit(limit + 10)}>
                  Show 10 more previews
                </Button>
              )}
              {selected && !found && (
                <p role="alert" className="text-sm text-destructive">
                  Selected preview is unavailable in this project.
                </p>
              )}
              {found && (
                <CompanyPreviewSelection
                  key={`${accountId}:${found.slug}`}
                  accountId={accountId}
                  slug={found.slug}
                  organization={label}
                />
              )}
            </>
          ))}
      </div>
    </Panel>
  );
}
function CompanyPreviewSelection({
  accountId,
  slug,
  organization,
}: {
  accountId: string;
  slug: string;
  organization: string;
}) {
  const query = usePreviewApp(accountId, slug);
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (query.isPending) return <LoadingState message="Reading preview…" />;
  return <PreviewWorkloadSet accountId={accountId} app={query.data} organization={organization} />;
}
function PersonalProjectPreviews({
  accountId,
  projectSlug,
  parents,
  selected,
  onSelect,
}: ProjectPreviewsProps) {
  const [open, setOpen] = useState(Boolean(selected));
  const [limit, setLimit] = useState(10);
  const query = useProjectPreviewApps(accountId, projectSlug, open || Boolean(selected));
  const candidates = [
    ...new Map(
      (query.data ?? [])
        .filter(
          (app) =>
            app.preview_of_slug &&
            parents.includes(app.preview_of_slug) &&
            (app.preview_pr_number ?? 0) > 0
        )
        .map((app) => [app.slug, app])
    ).values(),
  ];
  const app = candidates.find((item) => item.slug === selected);
  return (
    <Panel title="PR previews">
      <div className="space-y-4 p-4">
        <Button
          size="sm"
          variant="outline"
          aria-expanded={open || Boolean(selected)}
          onClick={() => {
            setOpen(!open);
            if (selected) onSelect(undefined);
          }}
        >
          {open || selected ? 'Hide previews' : 'Browse previews'}
        </Button>
        {(open || selected) &&
          (query.isError ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          ) : query.isPending ? (
            <LoadingState message="Loading preview apps…" />
          ) : (
            <>
              <ul className="space-y-2">
                {candidates.slice(0, limit).map((item) => (
                  <li key={item.id}>
                    <Button
                      size="sm"
                      variant={item.slug === selected ? 'secondary' : 'ghost'}
                      onClick={() => onSelect(item.slug)}
                    >
                      {item.slug} · PR #{item.preview_pr_number} ·{' '}
                      {item.preview_pr_state ?? 'unknown'}
                    </Button>
                  </li>
                ))}
              </ul>
              {!candidates.length && (
                <p className="text-sm text-muted-foreground">No project preview apps reported.</p>
              )}
              {candidates.length > limit && (
                <Button size="sm" variant="outline" onClick={() => setLimit(limit + 10)}>
                  Show 10 more previews
                </Button>
              )}
              {selected && !app && (
                <p role="alert" className="text-sm text-destructive">
                  Selected preview is unavailable in this project.
                </p>
              )}
              {app && (
                <PreviewWorkloadSet
                  key={`${accountId}:${app.slug}`}
                  accountId={accountId}
                  app={app}
                />
              )}
            </>
          ))}
      </div>
    </Panel>
  );
}
