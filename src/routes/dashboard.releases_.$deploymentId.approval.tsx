import { createFileRoute, Link } from '@tanstack/react-router';
import { CapabilityGate } from '@/components/dashboard/capability-gate';
import { DeploymentDiff } from '@/components/dashboard/deployment-diff';
import { PageHeader, Panel } from '@/components/dashboard/primitives';
import { ReleaseApproval } from '@/components/dashboard/release-approvals';
import { useDeployment } from '@/lib/api/queries';
import { useReleaseApproval } from '@/lib/api/release-approvals';
import { pageHead } from '@/lib/seo';

interface ApprovalSearch extends Record<string, unknown> {
  intent?: 'approve' | 'reject';
}

/**
 * The page a waiting release's Slack and email buttons open
 * (`/dashboard/releases/<id>/approval?intent=…`, faas release_approvals.go:461-468,
 * release_approval_page.go). It decides through the API with the signed-in
 * session, so the organization role, MFA and self-approval checks apply; the
 * intent only prepares the action. Not nested under Releases: it is its own
 * page, reached from a link.
 */
export const Route = createFileRoute('/dashboard/releases_/$deploymentId/approval')({
  component: ReleaseApprovalPage,
  validateSearch: (raw: Record<string, unknown>): ApprovalSearch => ({
    ...raw,
    intent: raw.intent === 'approve' || raw.intent === 'reject' ? raw.intent : undefined,
  }),
  head: () => pageHead({ title: 'Release approval' }),
});

export function ReleaseApprovalPage() {
  const { deploymentId } = Route.useParams();
  const { intent } = Route.useSearch();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Release approval"
        description="Approve the release to let its rollout continue, or reject it to abort the rollout."
        actions={
          <Link
            to="/dashboard/releases"
            search={{ deployment: deploymentId, releaseSection: 'lifecycle' }}
            className="text-sm text-brand underline-offset-4 hover:underline"
          >
            Open the release
          </Link>
        }
      />
      <CapabilityGate capability="release-approvals" title="Release approval">
        <ApprovalBody deploymentId={deploymentId} intent={intent} />
      </CapabilityGate>
    </div>
  );
}

function ApprovalBody({
  deploymentId,
  intent,
}: {
  deploymentId: string;
  intent?: 'approve' | 'reject';
}) {
  const deployment = useDeployment(deploymentId);
  const status = useReleaseApproval(deploymentId);
  const release = deployment.data?.revision
    ? `v${deployment.data.revision}`
    : deploymentId.slice(0, 8);
  return (
    <>
      <Panel title={status.data ? `${status.data.app} ${release}` : release}>
        <ReleaseApproval deploymentId={deploymentId} release={release} intent={intent} />
      </Panel>
      {/* What the release changes, the same comparison the notification summarises. */}
      {deployment.data && (
        <DeploymentDiff
          deploymentId={deploymentId}
          slug={status.data?.app}
          deployment={deployment.data}
        />
      )}
    </>
  );
}
