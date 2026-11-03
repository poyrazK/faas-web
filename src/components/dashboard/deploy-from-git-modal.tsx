import { useRef, useState } from 'react';
import { WarningTriangle } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { CopyableId } from '@/components/ui/copyable-id';
import { Modal } from '@/components/ui/modal';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { RepoPicker } from '@/components/dashboard/repo-picker';
import { SegmentedControl } from '@/components/dashboard/tabs';
import {
  useApp,
  useAppRepoBinding,
  useBindRepo,
  useDeployFromRef,
  useInstallRepos,
} from '@/lib/api/queries';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  reviewBlocker,
  reviewedDeployBody,
  reviewedRollout,
  useReviewSource,
  type ReviewedRollout,
  type SourceReview,
} from '@/lib/api/source-review';
import { useAuth } from '@/lib/auth';
import { useCapabilityAccess } from '@/lib/api/capabilities';
import { releaseAtProblem } from '@/lib/api/scheduled-releases';
import { InlinePhase, queryPhase } from './primitives';
import { FrozenRefusal, localInputToIso, localZone, zonedTime } from './release-freezes';
import { ReleaseChannelPicker } from './release-channel-picker';

export interface AcceptedDeploy {
  id: string;
  repo: string;
  ref: string;
}

type DeployMode = 'deploy' | 'review';
const MODES = [
  { key: 'deploy', label: 'Build and deploy' },
  { key: 'review', label: 'Review first' },
] as const;

/** The two answers that mean the review no longer describes what would be deployed. */
type ReviewConflict = 'source_ref_stale' | 'release_review_changed';

