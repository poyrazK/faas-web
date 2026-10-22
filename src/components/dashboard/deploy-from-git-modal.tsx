import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { RepoPicker } from '@/components/dashboard/repo-picker';
import { useAppRepoBinding, useBindRepo, useDeployFromRef } from '@/lib/api/queries';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useAuth } from '@/lib/auth';

export interface AcceptedDeploy {
  id: string;
  repo: string;
  ref: string;
}

/**
 * The one deploy the console can start itself: a Git ref, built server-side.
 * The image constructor wants a registry the browser has no business holding
 * credentials for.
 *
 * The app's repository binding decides what GitHub pushes deploy, and a
 * source-ref deploy never writes one. The modal starts from the bound
 * repository and branch, and only creates a binding when the app has none —
 * without naming a branch, because the console cannot tell a branch from a tag
 * or a commit. apid then binds the repository's default branch.
 */
export function DeployFromGitModal({
  open,
  onClose,
  appSlug,
  appName,
  onAccepted,
  onSubmissionError,
}: {
  open: boolean;
  onClose: () => void;
  appSlug: string;
  appName: string;
  onAccepted: (deploy: AcceptedDeploy) => void;
  onSubmissionError: (message: string | null) => void;
}) {
  const { account } = useAuth();
  const { toast } = useToast();
  const deployFromRef = useDeployFromRef(appSlug);
  const bindRepo = useBindRepo(appSlug);
  const binding = useAppRepoBinding(appSlug, { enabled: open });
  const bound = binding.data?.state === 'bound' ? binding.data : null;

  const [repo, setRepo] = useState('');
  const [ref, setRef] = useState('main');
  const [error, setError] = useState<string | null>(null);
  const [ambiguous, setAmbiguous] = useState(false);
  const [prefilledFrom, setPrefilledFrom] = useState<string | null>(null);
  const boundSource = bound?.repo_full_name
    ? `${bound.repo_full_name}@${bound.production_branch || 'main'}`
    : null;
  if (open && boundSource && prefilledFrom !== boundSource) {
    setPrefilledFrom(boundSource);
    setRepo(bound?.repo_full_name ?? '');
    setRef(bound?.production_branch || 'main');
  }

  const installationId = account?.github_install_id ? Number(account.github_install_id) : 0;

  const submit = () => {
    const source = { repo: repo.trim(), ref: ref.trim() };
    setError(null);
    setAmbiguous(false);
    onSubmissionError(null);
    // Read before the build is accepted: a failed or pending binding read
    // means the current binding is unknown, and unknown is never overwritten.
    const connectPushes =
      binding.data !== undefined && binding.data.state !== 'bound' && installationId > 0;
    void deployFromRef
      .mutateAsync({ ...source, format: 'tarball' })
      .then((deployment) => {
        onAccepted({ id: deployment.id, ...source });
        onClose();
        toast({
          kind: 'success',
          title: 'Build accepted',
          description: `${source.repo}@${source.ref} is queued.`,
        });
        if (!connectPushes) return;
        void bindRepo
          .mutateAsync({ installationId, repo: source.repo })
          .then(() =>
            toast({
              kind: 'success',
              title: 'Push-to-deploy connected',
              description: `Pushes to ${source.repo}'s default branch now deploy ${appName}.`,
            })
          )
          .catch((err: unknown) =>
            toast({
              kind: 'error',
              title: 'Could not connect push-to-deploy',
              description: `${errorMessage(err)} The build is still running.`,
            })
          );
      })
      .catch((err: unknown) => {
        // The ambiguous-installation answer has its own explanation in the
        // modal; the raw API sentence would only repeat it, here and on the
        // deployment panel behind it.
        if (err instanceof ApiError && err.code === 'github_install_ambiguous') {
          setAmbiguous(true);
          toast({
            kind: 'error',
            title: 'Could not start the deploy',
            description: `Connect ${appName} to one GitHub installation in Settings → Integrations, then deploy again.`,
          });
          return;
        }
        const message = errorMessage(err);
        setError(message);
        onSubmissionError(message);
        toast({ kind: 'error', title: 'Could not start the deploy', description: message });
      });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Deploy ${appName}`}
      description={
        bound?.repo_full_name
          ? `Builds a ref from ${bound.repo_full_name} and ships it when the build succeeds. Pushes keep deploying ${bound.production_branch || 'main'}.`
          : 'Builds a ref from the repository you choose and ships it when the build succeeds.'
      }
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!/^[^/\s]+\/[^/\s]+$/.test(repo.trim()) || !ref.trim()}
            busy={deployFromRef.isPending}
            onClick={submit}
          >
            Deploy
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {ambiguous ? (
          <p role="alert" className="text-xs text-[color:var(--status-critical)]">
            This repository is reachable from more than one GitHub installation, so Gregale cannot
            tell which one to build from. Connect {appName} to one of them in{' '}
            <Link
              to="/dashboard/settings"
              search={{ section: 'integrations' }}
              className="underline"
            >
              Settings → Integrations
            </Link>
            , then deploy again.
          </p>
        ) : (
          error && (
            <p role="alert" className="text-xs text-[color:var(--status-critical)]">
              {error}
            </p>
          )
        )}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="deploy-git-repository" className="label-mono text-muted-foreground">
            Repository
          </label>
          <RepoPicker
            id="deploy-git-repository"
            value={repo}
            unlistedNote={repo && repo === bound?.repo_full_name ? 'bound repository' : undefined}
            onChange={(next, defaultBranch) => {
              setRepo(next);
              if (defaultBranch) setRef(defaultBranch);
            }}
          />
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="label-mono text-muted-foreground">Ref</span>
          <input
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder="main, a tag, or a commit"
            spellCheck={false}
            className="h-9 rounded-md border border-border bg-background px-3 font-mono text-sm outline-none focus:border-brand/50"
          />
        </label>
      </div>
    </Modal>
  );
}
