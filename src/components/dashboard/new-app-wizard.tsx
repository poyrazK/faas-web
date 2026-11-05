import { sampleVersion, type OnboardingDraft } from '@/lib/onboarding-draft';
import { resourceId } from '@/lib/resource-id';
import type { Deployment } from '@/lib/api/queries';
import { MemorySelect } from './memory-select';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useUnsavedGuard } from '@/lib/use-unsaved-guard';
import { FUNCTION_STARTERS, languageOf, type FunctionLanguage } from '@/lib/function-starters';
import { gzip, tarball } from '@/lib/tar';
import { RepoPicker } from '@/components/dashboard/repo-picker';
import { GitHubConnectForm } from '@/components/dashboard/github-connect-form';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowRight, Check, RefreshDouble } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { FieldError, Select, fieldErrorProps, useFormValidation } from '@/components/ui/field';
import { appNameError, appNameFromRepo } from './new-app-validation';
import { SCAN_SOURCE_LABEL, scanUnavailableReason } from './scan-source';
import { useToast } from '@/components/ui/toast';
import { DeploymentProgress } from '@/components/dashboard/deployment-progress';
import {
  isValidGitHubRepo,
  isValidGitRef,
  newAppPath,
  type AppSource,
  type NewAppSearch,
  type DeploymentRecoveryContext,
} from '@/components/dashboard/new-app-source';
import { TemplateCatalog } from '@/components/dashboard/template-catalog';
import { rememberGitHubDeployment } from '@/lib/deployment-handoff';
import { ProjectImport } from '@/components/dashboard/project-import';
import { NewAppCapabilities } from './new-app-capabilities';
import { summaryRows } from './new-app-summary';
import { NewAppChooser } from './new-app-chooser';
import { NewAppHeader, NewAppReviewGrid } from './new-app-rail';
import { hasSetup, stationFor, stepForStation, type Station } from './new-app-station';
import { NewAppStage } from './new-app-layout';
import {
  AdvancedSettings,
  APP_ACCESS_OPTIONS,
  SettingChoices,
  SettingRow,
  SettingsSection,
} from './new-app-settings';
import { sourceName } from './new-app-sources';
import { ImageDeployForm } from './image-deploy-form';
import { FunctionSource } from './function-source';
import { CopyIconButton } from '@/components/ui/copy-button';
import { DEPLOY_STEP, templateBySlug } from '@/lib/templates';
import { cliDeployCommand, cliInitDeployCommand } from '@/lib/cli-commands';
import { type Runtime } from '@/lib/mock-data';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useData } from '@/lib/store';
import { useWorkspaceTarget, workspaceCreateError } from '@/lib/api/workspace-apps';
import {
  useBindRepoFor,
  useDeployFromRefFor,
  useDeployFunctionSourceFor,
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

type SourceField = 'source-git' | 'source-template' | 'repository' | 'ref' | 'handler';

/** The set `apid` accepts on `POST /v1/apps`; anything else is a 400. */
const RUNTIMES: { id: Runtime; label: string }[] = [
  { id: 'node22', label: 'Node 22' },
  { id: 'node24', label: 'Node 24' },
  { id: 'python312', label: 'Python 3.12' },
  { id: 'python313', label: 'Python 3.13' },
  { id: 'go124', label: 'Go 1.24' },
  { id: 'go124-alpine', label: 'Go 1.24 (Alpine)' },
];

const APP_TYPES = [
  {
    value: 'function',
    label: 'Function handler',
    description: 'Gregale calls your handler for each request.',
  },
  {
    value: 'app',
    label: 'Web app or API',
    description: 'Your code runs an HTTP server, using a framework or Dockerfile.',
  },
] as const;

const RUNTIME_LANGUAGES = [
  { id: 'node', label: 'JavaScript (Node.js)', defaultRuntime: 'node22' },
  { id: 'python', label: 'Python', defaultRuntime: 'python312' },
  { id: 'go', label: 'Go', defaultRuntime: 'go124' },
] as const;
const runtimeLanguage = (runtime: Runtime) =>
  runtime.startsWith('python') ? 'python' : runtime.startsWith('go') ? 'go' : 'node';

// A full commit SHA: what a compatibility check hands over to deploy exactly.
const FULL_SHA = /^[a-f0-9]{40}$/i;

// A handler written in the browser is one small file; anything bigger is a
// project, which deploys better from a repository or the CLI.
const HANDLER_MAX_BYTES = 256 * 1024;

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
  /** Compact first-signup presentation; uses the same mutation owner. */
  quickstart?: boolean;
  /** Confirm the onboarding workspace inventory before allowing a mutation. */
  deploymentDisabled?: boolean;
  suggestedName?: string;
  onDraftChange?: (draft: OnboardingDraft) => void;
  onProgress?: (draft: OnboardingDraft) => void;
  onDeploymentLive?: (deployment: Deployment) => void;
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
        onLive={props.onDeploymentLive}
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
  quickstart = false,
  deploymentDisabled = false,
  suggestedName,
  onDraftChange,
  onProgress,
  onDeploymentLive,
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
  const initialName = template?.slug ?? catalogTemplate?.name ?? suggestedName ?? '';
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
  // A compatibility check can hand over the repository and the exact commit
  // it checked (`?repo=&ref=`); after that, typing here stays local.
  const [repo, setRepo] = useState(search.repo ?? '');
  const [ref, setRef] = useState(search.ref ?? 'main');
  // Whether the installation can see the chosen repository: one carried in
  // from elsewhere may not be.
  const [repoAccessible, setRepoAccessible] = useState(true);
  const [nameDraft, setName] = useState<string | null>(quickstart ? (suggestedName ?? null) : null);
  const [nameTouched, setNameTouched] = useState(false);
  // A chosen repository names the app until the customer types a name of
  // their own; their typing (even clearing the field) always wins.
  const repoName = source === 'git' ? appNameFromRepo(repo) : '';
  const name = nameDraft ?? (repoName || initialName);
  const bindRepo = useBindRepoFor();
  const deployFromRef = useDeployFromRefFor();
  const deployFunctionSource = useDeployFunctionSourceFor();
  const updateApp = useUpdateAppFor();
  const [appTypeDraft, setAppType] = useState<'function' | 'app' | null>(null);
  const [visibility, setVisibility] = useState<'public' | 'internal'>('public');
  const [runtimeDraft, setRuntime] = useState<Runtime | null>(null);
  // A function written here: its language decides the file and the runtimes
  // it can run on; an untouched starter follows the language.
  const [fnLanguage, setFnLanguage] = useState<FunctionLanguage>('node');
  const [fnCode, setFnCode] = useState(FUNCTION_STARTERS.node.code);
  const fnStarter = FUNCTION_STARTERS[fnLanguage];
  const fnEdited = fnCode !== fnStarter.code;
  const chooseFnLanguage = (next: FunctionLanguage) => {
    if (next === fnLanguage) return;
    if (!fnEdited) setFnCode(FUNCTION_STARTERS[next].code);
    setFnLanguage(next);
    setRuntime(FUNCTION_STARTERS[next].runtime);
  };
  const runtime: Runtime =
    source === 'function'
      ? runtimeDraft && languageOf(runtimeDraft) === fnLanguage
        ? runtimeDraft
        : fnStarter.runtime
      : (runtimeDraft ?? template?.runtime ?? (picked ? catalogRuntime : null) ?? 'node22');
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
  const creationLock = useRef(false);
  function saveRecovery(next: DeploymentRecoveryContext) {
    setRecovery(next);
    onSearchChange?.({ ...search, recovery: next }, { replace: true });
  }

  // A half-filled wizard asks before it is discarded. Once the app exists
  // (or nothing was typed) leaving is free. A template's prefilled name is
  // not the user's typing — only their own edits arm the guard.
  useUnsavedGuard(
    !quickstart &&
      !createdId &&
      (Boolean(repo.trim() || (name.trim() && name !== initialName)) ||
        (source === 'function' && fnEdited)),
    undefined,
    onboarding ? '/onboarding' : '/dashboard/apps/new'
  );

  // A name prefilled from a repository can easily match an app the account
  // already has; say so on Configure rather than as a 409 after Deploy.
  const knownApps = useApps(
    quickstart ? { retry: false } : undefined,
    quickstart ? account?.id : undefined
  );
  const nameError =
    appNameError(name) ??
    ((knownApps.data ?? []).some((app) => app.slug === name)
      ? `You already have an app named ${name}. Choose another name.`
      : undefined);
  const nameValid = !nameError;
  const normalizedRef = ref.trim() || 'main';
  function onboardingDraft(
    phase: OnboardingDraft['phase'],
    app?: string,
    deployment?: string
  ): OnboardingDraft {
    const common = { phase, name, ...(app ? { app } : {}), ...(deployment ? { deployment } : {}) };
    return source === 'git'
      ? { ...common, kind: 'git', repo: repo.trim(), ref: normalizedRef }
      : { ...common, kind: 'sample', starter: sampleVersion() };
  }
  useEffect(() => {
    if (quickstart && !createdId && !deploying) onDraftChange?.(onboardingDraft('preparing'));
    // The fields, rather than a new object each render, own draft persistence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickstart, name, repo, normalizedRef, source, createdId, deploying, onDraftChange]);
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
  const appType = source === 'function' ? 'function' : (appTypeDraft ?? detectedType ?? 'function');
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
    if (quickstart) {
      void navigate({
        to: '/dashboard/apps/new',
        search: { source: 'import', slug: scanProjectSlug, branch: normalizedRef },
      });
      return;
    }
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
  const handlerError =
    source !== 'function'
      ? undefined
      : !fnCode.trim()
        ? 'Write the handler, or upload a file.'
        : new TextEncoder().encode(fnCode).length > HANDLER_MAX_BYTES
          ? 'The handler is over 256 KB. Deploy it from a repository or the CLI instead.'
          : undefined;
  // Where a GitHub connection returns: this source, with this repository and ref.
  // A named source lands on its Setup, so `source=git` is all it needs.
  const gitReturn: NewAppSearch = {
    source: 'git',
    ...(repo.trim() ? { repo: repo.trim(), ref: normalizedRef } : {}),
  };
  const sourceValid =
    !handlerError &&
    Boolean(source) &&
    source !== 'import' &&
    (source !== 'template' || picked) &&
    gitSourceValid &&
    (source !== 'git' || (githubConnected && repoAccessible));
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
        : source === 'git' && githubConnected && !repoAccessible
          ? 'Your GitHub installation cannot see this repository. Grant it access, or choose another.'
          : undefined,
    ref:
      source === 'git' && githubConnected && !refValid
        ? 'Use a valid branch, tag, or commit SHA of at most 200 characters.'
        : undefined,
    handler: handlerError,
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
    (quickstart &&
      (deploymentDisabled ||
        !account?.id ||
        !workspace.ready ||
        knownApps.isPending ||
        Boolean(knownApps.error))) ||
    limitsLoading ||
    quotaExceeded ||
    !memoryAllowed(account, selectedMemoryMb) ||
    (visibility === 'internal' && !privateAvailable);

  // The platform names the app's URL after its slug, so review can show it
  // before create; the zone comes from an app the account already has.
  const predictedUrl = nameValid ? predictedAppUrl(name, knownApps.data ?? []) : undefined;

  // A disabled Deploy always says why. The plan-limit case already has its
  // own alert in the review panel, so it is not repeated here.
  const blockedReason =
    quickstart && (deploymentDisabled || knownApps.isPending || knownApps.error)
      ? 'Confirm your app inventory before deploying. Retry the app lookup if it failed.'
      : limitsLoading
        ? 'Checking your plan limits before creating the app…'
        : quotaExceeded
          ? undefined
          : !memoryAllowed(account, selectedMemoryMb)
            ? `${selectedMemoryMb} MB is above your plan's per-app memory. Lower it in Advanced settings.`
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
    handlerFile: source === 'function' ? fnStarter.filename : undefined,
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
      // A checked commit pins the first build; it is not a branch to watch.
      // Empty lets the binding select the repository's default branch.
      branch: FULL_SHA.test(normalizedRef) ? '' : normalizedRef,
    });
    if (quickstart && !mounted.current)
      throw new Error('The account changed before source submission.');
    sourceRequested.current = true;
    return deployFromRef.mutateAsync({
      slug,
      repo: repo.trim(),
      ref: normalizedRef,
      format: 'tarball',
    });
  }

  async function submitFunctionSource(slug: string) {
    const archive = await gzip(
      tarball([{ name: fnStarter.filename, content: fnCode }, ...fnStarter.extra])
    );
    if (quickstart && !mounted.current)
      throw new Error('The account changed before source submission.');
    sourceRequested.current = true;
    return deployFunctionSource.mutateAsync({ slug, archive, runtime });
  }

  async function createFunction() {
    if (quickstart && creationLock.current) return;
    if (deployBlocked || !nameValid || !sourceValid) {
      return;
    }
    if (quickstart) creationLock.current = true;
    if (quickstart) onProgress?.(onboardingDraft('creating'));
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
      if (quickstart && !mounted.current) return;
      if (quickstart && appNameError(created.id))
        throw new Error('The API did not identify the created app. Check your app inventory.');
      if (quickstart) onProgress?.(onboardingDraft('submitting', created.id));
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
        source === 'git' && gitSourceValid
          ? submitGitSource(created.id)
          : source === 'function'
            ? submitFunctionSource(created.id)
            : Promise.resolve(null);

      const [scaleResult, deploymentResult] = await Promise.allSettled([
        scalePromise,
        deploymentPromise,
      ]);

      if (scaleResult.status === 'rejected') {
        toast({
          kind: 'error',
          title: 'App created, but configuration failed',
          error: scaleResult.reason,
        });
      }

      if (deploymentResult.status === 'fulfilled' && deploymentResult.value) {
        if (quickstart && !mounted.current) return;
        if (quickstart && !resourceId(deploymentResult.value.id)) {
          onProgress?.(onboardingDraft('unknown', created.id));
          return;
        }
        if (quickstart)
          onProgress?.(onboardingDraft('accepted', created.id, deploymentResult.value.id));
        setDeploymentId(deploymentResult.value.id);
        if (source === 'git')
          saveRecovery({ ...pointer, deployment: deploymentResult.value.id, phase: undefined });
        onDeploymentAccepted?.();
        toast({
          kind: 'success',
          title: 'Build accepted',
          description:
            source === 'function'
              ? `${fnStarter.filename} is queued for build.`
              : `${repo.trim()}@${normalizedRef} is queued for build.`,
        });
      } else if (deploymentResult.status === 'rejected') {
        if (quickstart && !mounted.current) return;
        if (quickstart)
          onProgress?.(
            onboardingDraft(
              sourceRequested.current &&
                (!(deploymentResult.reason instanceof ApiError) ||
                  deploymentResult.reason.status >= 500)
                ? 'unknown'
                : 'rejected',
              created.id
            )
          );
        setSubmissionError(errorMessage(deploymentResult.reason));
        const err: unknown = deploymentResult.reason;
        // Recovery retries a Git ref; a handler written here is still on the page.
        if (source === 'git')
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
          error: deploymentResult.reason,
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
      if (quickstart && (!(err instanceof ApiError) || err.status >= 500)) {
        onProgress?.(onboardingDraft('unknown'));
        return;
      }
      if (quickstart) {
        creationLock.current = false;
        onProgress?.(onboardingDraft('preparing'));
      }
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
          onLive={onDeploymentLive}
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
    // Git and functions deploy right away, so their progress is the page;
    // Template and Empty end at the app, with the command that deploys it.
    const tracked = source === 'git' || source === 'function';
    const command = (text: string, label: string) => (
      <div className="flex min-w-0 items-center gap-1 rounded-md bg-muted py-1 pl-3 pr-1">
        <span aria-hidden className="select-none font-mono text-xs text-muted-foreground">
          $
        </span>
        <code className="min-w-0 overflow-x-auto whitespace-nowrap font-mono text-xs text-foreground">
          {text}
        </code>
        <CopyIconButton text={text} label={label} className="ml-auto" />
      </div>
    );
    return (
      <div className="flex flex-col gap-8">
        <NewAppHeader title={onboarding ? 'Your first deployment' : name} />

        {tracked ? (
          <DeploymentProgress
            source={
              source === 'function'
                ? { kind: 'upload', label: `${fnStarter.filename}, written here` }
                : undefined
            }
            onLive={onDeploymentLive}
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
          <div className="flex items-start gap-3.5 rounded-xl border border-border bg-card px-4 py-4">
            <span
              aria-hidden
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-brand"
            >
              <RefreshDouble className="h-[18px] w-[18px] animate-spin motion-reduce:animate-none" />
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <h2 className="text-base font-medium">Creating app</h2>
              <p role="status" className="text-[13px] leading-5 text-muted-foreground">
                Saving your configuration. No deployment has started yet.
              </p>
            </div>
          </div>
        ) : (
          <section aria-labelledby={`${uid}-next`} className="flex flex-col gap-3">
            <h2 id={`${uid}-next`} className="text-sm font-medium text-muted-foreground">
              Next step
            </h2>
            <div className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
              <div className="flex items-start gap-3.5 px-4 py-4">
                <span
                  aria-hidden
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand/15 text-brand"
                >
                  <Check className="h-[18px] w-[18px]" />
                </span>
                <div className="flex min-w-0 flex-col gap-1">
                  <h3 className="text-base font-medium">
                    {!template && catalogTemplate
                      ? `${catalogTemplate.name} scaffold`
                      : template
                        ? `${template.name} scaffold`
                        : 'App ready'}
                  </h3>
                  <p className="text-[13px] leading-5 text-muted-foreground">
                    {!template && catalogTemplate
                      ? "The app exists. The CLI writes this template's files into an empty directory, then deploys them."
                      : template
                        ? 'The app exists. This code is its first deployment.'
                        : 'No deployment was started. The app is ready for its first one, from the CLI or CI.'}
                  </p>
                </div>
              </div>
              {!template && catalogTemplate ? (
                <div className="px-4 py-4">
                  {command(cliInitDeployCommand(catalogTemplate.name, name), 'the CLI commands')}
                </div>
              ) : template ? (
                <div className="flex flex-col gap-3 px-4 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-mono text-[13px] text-muted-foreground">
                      {template.filename}
                    </p>
                    <CopyIconButton text={template.code} label={`Copy ${template.filename}`} />
                  </div>
                  <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed text-foreground">
                    {template.code}
                  </pre>
                  <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[13px] text-muted-foreground">
                    {template.steps.map((st) => (
                      <li key={st}>
                        {st === DEPLOY_STEP ? (
                          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                            {cliDeployCommand(name)}
                          </code>
                        ) : (
                          st
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
              ) : (
                <div className="px-4 py-4">
                  {command(cliDeployCommand(name), cliDeployCommand(name))}
                </div>
              )}
              <div className="flex flex-col gap-0.5 px-4 py-3">
                <p className="text-[13px] text-muted-foreground">
                  {visibility === 'internal'
                    ? 'Internal service only'
                    : 'App endpoint · available after deployment'}
                </p>
                <p className="break-all font-mono text-sm">
                  {visibility === 'internal'
                    ? 'No public endpoint'
                    : (createdUrl ?? 'Waiting for the endpoint…')}
                </p>
              </div>
            </div>
          </section>
        )}

        {createdId && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate({ to: '/dashboard/apps' })}>
              All apps
            </Button>
            <Button
              variant={tracked ? 'outline' : 'cta'}
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
    if (source === 'function')
      return (
        <div className="flex flex-col gap-8">
          <form
            id={`${uid}-source-form`}
            hidden
            noValidate
            aria-label="Write the function"
            onSubmit={(event) => {
              event.preventDefault();
              if (sourceValidation.validate(sourceErrors, event.currentTarget)) setStep(1);
            }}
          />
          {quickstart ? (
            <details className="rounded-lg border border-border p-4">
              <summary className="cursor-pointer text-sm">View sample code</summary>
              <pre className="mt-3 overflow-x-auto text-xs">
                <code>{FUNCTION_STARTERS.node.code}</code>
              </pre>
            </details>
          ) : (
            <FunctionSource
              formId={`${uid}-source-form`}
              language={fnLanguage}
              code={fnCode}
              edited={fnEdited}
              error={sourceShown ? handlerError : undefined}
              errorId={`${uid}-handler-error`}
              onLanguage={chooseFnLanguage}
              onCode={setFnCode}
              onReset={() => setFnCode(fnStarter.code)}
              onBrowseStarters={() =>
                changeSearch({ ...search, source: 'template', template: undefined, step: 'setup' })
              }
            />
          )}
          <div className="flex justify-end">{continueButton}</div>
        </div>
      );
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
                Connect your GitHub account to choose a repository and the version to deploy.
                {quickstart && ' Signing in with GitHub does not grant repository access.'}
              </p>
            </div>
            {/* Connecting from New app comes straight back to the Git source,
                with the repository and ref already chosen. Onboarding keeps the
                Settings landing its return flag expects, and a hand-off brings
                it back to the same choice. */}
            <GitHubConnectForm
              onConnect={() => {
                if (onboarding) rememberGitHubDeployment(gitReturn, true);
                onConnectGitHub?.();
              }}
              returnTo={onConnectGitHub ? undefined : newAppPath(gitReturn)}
            />
            {repo.trim() && (
              <p className="w-full break-all text-[13px] text-muted-foreground">
                Continues with{' '}
                <span className="font-mono text-foreground">
                  {repo.trim()}@{normalizedRef}
                </span>{' '}
                after connecting.
              </p>
            )}
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
                  onAvailabilityChange={setRepoAccessible}
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
                Branch, tag or commit
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
                  The exact version of your code to deploy.
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
          if (configureValidation.validate({ name: nameError }, event.currentTarget)) {
            if (quickstart) void createFunction();
            else setStep(2);
          }
        }}
        noValidate
        className="flex flex-col gap-8"
      >
        <SettingsSection id={`${uid}-app-settings`} title="App">
          <SettingRow
            label="App name"
            htmlFor="new-app-name"
            hint="A short name used in the console and URLs."
          >
            <Input
              id="new-app-name"
              name="name"
              placeholder="my-app"
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

          {quickstart && source === 'function' && (
            <details className="rounded-lg border border-border p-4">
              <summary className="cursor-pointer text-sm">View sample code</summary>
              <pre className="mt-3 overflow-x-auto whitespace-pre-wrap font-mono text-xs">
                {fnStarter.code}
              </pre>
            </details>
          )}
          {source !== 'function' && (
            <SettingRow
              label="How does your code run?"
              labelId={`${uid}-type-label`}
              hint={
                detectedType && appTypeDraft === null
                  ? `Detected from ${detectedFrom}. You can change this choice.`
                  : undefined
              }
            >
              <SettingChoices
                labelId={`${uid}-type-label`}
                value={appType}
                onChange={setAppType}
                options={APP_TYPES}
              />
            </SettingRow>
          )}
          {appType === 'function' && source !== 'function' && (
            <SettingRow
              label="Language"
              htmlFor={`${uid}-language`}
              hint="Choose the language your handler is written in."
            >
              <Select
                id={`${uid}-language`}
                value={runtimeLanguage(runtime)}
                className={CONTROL}
                onChange={(event) => {
                  const language = RUNTIME_LANGUAGES.find((item) => item.id === event.target.value);
                  if (language && language.id !== runtimeLanguage(runtime))
                    setRuntime(language.defaultRuntime);
                }}
              >
                {RUNTIME_LANGUAGES.map((language) => (
                  <option key={language.id} value={language.id}>
                    {language.label}
                  </option>
                ))}
              </Select>
            </SettingRow>
          )}
          {source === 'function' && (
            <SettingRow
              label="Your function"
              hint={
                quickstart
                  ? 'The sample handler Gregale will deploy.'
                  : 'The handler you wrote in the previous step.'
              }
            >
              <p className="text-sm">
                {fnStarter.label} · <code className="font-mono">{fnStarter.filename}</code>
              </p>
            </SettingRow>
          )}
          <SettingRow
            label="Who can reach this app?"
            labelId={`${uid}-visibility-label`}
            hint={
              visibility === 'internal' && !privateAvailable
                ? 'Checking private-app availability before creation.'
                : undefined
            }
          >
            <SettingChoices
              labelId={`${uid}-visibility-label`}
              value={visibility}
              onChange={setVisibility}
              options={APP_ACCESS_OPTIONS}
            />
          </SettingRow>
          {/* No region picker: this is a one-box platform and the API
              exposes no region to choose. */}
        </SettingsSection>

        <AdvancedSettings
          summary={
            <>
              {appType === 'function' && `${RUNTIMES.find((r) => r.id === runtime)?.label} · `}
              {selectedMemoryMb} MB memory ·{' '}
              {effectiveScaleToZero ? 'Sleeps when idle' : 'Keeps one instance running'}
            </>
          }
        >
          {appType === 'function' && (
            <SettingRow
              label="Runtime version"
              htmlFor={`${uid}-runtime`}
              hint="The version used to run your handler."
            >
              <Select
                id={`${uid}-runtime`}
                name="runtime"
                value={runtime}
                onChange={(e) => setRuntime(e.target.value as Runtime)}
                className={CONTROL}
              >
                {RUNTIMES.filter((r) => runtimeLanguage(r.id) === runtimeLanguage(runtime)).map(
                  (r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  )
                )}
              </Select>
            </SettingRow>
          )}
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
            label="Sleep when idle"
            hint={
              <>
                The app sleeps when idle and wakes for the next request. Turn this off to keep one
                instance running.
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
              aria-label="Sleep when idle"
              aria-describedby={!canKeepResident ? 'scale-to-zero-plan-note' : undefined}
              className="data-[state=checked]:bg-brand"
            />
          </SettingRow>
        </AdvancedSettings>

        <p className="text-sm leading-relaxed text-muted-foreground">
          {quickstart
            ? 'Gregale will create the app and deploy this code using the choices above.'
            : source === 'git'
              ? `Next, review your choices. Gregale will create the app and build ${repo.trim()} at ${normalizedRef}.`
              : source === 'function'
                ? 'Next, review your choices. Gregale will create the app and deploy your handler.'
                : source === 'template'
                  ? 'Next, create the app. You’ll get CLI commands to download the starter and deploy its code.'
                  : 'Next, create the app. It will be ready for you to deploy code with the CLI.'}
        </p>
        {quickstart && (
          <p className="text-sm text-muted-foreground">
            {account?.plan} plan · {selectedMemoryMb} MB ·{' '}
            {effectiveScaleToZero ? 'Sleeps when idle' : 'Keeps an instance running'}.{' '}
            {visibility === 'public'
              ? 'Your app will have a public URL.'
              : 'Your app is internal only.'}{' '}
            Requests use your compute allowance.
          </p>
        )}
        {quickstart && blockedReason && (
          <p role="status" className="text-sm text-muted-foreground">
            {blockedReason}
          </p>
        )}
        {/* The way back is in the header; this row holds only the way on. */}
        <div className="flex justify-end">
          <Button
            variant="cta"
            type="submit"
            disabled={quickstart && deployBlocked}
            className="h-10 gap-2 rounded-lg"
          >
            {quickstart ? (source === 'function' ? 'Deploy sample' : 'Deploy app') : 'Review'}
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
        <div className="flex justify-end">
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
            {source === 'git'
              ? 'Deploy app'
              : source === 'function'
                ? 'Deploy function'
                : 'Create app'}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  // Each page names its own step. The flows with a Configure and a Review
  // (Git, Template, Empty) count three steps; the sources that finish on
  // their own page are one page, so they carry no count.
  function header(): Parameters<typeof NewAppHeader>[0] {
    const counted =
      source === 'git' || source === 'function' || source === 'template' || source === 'empty';
    const of = (n: number) => (counted ? `Step ${n} of 3` : undefined);
    if (station === 'sources')
      return onboarding
        ? {
            title: 'Deploy your first app',
            description: 'Choose a Git repository, configure it, and watch the real build go live.',
          }
        : { title: 'New app', back: 'apps' };
    if (station === 'setup') {
      const back = onboarding ? undefined : { label: 'Sources', onBack: toSources };
      if (onboarding)
        return {
          step: of(1),
          title: 'Deploy your first app',
          description:
            source === 'function'
              ? 'Deploy a working function with no repository.'
              : 'Choose a repository and the branch, tag or commit to deploy.',
        };
      const page: Record<AppSource, { title: string; description: string }> = {
        git: {
          title: 'Pick a repository',
          description: 'Choose your code and the branch, tag or commit to deploy.',
        },
        function: {
          title: 'Write a function',
          description: 'Choose a language, then write the code Gregale will run for each request.',
        },
        template: {
          title: 'Pick a starter',
          description:
            'Choose starter code for your app. After creation, use the CLI to download and deploy it.',
        },
        empty: { title: 'Empty app', description: '' },
        container: {
          title: 'Run a container image',
          description:
            'Choose the image for your website or API. Gregale will create the app and deploy it.',
        },
        worker: {
          title: 'Run a worker',
          description:
            'Run your image continuously in the background. Workers have no public URL and are billed while running.',
        },
        import: {
          title: 'Import a project',
          description:
            'Upload a repository archive. Preview the apps Gregale can create before you confirm.',
        },
      };
      return { step: of(1), back, ...page[source ?? 'git'] };
    }
    if (station === 'configure')
      return {
        step: quickstart ? undefined : of(2),
        title: quickstart
          ? source === 'function'
            ? 'Deploy a sample'
            : 'Deploy your repository'
          : 'Set up your app',
        description:
          'Choose how your code runs and who can reach it. Fine-tune the defaults in Advanced settings.',
        back:
          quickstart && source === 'function'
            ? undefined
            : hasSetup(source)
              ? { label: 'Setup', onBack: () => setStep(0) }
              : onboarding
                ? undefined
                : { label: 'Sources', onBack: toSources },
      };
    return {
      step: of(3),
      title: 'Review',
      description:
        source === 'git' || source === 'function'
          ? 'Check what will be created and deployed.'
          : 'Create the app now. Deploy its code later with the CLI.',
      back: { label: 'Configure', onBack: () => setStep(1) },
    };
  }

  const form = (
    <div
      className={`mx-auto flex w-full flex-col gap-6 text-[length:var(--console-body-size,0.875rem)] leading-[var(--console-body-leading,1.5714)] ${station === 'sources' ? 'max-w-[640px]' : 'max-w-3xl'}`}
    >
      {/* One tree, before and during creation: the content column swaps the
          station for the completion, so the import draft below it (and the
          rest of the form state) survives a failed attempt from any source. */}
      {!deploying && <NewAppHeader {...header()} />}
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
