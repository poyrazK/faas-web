import { MemorySelect } from './memory-select';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useUnsavedGuard } from '@/lib/use-unsaved-guard';
import { RepoPicker } from '@/components/dashboard/repo-picker';
import { GitHubConnectForm } from '@/components/dashboard/github-connect-form';
import { motion, useReducedMotion } from 'motion/react';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, ArrowRight, NavArrowDown } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { FieldError, Select, fieldErrorProps, useFormValidation } from '@/components/ui/field';
import { appNameError, appNameFromRepo } from './new-app-validation';
import { SCAN_SOURCE_LABEL, scanUnavailableReason } from './scan-source';
import { useToast } from '@/components/ui/toast';
import { DeploymentProgress } from '@/components/dashboard/deployment-progress';
import { PageHeader, Panel } from '@/components/dashboard/primitives';
import {
  isValidGitHubRepo,
  isValidGitRef,
  type AppSource,
  type NewAppSearch,
  type DeploymentRecoveryContext,
} from '@/components/dashboard/new-app-source';
import { TemplateCatalog } from '@/components/dashboard/template-catalog';
import { ProjectImport } from '@/components/dashboard/project-import';
import { NewAppCapabilities } from './new-app-capabilities';
import { summaryRows } from './new-app-summary';
import { NewAppChooser } from './new-app-chooser';
import { NewAppHeader, NewAppReviewGrid } from './new-app-rail';
import { hasSetup, stationFor, stepForStation, type Station } from './new-app-station';
import { NewAppStage } from './new-app-layout';
import { SettingRow, SettingsSection } from './new-app-settings';
import { sourceName } from './new-app-sources';
import { ImageDeployForm } from './image-deploy-form';
import { CopyIconButton } from '@/components/ui/copy-button';
import { templateBySlug } from '@/lib/templates';
import { type Runtime } from '@/lib/mock-data';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useData } from '@/lib/store';
import { useWorkspaceTarget, workspaceCreateError } from '@/lib/api/workspace-apps';
import {
  useBindRepoFor,
  useDeployFromRefFor,
  useApps,
  useSourceRefScan,
  useTemplates,
  useUpdateAppFor,
} from '@/lib/api/queries';
import { useAuth } from '@/lib/auth';
import { useCapability } from '@/lib/api/capabilities';
import { readPrivateAppCreateContext } from '@/lib/api/bindings';
import {
  appQuotaExceeded,
  appQuotaRemaining,
  memoryAllowed,
  residentInstancesAllowed,
} from '@/lib/plan';
import { cn } from '@/lib/utils';
import { predictedAppUrl } from '@/lib/app-url';
import { FirstDeploymentRecovery } from './first-deployment-recovery';

type SourceField = 'source-git' | 'source-template' | 'repository' | 'ref';

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

/** The set `apid` accepts on `POST /v1/apps`; anything else is a 400. */
const RUNTIMES: { id: Runtime; label: string }[] = [
  { id: 'node22', label: 'Node 22' },
  { id: 'node24', label: 'Node 24' },
  { id: 'python312', label: 'Python 3.12' },
  { id: 'python313', label: 'Python 3.13' },
  { id: 'go124', label: 'Go 1.24' },
  { id: 'go124-alpine', label: 'Go 1.24 (Alpine)' },
];

const APP_TYPES: { id: 'function' | 'app'; label: string; desc: string }[] = [
  { id: 'function', label: 'Function', desc: 'Source built against a managed runtime.' },
  { id: 'app', label: 'App', desc: 'Your own container image.' },
];

// Scoped pilot sizing, with light-onboarding fallbacks.
const CONTROL =
  'h-[var(--console-control-height,2.25rem)] rounded-[var(--console-control-radius,0.375rem)]';

interface NewAppWizardProps {
  search?: NewAppSearch;
  onSearchChange?: (search: NewAppSearch, options?: { replace?: boolean }) => void;
  /** Existing direct template launches remain supported alongside URL search state. */
  templateSlug?: string;
  /** Removes dashboard chrome and keeps onboarding focused on a real Git deployment. */
  onboarding?: boolean;
  /** Called after the first source-ref deployment has been accepted. */
  onDeploymentAccepted?: () => void;
  /** A saved app can be managed even when the first source submission fails. */
  onAppCreated?: () => void;
  /** Allows onboarding to make a deliberate hand-off to the account connection screen. */
  onConnectGitHub?: () => void;
}

export function NewAppWizard(props: NewAppWizardProps) {
  // Only restoration bypasses creation. An in-flight create keeps its owner
  // mounted while it writes the durable pointer and submits the first build.
  const [restored, setRestored] = useState(props.search?.recovery);
  if (restored)
    return (
      <FirstDeploymentRecovery
        recovery={props.onSearchChange ? (props.search?.recovery ?? restored) : restored}
        onChange={(recovery) => {
          setRestored(recovery);
          props.onSearchChange?.({ ...props.search, recovery }, { replace: true });
          if (recovery.deployment) props.onDeploymentAccepted?.();
        }}
      />
    );
  return <CreateAppWizard {...props} />;
}

