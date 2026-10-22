import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { RepoPicker } from '@/components/dashboard/repo-picker';
import {
  useAppRepoBinding,
  useBindRepo,
  useDeployFromRef,
  useInstallRepos,
} from '@/lib/api/queries';
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
 *
 * A repository reachable from more than one of the account's installations
 * answers `github_install_ambiguous`. The deploy body cannot name an
 * installation (apid rejects unknown fields), but an app binding for that
 * repository wins over the scan that found two (apid `resolveInstallToken`).
 * So when the installation the console knows can see the repository, the
 * modal offers to bind the app to it and deploy again; otherwise the fix is
 * on GitHub, and the modal says so.
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
  // The repository the last deploy was refused for as ambiguous.
  const [ambiguous, setAmbiguous] = useState<string | null>(null);
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
  // Same query (and cache entry) as the picker's list.
  const installRepos = useInstallRepos(installationId || null, account?.id);
  const canBindAmbiguous =
    ambiguous !== null &&
    installationId > 0 &&
    (installRepos.data ?? []).some((r) => r.full_name.toLowerCase() === ambiguous.toLowerCase());
  const installationName =
    binding.data?.github_login && binding.data.installation_id === installationId
      ? `the ${binding.data.github_login} installation`
      : 'your connected installation';

  const submit = ({ justBound = false }: { justBound?: boolean } = {}) => {
    const source = { repo: repo.trim(), ref: ref.trim() };
    setError(null);
    setAmbiguous(null);
    onSubmissionError(null);
    // Read before the build is accepted: a failed or pending binding read
    // means the current binding is unknown, and unknown is never overwritten.
    const connectPushes =
      !justBound &&
      binding.data !== undefined &&
      binding.data.state !== 'bound' &&
      installationId > 0;
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
          setAmbiguous(source.repo);
          toast({
            kind: 'error',
            title: 'Could not start the deploy',
            description: `${source.repo} is reachable from more than one GitHub installation.`,
          });
          return;
        }
        const message = errorMessage(err);
        setError(message);
        onSubmissionError(message);
        toast({ kind: 'error', title: 'Could not start the deploy', description: message });
      });
  };

  // A binding for this exact repository decides the installation, so bind
  // first and retry; the retry must not bind a second time.
  const bindAndDeploy = () => {
    if (!ambiguous) return;
    const target = ambiguous;
    setError(null);
    void bindRepo
      .mutateAsync({ installationId, repo: target })
      .then(() => {
        toast({
          kind: 'success',
          title: 'Push-to-deploy connected',
          description: `Pushes to ${target}'s default branch now deploy ${appName}.`,
        });
        submit({ justBound: true });
      })
      .catch((err: unknown) => setError(`Could not bind ${appName}. ${errorMessage(err)}`));
  };

  const boundElsewhere =
    bound?.repo_full_name && ambiguous && bound.repo_full_name !== ambiguous
      ? bound.repo_full_name
      : null;

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
            onClick={() => submit()}
          >
            Deploy
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {ambiguous && (
          <div role="alert" className="flex flex-col gap-2 text-xs">
            <p className="text-[color:var(--status-critical)]">
              {ambiguous} is reachable from more than one of your GitHub installations, so Gregale
              cannot tell which one to build from.
            </p>
            {canBindAmbiguous ? (
              <>
                <p className="text-muted-foreground">
                  Binding {appName} to {ambiguous} through {installationName} settles it: deploys of
                  a bound repository use the bound installation.{' '}
                  {boundElsewhere
                    ? `Pushes to ${boundElsewhere} stop deploying ${appName}; pushes to ${ambiguous}'s default branch deploy it instead.`
                    : `Pushes to ${ambiguous}'s default branch will deploy ${appName}.`}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="self-start"
                  busy={bindRepo.isPending}
                  onClick={bindAndDeploy}
                >
                  Bind and deploy
                </Button>
              </>
            ) : (
              <p className="text-muted-foreground">
                The installation Gregale knows for your account cannot see it, so the console cannot
                choose for you. On GitHub, open each installation&apos;s Repository access and
                remove {ambiguous} from all but one, then deploy again.
              </p>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="text-xs text-[color:var(--status-critical)]">
            {error}
          </p>
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