const ROLLOUT_COPY: Record<ReviewedRollout, { action: string; after: string }> = {
  stage: {
    action: 'Stage at 0%',
    after: 'It goes live with no traffic; promote it from the release when you are ready.',
  },
  service: {
    action: 'Roll out reviewed commit',
    after:
      'Once it is live, traffic moves to it through readiness and drain; there is no 0% stage.',
  },
  worker: {
    action: 'Roll out reviewed commit',
    after: 'Once it is live, it activates as the newest worker generation; there is no 0% stage.',
  },
};

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
 *
 * "Review first" is the reviewed-source release (faas
 * handlers_source_review.go): `source-review` resolves the ref to one commit
 * and pins the app's release state without building, and the deploy then
 * sends that review as `expected_source`. apid refuses with `source_ref_stale`
 * when the repository, installation, commit or source root moved, and with
 * `release_review_changed` when the configuration or serving release did; both
 * change nothing, and the answer is a fresh review. It never binds the app.
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
  const confirm = useConfirm();
  const deployFromRef = useDeployFromRef(appSlug);
  const bindRepo = useBindRepo(appSlug);
  const binding = useAppRepoBinding(appSlug, { enabled: open });
  const bound = binding.data?.state === 'bound' ? binding.data : null;

  const [mode, setMode] = useState<DeployMode>('deploy');
  const [repo, setRepo] = useState('');
  const [ref, setRef] = useState('main');
  const [error, setError] = useState<string | null>(null);
  // The repository the last deploy was refused for as ambiguous.
  const [ambiguous, setAmbiguous] = useState<string | null>(null);
  const [prefilledFrom, setPrefilledFrom] = useState<string | null>(null);
  // A production release refused by a deploy freeze (release_frozen), and the
  // deploy to resend with an audited override_freeze reason.
  const [frozen, setFrozen] = useState<{
    error: ApiError;
    resend: (reason: string) => void;
  } | null>(null);
  // Build now and start the rollout later (release_at, scheduled-releases).
  const schedules = useCapabilityAccess('scheduled-releases');
  const [later, setLater] = useState(false);
  const [releaseAt, setReleaseAt] = useState('');
  const [notify, setNotify] = useState<string[]>([]);
  const releaseAtIso = later ? localInputToIso(releaseAt) : null;
  const releaseAtError = later ? releaseAtProblem(releaseAtIso) : undefined;

  const reviewSource = useReviewSource(appSlug);
  // The workload mode decides how a reviewed commit reaches traffic.
  const app = useApp(appSlug, { enabled: open && mode === 'review' });
  const [review, setReview] = useState<SourceReview | null>(null);
  const [conflict, setConflict] = useState<ReviewConflict | null>(null);
  // A review answered after its inputs were edited describes nothing on screen.
  const reviewSeq = useRef(0);
  const dropReview = () => {
    reviewSeq.current += 1;
    setReview(null);
    setConflict(null);
  };

  const boundSource = bound?.repo_full_name
    ? `${bound.repo_full_name}@${bound.production_branch || 'main'}`
    : null;
  if (open && boundSource && prefilledFrom !== boundSource) {
    setPrefilledFrom(boundSource);
    setRepo(bound?.repo_full_name ?? '');
    setRef(bound?.production_branch || 'main');
    setReview(null);
    setConflict(null);
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

  const validSource = /^[^/\s]+\/[^/\s]+$/.test(repo.trim()) && Boolean(ref.trim());
  const appPhase = queryPhase({ error: app.error, loading: app.isPending });
  const executionMode = app.data?.manifest?.execution_mode;
  const rollout = app.data ? reviewedRollout(executionMode) : null;
  const blocker = review && rollout ? reviewBlocker(review, rollout) : null;

  const submit = ({
    justBound = false,
    override,
  }: { justBound?: boolean; override?: string } = {}) => {
    const source = { repo: repo.trim(), ref: ref.trim() };
    if (releaseAtError) {
      setError(releaseAtError);
      return;
    }
    const schedule = releaseAtIso
      ? { release_at: releaseAtIso, ...(notify.length ? { release_notify: notify } : {}) }
      : {};
    setError(null);
    setAmbiguous(null);
    setFrozen(null);
    onSubmissionError(null);
    // Read before the build is accepted: a failed or pending binding read
    // means the current binding is unknown, and unknown is never overwritten.
    const connectPushes =
      !justBound &&
      binding.data !== undefined &&
      binding.data.state !== 'bound' &&
      installationId > 0;
    void deployFromRef
      .mutateAsync({
        ...source,
        format: 'tarball',
        ...schedule,
        ...(override ? { override_freeze: override } : {}),
      })
      .then((deployment) => {
        onAccepted({ id: deployment.id, ...source });
        onClose();
        toast({
          kind: 'success',
          title: 'Build accepted',
          description: releaseAtIso
            ? `${source.repo}@${source.ref} is queued; it waits without traffic until ${scheduledAt(releaseAtIso)}.`
            : `${source.repo}@${source.ref} is queued.`,
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
        if (err instanceof ApiError && err.code === 'release_frozen') {
          setFrozen({ error: err, resend: (reason) => submit({ justBound, override: reason }) });
          return;
        }
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

  const runReview = () => {
    const source = { repo: repo.trim(), ref: ref.trim() };
    dropReview();
    setError(null);
    const seq = reviewSeq.current;
    void reviewSource
      .mutateAsync(source)
      .then((result) => {
        if (reviewSeq.current === seq) setReview(result);
      })
      .catch((err: unknown) => {
        if (reviewSeq.current === seq) setError(errorMessage(err));
      });
  };

  const deployReviewed = (override?: string) => {
    if (!review || !rollout || blocker) return;
    const pinned = review;
    setError(null);
    setConflict(null);
    setFrozen(null);
    onSubmissionError(null);
    void deployFromRef
      .mutateAsync({
        ...reviewedDeployBody(pinned, rollout),
        ...(override ? { override_freeze: override } : {}),
      })
      .then((deployment) => {
        onAccepted({ id: deployment.id, repo: pinned.repo, ref: pinned.commit_sha });
        onClose();
        toast({
          kind: 'success',
          title: rollout === 'stage' ? 'Reviewed commit staged' : 'Reviewed rollout started',
          description: `${pinned.repo}@${pinned.commit_sha.slice(0, 12)} is queued. ${ROLLOUT_COPY[rollout].after}`,
        });
      })
      .catch((err: unknown) => {
        if (
          err instanceof ApiError &&
          (err.code === 'source_ref_stale' || err.code === 'release_review_changed')
        ) {
          dropReview();
          setConflict(err.code);
          return;
        }
        if (err instanceof ApiError && err.code === 'release_frozen') {
          setFrozen({ error: err, resend: (reason) => deployReviewed(reason) });
          return;
        }
        const message = errorMessage(err);
        setError(message);
        onSubmissionError(message);
        toast({ kind: 'error', title: 'Could not start the deploy', description: message });
      });
  };

  // A scheduled deploy decides when production changes; it asks first.
  const deployNowOrLater = async () => {
    if (!releaseAtIso || releaseAtError) return submit();
    const ok = await confirm({
      title: `Build now and release ${appName} later?`,
      description: `The build starts now and the release waits live without traffic. At ${scheduledAt(releaseAtIso)} its production rollout starts with the app’s release policy, and production moves off the release serving now. A freeze active then stops it; any other pending schedule of ${appName} is cancelled.`,
      confirmLabel: 'Schedule release',
    });
    if (ok) submit();
  };

  // Releasing into a freeze is audited and changes what ships; it asks first.
  const deployAnyway = async (reason: string) => {
    if (!frozen) return;
    const ok = await confirm({
      title: `Deploy ${appName} into the freeze?`,
      description: `${appName}’s production releases are frozen. This release goes out anyway, and the override is recorded in the audit log with the freezes it overrides and your reason, “${reason}”.`,
      confirmLabel: 'Deploy anyway',
      destructive: true,
    });
    if (ok) frozen.resend(reason);
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

  const footer =
    mode === 'deploy' ? (
      <Button
        size="sm"
        disabled={!validSource}
        busy={deployFromRef.isPending}
        onClick={() => void deployNowOrLater()}
      >
        Deploy
      </Button>
    ) : review && rollout ? (
      <Button
        size="sm"
        disabled={Boolean(blocker)}
        busy={deployFromRef.isPending}
        onClick={() => deployReviewed()}
      >
        {ROLLOUT_COPY[rollout].action}
      </Button>
    ) : (
      <Button
        size="sm"
        disabled={!validSource || !rollout}
        busy={reviewSource.isPending}
        onClick={runReview}
      >
        Review
      </Button>
    );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Deploy ${appName}`}
      description={
        mode === 'review'
          ? 'Pins one commit and the app’s release state first, then deploys exactly that.'
          : bound?.repo_full_name
            ? `Builds a ref from ${bound.repo_full_name} and ships it when the build succeeds. Pushes keep deploying ${bound.production_branch || 'main'}.`
            : 'Builds a ref from the repository you choose and ships it when the build succeeds.'
      }
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          {footer}
        </>
      }
    >
      <div className="grid gap-4">
        <SegmentedControl
          label="How to deploy"
          value={mode}
          options={MODES}
          onChange={(next) => {
            setMode(next);
            setError(null);
            setFrozen(null);
          }}
        />
        {frozen && (
          <FrozenRefusal
            error={frozen.error}
            busy={deployFromRef.isPending}
            action="Deploy anyway"
            onOverride={(reason) => void deployAnyway(reason)}
          />
        )}
        {mode === 'deploy' && ambiguous && (
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
        {mode === 'review' && conflict && (
          <div role="alert" className="flex flex-col gap-2 text-xs">
            <p className="text-[color:var(--status-critical)]">
              {conflict === 'source_ref_stale'
                ? 'The source changed after it was reviewed: the repository, its installation, the commit or the app’s source root no longer match the review. Nothing was deployed.'
                : 'The app’s configuration or serving release changed after the review, so nothing was deployed.'}
            </p>
            <p className="text-muted-foreground">
              Review again to pin what is there now, and check it before deploying.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="self-start"
              busy={reviewSource.isPending}
              onClick={runReview}
            >
              Review again
            </Button>
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
              dropReview();
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="flex flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Ref</span>
            <input
              value={ref}
              onChange={(e) => {
                setRef(e.target.value);
                dropReview();
              }}
              placeholder={
                mode === 'review' ? 'main, or a full commit SHA' : 'main, a tag, or a commit'
              }
              aria-describedby={mode === 'review' ? 'deploy-git-ref-hint' : undefined}
              spellCheck={false}
              className="h-9 rounded-md border border-border bg-background px-3 font-mono text-sm outline-none focus:border-brand/50"
            />
          </label>
          {mode === 'review' && (
            <span id="deploy-git-ref-hint" className="text-xs text-muted-foreground">
              A branch is resolved once, here. For a tag, use its commit SHA.
            </span>
          )}
        </div>
        {mode === 'deploy' && schedules.access === 'on' && (
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={later} onChange={(e) => setLater(e.target.checked)} />
              Build now, start the production rollout later
            </label>
            {later && (
              <>
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="deploy-git-release-at"
                    className="label-mono text-muted-foreground"
                  >
                    Start the rollout
                  </label>
                  <input
                    id="deploy-git-release-at"
                    type="datetime-local"
                    value={releaseAt}
                    onChange={(e) => setReleaseAt(e.target.value)}
                    aria-invalid={Boolean(releaseAt && releaseAtError) || undefined}
                    className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand/50"
                  />
                  <span className="text-xs text-muted-foreground">
                    In your time zone, {localZone()}; at most 7 days ahead. Until then the release
                    waits live without traffic, and freezes are checked at that time.
                  </span>
                </div>
                <ReleaseChannelPicker
                  value={notify}
                  onChange={setNotify}
                  idPrefix="deploy-git-notify"
                  legend="Tell when it starts or cannot"
                />
              </>
            )}
          </div>
        )}
        {mode === 'review' && (
          <ReviewedSourceBody
            appPhase={appPhase}
            appError={app.error}
            onRetryApp={() => void app.refetch()}
            executionMode={executionMode}
            rollout={rollout}
            review={review}
            blocker={blocker}
          />
        )}
      </div>
    </Modal>
  );
}

const scheduledAt = zonedTime;

/** What a review pins and how the deploy will use it, before anything is sent. */
function ReviewedSourceBody({
  appPhase,
  appError,
  onRetryApp,
  executionMode,
  rollout,
  review,
  blocker,
}: {
  appPhase: ReturnType<typeof queryPhase>;
  appError: unknown;
  onRetryApp: () => void;
  executionMode: string | null | undefined;
  rollout: ReviewedRollout | null;
  review: SourceReview | null;
  blocker: string | null;
}) {
  if (appPhase !== 'ready')
    return (
      <InlinePhase
        phase={appPhase}
        error={appError}
        loadingMessage="Reading the app’s workload mode…"
        onRetry={onRetryApp}
      />
    );
  if (!rollout)
    return (
      <p className="text-xs text-muted-foreground">
        Reviewed releases cover request, service and worker apps; this app runs in{' '}
        <code className="font-mono">{executionMode}</code> mode. Deploy it with Build and deploy.
      </p>
    );
  const serving = review?.release_review.serving_deployment_ids ?? [];
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Gregale resolves the ref to one commit and pins this app&apos;s configuration and serving
        release, without building. Deploying then builds exactly that commit. The repository&apos;s
        triggers, workflows, operations and release command are not imported; workflows and
        operations stay as the serving release has them. {ROLLOUT_COPY[rollout].after}
      </p>
      {review && (
        <section aria-label="Reviewed source" className="rounded-md border border-border p-3">
          <p className="label-mono mb-2 text-muted-foreground">Reviewed source</p>
          <dl className="grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-[7rem_minmax(0,1fr)]">
            <dt className="text-muted-foreground">Commit</dt>
            <dd className="min-w-0">
              <CopyableId value={review.commit_sha} label="commit" />
            </dd>
            <dt className="text-muted-foreground">Repository</dt>
            <dd className="min-w-0 [overflow-wrap:anywhere]">
              <span className="font-mono">{review.repo}</span>
              <span className="text-muted-foreground">
                {' '}
                · installation {review.installation_id}
              </span>
            </dd>
            <dt className="text-muted-foreground">Source root</dt>
            <dd className="font-mono">{review.source_root || '/'}</dd>
            <dt className="text-muted-foreground">Configuration</dt>
            <dd className="min-w-0">
              <CopyableId
                value={review.release_review.configuration_hash}
                label="configuration hash"
              />
            </dd>
            <dt className="text-muted-foreground">Serving</dt>
            <dd className="flex min-w-0 flex-wrap gap-x-3">
              {serving.length === 0 ? (
                <span className="text-muted-foreground">Nothing serves yet</span>
              ) : (
                serving.map((id) => <CopyableId key={id} value={id} label="serving deployment" />)
              )}
            </dd>
          </dl>
        </section>
      )}
      {blocker && (
        <p role="status" className="flex items-start gap-1.5 text-xs">
          <WarningTriangle
            aria-hidden
            className="mt-0.5 h-3.5 w-3.5 shrink-0"
            style={{ color: 'var(--status-warning)' }}
          />
          <span>{blocker}</span>
        </p>
      )}
    </div>
  );
}
