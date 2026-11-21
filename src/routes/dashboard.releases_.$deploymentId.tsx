import { useEffect } from 'react';
import { createFileRoute, Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { ErrorState, LoadingState, queryPhase } from '@/components/dashboard/primitives';
import {
  validateReleasePageSearch,
  type ReleasePageSearch,
} from '@/components/dashboard/release-page/panels';
import { resolveAppSlug } from '@/components/dashboard/release-page/resolve-app';
import { useAuth } from '@/lib/auth';
import { useApps, useDeployment } from '@/lib/api/queries';
import { useOrgApps, useWorkspaceTarget } from '@/lib/api/workspace-apps';
import { consoleHead } from '@/lib/seo';

/**
 * A release by its ID alone, for links that do not know its app (the command
 * palette, instance detail, old bookmarks). It finds the app and replaces
 * itself with the release's page, keeping the open popup.
 */
export const Route = createFileRoute('/dashboard/releases_/$deploymentId')({
  component: ReleaseResolver,
  validateSearch: validateReleasePageSearch,
  head: () => consoleHead('releases'),
});

function ReleaseResolver() {
  const { deploymentId } = useParams({ strict: false }) as { deploymentId: string };
  const search = useSearch({ strict: false }) as ReleasePageSearch;
  const navigate = useNavigate();
  const { account } = useAuth();
  const deployment = useDeployment(deploymentId);
  const apps = useApps();
  const target = useWorkspaceTarget(account?.id);
  const orgApps = useOrgApps(target.org);
  const slug = deployment.data
    ? resolveAppSlug(deployment.data.app_id, apps.data, orgApps.data?.apps)
    : undefined;

  useEffect(() => {
    if (!slug) return;
    void navigate({
      to: '/dashboard/apps/$appSlug/releases/$deploymentId',
      params: { appSlug: slug, deploymentId },
      search: search as never,
      replace: true,
    });
  }, [slug, deploymentId, search, navigate]);

  // Only wait on the workspace inventory when there is a workspace to read:
  // a disabled query reports pending forever.
  const phase = queryPhase({
    error: deployment.error ?? apps.error,
    loading:
      deployment.isPending ||
      apps.isPending ||
      !target.ready ||
      (Boolean(target.org) && orgApps.isPending),
  });
  if (phase === 'error' || phase === 'unreachable')
    return (
      <ErrorState
        error={deployment.error ?? apps.error}
        onRetry={() => {
          void deployment.refetch();
          void apps.refetch();
        }}
      />
    );
  if (phase === 'loading' || slug) return <LoadingState message="Opening the release…" />;
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-sm text-muted-foreground">
        This release belongs to an app outside this workspace.
      </p>
      <Link
        to="/dashboard/releases"
        className="text-sm text-brand underline-offset-4 hover:underline"
      >
        Back to Releases
      </Link>
    </div>
  );
}
