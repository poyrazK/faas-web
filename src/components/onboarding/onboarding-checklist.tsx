import { Link } from '@tanstack/react-router';
import { useAuth } from '@/lib/auth';
import { useWorkspaceTarget } from '@/lib/api/workspace-apps';
import { useOnboardingInventory } from '@/lib/api/onboarding';
import { readOnboarding } from '@/lib/onboarding-draft';
import { Button } from '@/components/ui/button';

export function OnboardingChecklist() {
  const { account, user } = useAuth();
  const workspace = useWorkspaceTarget(account?.id ?? '');
  if (
    !account?.id ||
    !user ||
    account.email.toLowerCase() !== user.email.toLowerCase() ||
    !workspace.ready
  )
    return null;
  return (
    <ScopedChecklist
      key={JSON.stringify([account.id, workspace.org])}
      account={account.id}
      workspace={workspace.org}
    />
  );
}
function ScopedChecklist({ account, workspace }: { account: string; workspace: string | null }) {
  const owner = { account, workspace };
  const record = readOnboarding(owner);
  const inventory = useOnboardingInventory(owner);
  if (inventory.pending || inventory.error) return null;
  if (
    inventory.apps.some((app) =>
      inventory.deployments.some((d) => d.app_id === app.id && d.status === 'live')
    )
  )
    return null;
  const resume = Boolean(record.draft?.app || record.draft?.phase === 'unknown');
  return (
    <section
      aria-label="Finish getting started"
      className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card p-5"
    >
      <div>
        <h2 className="text-sm font-semibold">
          {resume ? 'Continue your first deployment' : 'Get your first app live'}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {resume
            ? 'Your saved app and deployment can be checked without starting another one.'
            : 'Deploy a working sample with no GitHub connection, or bring your repository.'}
        </p>
      </div>
      <Button asChild size="sm">
        <Link to="/onboarding" search={resume ? {} : { source: 'function', step: 'configure' }}>
          {' '}
          {resume ? 'Resume setup' : 'Deploy a sample'}
        </Link>
      </Button>
    </section>
  );
}
