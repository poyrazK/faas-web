import { createFileRoute, useParams } from '@tanstack/react-router';
import { ReleasePage } from '@/components/dashboard/release-page/release-page';
import { validateReleasePageSearch } from '@/components/dashboard/release-page/panels';
import { consoleHead } from '@/lib/seo';
import { withProductionBanner } from '@/components/dashboard/production-only-banner';

/**
 * A release's own page. Not nested under the app page (which has no outlet):
 * it is reached from the app's Deployments tab, the Releases list and every
 * link that used to open the release dialog.
 */
export const Route = createFileRoute('/dashboard/apps/$appSlug_/releases/$deploymentId')({
  component: withProductionBanner('releases', ReleasePageRoute),
  validateSearch: validateReleasePageSearch,
  head: () => consoleHead('releases'),
});

function ReleasePageRoute() {
  const { appSlug, deploymentId } = useParams({ strict: false }) as {
    appSlug: string;
    deploymentId: string;
  };
  return <ReleasePage key={deploymentId} appSlug={appSlug} deploymentId={deploymentId} />;
}