function CreateAppWizard({
  templateSlug: initialTemplateSlug,
  search: urlSearch,
  onSearchChange,
  onboarding = false,
  onDeploymentAccepted,
  onAppCreated,
  onConnectGitHub,
}: NewAppWizardProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { addWorkflow } = useData();
  const { account, loading: authLoading } = useAuth();
  const workspace = useWorkspaceTarget();
  const privateCapability = useCapability('private-apps');
  const reduce = useReducedMotion();
  const [localSearch, setLocalSearch] = useState<NewAppSearch>({
    source: onboarding ? 'git' : undefined,
    template: initialTemplateSlug,
  });
  // After submission, completion and retries describe the app we actually
  // created even if browser history moves to an earlier source selection.
  const [submittedSearch, setSubmittedSearch] = useState<NewAppSearch | null>(null);
  const search = submittedSearch ?? urlSearch ?? localSearch;
  const changeSearch = onSearchChange ?? setLocalSearch;
  const githubConnected = Boolean(account?.github_install_id);
  // With GitHub connected the common path is already chosen; an explicit
  // source (or a template link) in the URL always wins.
  const source =
    search.source ?? (search.template ? 'template' : githubConnected ? 'git' : undefined);
  const templateSlug = source === 'template' ? search.template : undefined;
  const sourceValidation = useFormValidation<SourceField>();
  const configureValidation = useFormValidation<'name'>();
  const setSource = (next: AppSource) => {
    sourceValidation.resetValidation();
    changeSearch({
      ...search,
      source: next,
      template: next === 'template' ? templateSlug : undefined,
      // Choosing is moving: to the source's own page, or straight to
      // Configure for Empty, which needs no setup.
      step: hasSetup(next) ? 'setup' : 'configure',
    });
  };
  const setStep = (next: number) =>
    changeSearch({
      ...search,
      source,
      step: next === 2 ? 'review' : next === 1 ? 'configure' : undefined,
    });
  // Back from a source's own page returns to the choices, marked so the URL
  // does not bounce straight back into that page.
  const toSources = () => {
    sourceValidation.resetValidation();
    changeSearch({ ...search, source, step: 'source' });
  };
  const uid = useId();
  // A template prefills runtime, memory and name; its scaffold is deployed
  // from the CLI once the app exists.
  const template = templateBySlug(templateSlug);
  // The API's starter catalog and the local scaffolds share no names, so a
  // catalog pick prefills what it can and hands the scaffold to the CLI. Only
  // the per-runtime starters name a runtime; the rest keep the default and the
  // customer chooses, rather than the wizard guessing.
  const catalog = useTemplates();
  const catalogTemplate = (catalog.data ?? []).find((t) => t.name === templateSlug);
  const picked = Boolean(template || catalogTemplate);
  const initialName = template?.slug ?? catalogTemplate?.name ?? '';
  const catalogRuntime: Runtime | null = /-node$/.test(templateSlug ?? '')
    ? 'node24'
    : /-python$/.test(templateSlug ?? '')
      ? 'python313'
      : /-go$/.test(templateSlug ?? '')
        ? 'go124'
        : null;

  const [createdId, setCreatedId] = useState<string | null>(null);
  // The endpoint the API assigned. Constructing one from the slug would be a
  // guess about the platform's hostname scheme; this is the real value.
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [repo, setRepo] = useState('');
  const [ref, setRef] = useState('main');
  const [nameDraft, setName] = useState<string | null>(null);
  const [nameTouched, setNameTouched] = useState(false);
  // A chosen repository names the app until the customer types a name of
  // their own; their typing (even clearing the field) always wins.
  const repoName = source === 'git' ? appNameFromRepo(repo) : '';
  const name = nameDraft ?? (repoName || initialName);
  const bindRepo = useBindRepoFor();
  const deployFromRef = useDeployFromRefFor();
  const updateApp = useUpdateAppFor();
  const [appTypeDraft, setAppType] = useState<'function' | 'app' | null>(null);
  const [visibility, setVisibility] = useState<'public' | 'internal'>('public');
  const [runtimeDraft, setRuntime] = useState<Runtime | null>(null);
  const runtime = runtimeDraft ?? template?.runtime ?? (picked ? catalogRuntime : null) ?? 'node22';
  // Start at the platform floor. The previous 512 MB default guaranteed a
  // failed Free-plan submission before the customer had seen the limit.
  const [memoryDraft, setMemoryMb] = useState<number | null>(null);
  const memoryMb = memoryDraft ?? template?.memoryMb ?? 128;
  const [scaleToZero, setScaleToZero] = useState(true);
  const canKeepResident = residentInstancesAllowed(account);
  const effectiveScaleToZero = scaleToZero || !canKeepResident;

  const [deploying, setDeploying] = useState(false);
  const [deploymentId, setDeploymentId] = useState<string | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const creationContext = useRef({
    accountId: account?.id ?? '',
    name,
    visibility,
    source,
    workspace: workspace.org,
  });
  const createController = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useLayoutEffect(() => {
    creationContext.current = {
      accountId: account?.id ?? '',
      name,
      visibility,
      source,
      workspace: workspace.org,
    };
  }, [account?.id, name, visibility, source, workspace.org]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      createController.current?.abort();
    };
  }, []);
  const privateAvailable =
    privateCapability.accountId === account?.id && privateCapability.state === 'available';
  const [recovery, setRecovery] = useState<DeploymentRecoveryContext>();
  const sourceRequested = useRef(false);
  function saveRecovery(next: DeploymentRecoveryContext) {
    setRecovery(next);
    onSearchChange?.({ ...search, recovery: next }, { replace: true });
  }

  // A half-filled wizard asks before it is discarded. Once the app exists
  // (or nothing was typed) leaving is free. A template's prefilled name is
  // not the user's typing — only their own edits arm the guard.
  useUnsavedGuard(
    !createdId && Boolean(repo.trim() || (name.trim() && name !== initialName)),
    undefined,
    onboarding ? '/onboarding' : '/dashboard/apps/new'
  );

  // A name prefilled from a repository can easily match an app the account
  // already has; say so on Configure rather than as a 409 after Deploy.
  const knownApps = useApps();
  const nameError =
    appNameError(name) ??
    ((knownApps.data ?? []).some((app) => app.slug === name)
      ? `You already have an app named ${name}. Choose another name.`
      : undefined);
  const nameValid = !nameError;
  const normalizedRef = ref.trim() || 'main';
  const repoValid = isValidGitHubRepo(repo);
  const refValid = isValidGitRef(normalizedRef);
  const gitSourceValid = source !== 'git' || (repoValid && refValid);
  const installId = Number(account?.github_install_id) || null;
  const scanProjectSlug = appNameFromRepo(repo) || 'app';
  const scan = useSourceRefScan({
    repo: repo.trim(),
    ref: normalizedRef,
    installId,
    projectSlug: scanProjectSlug,
    enabled: source === 'git' && githubConnected && repoValid && refValid,
  });
  const scannedWorkloads = scan.plan?.workloads ?? [];
  const scannedService = scannedWorkloads.length === 1 ? scannedWorkloads[0] : undefined;
  // The plan reports no runtime, so the only wizard field it can answer is
  // Type: a Dockerfile means the repository builds its own container image.
  const detectedType = scannedService?.dockerfile ? ('app' as const) : undefined;
  const appType = appTypeDraft ?? detectedType ?? 'function';
  const detectedFrom = scan.plan ? SCAN_SOURCE_LABEL[scan.plan.scan_source] : '';
  const scannedRootDir =
    scannedService && !['', '.', './'].includes(scannedService.root_dir.trim())
      ? scannedService.root_dir.trim()
      : '';
  // Import uploads an archive, so the repository cannot travel with it; the
  // project slug and branch it asks for can. Import keeps its own draft, so a
  // hand-off remounts it with these values rather than waiting on the URL.
  const [importHandoff, setImportHandoff] = useState<{
    seed: number;
    slug: string;
    branch: string;
  } | null>(null);
  const switchToImport = () => {
    setImportHandoff((prev) => ({
      seed: (prev?.seed ?? 0) + 1,
      slug: scanProjectSlug,
      branch: normalizedRef,
    }));
    changeSearch({
      source: 'import',
      slug: scanProjectSlug,
      branch: normalizedRef,
    });
  };
  const sourceValid =
    Boolean(source) &&
    source !== 'import' &&
    (source !== 'template' || picked) &&
    gitSourceValid &&
    (source !== 'git' || githubConnected);
  // Each reason Continue cannot go on, keyed by the control that fixes it.
  // Source-level reasons focus the card the customer most likely meant.
  const sourceErrors: Partial<Record<SourceField, string>> = {
    'source-git': !source
      ? 'Choose where the code comes from to continue.'
      : source === 'git' && !githubConnected
        ? 'Connect GitHub to deploy from a repository, or choose another source.'
        : undefined,
    'source-template':
      source === 'template' && !picked
        ? 'Choose a starter template below, or another source.'
        : undefined,
    repository:
      source === 'git' && githubConnected && !repoValid
        ? repo.trim()
          ? 'Use owner/name, like acme/api.'
          : 'Choose a repository to deploy.'
        : undefined,
    ref:
      source === 'git' && githubConnected && !refValid
        ? 'Use a valid branch, tag, or commit SHA of at most 200 characters.'
        : undefined,
  };
  const sourceShown = sourceValidation.submitAttempted;
  const sourceLevelError = sourceShown
    ? (sourceErrors['source-git'] ?? sourceErrors['source-template'])
    : undefined;
  const repoError = sourceShown ? sourceErrors.repository : undefined;
  // The ref was already checked as it was typed; keep that.
  const refError = sourceErrors.ref;
  // Reloaded URLs restore the source; missing in-memory fields return to the
  // earliest incomplete step instead of exposing an invalid review/create.
  const station: Station = stationFor({
    step: search.step,
    source,
    named: Boolean(search.source || search.template),
    sourceValid,
    nameValid,
  });
  const step = station === 'review' ? 2 : station === 'configure' ? 1 : 0;
  const normalizedStep = stepForStation(station, search.step);
  const sourcePending =
    (source === 'template' && catalog.isPending) || (source === 'git' && authLoading);
  // Replace an incomplete restored step, rather than leaving a review URL
  // armed to advance as soon as typing makes the missing fields valid.
  useEffect(() => {
    if (
      urlSearch &&
      onSearchChange &&
      !submittedSearch &&
      !sourcePending &&
      urlSearch.step !== normalizedStep
    ) {
      onSearchChange({ ...urlSearch, step: normalizedStep }, { replace: true });
    }
  }, [urlSearch, onSearchChange, submittedSearch, sourcePending, normalizedStep]);
  const maxMemoryMb = account?.limits.ram_mb ?? 128;
  const selectedMemoryMb = Math.min(memoryMb, maxMemoryMb);
  const quotaRemaining = appQuotaRemaining(account);
  const quotaExceeded = appQuotaExceeded(account);
  const limitsLoading = authLoading && !account;
  const deployBlocked =
    limitsLoading ||
    quotaExceeded ||
    !memoryAllowed(account, selectedMemoryMb) ||
    (visibility === 'internal' && !privateAvailable);

  // The platform names the app's URL after its slug, so review can show it
  // before create; the zone comes from an app the account already has.
  const predictedUrl = nameValid ? predictedAppUrl(name, knownApps.data ?? []) : undefined;

  // A disabled Deploy always says why. The plan-limit case already has its
  // own alert in the review panel, so it is not repeated here.
  const blockedReason = limitsLoading
    ? 'Checking your plan limits before creating the app…'
    : quotaExceeded
      ? undefined
      : !memoryAllowed(account, selectedMemoryMb)
        ? `${selectedMemoryMb} MB is above your plan's per-app memory. Lower it in Resource settings.`
        : visibility === 'internal' && !privateAvailable
          ? 'Internal-only apps are not confirmed for this account yet. Choose public visibility, or try again shortly.'
          : undefined;

  // What the app will be, as far as the person has said: the rail shows it as
  // it fills in, Review shows it whole, from one list.
  const rows = summaryRows({
    step: step as 0 | 1 | 2,
    source,
    repo,
    ref,
    templateName: template?.name ?? catalogTemplate?.name,
    name,
    workspaceLabel: workspace.label,
    workspaceIsOrg: Boolean(workspace.org),
    appType,
    runtimeLabel: RUNTIMES.find((r) => r.id === runtime)?.label,
    memoryMb: selectedMemoryMb,
    scaleToZero: effectiveScaleToZero,
    visibility,
    predictedUrl,
  });

  async function submitGitSource(slug: string) {
    sourceRequested.current = false;
    const installationId = Number(account?.github_install_id);
    if (!Number.isSafeInteger(installationId) || installationId <= 0) {
      throw new Error('Connect GitHub before deploying from a repository.');
    }

    await bindRepo.mutateAsync({
      slug,
      installationId,
      repo: repo.trim(),
      branch: normalizedRef,
    });
    sourceRequested.current = true;
    return deployFromRef.mutateAsync({
      slug,
      repo: repo.trim(),
      ref: normalizedRef,
      format: 'tarball',
    });
  }

  async function createFunction() {
    if (deployBlocked || !nameValid || !sourceValid) {
      return;
    }
    setDeploying(true);
    setSubmittedSearch(search);
    setSubmissionError(null);
    try {
      if (visibility === 'internal') {
        if (!account?.id) throw new Error('Account access could not be confirmed.');
        const before = { ...creationContext.current };
        const controller = new AbortController();
        createController.current = controller;
        await readPrivateAppCreateContext(account.id, account.plan, controller.signal);
        createController.current = null;
        if (!mounted.current) return;
        if (JSON.stringify(before) !== JSON.stringify(creationContext.current))
          throw new Error('Creation choices changed during access check. Review again.');
      }
      // App creation is the durable first step. The UI only advances to build
      // status after the API returns the actual deployment id.
      const created = await addWorkflow({
        name,
        memoryMb: selectedMemoryMb,
        ...(appType === 'function' ? { type: 'function', runtime } : { type: 'app' }),
        visibility,
        org: workspace.org,
      });
      setCreatedId(created.id);
      setCreatedUrl(visibility === 'internal' ? null : created.url);
      onAppCreated?.();
      const pointer: DeploymentRecoveryContext = {
        app: created.id,
        repo: repo.trim(),
        ref: normalizedRef,
        phase: 'submitting',
      };
      if (source === 'git') saveRecovery(pointer);

      const scalePromise: Promise<unknown> = !effectiveScaleToZero
        ? updateApp.mutateAsync({ slug: created.id, min_instances: 1 })
        : Promise.resolve();
      const deploymentPromise =
        source === 'git' && gitSourceValid ? submitGitSource(created.id) : Promise.resolve(null);

      const [scaleResult, deploymentResult] = await Promise.allSettled([
        scalePromise,
        deploymentPromise,
      ]);

      if (scaleResult.status === 'rejected') {
        toast({
          kind: 'error',
          title: 'App created, but configuration failed',
          description: errorMessage(scaleResult.reason),
        });
      }

      if (deploymentResult.status === 'fulfilled' && deploymentResult.value) {
        setDeploymentId(deploymentResult.value.id);
        saveRecovery({ ...pointer, deployment: deploymentResult.value.id, phase: undefined });
        onDeploymentAccepted?.();
        toast({
          kind: 'success',
          title: 'Build accepted',
          description: `${repo.trim()}@${normalizedRef} is queued for build.`,
        });
      } else if (deploymentResult.status === 'rejected') {
        setSubmissionError(errorMessage(deploymentResult.reason));
        const err: unknown = deploymentResult.reason;
        saveRecovery({
          ...pointer,
          phase:
            sourceRequested.current && (!(err instanceof ApiError) || err.status >= 500)
              ? 'unknown'
              : 'rejected',
        });
        toast({
          kind: 'error',
          title: 'App created, but build was not submitted',
          description: errorMessage(deploymentResult.reason),
        });
      } else {
        toast({
          kind: 'success',
          title: 'App ready',
          description: `${name} is ready. Deploy it with gregale deploy when you are.`,
        });
      }
    } catch (err) {
      createController.current = null;
      if (!mounted.current) return;
      setDeploying(false);
      setSubmittedSearch(null);
      toast({
        kind: 'error',
        title: 'Could not create the app',
        description: workspaceCreateError(err, workspace),
      });
    }
  }

  function renderCompletion() {
    if (source === 'git' && recovery)
      return (
        <FirstDeploymentRecovery
          recovery={recovery}
          submitting={recovery.phase === 'submitting'}
          submissionError={submissionError}
          onChange={(next) => {
            saveRecovery(next);
            if (next.deployment) {
              setDeploymentId(next.deployment);
              onDeploymentAccepted?.();
            }
          }}
        />
      );
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <PageHeader
          title={onboarding ? 'Your first deployment' : 'New app'}
          description="Track the app and its first deployment from the platform state."
        />

        {source === 'git' ? (
          <DeploymentProgress
            appCreated={Boolean(createdId)}
            appName={name}
            deploymentId={deploymentId}
            repo={repo}
            sourceRef={ref}
            submissionError={submissionError}
            endpoint={visibility === 'internal' ? null : createdUrl}
            appSlug={createdId ?? undefined}
          />
        ) : !createdId ? (
          <Panel title="Creating app">
            <p role="status" className="text-sm text-muted-foreground">
              Saving your configuration. No deployment has started yet.
            </p>
          </Panel>
        ) : !template && catalogTemplate ? (
          <Panel
            title={`${catalogTemplate.name} scaffold`}
            description="The app exists — the CLI writes this template's files into an empty directory, then deploys them."
          >
            <p className="text-xs text-muted-foreground">{catalogTemplate.description}</p>
            <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-border bg-background p-3">
              <code className="font-mono text-xs text-foreground">
                gregale init --template {catalogTemplate.name} && gregale deploy --app {name}
              </code>
              <CopyIconButton
                text={`gregale init --template ${catalogTemplate.name} && gregale deploy --app ${name}`}
                label="Copy the CLI commands"
              />
            </div>
          </Panel>
        ) : template ? (
          <Panel
            title={`${template.name} scaffold`}
            description="The app exists — this code is its first deployment."
          >
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-xs text-muted-foreground">{template.filename}</p>
              <CopyIconButton text={template.code} label={`Copy ${template.filename}`} />
            </div>
            <pre className="mt-2 max-h-72 overflow-auto rounded-lg border border-border bg-background p-3 font-mono text-xs leading-relaxed text-foreground">
              {template.code}
            </pre>
            <ol className="mt-4 flex list-decimal flex-col gap-1.5 pl-5 text-sm text-muted-foreground">
              {template.steps.map((s) => (
                <li key={s}>
                  {s === 'gregale deploy --app' ? (
                    <code className="rounded bg-background px-1.5 py-0.5 font-mono text-xs text-foreground">
                      gregale deploy --app {name}
                    </code>
                  ) : (
                    s
                  )}
                </li>
              ))}
            </ol>
          </Panel>
        ) : (
          <Panel title="App ready" description="No deployment was started.">
            <p className="text-sm text-muted-foreground">
              The app is ready for its first deployment from the CLI or CI.
            </p>
            <code className="mt-4 block overflow-x-auto rounded-lg border border-border bg-background p-3 font-mono text-xs text-foreground">
              gregale deploy --app {name}
            </code>
          </Panel>
        )}

        {createdId && (
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduce ? 0 : 0.3, ease: EASE }}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4"
          >
            {source !== 'git' && (
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">
                  {visibility === 'internal'
                    ? 'Internal service only'
                    : 'App endpoint · available after deployment'}
                </p>
                <p className="break-all font-mono text-xs text-muted-foreground">
                  {visibility === 'internal'
                    ? 'No public endpoint'
                    : (createdUrl ?? 'Waiting for the endpoint…')}
                </p>
              </div>
            )}
            {source === 'git' && (
              <p className="text-xs text-muted-foreground">
                Manage settings and future deployments from the app page.
              </p>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate({ to: '/dashboard/apps' })}
              >
                All apps
              </Button>
              <Button
                variant={source === 'git' ? 'outline' : 'cta'}
                size="sm"
                className="gap-1.5 rounded-md"
                onClick={() =>
                  navigate({
                    to: '/dashboard/apps/$appSlug',
                    params: { appSlug: createdId },
                  })
                }
              >
                View app
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </motion.div>
        )}
      </div>
    );
  }

  // The scan only ever adds a hint below the repository; nothing waits on it.
  function renderScanHint() {
    if (scan.scanning)
      return (
        <p role="status" className="text-[13px] leading-5 text-muted-foreground sm:col-span-2">
          Scanning {repo.trim()}@{normalizedRef} for services…
        </p>
      );
    if (scan.error)
      return (
        <p className="text-[13px] leading-5 text-muted-foreground sm:col-span-2">
          {scanUnavailableReason(scan.error)}
        </p>
      );
    if (!scan.plan) return null;
    const count = scannedWorkloads.length;
    if (count > 1 || scannedRootDir)
      return (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 sm:col-span-2"
        >
          <p className="min-w-0 flex-1 basis-64 text-sm">
            {count > 1 ? (
              <>
                This repository has {count} services. Import it as a project to create them
                together.
              </>
            ) : (
              <>
                The scan found this service in <code className="font-mono">{scannedRootDir}</code>.
                This form deploys the repository as one app; import it as a project to build from
                that directory.
              </>
            )}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={switchToImport}>
            Import as a project
          </Button>
        </div>
      );
    if (count === 1)
      return (
        <p className="text-[13px] leading-5 text-muted-foreground sm:col-span-2">
          One service detected ({detectedFrom})
          {detectedType ? '; it builds its own container image.' : '.'}
        </p>
      );
    return null;
  }

  function renderSources() {
    return (
      <div className="flex flex-col gap-4">
        {/* The step holds GitHub's own connect form, so its controls join
                this form by id rather than by nesting. */}
        <form
          id={`${uid}-source-form`}
          // Empty: its controls join it by id. Hidden, it takes no gap.
          hidden
          noValidate
          aria-label="Choose a source"
          onSubmit={(event) => {
            event.preventDefault();
            if (
              sourceValidation.validate(
                { 'source-git': source ? undefined : sourceErrors['source-git'] },
                event.currentTarget
              )
            )
              changeSearch({
                ...search,
                source,
                step: hasSetup(source) ? 'setup' : 'configure',
              });
          }}
        />
        {/* Each choice moves the wizard on; there is no separate Continue. */}
        <NewAppChooser
          uid={uid}
          formId={`${uid}-source-form`}
          selected={source}
          onSelect={setSource}
          errorId={sourceLevelError ? `${uid}-source-error` : undefined}
          single={onboarding}
        />
        {sourceLevelError && <FieldError id={`${uid}-source-error`}>{sourceLevelError}</FieldError>}

        {!onboarding && <NewAppCapabilities />}
      </div>
    );
  }

  // A source's own page. Container and Worker hand over to the image form,
  // which finishes the flow itself; Import's form is mounted below, kept
  // alive across source switches, and shown in this station's place.
  function renderSetup() {
    const continueButton = (
      <Button
        variant="cta"
        type="submit"
        form={`${uid}-source-form`}
        className="h-10 gap-2 rounded-lg"
      >
        Continue
        <ArrowRight className="h-4 w-4" />
      </Button>
    );
    if (source === 'container' || source === 'worker')
      return <ImageDeployForm kind={source === 'worker' ? 'worker' : 'http'} />;
    if (source === 'import') return null;
    return (
      <div className="flex flex-col gap-8">
        {/* GitHub's own connect form lives here, so this station's
                controls join the form by id rather than by nesting. */}
        <form
          id={`${uid}-source-form`}
          // Empty: its controls join it by id. Hidden, it takes no gap.
          hidden
          noValidate
          aria-label="Set up the source"
          onSubmit={(event) => {
            event.preventDefault();
            if (sourceValidation.validate(sourceErrors, event.currentTarget)) setStep(1);
          }}
        />
        {sourceLevelError && <FieldError id={`${uid}-source-error`}>{sourceLevelError}</FieldError>}
        {source === 'git' && !githubConnected ? (
          <div
            role="status"
            className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-brand/30 bg-brand/5 p-4"
          >
            <div>
              <p className="text-sm font-medium">Connect GitHub first</p>
              <p className="mt-1 max-w-md text-xs text-muted-foreground">
                Gregale uses your GitHub App installation to list repositories and fetch the exact
                ref you deploy.
              </p>
            </div>
            {/* Connecting from New app comes straight back to the Git source.
                    Onboarding keeps the Settings landing its return flag expects. */}
            <GitHubConnectForm
              onConnect={onConnectGitHub}
              returnTo={onConnectGitHub ? undefined : '/dashboard/apps/new?source=git'}
            />
          </div>
        ) : source === 'git' ? (
          <>
            {/* Which repository, then which ref of it: each a quiet heading
                over its control, like New app's source list. */}
            <div className="flex flex-col gap-3">
              <label
                id={`${uid}-repository-label`}
                htmlFor={`${uid}-repository`}
                className="text-sm font-medium text-muted-foreground"
              >
                Repository
              </label>
              <div className="rounded-xl border border-border bg-card">
                <RepoPicker
                  variant="list"
                  labelledBy={`${uid}-repository-label`}
                  id={`${uid}-repository`}
                  name="repository"
                  form={`${uid}-source-form`}
                  {...fieldErrorProps(repoError, `${uid}-repository-error`)}
                  value={repo}
                  onChange={(nextRepo, defaultBranch) => {
                    setRepo(nextRepo);
                    if (defaultBranch) setRef(defaultBranch);
                  }}
                  className={CONTROL}
                />
              </div>
              {repoError && <FieldError id={`${uid}-repository-error`}>{repoError}</FieldError>}
            </div>
            <div className="flex flex-col gap-3">
              <label htmlFor={`${uid}-ref`} className="text-sm font-medium text-muted-foreground">
                Ref
              </label>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <Input
                  id={`${uid}-ref`}
                  name="ref"
                  form={`${uid}-source-form`}
                  {...fieldErrorProps(refError, `${uid}-ref-error`)}
                  value={ref}
                  onChange={(e) => setRef(e.target.value)}
                  placeholder="main"
                  maxLength={200}
                  spellCheck={false}
                  className={cn(CONTROL, 'w-56 font-mono')}
                />
                <span className="text-[13px] text-muted-foreground">
                  Branch, tag, or commit SHA
                </span>
              </div>
              {refError && <FieldError id={`${uid}-ref-error`}>{refError}</FieldError>}
            </div>
            {renderScanHint()}
          </>
        ) : null}

        {source === 'template' && (
          <>
            {templateSlug && !picked && !catalog.isPending && (
              <p role="status" className="text-sm text-muted-foreground">
                This template is unavailable. Choose a starter below or another source.
              </p>
            )}
            <TemplateCatalog
              selected={templateSlug}
              action={picked ? continueButton : undefined}
              onChooseEmpty={() => setSource('empty')}
              onSelect={(slug) =>
                changeSearch({
                  ...search,
                  source: 'template',
                  template: slug,
                  step: undefined,
                })
              }
            />
          </>
        )}

        {/* Continue only where it can lead somewhere: without GitHub the way
            on is the connect notice, and without a pick it is the catalog. */}
        {/* Template's Continue rides in the catalog's bar beside the chosen
            starter, which stays in view; Git's sits under its panel. */}
        {source === 'git' && githubConnected && (
          <div className="flex justify-end">{continueButton}</div>
        )}
      </div>
    );
  }

  function renderConfigure() {
    const nameShown = (nameTouched || configureValidation.submitAttempted) && nameError;
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (configureValidation.validate({ name: nameError }, event.currentTarget)) setStep(2);
        }}
        noValidate
        className="flex flex-col gap-8"
      >
        <SettingsSection id={`${uid}-app-settings`} title="App">
          <SettingRow label="App name" htmlFor="new-app-name">
            <Input
              id="new-app-name"
              name="name"
              aria-describedby={nameShown ? 'new-app-name-error' : undefined}
              aria-invalid={nameShown ? true : undefined}
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase())}
              onBlur={() => setNameTouched(true)}
              className={cn(CONTROL, 'font-mono')}
            />
            {nameShown && (
              <p
                id="new-app-name-error"
                role="alert"
                className="text-[13px] leading-5 text-destructive"
              >
                {nameError}
              </p>
            )}
          </SettingRow>

          <SettingRow
            label="Type"
            htmlFor={`${uid}-type`}
            hintId={`${uid}-type-hint`}
            hint={
              <>
                {APP_TYPES.find((t) => t.id === appType)?.desc}
                {detectedType && appTypeDraft === null && (
                  <> Detected from {detectedFrom} — change it if that is wrong.</>
                )}
              </>
            }
          >
            <Select
              id={`${uid}-type`}
              name="type"
              aria-describedby={`${uid}-type-hint`}
              value={appType}
              onChange={(e) => setAppType(e.target.value as 'function' | 'app')}
              className={CONTROL}
            >
              {APP_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </Select>
          </SettingRow>

          {appType === 'function' && (
            <SettingRow label="Runtime" htmlFor={`${uid}-runtime`}>
              <Select
                id={`${uid}-runtime`}
                name="runtime"
                value={runtime}
                onChange={(e) => setRuntime(e.target.value as Runtime)}
                className={CONTROL}
              >
                {RUNTIMES.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </SettingRow>
          )}

          <SettingRow
            label="App visibility"
            htmlFor={`${uid}-visibility`}
            hintId={`${uid}-visibility-hint`}
            hint={
              <>
                Internal apps have no public platform URL or custom-domain route.
                {visibility === 'internal' && !privateAvailable
                  ? ' Checking private-app availability before creation.'
                  : ''}
              </>
            }
          >
            <Select
              id={`${uid}-visibility`}
              name="visibility"
              aria-describedby={`${uid}-visibility-hint`}
              value={visibility}
              onChange={(event) => setVisibility(event.target.value as 'public' | 'internal')}
              className={CONTROL}
            >
              <option value="public">Public edge and internal service</option>
              <option value="internal">Internal service only</option>
            </Select>
          </SettingRow>
          {/* No region picker: this is a one-box platform and the API
              exposes no region to choose. */}
        </SettingsSection>

        {/* Resources keep sensible defaults, so they stay folded, with what
            they are set to shown on the fold. */}
        <details className="group/res rounded-xl border border-border bg-card">
          <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-xl px-4 py-3 focus-visible:outline-2 focus-visible:outline-brand [&::-webkit-details-marker]:hidden">
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-sm font-medium">Resource settings</span>
              <span className="text-[13px] text-muted-foreground">
                {selectedMemoryMb} MB ·{' '}
                {effectiveScaleToZero ? 'Parks when idle' : 'One instance kept resident'}
              </span>
            </span>
            <NavArrowDown
              aria-hidden
              className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open/res:rotate-180 motion-reduce:transition-none"
            />
          </summary>
          <div className="@container flex flex-col divide-y divide-border border-t border-border">
            <SettingRow
              label="Memory"
              hint={
                account ? (
                  `${account.plan} plan · up to ${account.limits.ram_mb} MB per instance`
                ) : limitsLoading ? (
                  <span role="status">Checking plan limits…</span>
                ) : undefined
              }
            >
              <MemorySelect
                value={selectedMemoryMb}
                maxMb={limitsLoading ? undefined : account?.limits.ram_mb}
                onChange={setMemoryMb}
              />
            </SettingRow>
            <SettingRow
              label="Scale to zero"
              hint={
                <>
                  Park the app when idle; the next request wakes it.
                  {account && !canKeepResident && (
                    <span id="scale-to-zero-plan-note" className="mt-1 block">
                      Keeping an instance resident requires a paid plan.
                    </span>
                  )}
                </>
              }
            >
              <Switch
                checked={effectiveScaleToZero}
                disabled={!canKeepResident}
                onCheckedChange={setScaleToZero}
                aria-label="Scale to zero"
                aria-describedby={!canKeepResident ? 'scale-to-zero-plan-note' : undefined}
                className="data-[state=checked]:bg-brand"
              />
            </SettingRow>
          </div>
        </details>

        <div className="flex items-center justify-between">
          <Button type="button" variant="ghost" onClick={() => setStep(0)} className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <Button variant="cta" type="submit" className="h-10 gap-2 rounded-lg">
            Review
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </form>
    );
  }

  function renderReview() {
    return (
      <div className="flex flex-col gap-6">
        <NewAppReviewGrid rows={rows} />
        <div className="flex flex-col gap-2 text-[13px] leading-5 text-muted-foreground">
          <p>
            {visibility === 'internal'
              ? 'Internal apps get no public URL; other apps in this account call them through service routing.'
              : 'The URL follows the app name; the platform confirms it when the app is created.'}
          </p>
          {workspace.org && (
            <p>
              Created in {workspace.label}, so it is listed in that workspace. You stay its owner:
              its settings, quota, and billing remain with your account.
            </p>
          )}
          {account && (
            <p
              role={quotaExceeded ? 'alert' : 'status'}
              className={cn(quotaExceeded && 'text-foreground')}
            >
              {quotaExceeded ? (
                <>
                  You have reached the {account.plan} plan limit of {account.limits.deployed_apps}{' '}
                  app
                  {account.limits.deployed_apps === 1 ? '' : 's'}.{' '}
                  <Link to="/dashboard/plans" className="text-brand hover:underline">
                    Upgrade your plan
                  </Link>{' '}
                  to deploy another app.
                </>
              ) : (
                <>
                  {account.plan} plan · {quotaRemaining} app
                  {quotaRemaining === 1 ? '' : 's'} available · up to {account.limits.ram_mb} MB per
                  app.
                </>
              )}
            </p>
          )}
        </div>

        {blockedReason && (
          <p
            id={`${uid}-blocked`}
            role="status"
            className="text-right text-[13px] leading-5 text-muted-foreground"
          >
            {blockedReason}
          </p>
        )}
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => setStep(1)} className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <Button
            variant="cta"
            disabled={
              deployBlocked ||
              !nameValid ||
              !gitSourceValid ||
              (source === 'git' && !githubConnected)
            }
            aria-describedby={blockedReason ? `${uid}-blocked` : undefined}
            onClick={() => void createFunction()}
            className="h-10 gap-2 rounded-lg px-6"
          >
            {source === 'git' ? 'Deploy app' : 'Create app'}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  const form = (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 text-[length:var(--console-body-size,0.875rem)] leading-[var(--console-body-leading,1.5714)]">
      {/* One tree, before and during creation: the content column swaps the
          station for the completion, so the import draft below it (and the
          rest of the form state) survives a failed attempt from any source. */}
      {!deploying && (
        <NewAppHeader
          title={onboarding ? 'Deploy your first app' : 'New app'}
          description={
            onboarding
              ? 'Choose a Git repository, configure its runtime, and watch the real build go live.'
              : template
                ? `Starting from the ${template.name} template — source, runtime, and memory are prefilled; the scaffold arrives once the app exists.`
                : 'Choose a source to create your app.'
          }
          back={!onboarding}
        />
      )}
      <div className="@container flex min-w-0 flex-col gap-6">
        {deploying && renderCompletion()}
        {/* The stage stays mounted while creating, emptied and hidden, so the
            import draft in its persistent slot survives a failed attempt. */}
        <div hidden={deploying}>
          <NewAppStage
            station={station}
            label={
              station === 'sources'
                ? 'Choose a source'
                : station === 'setup' && source
                  ? sourceName(source)
                  : station === 'configure'
                    ? 'Configure'
                    : 'Review'
            }
            back={
              station !== 'sources' && !onboarding
                ? station === 'setup' || (station === 'configure' && !hasSetup(source))
                  ? { label: 'Sources', onBack: toSources }
                  : station === 'configure'
                    ? { label: 'Setup', onBack: () => setStep(0) }
                    : { label: 'Configure', onBack: () => setStep(1) }
                : undefined
            }
            persistent={
              // Kept mounted through source switches and creation, including a
              // failed attempt from another source; shown on Import's Setup.
              !onboarding && (
                <div hidden={deploying || source !== 'import' || station !== 'setup'}>
                  <ProjectImport
                    key={importHandoff?.seed ?? 0}
                    initialSlug={importHandoff?.slug ?? search.slug}
                    initialBranch={importHandoff?.branch ?? search.branch}
                  />
                </div>
              )
            }
          >
            {!deploying && station === 'sources' && renderSources()}
            {!deploying && station === 'setup' && renderSetup()}
            {!deploying && station === 'configure' && renderConfigure()}
            {!deploying && station === 'review' && renderReview()}
          </NewAppStage>
        </div>
      </div>
    </div>
  );

  return form;
}
